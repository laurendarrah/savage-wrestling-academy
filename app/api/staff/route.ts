import {env} from 'cloudflare:workers';
import {ownerIdentity,sameOrigin,accountReply,OWNER_EMAIL} from '../../../lib/account-auth';
import {securityEvent} from '../../../lib/security-events';
export const dynamic='force-dynamic';
export async function GET(request:Request){const auth=await ownerIdentity(request);if(!auth.owner)return accountReply({error:'Owner sign-in and authenticator verification required.'},403,auth.headers);const rows=await env.DB!.prepare('SELECT email,name,programs,active,updated_at FROM staff_access ORDER BY name').all();return accountReply({staff:rows.results},200,auth.headers)}
export async function POST(request:Request){
 const auth=await ownerIdentity(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!auth.owner)return reply({error:'Owner sign-in and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>4096)return reply({error:'Request too large.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 const email=typeof input?.email==='string'?input.email.trim().toLowerCase():'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||email===OWNER_EMAIL)return reply({error:'Enter a coach email different from your owner email.'},400);
 if(input.action==='revoke'){
 await env.DB!.prepare('UPDATE staff_access SET active=0,updated_at=? WHERE email=?').bind(new Date().toISOString(),email).run();await securityEvent(auth.user!.id,'coach_access_revoked',email);return reply({ok:true});
 }
 if(input.action!=='grant'||typeof input.name!=='string'||!input.name.trim()||input.name.length>100||!Array.isArray(input.programs)||input.programs.length>3||input.programs.some((p:unknown)=>!['Elementary','Intermediate','Advanced'].includes(p as string)))return reply({error:'Enter a coach name and valid program assignments.'},400);
 await env.DB!.prepare('INSERT INTO staff_access (email,name,programs,active,updated_at) VALUES (?,?,?,1,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,programs=excluded.programs,active=1,updated_at=excluded.updated_at').bind(email,input.name.trim(),JSON.stringify([...new Set(input.programs)]),new Date().toISOString()).run();
 await securityEvent(auth.user!.id,'coach_access_granted',email);return reply({ok:true});
}
