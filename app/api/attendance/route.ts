import {env} from 'cloudflare:workers';
import {accountReply,ownerIdentity,sameOrigin} from '../../../lib/account-auth';
import {attendanceDate,attendanceDay,attendancePrograms,attendanceToday,practiceRoster} from '../../../lib/program-attendance';
import {checkCompetitionAccess,familyProfile} from '../../../lib/program-approval';
import {usaCardLabels} from '../../../lib/usa-card';
import {isTestWrestler} from '../../../lib/test-family';

export const dynamic='force-dynamic';

export async function GET(request:Request){
 const auth=await ownerIdentity(request),reply=(body:unknown,status=200)=>accountReply(body,status,auth.headers);
 if(!auth.owner)return reply({error:'Owner access required.'},403);
 const query=new URL(request.url).searchParams;
 const date=query.get('date')??attendanceToday();
 if(!attendanceDate(date))return reply({error:'Choose a valid practice date.'},400);
 const test=query.get('test')==='1',day=await attendanceDay(date,test);
 const practice=day.practices.find(p=>p.id===query.get('practice'));
 const userId=query.get('account'),wrestlerId=query.get('wrestler');
 const wrestler=userId&&wrestlerId?(await familyProfile(userId))?.wrestlers.find(w=>w.id===wrestlerId):null;
 return reply({...day,today:attendanceToday(),practice:practice??null,roster:practice?await practiceRoster(practice,test?auth.user!.id:null):[],wrestler:wrestler?{id:wrestler.id,name:wrestler.name,grade:wrestler.grade}:null});
}

export async function POST(request:Request){
 const auth=await ownerIdentity(request),reply=(body:unknown,status=200)=>accountReply(body,status,auth.headers);
 if(!auth.owner||!sameOrigin(request))return reply({error:'Owner access required.'},403);
 const raw=await request.text();
 if(raw.length>2048)return reply({error:'Request too large.'},413);
 let input;
 try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 if(!input||!attendanceDate(input.date))return reply({error:'Choose a valid practice date.'},400);
 const db=env.DB!,now=new Date().toISOString(),today=attendanceToday();
 if(input.action==='enroll'){
  const {userId,wrestlerId,program,kind,date,endsOn,practiceId}=input;
  if(typeof userId!=='string'||typeof wrestlerId!=='string'||!attendancePrograms.includes(program)||!['membership','walkin'].includes(kind)){
   return reply({error:'Choose a saved wrestler, program and registration type.'},400);
  }
  const wrestler=(await familyProfile(userId))?.wrestlers.find(w=>w.id===wrestlerId);
  if(!wrestler)return reply({error:'Wrestler not found in the saved family profile.'},404);
  if(isTestWrestler(wrestlerId))return reply({error:'Use test attendance for sample wrestlers.'},409);
  const blocked=await checkCompetitionAccess(userId,program,wrestler);
  if(blocked)return reply({error:blocked},403);
  const practice=kind==='walkin'?(await attendanceDay(date)).practices.find(p=>p.id===practiceId&&p.program===program&&p.scheduled):null;
  if(kind==='walkin'&&!practice)return reply({error:'Select a practice that is on the current schedule.'},409);
  if(kind==='membership'&&(!attendanceDate(endsOn)||endsOn<date))return reply({error:'Enter the confirmed membership end date, on or after the start date.'},400);
  const end=kind==='membership'?endsOn:date;
  // The duplicate check and insert run in the same statement, including on retries.
  const result=await db.prepare(`INSERT INTO program_enrollments
   (id,user_id,wrestler_id,program,kind,starts_on,ends_on,practice_start,practice_end,created_at,created_by)
   SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11 WHERE NOT EXISTS(
    SELECT 1 FROM program_enrollments WHERE user_id=?2 AND wrestler_id=?3 AND program=?4 AND kind=?5 AND voided_at IS NULL
    AND ((?5='membership' AND starts_on<=?7 AND ends_on>=?6) OR (?5='walkin' AND starts_on=?6 AND practice_start=?8))
   ) AND EXISTS(SELECT 1 FROM family_accounts f JOIN json_each(f.payload,'$.wrestlers') w
    ON json_extract(w.value,'$.id')=?3 WHERE f.user_id=?2)`).bind(crypto.randomUUID(),userId,wrestlerId,program,kind,date,end,practice?.start??null,practice?.end??null,now,auth.owner.userId).run();
  return result.meta.changes?reply({message:'Confirmed signup recorded.'},201):reply({error:'This wrestler already has an overlapping membership or this exact walk-in.'},409);
 }
 if(!['check','undo','scan'].includes(input.action)||input.date>today)return reply({error:'Choose a practice today or in the past.'},400);
 if(input.action==='scan'&&input.date!==today)return reply({error:'QR check-in is available for today’s practices.'},400);
 const test=input.test===true,day=await attendanceDay(input.date,test),practice=day.practices.find(p=>p.id===input.practiceId);
 if(!practice)return reply({error:'Practice not found. Refresh the roster.'},404);
 let {userId,wrestlerId}=input;
 if(input.action==='scan'){
  const code=typeof input.code==='string'?input.code.trim():'';
  if(!/^SWA1:[\da-f]{32}$/i.test(code))return reply({error:'This is not a live wrestler pass.'},400);
  const pass=await db.prepare('SELECT user_id AS userId,wrestler_id AS wrestlerId FROM wrestler_passes WHERE token=?')
   .bind(code.slice(5).toLowerCase()).first<{userId:string;wrestlerId:string}>();
  if(!pass)return reply({error:'Wrestler pass not found.'},404);
  ({userId,wrestlerId}=pass);
 }
 const person=(await practiceRoster(practice,test?auth.user!.id:null)).find(w=>w.userId===userId&&w.wrestlerId===wrestlerId);
 if(!person)return reply({error:'This wrestler is not on the roster for the selected practice.'},409);
 if(input.action==='undo'){
  await db.prepare('DELETE FROM attendance_checkins WHERE practice_id=? AND user_id=? AND wrestler_id=?')
   .bind(practice.id,person.userId,person.wrestlerId).run();
  return reply({message:person.name+' · check-in undone.'});
 }
 if(person.checkedAt)return reply({message:person.name+' is already checked in.'});
 const requireCard=!test&&input.date===today;
 if(requireCard&&person.cardStatus!=='current'){
  return reply({error:person.name+' · '+usaCardLabels[person.cardStatus??'missing']+'. Verify a current card before check-in.'},409);
 }
 const result=await db.prepare(`INSERT INTO attendance_checkins
  (practice_id,date,program,practice_start,practice_end,user_id,wrestler_id,wrestler_name,checked_at,method,checked_by)
  SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ? OR EXISTS(
   SELECT 1 FROM wrestler_membership_cards WHERE user_id=? AND wrestler_id=? AND verified_at IS NOT NULL AND expires_on>=?
  ) ON CONFLICT(practice_id,user_id,wrestler_id) DO NOTHING`)
  .bind(practice.id,practice.date,practice.program,practice.start,practice.end,person.userId,person.wrestlerId,person.name,now,input.action==='scan'?'qr':'manual',auth.owner.userId,requireCard?0:1,person.userId,person.wrestlerId,today).run();
 if(result.meta.changes)return reply({message:person.name+' checked in.'});
 const checked=await db.prepare('SELECT 1 FROM attendance_checkins WHERE practice_id=? AND user_id=? AND wrestler_id=?')
  .bind(practice.id,person.userId,person.wrestlerId).first();
 return checked?reply({message:person.name+' is already checked in.'}):reply({error:'The card changed. Verify a current card before check-in.'},409);
}
