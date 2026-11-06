import { env } from 'cloudflare:workers';
import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';

export const OWNER_EMAIL = 'savagewrestlingclub@gmail.com';
export const APP_ORIGIN = 'https://savage-registration-preview.justinaccordino546.chatgpt.site';
export function accountClient(request: Request) {
 const headers = new Headers({'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"});
 const config=env as Cloudflare.Env & {SUPABASE_URL?:string;SUPABASE_PUBLISHABLE_KEY?:string};
 if(!config.SUPABASE_URL||!config.SUPABASE_PUBLISHABLE_KEY) throw new Error('Account sign-in is not configured.');
 const client=createServerClient(config.SUPABASE_URL,config.SUPABASE_PUBLISHABLE_KEY,{
  cookieOptions:{httpOnly:true,secure:true,sameSite:'lax',path:'/'},
  cookies:{getAll(){return parseCookieHeader(request.headers.get('cookie')??'').map(c=>({name:c.name,value:c.value??''}))},setAll(cookies,cacheHeaders){for(const {name,value,options} of cookies)headers.append('Set-Cookie',serializeCookieHeader(name,value,{...options,httpOnly:true,secure:true,sameSite:'lax',path:'/'}));for(const [name,value] of Object.entries(cacheHeaders??{})) headers.set(name,value)}},
 });
 return {client,headers};
}
export function verifiedOwner(user: User | null): boolean {return !!user?.email_confirmed_at && user.email?.toLowerCase()===OWNER_EMAIL}
export async function verifiedAccount(request: Request) {
 const auth=accountClient(request);
 const {data:{user},error}=await auth.client.auth.getUser();
 return {...auth,user:error?null:user};
}
export async function strongAccount(request: Request) {
 const auth=await verifiedAccount(request);
 let strong=false;
 if(auth.user?.email_confirmed_at){
 const {data,error}=await auth.client.auth.mfa.getAuthenticatorAssuranceLevel();
 strong=!error&&data?.currentLevel==='aal2'&&!!auth.user.factors?.some(f=>f.status==='verified'&&f.factor_type==='totp');
 }
 return {...auth,strong};
}
export async function ownerIdentity(request: Request) {
 const auth=await strongAccount(request);
 return {...auth,mfaRequired:verifiedOwner(auth.user)&&!auth.strong,owner:verifiedOwner(auth.user)&&auth.strong?{userId:'supabase:'+auth.user!.id,displayName:auth.user!.email!}:null};
}
export function sameOrigin(request:Request){return request.headers.get('origin')===new URL(request.url).origin}
export function accountReply(body:unknown,status=200,headers?:Headers){return Response.json(body,{status,headers:headers??{'Cache-Control':'private, no-store'}})}
