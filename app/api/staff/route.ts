// Coaches (/staff), owner only (issue #190). Invite a coach (they get access when they accept), change programs,
// add yourself as a coach, remove access, restore it, and permanently remove a coach who was already removed.
// Removing never deletes past lessons, payments or pay history: those live in orders, coach_openings and the audit log.
import {env} from 'cloudflare:workers';
import {ownerIdentity,sameOrigin,accountReply,OWNER_EMAIL} from '../../../lib/account-auth';
import {securityEvent} from '../../../lib/security-events';
import {createInvite,renewInvite,cancelInvite,inviteView,validEmail,PROGRAM_IDS,INVITE_DAYS,type InviteRow} from '../../../lib/coach-invites';
import {emailConfigured} from '../../../lib/email';
import {academyToday} from '../../../lib/public-schedule';
import {HOLD_MINUTES} from '../../../lib/capacity';
export const dynamic='force-dynamic';
type Staff={email:string;name:string;programs:string;active:number;updated_at:string;display_name:string|null;bio:string|null;specialties:string|null;phone:string|null};
const validPrograms=(p:unknown):p is string[]=>Array.isArray(p)&&p.length<=3&&p.every(x=>PROGRAM_IDS.includes(x as string));
// Booked lessons still to come per coach: paid ones, and checkouts in progress.
async function upcomingBooked(){
 const since=new Date(Date.now()-HOLD_MINUTES*60000).toISOString();
 const rows=(await env.DB!.prepare(`SELECT o.coach_email AS email,COUNT(DISTINCT o.id) AS n FROM coach_openings o JOIN orders x ON x.kind='lesson' AND x.item_id=o.id
  AND (x.status='paid' OR (x.status='pending' AND x.created_at>=?)) WHERE o.date>=? AND o.coach_email IS NOT NULL GROUP BY o.coach_email`).bind(since,academyToday()).all<{email:string;n:number}>()).results;
 return new Map(rows.map(r=>[r.email,r.n]));
}
export async function GET(request:Request){
 const auth=await ownerIdentity(request);if(!auth.owner)return accountReply({error:'Owner sign-in and authenticator verification required.'},403,auth.headers);
 const rows=(await env.DB!.prepare('SELECT s.email,s.name,s.programs,s.active,s.updated_at,p.display_name,p.bio,p.specialties,p.phone FROM staff_access s LEFT JOIN coach_profiles p ON p.email=s.email ORDER BY COALESCE(p.display_name,s.name)').all<Staff>()).results;
 const upcoming=await upcomingBooked();
 const view=(s:Staff)=>({email:s.email,name:s.name,displayName:s.display_name||s.name,programs:JSON.parse(s.programs),active:s.active===1,updatedAt:s.updated_at,
  phone:s.phone??'',bio:s.bio??'',specialties:s.specialties?JSON.parse(s.specialties):[],profileSaved:s.display_name!==null,upcomingLessons:upcoming.get(s.email)??0});
 const own=rows.find(s=>s.email===OWNER_EMAIL);
 // Open invites, and ones that ended in the last 30 days so the owner can send a new link.
 const recent=new Date(Date.now()-30*86400000).toISOString();
 const invites=(await env.DB!.prepare('SELECT * FROM coach_invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC').bind(recent).all<InviteRow>()).results.map(inviteView);
 return accountReply({staff:rows.filter(s=>s.email!==OWNER_EMAIL).map(view),self:own?view(own):null,invites,emailOn:emailConfigured(),inviteDays:INVITE_DAYS},200,auth.headers);
}
export async function POST(request:Request){
 const auth=await ownerIdentity(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);if(!auth.owner)return reply({error:'Owner sign-in and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>4096)return reply({error:'Request too large.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 const actor=auth.user!.id,now=new Date().toISOString();
 const done=(r:{status:number;error?:string}&Record<string,unknown>)=>r.status===200?reply({ok:true,...r,status:undefined}):reply({error:r.error},r.status);
 // Invites.
 if(input?.action==='invite')return done(await createInvite(input,actor));
 if(input?.action==='renew')return done(await renewInvite(input.id,actor));
 if(input?.action==='cancel-invite')return done(await cancelInvite(input.id,actor));
 // The owner as a coach: their own staff record, under the owner email. They keep the owner role everywhere.
 if(input?.action==='self'){
  if(!validPrograms(input.programs))return reply({error:'Choose valid programs.'},400);
  const name=typeof input.name==='string'&&input.name.trim()?input.name.replace(/\s+/g,' ').trim().slice(0,100):'Owner';
  await env.DB!.prepare('INSERT INTO staff_access (email,name,programs,active,updated_at) VALUES (?,?,?,1,?) ON CONFLICT(email) DO UPDATE SET programs=excluded.programs,active=1,updated_at=excluded.updated_at').bind(OWNER_EMAIL,name,JSON.stringify([...new Set(input.programs)]),now).run();
  await securityEvent(actor,'owner_coaching_on',OWNER_EMAIL);return reply({ok:true});
 }
 if(input?.action==='self-stop'){
  await env.DB!.prepare('UPDATE staff_access SET active=0,updated_at=? WHERE email=?').bind(now,OWNER_EMAIL).run();
  await securityEvent(actor,'owner_coaching_off',OWNER_EMAIL);return reply({ok:true});
 }
 const email=typeof input?.email==='string'?input.email.trim().toLowerCase():'';
 if(!validEmail(email)||email===OWNER_EMAIL)return reply({error:'Enter a coach email different from your owner email.'},400);
 if(input.action==='revoke'){
  await env.DB!.prepare('UPDATE staff_access SET active=0,updated_at=? WHERE email=?').bind(now,email).run();
  await env.DB!.prepare('UPDATE coach_invites SET revoked_at=? WHERE email=? AND used_at IS NULL AND revoked_at IS NULL').bind(now,email).run();
  await securityEvent(actor,'coach_access_revoked',email);return reply({ok:true});
 }
 if(input.action==='restore'){
  const row=await env.DB!.prepare('UPDATE staff_access SET active=1,updated_at=? WHERE email=? AND active=0 RETURNING email').bind(now,email).first();
  if(!row)return reply({error:'Coach not found.'},404);
  await securityEvent(actor,'coach_access_restored',email);return reply({ok:true});
 }
 // Permanent removal (Justin's entry 15): only for a coach whose access was already removed, and never while they
 // have lessons booked. Their profile, future open times and unused invites go; their staff record goes, so they leave
 // the lists. Past lessons, payments (each order keeps the coach's name), pay settings and the audit log stay.
 if(input.action==='delete'){
  if(input.confirmed!==true)return reply({error:'Confirm permanent removal first.'},400);
  const row=await env.DB!.prepare('SELECT active FROM staff_access WHERE email=?').bind(email).first<{active:number}>();
  if(!row)return reply({error:'Coach not found.'},404);
  if(row.active!==0)return reply({error:'Remove this coach’s access first.'},409);
  const booked=(await upcomingBooked()).get(email)??0;
  if(booked)return reply({error:`This coach has ${booked} booked lesson${booked===1?'':'s'} still to come. Move or refund ${booked===1?'it':'them'} first.`},409);
  const removed='EXISTS (SELECT 1 FROM staff_access WHERE email=? AND active=0)';
  await env.DB!.batch([
   env.DB!.prepare(`DELETE FROM coach_openings WHERE coach_email=? AND date>=? AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.kind='lesson' AND x.item_id=coach_openings.id) AND ${removed}`).bind(email,academyToday(),email),
   env.DB!.prepare(`DELETE FROM coach_profiles WHERE email=? AND ${removed}`).bind(email,email),
   env.DB!.prepare(`UPDATE coach_invites SET revoked_at=? WHERE email=? AND used_at IS NULL AND revoked_at IS NULL AND ${removed}`).bind(now,email,email),
   env.DB!.prepare(`INSERT INTO security_events(id,actor,action,target,created_at) SELECT ?,?,?,?,? WHERE ${removed}`).bind(crypto.randomUUID(),actor,'coach_permanently_removed',email,now,email),
   env.DB!.prepare('DELETE FROM staff_access WHERE email=? AND active=0').bind(email)
  ]);
  return reply({ok:true});
 }
 // Change a coach's name or programs (also how coach access was granted before invites).
 if(input.action!=='grant'||typeof input.name!=='string'||!input.name.trim()||input.name.length>100||!validPrograms(input.programs))return reply({error:'Enter a coach name and valid program assignments.'},400);
 await env.DB!.prepare('INSERT INTO staff_access (email,name,programs,active,updated_at) VALUES (?,?,?,1,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,programs=excluded.programs,active=1,updated_at=excluded.updated_at').bind(email,input.name.trim(),JSON.stringify([...new Set(input.programs)]),now).run();
 await securityEvent(actor,'coach_access_granted',email);return reply({ok:true});
}
