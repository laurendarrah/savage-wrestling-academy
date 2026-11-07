import {env} from 'cloudflare:workers';
import {strongAccount,sameOrigin,accountReply} from '../../../lib/account-auth';
import {coachAccess} from '../../../lib/access-control';
import {securityEvent} from '../../../lib/security-events';
import {coachSchedule, openingTaken, lessonSpots, updateOpening} from '../../../lib/lessons';
import {profileView} from '../../../lib/coach-profile';
import {notify, quietly} from '../../../lib/notify';
import {dayTime} from '../../../lib/datetime';
export const dynamic='force-dynamic';
// How many weeks a repeating opening can cover (issue #190). How far ahead coaches may post is an open question in
// #197 (question 21); 12 weeks is the cap until it is decided.
const MAX_WEEKS=12;
// Coaches, and the owner once they have added themselves as a coach (issue #190). Same authenticator rule for both.
async function coach(request:Request){const auth=await strongAccount(request);return {auth,staff:await coachAccess(auth.user,auth.strong)}}
export async function GET(request:Request){
 const {auth,staff}=await coach(request);if(!staff)return accountReply({error:'Coach access and authenticator verification required.'},403,auth.headers);
 // Openings made before issue #70 have no coach email; link them so families can book them.
 await env.DB!.prepare('UPDATE coach_openings SET coach_email=? WHERE user_id=? AND coach_email IS NULL').bind(staff.email,auth.user!.id).run();
 const profile=await profileView(staff.email,staff.name);
 return accountReply({name:profile.displayName||staff.name,programs:staff.programs,owner:staff.owner,profileSaved:profile.saved,maxWeeks:MAX_WEEKS,openings:await coachSchedule(auth.user!.id)},200,auth.headers);
}
const addDays=(date:string,n:number)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export async function POST(request:Request){
 const {auth,staff}=await coach(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!staff)return reply({error:'Coach access and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>2048)return reply({error:'Request too large.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 if(input?.action==='remove'&&typeof input.id==='string'){
 if(await openingTaken(input.id))return reply({error:'A family has booked this lesson (or is paying for it now). Ask the academy to move or refund it before removing the opening.'},409);
 // A family's private group request on this time is called off with it, and the family is told (issue #177).
 const row=await env.DB!.prepare('DELETE FROM coach_openings WHERE id=? AND user_id=? RETURNING date,start,organizer_id').bind(input.id,auth.user!.id).first<{date:string;start:string;organizer_id:string|null}>();
 if(row?.organizer_id){const fam=await env.DB!.prepare('SELECT email FROM family_accounts WHERE user_id=?').bind(row.organizer_id).first<{email:string}>();
  if(fam)await quietly(()=>notify([{userId:row.organizer_id,email:fam.email,kind:'lesson_group_canceled',dedupeKey:`lesson-group-off:${input.id}`,link:'/lesson',subject:`Lesson called off: ${dayTime(row.date,row.start)}`,
   body:`${staff.name} can no longer teach at ${dayTime(row.date,row.start)}, so the private group you asked for is called off. Nothing was paid for it. Choose another time on the lesson page.`}]))}
 await securityEvent(auth.user!.id,'coach_opening_removed');return reply({ok:true});
 }
 if(input?.action==='update'){const r=await updateOpening(auth.user!.id,input);if(r.status!==200)return reply({error:r.error},r.status);await securityEvent(auth.user!.id,'coach_opening_changed');return reply({ok:true})}
 if(input?.action!=='add'||typeof input.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!Number.isFinite(Date.parse(input.date))||new Date(input.date).toISOString().slice(0,10)!==input.date||typeof input.start!=='string'||typeof input.end!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.end))return reply({error:'Choose a valid date and times.'},400);
 const minutes=(t:string)=>+t.slice(0,2)*60+(+t.slice(3));if(minutes(input.end)-minutes(input.start)!==60)return reply({error:'Each opening must be exactly one hour.'},400);
 // The lesson type (issue #177): blank is an ordinary open time; partner and small group are coach-hosted groups.
 const type=lessonSpots(input.format,input.spots);if('error' in type)return reply({error:type.error},400);
 // Repeat weekly (issue #190): the same time, lesson type and spots on the same weekday for up to MAX_WEEKS weeks.
 // Each week is its own opening. A week that overlaps one of the coach's openings is skipped, never doubled.
 const weeks=input.weeks===undefined||input.weeks===null?1:typeof input.weeks==='string'&&/^\d+$/.test(input.weeks)?Number(input.weeks):input.weeks;
 if(!Number.isInteger(weeks)||weeks<1||weeks>MAX_WEEKS)return reply({error:`Repeat for 1 to ${MAX_WEEKS} weeks.`},400);
 const dates=Array.from({length:weeks},(_,i)=>addDays(input.date,7*i));
 const insert=(date:string)=>env.DB!.prepare('INSERT INTO coach_openings (id,user_id,date,start,end,coach_email,format,capacity) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM coach_openings WHERE user_id=? AND date=? AND start<? AND end>?) RETURNING date')
  .bind(crypto.randomUUID(),auth.user!.id,date,input.start,input.end,staff.email,type.format,type.capacity,auth.user!.id,date,input.end,input.start);
 const results=await env.DB!.batch(dates.map(insert));
 const created=dates.filter((_,i)=>(results[i] as any).results?.length),skipped=dates.filter(d=>!created.includes(d));
 if(!created.length)return reply({error:weeks===1?'This opening overlaps one of your existing openings.':'Every one of those weeks overlaps one of your existing openings.'},409);
 await securityEvent(auth.user!.id,'coach_opening_added',weeks>1?`weekly:${created.length}`:'');return reply({ok:true,created,skipped});
}
