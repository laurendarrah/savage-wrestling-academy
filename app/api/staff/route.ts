import {env} from 'cloudflare:workers';
import {ownerIdentity,sameOrigin,accountReply,OWNER_EMAIL} from '../../../lib/account-auth';
import {securityEvent} from '../../../lib/security-events';
export const dynamic='force-dynamic';
// Keep access disabled while photo cleanup is retried, and block restoration during deletion.
const DELETING=-1;

async function deleteRemovedCoach(email:string,actor:string){
 const db=env.DB!;
 const lock=await db.prepare('UPDATE staff_access SET active=? WHERE email=? AND active IN (0,?) RETURNING updated_at')
  .bind(DELETING,email,DELETING).first<{updated_at:string}>();
 if(!lock)return {body:{error:'Remove this coach from the active team first.'},status:409};
 const claimed='SELECT 1 FROM staff_access WHERE email=? AND active=? AND updated_at=?';
 const claim=[email,DELETING,lock.updated_at] as const;
 const profile=await db.prepare(`SELECT photo_key FROM coach_profiles WHERE email=? AND EXISTS (${claimed})`)
  .bind(email,...claim).first<{photo_key:string|null}>();
 if(profile?.photo_key){
  const storage=(env as Cloudflare.Env & {BUCKET?:R2Bucket}).BUCKET;
  try{
   if(!storage)throw Error('Photo storage unavailable');
   await storage.delete(profile.photo_key);
  }catch{
   return {body:{error:'The photo could not be deleted. The coach still has no access. Retry permanent deletion.'},status:503};
  }
 }
 await db.batch([
  db.prepare(`DELETE FROM coach_openings WHERE user_id IN (
   SELECT p.user_id FROM coach_profiles p WHERE p.email=? AND NOT EXISTS (
    SELECT 1 FROM coach_profiles other WHERE other.user_id=p.user_id AND other.email<>p.email
   )) AND EXISTS (${claimed})`).bind(email,...claim),
  db.prepare(`DELETE FROM coach_lesson_rates WHERE email=? AND EXISTS (${claimed})`).bind(email,...claim),
  db.prepare(`DELETE FROM coach_profiles WHERE email=? AND EXISTS (${claimed})`).bind(email,...claim),
  db.prepare(`INSERT INTO security_events(id,actor,action,target,created_at) SELECT ?,?,?,?,? WHERE EXISTS (${claimed})`)
   .bind(crypto.randomUUID(),actor,'coach_permanently_deleted',email,new Date().toISOString(),...claim),
  db.prepare('DELETE FROM staff_access WHERE email=? AND active=? AND updated_at=?').bind(...claim)
 ]);
 return {body:{ok:true},status:200};
}
export async function GET(request:Request){
 const auth=await ownerIdentity(request);if(!auth.owner)return accountReply({error:'Owner sign-in and authenticator verification required.'},403,auth.headers);
 const rows=await env.DB!.prepare('SELECT email,name,programs,active,updated_at FROM staff_access ORDER BY name')
  .all<{email:string;name:string;programs:string;active:number;updated_at:string}>();
 const own=rows.results.find(s=>s.email===OWNER_EMAIL);
 const profile=await env.DB!.prepare('SELECT payload FROM coach_profiles WHERE email=?').bind(OWNER_EMAIL).first<{payload:string}>();
 const owner={email:OWNER_EMAIL,name:profile?JSON.parse(profile.payload).name:own?.name||'Your coaching profile',
  programs:own?.programs||'[]',active:1,owner:true};
 const staff=rows.results.filter(row=>row.email!==OWNER_EMAIL).map(row=>row.active===DELETING?{...row,active:0,deleting:true}:row);
 return accountReply({staff:[owner,...staff]},200,auth.headers);
}
export async function POST(request:Request){
 const auth=await ownerIdentity(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!auth.owner)return reply({error:'Owner sign-in and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>4096)return reply({error:'Request too large.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 const email=typeof input?.email==='string'?input.email.trim().toLowerCase():'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return reply({error:'Enter a valid coach email.'},400);
 if(input.action==='revoke'){
 if(email===OWNER_EMAIL)return reply({error:'Owner access cannot be revoked here. Edit your coaching programs or profile instead.'},400);
 await env.DB!.prepare('UPDATE staff_access SET active=0,updated_at=? WHERE email=? AND active=1').bind(new Date().toISOString(),email).run();await securityEvent(auth.user!.id,'coach_access_revoked',email);return reply({ok:true});
 }
 if(input.action==='delete'){
  if(email===OWNER_EMAIL)return reply({error:'The owner profile cannot be deleted here.'},400);
  if(input.confirmed!==true)return reply({error:'Confirm permanent deletion first.'},400);
  try{
   const result=await deleteRemovedCoach(email,auth.user!.id);
   return reply(result.body,result.status);
  }catch{
   return reply({error:'Permanent deletion could not finish. Refresh the coach list and try again.'},503);
  }
 }
 if(input.action!=='grant'||typeof input.name!=='string'||!input.name.trim()||input.name.length>100||!Array.isArray(input.programs)||input.programs.length>3||input.programs.some((p:unknown)=>!['Elementary','Intermediate','Advanced'].includes(p as string)))return reply({error:'Enter a coach name and valid program assignments.'},400);
 const saved=await env.DB!.prepare('INSERT INTO staff_access (email,name,programs,active,updated_at) VALUES (?,?,?,1,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,programs=excluded.programs,active=1,updated_at=excluded.updated_at WHERE staff_access.active>=0 RETURNING email').bind(email,input.name.trim(),JSON.stringify([...new Set(input.programs)]),new Date().toISOString()).first();
 if(!saved)return reply({error:'Finish deleting this coach before adding them again.'},409);
 await securityEvent(auth.user!.id,'coach_access_granted',email);return reply({ok:true});
}
