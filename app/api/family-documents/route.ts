import {env} from 'cloudflare:workers';
import {strongAccount,accountReply,sameOrigin,verifiedOwner} from '../../../lib/account-auth';
import {boundedBody} from '../../../lib/coach-profile';
import {getDocument,idValid,versionHash} from '../../../lib/documents';
import {cleanSignature,electronicConsent,type SignatureRecord} from '../../../lib/scholarship-signatures';
import {rateLimited} from '../../../lib/rate-limit';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const auth=await strongAccount(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(!auth.user?.email_confirmed_at)return reply({error:'Sign in to your family account.'},401);if((verifiedOwner(auth.user)||auth.user.factors?.some(f=>f.status==='verified'))&&!auth.strong)return reply({error:'Authenticator verification required.'},403);
 const u=new URL(request.url),id=u.searchParams.get('id');
 if(id){
  if(!idValid(id))return reply({error:'Document not found.'},404);
  const d=await getDocument(id);
  const assigned=d?.user_id===auth.user.id;
  if(!d||(!assigned&&!verifiedOwner(auth.user)))return reply({error:'Document not found for this account. Open the link while signed in with the assigned parent or guardian account.'},404);
  const {signature_record,...safe}=d;
  return reply({document:safe,canSign:assigned&&d.status==='pending'});
 }
 const offset=Number(u.searchParams.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return reply({error:'Invalid page.'},400);
 const docs=await env.DB!.prepare('SELECT a.id,a.wrestler_name,a.status,a.assigned_at,a.signed_at,a.signer,v.title,v.kind,v.version FROM document_assignments a JOIN document_versions v ON v.id=a.version_id WHERE a.user_id=? ORDER BY a.assigned_at DESC,a.id DESC LIMIT 51 OFFSET ?').bind(auth.user.id,offset).all();
 const scholarships=await env.DB!.prepare('SELECT id,wrestler_name,signer,accepted_at,status FROM scholarship_awards WHERE user_id=? AND accepted_at IS NOT NULL ORDER BY accepted_at DESC LIMIT 100').bind(auth.user.id).all();
 return reply({documents:docs.results.slice(0,50),hasMore:docs.results.length>50,scholarships:scholarships.results});
}
export async function POST(request:Request){
 const auth=await strongAccount(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(!auth.user?.email_confirmed_at)return reply({error:'Sign in to your family account.'},401);if((verifiedOwner(auth.user)||auth.user.factors?.some(f=>f.status==='verified'))&&!auth.strong)return reply({error:'Authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await boundedBody(request,100000);if(!raw)return reply({error:'Signature too large.'},413);let input;try{input=JSON.parse(new TextDecoder().decode(raw))}catch{return reply({error:'Invalid request.'},400)}
 if(!idValid(input?.id))return reply({error:'Document not found.'},404);const d=await getDocument(input.id);if(!d||d.user_id!==auth.user.id)return reply({error:'Document not found for this account.'},404);
 if(d.status==='signed')return reply({ok:true,alreadySigned:true});if(d.status!=='pending')return reply({error:'This request was withdrawn. Contact SWA.'},409);
 const sig=cleanSignature(input.signature);if(typeof input.signer!=='string'||input.signer.trim().length<2||input.signer.length>120||input.accepted!==true||input.electronicConsent!==true||!sig||sig.method!=='drawn')return reply({error:'Print your full name, draw your signature, and confirm both checkboxes.'},400);
 if(input.signerRole!=='guardian')return reply({error:'A parent or legal guardian must sign this request.'},400);
 if(input.versionId!==d.version_id||input.bodyHash!==d.body_hash||d.body_hash!==await versionHash(d))return reply({error:'Reload and review the exact published document before signing.'},409);
 if(await rateLimited(request,'document-sign:'+auth.user.id,10))return reply({error:'Too many attempts. Please wait a minute.'},429);
 const now=new Date().toISOString(),signer=input.signer.trim();
 const record:SignatureRecord={...sig,version:1,termsRevision:d.version,termsSha256:d.body_hash,signedAt:now,signer,accountEmail:auth.user.email!,consent:electronicConsent};
 // Immutable first acceptance and its audit entry commit together. A duplicate submission cannot overwrite the signature.
 const result=await env.DB!.batch([
 env.DB!.prepare("UPDATE document_assignments SET status='signed',signer=?,signer_role=?,signed_at=?,signature_record=? WHERE id=? AND user_id=? AND status='pending' AND version_id=? RETURNING id").bind(signer,input.signerRole,now,JSON.stringify(record),d.id,auth.user.id,d.version_id),
 env.DB!.prepare("INSERT INTO security_events(id,actor,action,target,created_at) SELECT ?,?,'document_signed',?,? WHERE EXISTS (SELECT 1 FROM document_assignments WHERE id=? AND signed_at=? AND signer=?)").bind(crypto.randomUUID(),auth.user.id,d.id,now,d.id,now,signer)
 ]);
 return result[0].results.length?reply({ok:true}):reply({error:'This request changed before signing. Reload it.'},409);
}
