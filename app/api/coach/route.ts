import {env} from 'cloudflare:workers';
import {strongAccount,sameOrigin,accountReply} from '../../../lib/account-auth';
import {accountRole} from '../../../lib/access-control';
import {securityEvent} from '../../../lib/security-events';
import {coachSchedule, openingTaken} from '../../../lib/lessons';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const auth=await strongAccount(request),access=await accountRole(auth.user);if(access.role!=='coach'||!auth.strong)return accountReply({error:'Coach access and authenticator verification required.'},403,auth.headers);
 // Openings made before issue #70 have no coach email; link them so families can book them.
 await env.DB!.prepare('UPDATE coach_openings SET coach_email=? WHERE user_id=? AND coach_email IS NULL').bind(access.staff!.email,auth.user!.id).run();
 return accountReply({name:access.staff!.name,programs:access.staff!.programs,openings:await coachSchedule(auth.user!.id)},200,auth.headers);
}
export async function POST(request:Request){
 const auth=await strongAccount(request),access=await accountRole(auth.user),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(access.role!=='coach'||!auth.strong)return reply({error:'Coach access and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>2048)return reply({error:'Request too large.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 if(input?.action==='remove'&&typeof input.id==='string'){
 if(await openingTaken(input.id))return reply({error:'A family has booked this lesson (or is paying for it now). Ask the academy to move or refund it before removing the opening.'},409);
 await env.DB!.prepare('DELETE FROM coach_openings WHERE id=? AND user_id=?').bind(input.id,auth.user!.id).run();await securityEvent(auth.user!.id,'coach_opening_removed');return reply({ok:true});
 }
 if(input?.action!=='add'||typeof input.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!Number.isFinite(Date.parse(input.date))||new Date(input.date).toISOString().slice(0,10)!==input.date||typeof input.start!=='string'||typeof input.end!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.end))return reply({error:'Choose a valid date and times.'},400);
 const minutes=(t:string)=>+t.slice(0,2)*60+(+t.slice(3));if(minutes(input.end)-minutes(input.start)!==60)return reply({error:'Each opening must be exactly one hour.'},400);
 const id=crypto.randomUUID(),row=await env.DB!.prepare('INSERT INTO coach_openings (id,user_id,date,start,end,coach_email) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM coach_openings WHERE user_id=? AND date=? AND start<? AND end>?) RETURNING id').bind(id,auth.user!.id,input.date,input.start,input.end,access.staff!.email,auth.user!.id,input.date,input.end,input.start).first();
 if(!row)return reply({error:'This opening overlaps one of your existing openings.'},409);
 await securityEvent(auth.user!.id,'coach_opening_added');return reply({ok:true});
}
