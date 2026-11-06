import {env} from 'cloudflare:workers';
import {strongAccount,accountReply,sameOrigin} from '../../../lib/account-auth';
import {accountRole} from '../../../lib/access-control';
import {publicSchedule} from '../../../lib/public-schedule';
import {registrationCatalog} from '../../../lib/registration-catalog';
import {validPracticePlan,cleanPracticePlan} from '../../../lib/practice-plans';
import {securityEvent} from '../../../lib/security-events';
export const dynamic='force-dynamic';
const ids=['Elementary','Intermediate','Advanced'];
const monthValid=(v:string)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(v)&&Number(v.slice(0,4))>=2020&&Number(v.slice(0,4))<=2100;
async function academySchedule(){
 const row=await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload:string}>();
 return row?JSON.parse(row.payload):{};
}
type SubmissionRow={id:string;program:string;date:string;coach_name:string;payload:string;status:string;revision:number};
const submissionColumns='id,program,date,coach_name,payload,status,revision';
const stalePlan='The plan changed on another device. Reload before editing.';
const planRequirements='Enter a plan title and 1–30 sections. Give every section a name and whole-number minutes. The total cannot exceed 90 minutes. Keep each section under 5,000 characters.';
export async function GET(request:Request){
 const auth=await strongAccount(request),access=await accountRole(auth.user),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(!['owner','coach'].includes(access.role)||!auth.strong)return reply({error:'Owner or coach access and authenticator verification required.'},403);
 const query=new URL(request.url).searchParams,summary=query.get('summary')==='1';
 const owner=access.role==='owner'&&query.get('coachView')!=='1',month=query.get('month')||new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7);
 if(!monthValid(month))return reply({error:'Choose a valid month.'},400);
 const settings=await academySchedule();
 const schedule=owner?null:publicSchedule(settings,month,'0000-01-01');
 const data=schedule??registrationCatalog(settings,month,'0000-01-01');
 const practices=data.practices;
 const activities=schedule?[
  ...schedule.events.flatMap(event=>event.dates.filter(date=>date.slice(0,7)===month).map(date=>{
   const time=event.schedule.find(slot=>slot.date===date);
   return {id:'event:'+event.id+':'+date,date,name:event.name,type:event.type,description:event.description,
    gradeRange:event.gradeRange,start:time?.start??null,end:time?.end??null};
  })),
  ...schedule.liveClasses.map(practice=>({
   id:'practice:'+practice.id+':'+practice.date,date:practice.date,name:practice.name,type:'Additional practice',
   description:practice.description??'',gradeRange:practice.gradeRange??'',start:practice.start,end:practice.end
  }))
 ].sort((a,b)=>a.date.localeCompare(b.date)||(a.start??'').localeCompare(b.start??'')||a.name.localeCompare(b.name)):[];
 const rows=await env.DB!.prepare('SELECT program,date,payload,published,revision,updated_at FROM practice_plans WHERE date LIKE ? ORDER BY date,program').bind(month+'-%').all<{program:string;date:string;payload:string;published:number;revision:number;updated_at:string}>();
 const plans=rows.results.filter(p=>ids.includes(p.program)&&(owner||p.published===1&&practices.some(s=>s.program===p.program&&s.date===p.date))).map(p=>({program:p.program,date:p.date,data:summary?undefined:JSON.parse(p.payload),title:summary?JSON.parse(p.payload).title:undefined,published:p.published===1,revision:p.revision,updatedAt:p.updated_at,scheduled:practices.some(s=>s.program===p.program&&s.date===p.date)}));
 const draftPrograms=access.role==='owner'?ids:access.staff?.programs.filter(program=>ids.includes(program))??[];
 const db=env.DB!;
 const submissions=summary?[]:owner
  ? (await db.prepare(`SELECT ${submissionColumns} FROM practice_plan_submissions WHERE status='submitted' AND date LIKE ? ORDER BY date,program,coach_name`).bind(month+'-%').all<SubmissionRow>()).results
  : draftPrograms.length
   ? (await db.prepare(`SELECT ${submissionColumns} FROM practice_plan_submissions WHERE coach_id=? AND date LIKE ? ORDER BY date,program`).bind(auth.user!.id,month+'-%').all<SubmissionRow>()).results.filter(s=>draftPrograms.includes(s.program)&&practices.some(p=>p.date===s.date&&p.program===s.program))
   : [];
 return reply({owner,month,programs:data.programs.map((p:{id:string;name:string})=>({id:p.id,name:p.name})),practices,closures:data.closures,holidays:data.holidays,plans,activities,draftPrograms,
  submissions:submissions.map(s=>({id:s.id,program:s.program,date:s.date,coachName:s.coach_name,data:JSON.parse(s.payload),
   status:s.status,revision:s.revision,scheduled:practices.some(p=>p.date===s.date&&p.program===s.program)}))});
}
export async function POST(request:Request){
 const auth=await strongAccount(request),access=await accountRole(auth.user),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(!auth.strong||!['owner','coach'].includes(access.role))return reply({error:'Owner or coach access and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>40000)return reply({error:'Practice plan is too long.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 const action=input?.action,coachAction=action==='coachDraft'||action==='coachSubmit';
 if(access.role!=='owner'&&!coachAction)return reply({error:'Only the owner can edit or share official practice plans.'},403);
 if(coachAction&&access.role!=='owner'&&!access.staff?.programs.includes(input?.program))return reply({error:'You can draft plans only for programs assigned to you.'},403);
 const date=input?.date,program=input?.program;
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!monthValid(date.slice(0,7))||!Number.isFinite(Date.parse(date))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||!ids.includes(program)||!Number.isInteger(input.revision)||input.revision<0)return reply({error:'Choose a scheduled practice and reload its current plan.'},400);
 const now=new Date().toISOString();
 if(input.action==='unpublish'){
 const row=await env.DB!.prepare('UPDATE practice_plans SET published=0,revision=revision+1,updated_by=?,updated_at=? WHERE program=? AND date=? AND revision=? RETURNING revision').bind(auth.user!.id,now,program,date,input.revision).first<{revision:number}>();
 if(!row)return reply({error:'The plan changed on another device. Reload before editing.'},409);await securityEvent(auth.user!.id,'practice_plan_hidden',program+':'+date);return reply({revision:row.revision,updatedAt:now});
 }
 const reviewAction=action==='reviewSave'||action==='reviewPublish';
 if(!validPracticePlan(input.data)||(!coachAction&&!reviewAction&&(action!=='save'||typeof input.published!=='boolean')))return reply({error:planRequirements},400);
 if(reviewAction&&(typeof input.submissionId!=='string'||!/^[a-f0-9-]{36}$/.test(input.submissionId)||input.revision<1))return reply({error:'Choose a submitted practice plan.'},400);
 if(action==='reviewPublish'&&(!Number.isInteger(input.planRevision)||input.planRevision<0))return reply({error:'Reload the current official plan before publishing.'},400);
 const schedule=registrationCatalog(await academySchedule(),date.slice(0,7),'0000-01-01');if(!schedule.practices.some(p=>p.program===program&&p.date===date))return reply({error:'This practice is no longer scheduled. Check its dates or days off before adding a plan.'},409);
 const payload=JSON.stringify(cleanPracticePlan(input.data));
 const db=env.DB!,userId=auth.user!.id;
 if(coachAction){
  const status=action==='coachSubmit'?'submitted':'draft',coachName=access.staff?.name??'Academy owner';
  const row=input.revision===0
   ? await db.prepare(`INSERT INTO practice_plan_submissions (id,program,date,coach_id,coach_name,payload,status,revision,updated_at)
      VALUES (?,?,?,?,?,?,?,1,?) ON CONFLICT(coach_id,program,date) DO NOTHING RETURNING revision`)
      .bind(crypto.randomUUID(),program,date,userId,coachName,payload,status,now).first<{revision:number}>()
   : await db.prepare(`UPDATE practice_plan_submissions SET payload=?,coach_name=?,status=?,revision=revision+1,updated_at=?
      WHERE coach_id=? AND program=? AND date=? AND revision=? AND status='draft' RETURNING revision`)
      .bind(payload,coachName,status,now,userId,program,date,input.revision).first<{revision:number}>();
  if(!row)return reply({error:'This draft changed or was already submitted. Reload practice plans.'},409);
  if(status==='submitted')await securityEvent(userId,'practice_plan_submitted',program+':'+date);
  return reply({revision:row.revision,status});
 }
 if(action==='reviewSave'){
  const row=await db.prepare(`UPDATE practice_plan_submissions SET payload=?,revision=revision+1,updated_at=?
   WHERE id=? AND program=? AND date=? AND revision=? AND status='submitted' RETURNING revision`)
   .bind(payload,now,input.submissionId,program,date,input.revision).first<{revision:number}>();
  if(!row)return reply({error:stalePlan},409);
  return reply({revision:row.revision,status:'submitted'});
 }
 if(action==='reviewPublish'){
  const {submissionId,revision,planRevision}=input,publishToken=crypto.randomUUID();
  // Both changes run in one D1 transaction. The expected official revision protects an
  // existing plan, including one published concurrently from a different submission.
  const [review,official]=await db.batch<{revision:number}>([
   db.prepare(`UPDATE practice_plan_submissions SET payload=?,status='published',revision=revision+1,updated_at=?,publish_token=?
    WHERE id=? AND program=? AND date=? AND revision=? AND status='submitted'
    AND COALESCE((SELECT revision FROM practice_plans WHERE program=? AND date=?),0)=? RETURNING revision`)
    .bind(payload,now,publishToken,submissionId,program,date,revision,program,date,planRevision),
   db.prepare(`INSERT INTO practice_plans(id,program,date,payload,published,revision,updated_by,updated_at)
    SELECT ?,program,date,payload,1,?,?,? FROM practice_plan_submissions
    WHERE id=? AND publish_token=?
    AND COALESCE((SELECT revision FROM practice_plans WHERE program=? AND date=?),0)=?
    ON CONFLICT(program,date) DO UPDATE SET payload=excluded.payload,published=1,revision=excluded.revision,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at RETURNING revision`)
    .bind(program+'-'+date,planRevision+1,userId,now,submissionId,publishToken,program,date,planRevision)
  ]);
  if(!review.results.length||!official.results.length)return reply({error:stalePlan},409);
  await securityEvent(userId,'practice_plan_submission_published',submissionId);
  return reply({revision:official.results[0].revision,status:'published'});
 }
 const row=input.revision===0?await env.DB!.prepare('INSERT INTO practice_plans(id,program,date,payload,published,revision,updated_by,updated_at) VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(program,date) DO NOTHING RETURNING revision').bind(program+'-'+date,program,date,payload,input.published?1:0,auth.user!.id,now).first<{revision:number}>():await env.DB!.prepare('UPDATE practice_plans SET payload=?,published=?,revision=revision+1,updated_by=?,updated_at=? WHERE program=? AND date=? AND revision=? RETURNING revision').bind(payload,input.published?1:0,auth.user!.id,now,program,date,input.revision).first<{revision:number}>();
 if(!row)return reply({error:'The plan changed on another device. Reload before editing.'},409);
 await securityEvent(auth.user!.id,input.published?'practice_plan_shared':'practice_plan_draft',program+':'+date);return reply({revision:row.revision,updatedAt:now});
}
