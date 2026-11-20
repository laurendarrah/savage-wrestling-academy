import { accountClient } from '../../../lib/account-auth';
import { hasOpenInvite, acceptOpenInvite } from '../../../lib/coach-invites';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const url=new URL(request.url),auth=accountClient(request);
 const code=url.searchParams.get('code'),hash=url.searchParams.get('token_hash'),type=url.searchParams.get('type');
 let valid=false,email:string|undefined,user:any=null;
 if(code){const {data,error}=await auth.client.auth.exchangeCodeForSession(code);valid=!error;email=data?.user?.email;user=data?.user??null}
 else if(hash&&(type==='email'||type==='signup'||type==='recovery')){const {data,error}=await auth.client.auth.verifyOtp({token_hash:hash,type});valid=!error;email=data?.user?.email;user=data?.user??null}
 const requested=url.searchParams.get('next'),change=requested==='change'||type==='recovery';
 // A coach who signed up from their invite comes back to /coach-join to accept it, on any device (issue #190). The
 // email link itself stays /auth/confirm, so no new Supabase redirect address is needed.
 const coach=valid&&!change&&!!email&&await hasOpenInvite(email).catch(()=>false);
 // A link that cannot sign the person in (issue #384). With the email templates in docs/email-templates the site checks
 // the link itself (token_hash), in any app or browser, so a failure means the link was used already or has expired.
 // An older email's link (?code=) also fails when opened away from the browser that asked for it. In each case a
 // confirmation link has most likely confirmed the email, so the page that follows tells the person to sign in and
 // never to start again. A password reset link that fails is said as that, not as a confirmation.
 // An invited coach who is now signed in gets coach access here and lands on coach home (issue #392).
 const accepted=coach&&await acceptOpenInvite(user).catch(()=>false);
 const path=valid?(change?'/login?mode=change':accepted?'/coach':coach?'/coach-join':'/login?confirmed=1'):change?'/login?reset=failed':'/login?confirmation=failed';
 auth.headers.set('Location',new URL(path,url.origin).href);
 return new Response(null,{status:303,headers:auth.headers});
}
