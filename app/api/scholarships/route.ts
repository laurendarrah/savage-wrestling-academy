import {env} from 'cloudflare:workers';
import {ownerIdentity,accountReply,sameOrigin} from '../../../lib/account-auth';
import {registrationCatalog} from '../../../lib/registration-catalog';
import {scholarshipDraft,scholarshipView,newInviteToken,inviteHash,type Scholarship} from '../../../lib/scholarships';
import {securityEvent} from '../../../lib/security-events';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const auth=await ownerIdentity(request);
 if(!auth.owner)return accountReply({error:'Owner sign-in and authenticator verification required.'},403,auth.headers);
 const rows=await env.DB!.prepare('SELECT * FROM scholarship_awards ORDER BY created_at DESC, id DESC').all<Scholarship>();
 return accountReply({awards:rows.results.map(a=>scholarshipView(a))},200,auth.headers);
}
export async function POST(request:Request){
 const auth=await ownerIdentity(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(!auth.owner)return reply({error:'Owner sign-in and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>25000)return reply({error:'Request too large.'},413);
 let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 const now=new Date(),at=now.toISOString();
 if(input?.action==='create'){
  const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof input.wrestlerName!=='string'||!input.wrestlerName.trim()||input.wrestlerName.length>120)return reply({error:'Enter the parent email and wrestler’s name.'},400);
  const row=await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload:string}>();
  const p=registrationCatalog(row?JSON.parse(row.payload):{},at.slice(0,7),at.slice(0,10)).programs.find((p:{id:string;monthlyCents:number|null})=>p.id===input.program);
  if(!p||p.monthlyCents===null)return reply({error:'Choose a program with a saved monthly tuition price.'},400);
  const token=newInviteToken(),id=crypto.randomUUID(),expires=new Date(now.getTime()+30*86400000).toISOString();
  const award=await env.DB!.prepare("INSERT INTO scholarship_awards(id,token_hash,recipient_email,wrestler_name,program,reference_cents,terms_text,expires_at,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *")
   .bind(id,await inviteHash(token),email,input.wrestlerName.trim(),p.id,p.monthlyCents,scholarshipDraft,expires,at,auth.owner.userId).first<Scholarship>();
  // Issue #272: offers and revocations are in the security log (the id, program and monthly value; never the email).
  await securityEvent(auth.owner.userId,'scholarship_offered',`${id} ${p.id} ${p.monthlyCents}`);
  return reply({award:scholarshipView(award!),inviteUrl:new URL('/scholarship#token='+token,request.url).href});
 }
 if(!input||typeof input.id!=='string'||!Number.isInteger(input.revision))return reply({error:'Refresh the scholarship list before editing.'},400);
 const award=await env.DB!.prepare('SELECT * FROM scholarship_awards WHERE id=?').bind(input.id).first<Scholarship>();
 if(!award)return reply({error:'Scholarship not found.'},404);
 if(award.revision!==input.revision)return reply({error:'This award changed. Refresh before editing.'},409);
 let updated:Scholarship|null=null;
 if(input.action==='finalize'){
  if(award.status!=='offered'||input.reviewed!==true||typeof input.terms!=='string'||input.terms.trim().length<200||input.terms.trim()===scholarshipDraft.trim()||input.terms.length>20000)return reply({error:'Paste the final attorney-reviewed agreement and confirm its review before opening acceptance.'},400);
  updated=await env.DB!.prepare("UPDATE scholarship_awards SET terms_text=?,terms_ready=1,revision=revision+1 WHERE id=? AND revision=? AND status='offered' RETURNING *").bind(input.terms.trim(),award.id,input.revision).first<Scholarship>();
 }else if(input.action==='revoke'){
  updated=await env.DB!.prepare("UPDATE scholarship_awards SET status=CASE WHEN status='active' THEN 'ended' ELSE 'revoked' END,ended_at=?,revision=revision+1 WHERE id=? AND revision=? AND status IN ('offered','active') RETURNING *").bind(at,award.id,input.revision).first<Scholarship>();
  if(updated)await securityEvent(auth.owner.userId,updated.status==='ended'?'scholarship_ended':'scholarship_revoked',`${award.id} ${award.program} ${award.reference_cents}`);
 }else if(input.action==='link'){
  if(award.status!=='offered')return reply({error:'Only an unaccepted offer can have a new invitation link.'},409);
  const token=newInviteToken();
  updated=await env.DB!.prepare("UPDATE scholarship_awards SET token_hash=?,expires_at=?,revision=revision+1 WHERE id=? AND revision=? AND status='offered' RETURNING *").bind(await inviteHash(token),new Date(now.getTime()+30*86400000).toISOString(),award.id,input.revision).first<Scholarship>();
  return updated?reply({award:scholarshipView(updated),inviteUrl:new URL('/scholarship#token='+token,request.url).href}):reply({error:'Award changed. Refresh before editing.'},409);
 }else return reply({error:'Choose a valid scholarship action.'},400);
 return updated?reply({award:scholarshipView(updated)}):reply({error:'Award changed or is no longer editable. Refresh the list.'},409);
}
