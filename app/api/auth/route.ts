import { rateLimited } from '../../../lib/rate-limit';
import { accountRole,roleDestination } from '../../../lib/access-control';
import { accountClient, accountReply, sameOrigin, verifiedOwner, APP_ORIGIN } from '../../../lib/account-auth';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const auth=accountClient(request),{data:{user},error}=await auth.client.auth.getUser();
 return accountReply({user:!error&&user?{email:user.email,role:(await accountRole(user)).role}:null},200,auth.headers);
}
export async function POST(request:Request){
 if(!sameOrigin(request))return accountReply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return accountReply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>8192)return accountReply({error:'Request too large.'},413);
 let input;try{input=JSON.parse(raw)}catch{return accountReply({error:'Invalid request.'},400)}
 const coachContext=input?.context==='coach';
 const confirmationUrl=APP_ORIGIN+'/auth/confirm'+(coachContext?'?next=coach':'');
 const action=input?.action,email=typeof input?.email==='string'?input.email.trim().toLowerCase():'';
 if(!['signup','login','reset','change','logout','resend'].includes(action))return accountReply({error:'Unknown action.'},400);
 if(['signup','login','reset','resend'].includes(action)&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254))return accountReply({error:'Enter a valid email address.'},400);
 if(['signup','change'].includes(action)&&(typeof input.password!=='string'||input.password.length<12||input.password.length>128))return accountReply({error:'Use a password between 12 and 128 characters.'},400);
 if(action==='login'&&(typeof input.password!=='string'||!input.password||input.password.length>128))return accountReply({error:'Enter your password.'},400);
 if(await rateLimited(request,email||'session-action'))return accountReply({error:'Too many attempts. Please wait a minute and try again.'},429);
 const auth=accountClient(request),reply=(body:unknown,status=200)=>accountReply(body,status,auth.headers);
 try{
 if(action==='logout'){const {error}=await auth.client.auth.signOut({scope:'local'});if(error&&error.status!==403)return reply({error:'Sign-out could not finish. Try again.'},502);return reply({ok:true})}
 if(action==='signup'){
 const {error}=await auth.client.auth.signUp({email,password:input.password,options:{emailRedirectTo:confirmationUrl}});
 if(error)return reply({error:error.code==='over_email_send_rate_limit'?'Email limit reached. Please wait before trying again.':'Account creation could not finish. Check your details or try signing in.'},400);
 return reply({message:'Check your email to confirm your account, then return here to sign in.'});
 }
 if(action==='login'){
 const {data,error}=await auth.client.auth.signInWithPassword({email,password:input.password});
 if(error||!data.user){
 if(error?.code==='email_not_confirmed')return reply({error:'Confirm your email before signing in.'},401);
 if(error?.code==='invalid_credentials')return reply({error:'Email or password is incorrect.'},401);
 if(error?.status===429||error?.code==='over_request_rate_limit')return reply({error:'Too many sign-in attempts. Please wait a minute and try again.'},429);
 return reply({error:'The sign-in service is temporarily unavailable. Your password has not been checked. Please try again shortly.'},503);
 }
 const {role}=await accountRole(data.user);
 const {data:level}=await auth.client.auth.mfa.getAuthenticatorAssuranceLevel();
 const hasFactor=!!data.user.factors?.some(f=>f.status==='verified');
 return reply({redirect:((role==='owner'||role==='coach'||hasFactor)&&level?.currentLevel!=='aal2')?'/security':roleDestination(role)});
 }
 if(action==='reset'){
 const {error}=await auth.client.auth.resetPasswordForEmail(email,{redirectTo:APP_ORIGIN+'/auth/confirm?next=change'+(coachContext?'&coach=1':'')});
 if(error)return reply({error:error.status===429||error.code==='over_email_send_rate_limit'?'Email sending is temporarily limited. Your reset email could not be sent. Please try again later; your current password still works.':'Unable to request a reset right now. Try again later.'},error.status===429||error.code==='over_email_send_rate_limit'?429:502);
 return reply({message:'If an account exists, you will receive a password reset email. Check your inbox and spam folder.'});
 }
 if(action==='resend'){
 const {error}=await auth.client.auth.resend({type:'signup',email,options:{emailRedirectTo:confirmationUrl}});
 if(error)return reply({error:error.status===429||error.code==='over_email_send_rate_limit'?'Email sending is temporarily limited. A new confirmation email could not be sent. Please try again later.':'Unable to request a confirmation email right now. Try again later.'},error.status===429||error.code==='over_email_send_rate_limit'?429:502);
 return reply({message:'If confirmation is needed, a confirmation email has been requested. Please check your inbox.'});
 }
 const {data:{user},error}=await auth.client.auth.getUser();if(error||!user)return reply({error:'Open the password reset link from your email first.'},401);
 if(user.factors?.some(f=>f.status==='verified')){const {data:level,error:levelError}=await auth.client.auth.mfa.getAuthenticatorAssuranceLevel();if(levelError||level?.currentLevel!=='aal2')return reply({error:'Verify your authenticator at Security before changing your password.'},403)}
 const result=await auth.client.auth.updateUser({password:input.password});if(result.error)return reply({error:'Password could not be changed. Use a different password or request a new reset link.'},400);
 await auth.client.auth.signOut({scope:'others'});
 return reply({message:'Password updated. You can now sign in with your new password.'});
 }catch{return reply({error:'Account service unavailable. Please try again.'},502)}
}
