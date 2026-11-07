import {env} from 'cloudflare:workers';
import {strongAccount,accountReply,sameOrigin} from '../../../lib/account-auth';
import {accountRole} from '../../../lib/access-control';
import {registrationCatalog} from '../../../lib/registration-catalog';
import {validPracticePlan,cleanPracticePlan} from '../../../lib/practice-plans';
import {securityEvent} from '../../../lib/security-events';
import {publicSchedule,academyToday} from '../../../lib/public-schedule';
import {practiceMonth} from '../../../lib/practice-calendar';
export const dynamic='force-dynamic';
const ids=['Elementary','Intermediate','Advanced'];
const monthValid=(v:string)=>/^\d{4}-(0[1-9]|1[0-2])$/.test(v)&&Number(v.slice(0,4))>=2020&&Number(v.slice(0,4))<=2100;
async function settings(){const row=await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload:string}>();return row?JSON.parse(row.payload):{}}
async function catalog(month:string){return registrationCatalog(await settings(),month,'0000-01-01')}
export async function GET(request:Request){
 const auth=await strongAccount(request),access=await accountRole(auth.user),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(!['owner','coach'].includes(access.role)||!auth.strong)return reply({error:'Owner or coach access and authenticator verification required.'},403);
 const summary=new URL(request.url).searchParams.get('summary')==='1';
 const owner=access.role==='owner',month=new URL(request.url).searchParams.get('month')||new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7);
 if(!monthValid(month))return reply({error:'Choose a valid month.'},400);
 const state=await settings(),data=registrationCatalog(state,month,'0000-01-01'),allowed=owner?ids:access.staff!.programs.filter(p=>ids.includes(p)),practices=data.practices.filter(p=>allowed.includes(p.program));
 const rows=await env.DB!.prepare('SELECT program,date,payload,published,revision,updated_at FROM practice_plans WHERE date LIKE ? ORDER BY date,program').bind(month+'-%').all<{program:string;date:string;payload:string;published:number;revision:number;updated_at:string}>();
 const plans=rows.results.filter(p=>allowed.includes(p.program)&&(owner||p.published===1&&practices.some(s=>s.program===p.program&&s.date===p.date))).map(p=>({program:p.program,date:p.date,data:summary?undefined:JSON.parse(p.payload),title:summary?JSON.parse(p.payload).title:undefined,published:p.published===1,revision:p.revision,updatedAt:p.updated_at,scheduled:practices.some(s=>s.program===p.program&&s.date===p.date)}));
 // A coach's month calendar (issue #191): their practices, every extra practice, camp, clinic and event, holidays,
 // today, and which practices have a shared plan. Past days of the month are included. The owner has the owner calendar.
 const today=academyToday(),calendar=owner||summary?undefined:practiceMonth(publicSchedule(state,month,'0000-01-01'),month,today,allowed,plans);
 return reply({owner,month,today,calendar,programs:data.programs.filter((p:{id:string;name:string})=>allowed.includes(p.id)).map((p:{id:string;name:string})=>({id:p.id,name:p.name})),practices,plans});
}
export async function POST(request:Request){
 const auth=await strongAccount(request),access=await accountRole(auth.user),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(access.role!=='owner'||!auth.strong)return reply({error:'Only the owner can edit or share practice plans.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>40000)return reply({error:'Practice plan is too long.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 const date=input?.date,program=input?.program;
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!monthValid(date.slice(0,7))||!Number.isFinite(Date.parse(date))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||!ids.includes(program)||!Number.isInteger(input.revision)||input.revision<0)return reply({error:'Choose a scheduled practice and reload its current plan.'},400);
 const now=new Date().toISOString();
 if(input.action==='unpublish'){
 const row=await env.DB!.prepare('UPDATE practice_plans SET published=0,revision=revision+1,updated_by=?,updated_at=? WHERE program=? AND date=? AND revision=? RETURNING revision').bind(auth.user!.id,now,program,date,input.revision).first<{revision:number}>();
 if(!row)return reply({error:'The plan changed on another device. Reload before editing.'},409);await securityEvent(auth.user!.id,'practice_plan_hidden',program+':'+date);return reply({revision:row.revision,updatedAt:now});
 }
 if(input.action!=='save'||typeof input.published!=='boolean'||!validPracticePlan(input.data))return reply({error:'Enter a plan title and 1–30 sections. Give every section a name and whole-number minutes. The total cannot exceed 90 minutes. Keep each section under 5,000 characters.'},400);
 const schedule=await catalog(date.slice(0,7));if(!schedule.practices.some(p=>p.program===program&&p.date===date))return reply({error:'This practice is no longer scheduled. Check its dates or days off before adding a plan.'},409);
 const payload=JSON.stringify(cleanPracticePlan(input.data));
 const row=input.revision===0?await env.DB!.prepare('INSERT INTO practice_plans(id,program,date,payload,published,revision,updated_by,updated_at) VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(program,date) DO NOTHING RETURNING revision').bind(program+'-'+date,program,date,payload,input.published?1:0,auth.user!.id,now).first<{revision:number}>():await env.DB!.prepare('UPDATE practice_plans SET payload=?,published=?,revision=revision+1,updated_by=?,updated_at=? WHERE program=? AND date=? AND revision=? RETURNING revision').bind(payload,input.published?1:0,auth.user!.id,now,program,date,input.revision).first<{revision:number}>();
 if(!row)return reply({error:'The plan changed on another device. Reload before editing.'},409);
 await securityEvent(auth.user!.id,input.published?'practice_plan_shared':'practice_plan_draft',program+':'+date);return reply({revision:row.revision,updatedAt:now});
}
