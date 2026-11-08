import {env} from 'cloudflare:workers';
import {strongAccount,accountReply,sameOrigin} from '../../../lib/account-auth';
import {familyProfile,requiresApproval,approvalApplies} from '../../../lib/program-approval';
import {securityEvent} from '../../../lib/security-events';
import {rateLimited} from '../../../lib/rate-limit';
import {withApi} from '../../../lib/api';
export const dynamic='force-dynamic';
export const GET = withApi(GET_); async function GET_(request:Request){
 const auth=await strongAccount(request);if(!auth.user?.email_confirmed_at)return accountReply({error:'Sign-in required.'},401,auth.headers);
 if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return accountReply({error:'Authenticator verification required.'},403,auth.headers);
 const profile=await familyProfile(auth.user.id);
 const rows=await env.DB!.prepare("SELECT id,wrestler_id,wrestler_name,grade,status FROM program_approvals WHERE user_id=? AND program='Advanced'").bind(auth.user.id).all<{id:string;wrestler_id:string;wrestler_name:string;grade:string;status:string}>();
 // A decision follows the wrestler through a grade change within 7–12 (issue #271); `grade` is the grade they asked
 // in, and gradeChanged tells the registration page to say the owner sees the new grade with the request.
 const list=[];
 for(const r of rows.results){const w=profile?.wrestlers.find(w=>w.id===r.wrestler_id);if(w&&approvalApplies(r,w))list.push({id:r.id,wrestlerId:r.wrestler_id,status:r.status,grade:r.grade,currentGrade:w.grade,gradeChanged:w.grade!==r.grade})}
 return accountReply({approvals:list},200,auth.headers);
}
export const POST = withApi(POST_); async function POST_(request:Request){
 const auth=await strongAccount(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(!auth.user?.email_confirmed_at)return reply({error:'Sign-in required.'},401);
 if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return reply({error:'Authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>2048)return reply({error:'Request too large.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 if(input?.action!=='request'||typeof input.wrestlerId!=='string')return reply({error:'Choose a saved wrestler.'},400);
 const profile=await familyProfile(auth.user.id),w=profile?.wrestlers.find(w=>w.id===input.wrestlerId);
 if(!w)return reply({error:'Saved wrestler not found in your family account.'},404);
 if(!requiresApproval('Advanced',w))return reply({error:'SWA Advance approval requests are for wrestlers in grades 7–12.'},400);
 if(await rateLimited(request,'program-approval:'+auth.user.id))return reply({error:'Please wait a minute before trying again.'},429);
 const now=new Date().toISOString();
 // A request for a wrestler who already has one changes nothing while the decision still applies (same name, grades
 // 7–12, issue #271). A renamed entry starts over as a new pending request.
 const row=await env.DB!.prepare(`INSERT INTO program_approvals(id,user_id,wrestler_id,program,wrestler_name,grade,status,created_at,updated_at) VALUES (?,?,?,'Advanced',?,?,'pending',?,?) ON CONFLICT(user_id,wrestler_id,program) DO UPDATE SET wrestler_name=excluded.wrestler_name,grade=excluded.grade,status='pending',created_at=excluded.created_at,updated_at=excluded.updated_at,decided_by=NULL WHERE lower(trim(program_approvals.wrestler_name))!=lower(trim(excluded.wrestler_name)) RETURNING id`).bind(crypto.randomUUID(),auth.user.id,w.id,w.name,w.grade,now,now).first<{id:string}>();
 if(row)await securityEvent(auth.user.id,'program_approval_requested',row.id);
 return reply({ok:true});
}
