import {env} from 'cloudflare:workers';
import {strongAccount,sameOrigin,accountReply} from '../../../lib/account-auth';
import {accountRole} from '../../../lib/access-control';
import {addLessonOpenings} from '../../../lib/lesson-availability';
import {securityEvent} from '../../../lib/security-events';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const auth=await strongAccount(request),access=await accountRole(auth.user);if((access.role!=='coach'&&access.role!=='owner')||!auth.strong)return accountReply({error:'Coach access and authenticator verification required.'},403,auth.headers);
 const rows=await env.DB!.prepare('SELECT id,date,start,end FROM coach_openings WHERE user_id=? ORDER BY date,start').bind(auth.user!.id).all();
 const staff=access.staff??await env.DB!.prepare('SELECT name,programs FROM staff_access WHERE email=? AND active=1').bind(auth.user!.email!.toLowerCase()).first<{name:string;programs:string}>();
 const programs=staff?(typeof staff.programs==='string'?JSON.parse(staff.programs):staff.programs):[];
 return accountReply({name:staff?.name||'Owner',programs,owner:access.role==='owner',openings:rows.results},200,auth.headers);
}
export async function POST(request:Request){
 const auth=await strongAccount(request),access=await accountRole(auth.user),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if((access.role!=='coach'&&access.role!=='owner')||!auth.strong)return reply({error:'Coach access and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>2048)return reply({error:'Request too large.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 if(input?.action==='remove'&&typeof input.id==='string'){
 await env.DB!.prepare('DELETE FROM coach_openings WHERE id=? AND user_id=?').bind(input.id,auth.user!.id).run();await securityEvent(auth.user!.id,'coach_opening_removed');return reply({ok:true});
 }
 if(input?.action!=='add')return reply({error:'Choose a valid opening action.'},400);
 const user=auth.user!,result=await addLessonOpenings(input,{email:user.email!.toLowerCase(),userId:user.id});
 if(result.status===200)await securityEvent(user.id,result.body.count===1?'coach_opening_added':'coach_recurring_openings_added');
 return reply(result.body,result.status);
}
