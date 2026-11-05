import {env} from 'cloudflare:workers';
import {ownerIdentity} from '../../lib/account-auth';
import {inviteHash,type Scholarship} from '../../lib/scholarships';
import {cleanSignature,type SignatureRecord} from '../../lib/scholarship-signatures';
import {agreementHtml} from '../../lib/scholarship-agreement';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const auth=await ownerIdentity(request);
 if(!auth.user?.email_confirmed_at)return new Response('Sign-in required.',{status:401,headers:auth.headers});
 if(auth.mfaRequired||(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong))return new Response('Authenticator verification required.',{status:403,headers:auth.headers});
 const id=new URL(request.url).searchParams.get('id');
 if(!id||!/^[a-zA-Z0-9-]{1,80}$/.test(id))return new Response('Agreement not found.',{status:404,headers:auth.headers});
 const award=await env.DB!.prepare('SELECT * FROM scholarship_awards WHERE id=?').bind(id).first<Scholarship>();
 if(!award?.accepted_at||(!auth.owner&&award.user_id!==auth.user.id))return new Response('Agreement not found.',{status:404,headers:auth.headers});
 let record:SignatureRecord|null=null;
 if(award.signature_record){
  try{record=JSON.parse(award.signature_record)}catch{return new Response('The signature record needs review. Contact SWA.',{status:409,headers:auth.headers})}
  if(!record||!cleanSignature(record)||record.termsSha256!==await inviteHash(award.terms_text))return new Response('The agreement record needs review. Contact SWA.',{status:409,headers:auth.headers});
 }
 const nonce=crypto.randomUUID();
 auth.headers.set('Content-Type','text/html; charset=utf-8');
 auth.headers.set('Cache-Control','private, no-store');
 auth.headers.set('Referrer-Policy','no-referrer');
 auth.headers.set('X-Content-Type-Options','nosniff');
 auth.headers.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-"+nonce+"'; base-uri 'none'; frame-ancestors 'none'");
 if(new URL(request.url).searchParams.get('download')==='1')auth.headers.set('Content-Disposition',`attachment; filename="SWA-Scholarship-Agreement-${award.id}.html"`);
 return new Response(agreementHtml(award,record,nonce),{headers:auth.headers});
}
