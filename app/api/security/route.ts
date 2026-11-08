import { accountReply,verifiedAccount,strongAccount,sameOrigin,verifiedOwner } from '../../../lib/account-auth';
import { accountRole,roleDestination } from '../../../lib/access-control';
import { rateLimited } from '../../../lib/rate-limit';
import { securityEvent } from '../../../lib/security-events';
import {withApi} from '../../../lib/api';
export const dynamic='force-dynamic';
export const GET = withApi(GET_); async function GET_(request:Request){
 const auth=await strongAccount(request);if(!auth.user?.email_confirmed_at)return accountReply({error:'Sign in with your email and password first.'},401,auth.headers);
 const {data,error}=await auth.client.auth.mfa.listFactors();if(error)return accountReply({error:'Unable to load authenticator settings.'},502,auth.headers);
 const {role}=await accountRole(auth.user);
 return accountReply({email:auth.user.email,role,strong:auth.strong,required:role==='owner'||role==='coach',destination:roleDestination(role),factors:data.totp.filter(f=>f.status==='verified').map(f=>({id:f.id,name:f.friendly_name||'Authenticator'}))},200,auth.headers);
}
export const POST = withApi(POST_); async function POST_(request:Request){
 const auth=await strongAccount(request);const reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(!auth.user?.email_confirmed_at)return reply({error:'Sign in first.'},401);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>4096)return reply({error:'Request too large.'},413);
 let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 if(await rateLimited(request,'mfa:'+auth.user.id))return reply({error:'Too many attempts. Wait a minute before trying again.'},429);
 const {data:factors,error:factorError}=await auth.client.auth.mfa.listFactors();if(factorError)return reply({error:'Unable to load authenticators.'},502);
 if(input?.action==='enroll'){
 if(factors.totp.some(f=>f.status==='verified')&&!auth.strong)return reply({error:'Enter your existing authenticator code before adding another.'},403);
 if(factors.totp.filter(f=>f.status==='verified').length>=2)return reply({error:'Two authenticators are already enrolled.'},400);
 // Remove only abandoned, unverified factors belonging to this session's user.
 for(const factor of factors.all.filter(f=>f.factor_type==='totp'&&f.status==='unverified'))await auth.client.auth.mfa.unenroll({factorId:factor.id});
 const {data,error}=await auth.client.auth.mfa.enroll({factorType:'totp',friendlyName:'Savage '+new Date().toISOString(),issuer:'Savage Wrestling Academy LLC'});
 if(error)return reply({error:'Unable to start authenticator setup. Please try again.'},502);
 return reply({factorId:data.id,qr:data.totp.qr_code,secret:data.totp.secret});
 }
 if(input?.action==='verify'){
 if(typeof input.factorId!=='string'||!factors.all.some(f=>f.factor_type==='totp'&&f.id===input.factorId)||typeof input.code!=='string'||!/^\d{6}$/.test(input.code))return reply({error:'Enter the six-digit code from your authenticator.'},400);
 const {error}=await auth.client.auth.mfa.challengeAndVerify({factorId:input.factorId,code:input.code});
 if(error)return reply({error:'The code could not be verified. Try the newest code in your authenticator.'},400);
 await securityEvent(auth.user.id,'mfa_verified');return reply({ok:true});
 }
 return reply({error:'Unknown action.'},400);
}
