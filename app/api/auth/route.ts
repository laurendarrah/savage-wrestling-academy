import {env} from 'cloudflare:workers';
import {mfaSwitchedOff} from '../../../lib/mfa-policy';
import { rateLimited } from '../../../lib/rate-limit';
import { accountRole,roleDestination } from '../../../lib/access-control';
import { accountClient, accountReply, sameOrigin, appOrigin, sessionClaims, verifiedAccount } from '../../../lib/account-auth';
import { hasOpenInvite } from '../../../lib/coach-invites';
import {withApi} from '../../../lib/api';
export const dynamic='force-dynamic';
// Sign-in attempts per email: 10 a minute, and 30 an hour as the back-off for anyone who keeps trying (issue #274).
// The shared address counter is higher, so a gym full of families on one network can all sign in.
export const LOGIN_PER_MINUTE=10,LOGIN_PER_HOUR=30,LOGIN_PER_ADDRESS=30,SESSION_ACTIONS_PER_ADDRESS=60;
// One answer for a wrong password and an unconfirmed email (issue #274), so the sign-in page never says which
// addresses have an account waiting for confirmation.
export const LOGIN_FAILED='Email or password is incorrect. If you just signed up, confirm your email first.';
export const GET = withApi(GET_); async function GET_(request:Request){
 const auth=await verifiedAccount(request),user=auth.user;
 return accountReply({user:user?{email:user.email,role:(await accountRole(user)).role}:null},200,auth.headers);
}
export const POST = withApi(POST_); async function POST_(request:Request){
 if(!sameOrigin(request))return accountReply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return accountReply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>8192)return accountReply({error:'Request too large.'},413);
 let input;try{input=JSON.parse(raw)}catch{return accountReply({error:'Invalid request.'},400)}
 const action=input?.action,email=typeof input?.email==='string'?input.email.trim().toLowerCase():'';
 if(!['signup','login','reset','change','logout','resend'].includes(action))return accountReply({error:'Unknown action.'},400);
 if(['signup','login','reset','resend'].includes(action)&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254))return accountReply({error:'Enter a valid email address.'},400);
 if(['signup','change'].includes(action)&&(typeof input.password!=='string'||input.password.length<12||input.password.length>128))return accountReply({error:'Use a password between 12 and 128 characters.'},400);
 if(action==='login'&&(typeof input.password!=='string'||!input.password||input.password.length>128))return accountReply({error:'Enter your password.'},400);
 const auth=accountClient(request),reply=(body:unknown,status=200)=>accountReply(body,status,auth.headers);
 // Each action has its own counters (issue #274): sign-in attempts never use up password resets, and sign-out and
 // password changes are counted per signed-in account (from the session's own token; anonymous ones per address), so
 // nobody can lock everyone out of signing out by posting ten anonymous requests.
 const limited=async()=>{
  if(action==='login')return rateLimited(request,'login:'+email,LOGIN_PER_MINUTE,{ipLimit:LOGIN_PER_ADDRESS,hourly:LOGIN_PER_HOUR});
  if(action==='signup'||action==='reset'||action==='resend')return rateLimited(request,action+':'+email);
  const who=(await sessionClaims(auth.client))?.sub;
  return rateLimited(request,'session:'+(who?'user:'+who:'ip:'+(request.headers.get('cf-connecting-ip')??'unknown')),10,{ipLimit:SESSION_ACTIONS_PER_ADDRESS});
 };
 if(await limited())return reply({error:'Too many attempts. Please wait a minute and try again.'},429);
 try{
 if(action==='logout'){const {error}=await auth.client.auth.signOut({scope:'local'});if(error&&error.status!==403)return reply({error:'Sign-out could not finish. Try again.'},502);return reply({ok:true})}
 if(action==='signup'){
 const {error}=await auth.client.auth.signUp({email,password:input.password,options:{emailRedirectTo:appOrigin()+'/auth/confirm'}});
 if(error)return reply({error:error.code==='over_email_send_rate_limit'?'Email limit reached. Please wait before trying again.':'Account creation could not finish. Check your details or try signing in.'},400);
 return reply({message:'Check your email to confirm your account, then return here to sign in.'});
 }
 if(action==='login'){
 const {data,error}=await auth.client.auth.signInWithPassword({email,password:input.password});
 if(error||!data.user){
 if(error?.code==='email_not_confirmed'||error?.code==='invalid_credentials')return reply({error:LOGIN_FAILED},401);
 if(error?.status===429||error?.code==='over_request_rate_limit')return reply({error:'Too many sign-in attempts. Please wait a minute and try again.'},429);
 return reply({error:'The sign-in service is temporarily unavailable. Your password has not been checked. Please try again shortly.'},503);
 }
 const {role}=await accountRole(data.user);
 // Someone invited as a coach goes back to accept the invite first (issue #190); it then asks for the authenticator.
 if(role==='family'&&data.user.email_confirmed_at&&await hasOpenInvite(data.user.email))return reply({redirect:'/coach-join'});
 // The authenticator level comes from the new session's own token (issue #274), not another call to Supabase.
 const aal2=(await sessionClaims(auth.client))?.aal==='aal2';
 const hasFactor=!!data.user.factors?.some(f=>f.status==='verified');
 // Staff need the authenticator unless STAFF_MFA=off (issue #204); anyone who set one up always uses it.
 const staffNeedCode=(role==='owner'||role==='coach')&&!mfaSwitchedOff((env as {STAFF_MFA?:string}).STAFF_MFA);
 return reply({redirect:((staffNeedCode||hasFactor)&&!aal2)?'/security':roleDestination(role)});
 }
 if(action==='reset'){
 const {error}=await auth.client.auth.resetPasswordForEmail(email,{redirectTo:appOrigin()+'/auth/confirm?next=change'});
 if(error)return reply({error:error.status===429||error.code==='over_email_send_rate_limit'?'Email sending is temporarily limited. Your reset email could not be sent. Please try again later; your current password still works.':'Unable to request a reset right now. Try again later.'},error.status===429||error.code==='over_email_send_rate_limit'?429:502);
 return reply({message:'If an account exists, you will receive a password reset email. Check your inbox and spam folder.'});
 }
 if(action==='resend'){
 const {error}=await auth.client.auth.resend({type:'signup',email,options:{emailRedirectTo:appOrigin()+'/auth/confirm'}});
 if(error)return reply({error:error.status===429||error.code==='over_email_send_rate_limit'?'Email sending is temporarily limited. A new confirmation email could not be sent. Please try again later.':'Unable to request a confirmation email right now. Try again later.'},error.status===429||error.code==='over_email_send_rate_limit'?429:502);
 return reply({message:'If confirmation is needed, a confirmation email has been requested. Please check your inbox.'});
 }
 const {data:{user},error}=await auth.client.auth.getUser();if(error||!user)return reply({error:'Open the password reset link from your email first.'},401);
 if(user.factors?.some(f=>f.status==='verified')){const claims=await sessionClaims(auth.client);if(claims?.aal!=='aal2')return reply({error:'Verify your authenticator at Security before changing your password.'},403)}
 const result=await auth.client.auth.updateUser({password:input.password});if(result.error)return reply({error:'Password could not be changed. Use a different password or request a new reset link.'},400);
 await auth.client.auth.signOut({scope:'others'});
 return reply({message:'Password updated. You can now sign in with your new password.'});
 }catch{return reply({error:'Account service unavailable. Please try again.'},502)}
}
