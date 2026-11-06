import {env} from 'cloudflare:workers';
import {strongAccount,verifiedOwner,accountReply,sameOrigin} from '../../../lib/account-auth';
import {accountRole} from '../../../lib/access-control';
import {boundedBody,rasterType} from '../../../lib/coach-profile';
import {securityEvent} from '../../../lib/security-events';
export const dynamic='force-dynamic';
const bucket=()=> (env as Cloudflare.Env & {BUCKET?:R2Bucket}).BUCKET;
export async function GET(request:Request){
 const auth=await strongAccount(request),access=await accountRole(auth.user);
 if(!auth.strong||(access.role!=='coach'&&!verifiedOwner(auth.user)))return accountReply({error:'Coach or owner access required.'},403,auth.headers);
 const email=verifiedOwner(auth.user)?(new URL(request.url).searchParams.get('email')?.toLowerCase()||auth.user!.email!.toLowerCase()):auth.user!.email!.toLowerCase();
 if(!email)return accountReply({error:'Choose a coach.'},400,auth.headers);
 const row=await env.DB!.prepare('SELECT photo_key,photo_type FROM coach_profiles WHERE email=?').bind(email).first<{photo_key:string|null;photo_type:string|null}>();
 const object=row?.photo_key?await bucket()?.get(row.photo_key):null;
 if(!object)return accountReply({error:'No coach photo.'},404,auth.headers);
 auth.headers.set('Content-Type',row!.photo_type!);auth.headers.set('Content-Security-Policy',"default-src 'none'; sandbox");auth.headers.set('Content-Disposition','inline');return new Response(object.body,{headers:auth.headers});
}
export async function POST(request:Request){
 const auth=await strongAccount(request),access=await accountRole(auth.user),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if((access.role!=='coach'&&access.role!=='owner')||!auth.strong)return reply({error:'Coach access and authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 const storage=bucket();if(!storage)return reply({error:'Photo storage is unavailable. Your profile can still be saved.'},503);
 const email=auth.user!.email!.toLowerCase();
 const row=await env.DB!.prepare('SELECT photo_key FROM coach_profiles WHERE email=?').bind(email).first<{photo_key:string|null}>();
 if(!row)return reply({error:'Save your coach profile before adding a photo.'},409);
 if(request.headers.get('x-photo-action')==='remove'){
 await env.DB!.prepare('UPDATE coach_profiles SET photo_key=NULL,photo_type=NULL,updated_at=? WHERE email=?').bind(new Date().toISOString(),email).run();
 if(row.photo_key)await storage.delete(row.photo_key);await securityEvent(auth.user!.id,'coach_photo_removed');return reply({ok:true});
 }
 const bytes=await boundedBody(request,2*1024*1024);if(!bytes)return reply({error:'Choose a photo smaller than 2 MB.'},413);
 const type=rasterType(bytes);if(!type||type!==request.headers.get('content-type'))return reply({error:'Use a JPG, PNG or WebP photo.'},415);
 const key='coach-photos/'+auth.user!.id+'/'+crypto.randomUUID();
 await storage.put(key,bytes,{httpMetadata:{contentType:type}});
 let saved;
 try{
  saved=await env.DB!.prepare('UPDATE coach_profiles SET photo_key=?,photo_type=?,updated_at=? WHERE email=? AND (? OR EXISTS (SELECT 1 FROM staff_access WHERE email=? AND active=1)) RETURNING email')
   .bind(key,type,new Date().toISOString(),email,access.role==='owner'?1:0,email).first();
 }catch(error){await storage.delete(key);throw error}
 if(!saved){await storage.delete(key);return reply({error:'Coach access or profile changed. Reload before adding a photo.'},409)}
 if(row.photo_key)await storage.delete(row.photo_key);await securityEvent(auth.user!.id,'coach_photo_saved');return reply({ok:true});
}
