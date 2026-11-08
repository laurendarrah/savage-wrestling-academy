import {env} from 'cloudflare:workers';
import {strongAccount,accountReply,sameOrigin} from '../../../lib/account-auth';
import {familyProfile,checkCompetitionAccess} from '../../../lib/program-approval';
import {scholarshipView,inviteHash,validInvite,type Scholarship} from '../../../lib/scholarships';
import {cleanSignature,electronicConsent,type SignatureRecord} from '../../../lib/scholarship-signatures';
import {withApi} from '../../../lib/api';
export const dynamic='force-dynamic';
export const GET = withApi(GET_); async function GET_(request:Request){
 const auth=await strongAccount(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(!auth.user?.email_confirmed_at)return reply({error:'Sign-in required.'},401);
 if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return reply({error:'Authenticator verification required.'},403);
 const rows=await env.DB!.prepare("SELECT * FROM scholarship_awards WHERE user_id=? ORDER BY accepted_at DESC").bind(auth.user.id).all<Scholarship>();
 return reply({awards:rows.results.map(a=>scholarshipView(a))});
}
export const POST = withApi(POST_); async function POST_(request:Request){
 const auth=await strongAccount(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(!auth.user?.email_confirmed_at)return reply({error:'Sign in with the parent email that received this invitation.'},401);
 if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return reply({error:'Authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>100000)return reply({error:'Request too large.'},413);
 let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 if(!validInvite(input?.token))return reply({error:'This invitation is unavailable.'},404);
 const hash=await inviteHash(input.token);
 const award=await env.DB!.prepare('SELECT * FROM scholarship_awards WHERE token_hash=? AND recipient_email=?').bind(hash,auth.user.email!.toLowerCase()).first<Scholarship>();
 if(!award||['revoked','ended'].includes(award.status))return reply({error:'This invitation is unavailable for your account. Use the invited parent email or contact SWA.'},404);
 if(award.status==='active')return award.user_id===auth.user.id?reply({award:scholarshipView(award),accepted:true}):reply({error:'Invitation unavailable.'},404);
 if(Date.parse(award.expires_at)<=Date.now())return reply({error:'This invitation expired. Ask SWA for a new link.'},410);
 if(input.action==='view')return reply({award:scholarshipView(award)});
 if(input.action!=='accept')return reply({error:'Choose a valid action.'},400);
 if(!award.terms_ready)return reply({error:'This agreement isn’t final yet. You can accept it once the academy finishes it.'},409);
 if(input.revision!==award.revision)return reply({error:'The terms changed. Reload and review the current agreement.'},409);
 if(input.accepted!==true||typeof input.signer!=='string'||input.signer.trim().length<2||input.signer.length>120)return reply({error:'Enter the parent/guardian’s full name and confirm acceptance.'},400);
 const signature=cleanSignature(input.signature);
 if(!signature||signature.method!=='drawn'||input.electronicConsent!==true)return reply({error:'Print your name, draw your signature, and consent to signing electronically. Refresh the invitation if the signature section is missing.'},400);
 const profile=await familyProfile(auth.user.id),w=profile?.wrestlers.find(w=>w.id===input.wrestlerId);
 if(!w||w.name.trim().toLowerCase()!==award.wrestler_name.toLowerCase())return reply({error:'Select the invited wrestler from your saved family profile.'},400);
 const blocked=await checkCompetitionAccess(auth.user.id,award.program,w);if(blocked)return reply({error:blocked},403);
 const now=new Date().toISOString();
 const record:SignatureRecord={...signature,version:1,termsRevision:award.revision,termsSha256:await inviteHash(award.terms_text),signedAt:now,signer:input.signer.trim(),accountEmail:auth.user.email!,consent:electronicConsent};
 try{
  const updated=await env.DB!.prepare("UPDATE scholarship_awards SET status='active',user_id=?,wrestler_id=?,signer=?,accepted_at=?,signature_record=?,revision=revision+1 WHERE id=? AND token_hash=? AND revision=? AND terms_ready=1 AND status='offered' AND expires_at>? AND EXISTS (SELECT 1 FROM family_accounts f, json_each(f.payload,'$.wrestlers') w WHERE f.user_id=? AND json_extract(w.value,'$.id')=? AND json_extract(w.value,'$.name')=? AND json_extract(w.value,'$.grade')=?) AND (program<>'Advanced' OR EXISTS (SELECT 1 FROM program_approvals p WHERE p.user_id=? AND p.wrestler_id=? AND p.program='Advanced' AND p.status='approved' AND p.wrestler_name=? AND p.grade=?)) RETURNING *")
   .bind(auth.user.id,w.id,input.signer.trim(),now,JSON.stringify(record),award.id,hash,input.revision,now,auth.user.id,w.id,w.name,w.grade,auth.user.id,w.id,w.name,w.grade).first<Scholarship>();
  return updated?reply({award:scholarshipView(updated),accepted:true}):reply({error:'This offer changed. Reload before accepting.'},409);
 }catch{return reply({error:'This wrestler may already have an active scholarship. Refresh your family account or contact SWA.'},409)}
}
