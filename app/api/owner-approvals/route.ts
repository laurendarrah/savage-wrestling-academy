import {env} from 'cloudflare:workers';
import {ownerIdentity,sameOrigin,accountReply} from '../../../lib/account-auth';
import {securityEvent} from '../../../lib/security-events';
import {noticeApproval, quietly} from '../../../lib/notify';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const auth=await ownerIdentity(request);if(!auth.owner)return accountReply({error:'Owner sign-in and authenticator verification required.'},403,auth.headers);
 const rows=await env.DB!.prepare(`SELECT a.id,a.wrestler_name,a.grade,a.status,a.created_at,a.updated_at,f.email,json_extract(f.payload,'$.parentName') AS parent_name,json_extract(f.payload,'$.phone') AS phone,json_extract(w.value,'$.name') AS current_name,json_extract(w.value,'$.grade') AS current_grade FROM program_approvals a JOIN family_accounts f ON f.user_id=a.user_id JOIN json_each(f.payload,'$.wrestlers') w ON json_extract(w.value,'$.id')=a.wrestler_id ORDER BY CASE a.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,a.created_at DESC LIMIT 1000`).all();
 return accountReply({requests:rows.results},200,auth.headers);
}
export async function POST(request:Request){
 const auth=await ownerIdentity(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!auth.owner)return reply({error:'Owner sign-in and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>2048)return reply({error:'Request too large.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 if(!input||!['approved','declined'].includes(input.status)||typeof input.id!=='string'||input.id.length>80||typeof input.updatedAt!=='string'||input.updatedAt.length>40||!Number.isFinite(Date.parse(input.updatedAt)))return reply({error:'Choose a valid approval decision.'},400);
 const now=new Date(Math.max(Date.now(),Date.parse(input.updatedAt)+1)).toISOString();
 const row=await env.DB!.prepare(`UPDATE program_approvals SET status=?,decided_by=?,updated_at=? WHERE id=? AND updated_at=? AND EXISTS (SELECT 1 FROM family_accounts f,json_each(f.payload,'$.wrestlers') w WHERE f.user_id=program_approvals.user_id AND json_extract(w.value,'$.id')=program_approvals.wrestler_id AND json_extract(w.value,'$.name')=program_approvals.wrestler_name AND json_extract(w.value,'$.grade')=program_approvals.grade) RETURNING id`).bind(input.status,auth.user!.id,now,input.id,input.updatedAt).first<{id:string}>();
 if(!row)return reply({error:'This request or wrestler profile changed. Refresh the requests before deciding.'},409);
 await securityEvent(auth.user!.id,'program_approval_'+input.status,row.id);await quietly(()=>noticeApproval(row.id,input.status));return reply({ok:true});
}
