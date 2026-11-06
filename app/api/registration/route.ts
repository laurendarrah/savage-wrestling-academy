import {teamCodeDiscount} from '../../../lib/academy-validation';
import {env} from 'cloudflare:workers';
import {strongAccount,accountReply,sameOrigin} from '../../../lib/account-auth';
import {familyProfile,checkCompetitionAccess,requiresApproval} from '../../../lib/program-approval';
import {registrationCatalog} from '../../../lib/registration-catalog';
import {isTestWrestler} from '../../../lib/test-family';
import {hasScholarship} from '../../../lib/scholarships';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const auth=await strongAccount(request);
 if(!auth.user?.email_confirmed_at)return accountReply({error:'Sign-in required.'},401,auth.headers);
 if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return accountReply({error:'Authenticator verification required.'},403,auth.headers);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const month=new URL(request.url).searchParams.get('month')||today.slice(0,7);
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<2020||Number(month.slice(0,4))>2100)return accountReply({error:'Choose a valid month.'},400,auth.headers);
 const row=await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload:string}>();
 return accountReply(registrationCatalog(row?JSON.parse(row.payload):{},month,today),200,auth.headers);
}

// Registration review is authorized on the server. A browser flag cannot grant approval.
export async function POST(request:Request){
 const auth=await strongAccount(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(!auth.user?.email_confirmed_at)return reply({error:'Sign-in required.'},401);
 if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return reply({error:'Authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>2048)return reply({error:'Request too large.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 if(!input||typeof input.wrestlerId!=='string'||!['Elementary','Intermediate','Advanced'].includes(input.program)||!['monthly','walkin'].includes(input.plan))return reply({error:'Choose a saved wrestler, program, and plan.'},400);
 const profile=await familyProfile(auth.user.id),w=profile?.wrestlers.find(w=>w.id===input.wrestlerId);if(!w)return reply({error:'Saved wrestler not found in your family account.'},404);
 if(isTestWrestler(w.id))return reply({error:'Sample wrestlers use test attendance and test waivers only.'},409);
 const blocked=await checkCompetitionAccess(auth.user.id,input.program,w);if(blocked)return reply({error:blocked,approvalRequired:requiresApproval(input.program,w)},403);
 if(await hasScholarship(auth.user.id,w.id,input.program))return reply({error:'This wrestler already has an active scholarship in this program. Regular scheduled practices are included. View the scholarship in your family account.'},409);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const date=typeof input.date==='string'?input.date:'';
 if(input.plan==='walkin'&&(!/^\d{4}-(0[1-9]|1[0-2])-\d\d$/.test(date)||date<today))return reply({error:'Choose an upcoming scheduled practice.'},400);
 const row=await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload:string}>();
 const state=row?JSON.parse(row.payload):{};
 const catalog=registrationCatalog(state,input.plan==='walkin'?date.slice(0,7):today.slice(0,7),today),p=catalog.programs.find((p:any)=>p.id===input.program);
 if(!p)return reply({error:'This program is no longer available. Refresh your options.'},409);
 const practice=input.plan==='walkin'?catalog.practices.find(s=>s.program===input.program&&s.date===date&&s.id===input.practiceId):null;
 if(input.plan==='walkin'&&!practice)return reply({error:'This practice changed or is unavailable. Refresh the schedule.'},409);
 const baseCents=input.plan==='walkin'?p.walkInCents:p.monthlyCents;
 const pricing=teamCodeDiscount(state.teamCodes??[],input.teamCode,p.id,input.plan,baseCents);if('error' in pricing)return reply({error:pricing.error},400);
 const membership=input.plan!=='walkin';
 return reply({review:{wrestlerName:w.name,grade:w.grade,programName:p.name,programId:p.id,plan:input.plan,baseCents,cents:pricing.cents,discount:pricing.discount,practice,termMonths:membership?12:null,paymentCount:input.plan==='monthly'?12:1,totalCents:pricing.cents===null?null:pricing.cents*(input.plan==='monthly'?12:1),renewal:membership?'manual':null,termsStatus:membership?'draft':null,termsUrl:membership?'/membership-terms':null},paymentsEnabled:false});
}
