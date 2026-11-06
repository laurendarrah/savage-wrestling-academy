import { env } from 'cloudflare:workers';
import { strongAccount, accountReply, sameOrigin, verifiedOwner } from '../../../lib/account-auth';
import {deleteUsaCardPhoto} from '../../../lib/usa-card';
import {isTestWrestler} from '../../../lib/test-family';
import {attendanceToday} from '../../../lib/program-attendance';
import { validFamily, cleanFamily, emptyFamily, type FamilyProfile } from '../../../lib/family-records';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const auth=await strongAccount(request);if(!auth.user?.email_confirmed_at)return accountReply({error:'Sign-in required.'},401,auth.headers);
 if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return accountReply({error:'Authenticator verification required.'},403,auth.headers);
 const row=await env.DB!.prepare('SELECT payload,revision,updated_at FROM family_accounts WHERE user_id=?').bind(auth.user.id).first<{payload:string;revision:number;updated_at:string}>();
 const enrollments=await env.DB!.prepare(`SELECT wrestler_id,program,kind,starts_on,ends_on,practice_start,practice_end FROM program_enrollments
  WHERE user_id=? AND ends_on>=? AND voided_at IS NULL ORDER BY starts_on`).bind(auth.user.id,attendanceToday()).all();
 return accountReply({email:auth.user.email,enrollments:enrollments.results,data:row?JSON.parse(row.payload):emptyFamily(),revision:row?.revision??0,updatedAt:row?.updated_at??null},200,auth.headers);
}
export async function PUT(request:Request){
 const auth=await strongAccount(request);if(!auth.user?.email_confirmed_at)return accountReply({error:'Sign-in required.'},401,auth.headers);
 const reply=(body:unknown,status=200)=>accountReply(body,status,auth.headers);
 if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return reply({error:'Authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>20000)return reply({error:'Profile is too large.'},413);
 let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid JSON.'},400)}
 if(!input||!Number.isInteger(input.revision)||input.revision<0||!validFamily(input.data))return reply({error:'Check the family profile fields.'},400);
 if(!verifiedOwner(auth.user)&&input.data.wrestlers.some((w:{id:string})=>isTestWrestler(w.id)))return reply({error:'Choose a valid wrestler ID.'},400);
 const scholarships=await env.DB!.prepare("SELECT wrestler_id FROM scholarship_awards WHERE user_id=? AND status='active'").bind(auth.user.id).all<{wrestler_id:string}>();
 if(scholarships.results.some(a=>!input.data.wrestlers.some((w:{id:string})=>w.id===a.wrestler_id)))return reply({error:'An active scholarship wrestler must remain in the family profile. Contact SWA before removing this wrestler.'},409);
 const prior=input.revision>0?await env.DB!.prepare('SELECT payload FROM family_accounts WHERE user_id=? AND revision=?')
  .bind(auth.user.id,input.revision).first<{payload:string}>():null;
 const previous=prior?JSON.parse(prior.payload) as FamilyProfile:undefined;
 const payload=JSON.stringify(cleanFamily(input.data,previous)),now=new Date().toISOString();
 const hasEnrollmentToKeep=`EXISTS(SELECT 1 FROM program_enrollments WHERE user_id=? AND ends_on>=? AND voided_at IS NULL
  AND wrestler_id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?,'$.wrestlers')))`;
 const enrollmentArgs=[auth.user.id,attendanceToday(),payload] as const;
 // The account ID always comes from the verified session, never the client body.
 const row=input.revision===0?
 await env.DB!.prepare('INSERT INTO family_accounts (user_id,email,payload,revision,updated_at) VALUES (?,?,?,1,?) ON CONFLICT(user_id) DO NOTHING RETURNING revision').bind(auth.user.id,auth.user.email!,payload,now).first<{revision:number}>():
 await env.DB!.prepare(`UPDATE family_accounts SET payload=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? AND NOT ${hasEnrollmentToKeep} RETURNING revision`).bind(payload,now,auth.user.id,input.revision,...enrollmentArgs).first<{revision:number}>();
 if(!row){
  const blocked=await env.DB!.prepare(`SELECT 1 WHERE ${hasEnrollmentToKeep}`).bind(...enrollmentArgs).first();
  return reply({error:blocked?'A wrestler with a confirmed signup must remain in the family profile. Contact SWA before removing this wrestler.':'Your profile changed on another device. Reload before saving.'},409);
 }
 if(previous?.wrestlers.some(w=>!input.data.wrestlers.some((item:{id:string})=>item.id===w.id))){
  const removed=await env.DB!.prepare(`DELETE FROM wrestler_membership_cards WHERE user_id=? AND NOT EXISTS (
   SELECT 1 FROM family_accounts f,json_each(f.payload,'$.wrestlers') w
   WHERE f.user_id=wrestler_membership_cards.user_id AND json_extract(w.value,'$.id')=wrestler_membership_cards.wrestler_id
  ) RETURNING photo_key`).bind(auth.user.id).all<{photo_key:string}>();
  await Promise.all(removed.results.map(card=>deleteUsaCardPhoto(card.photo_key)));
 }
 return reply({revision:row.revision,updatedAt:now});
}
