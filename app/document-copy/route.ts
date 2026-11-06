import {ownerIdentity} from '../../lib/account-auth';
import {getDocument,idValid,versionHash,signedDocumentHtml} from '../../lib/documents';
import {cleanSignature,type SignatureRecord} from '../../lib/scholarship-signatures';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const auth=await ownerIdentity(request);if(!auth.user?.email_confirmed_at)return new Response('Sign-in required.',{status:401,headers:auth.headers});
 if(auth.mfaRequired||auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return new Response('Authenticator verification required.',{status:403,headers:auth.headers});
 const id=new URL(request.url).searchParams.get('id');if(!idValid(id))return new Response('Signed document not found.',{status:404,headers:auth.headers});
 const d=await getDocument(id);if(!d||d.status!=='signed'||!d.signature_record||!auth.owner&&d.user_id!==auth.user.id)return new Response('Signed document not found.',{status:404,headers:auth.headers});
 let r:SignatureRecord;try{r=JSON.parse(d.signature_record)}catch{return new Response('Signature record requires review.',{status:409,headers:auth.headers})}
 if(cleanSignature(r)?.method!=='drawn'||r.termsSha256!==d.body_hash||r.signedAt!==d.signed_at||r.signer!==d.signer||await versionHash(d)!==d.body_hash)return new Response('Document integrity requires review.',{status:409,headers:auth.headers});
 const nonce=crypto.randomUUID();auth.headers.set('Content-Type','text/html; charset=utf-8');auth.headers.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-"+nonce+"'; base-uri 'none'; frame-ancestors 'none'");if(new URL(request.url).searchParams.get('download')==='1')auth.headers.set('Content-Disposition',`attachment; filename="SWA-Signed-Document-${d.id}.html"`);
 return new Response(signedDocumentHtml(d,r,nonce),{headers:auth.headers});
}
