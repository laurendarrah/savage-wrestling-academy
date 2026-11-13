import {env} from 'cloudflare:workers';
import {ownerIdentity,accountReply,sameOrigin} from '../../../lib/account-auth';
import {checkoutKinds,stripeMode,webhookSecret} from '../../../lib/checkout-config';
import {kindList} from '../../../lib/purchase-kinds';
import {validTestKey,stripeTestClient,sealStripeKey,testKeyConfigured,validKeyFor,stripeClientFor,sealStripeKeyFor,keyConfiguredFor,expectedStripeAccount,recordedStripeAccount,settingStripeAccount,sealStripeAccount,stripeAccountName,ACCOUNT_ID,type StripeAccountInfo} from '../../../lib/stripe-test';
import {rateLimited} from '../../../lib/rate-limit';
import {stripeSetupError} from '../../../lib/stripe-setup-errors';
import {keyAccount,NEEDS_ACCOUNT_SETTING} from '../../../lib/stripe-key-account';
import {securityEvent} from '../../../lib/security-events';
import {withApi} from '../../../lib/api';
export const dynamic='force-dynamic';
type Reply=(b:unknown,s?:number)=>Response;
const SETTING_INVALID='The Stripe account saved in the site’s settings is not a valid account id, so no key can be checked against it. Ask whoever maintains the site to correct it.';
const named=(a:StripeAccountInfo)=>a.name?`${a.name} (${a.id})`:a.id;
const upsert=(id:string,encrypted:string,ownerId:string,now:string)=>env.DB!.prepare('INSERT INTO integration_secrets (id,encrypted,updated_by,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(id,encrypted,ownerId,now);

export const GET = withApi(GET_); async function GET_(request:Request){const auth=await ownerIdentity(request);if(!auth.owner)return accountReply({error:'Sign in as the owner and enter your authenticator code to continue.'},403,auth.headers);const config=await testKeyConfigured(),mode=stripeMode(),live=await keyConfiguredFor('live');
 // The academy's Stripe account (issue #255): from the site's setting, or the account the first confirmed test key recorded.
 let account=null,accountSettingInvalid=false;try{const e=await expectedStripeAccount();if(e==='invalid')accountSettingInvalid=true;else account=e}catch{account=null}
 return accountReply({...config,account,accountSettingInvalid,canChangeAccount:mode==='test'&&settingStripeAccount()===null,mode,liveConfigured:live.configured,liveUpdatedAt:live.updatedAt,webhookConfigured:!!webhookSecret(mode),checkoutEnabled:checkoutKinds().size>0,checkoutKinds:[...checkoutKinds()],checkoutNames:kindList(checkoutKinds()),message:checkoutKinds().size?'Test checkout is open for '+kindList(checkoutKinds())+'.':'Online payment is off. Each purchase type opens only after its terms and refund policy are decided and whoever maintains the site turns it on.'},200,auth.headers)}

export const POST = withApi(POST_); async function POST_(request:Request){const auth=await ownerIdentity(request),reply:Reply=(b,s=200)=>accountReply(b,s,auth.headers);if(!auth.owner)return reply({error:'Sign in as the owner and enter your authenticator code to continue.'},403);if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);const raw=await request.text();if(raw.length>4096)return reply({error:'Request too large.'},413);let data;try{data=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 if(data&&typeof data==='object'&&'resetAccount' in data)return resetAccount(request,auth.owner.userId,data.resetAccount,reply);
 if(data&&typeof data==='object'&&'liveKey' in data)return saveLiveKey(request,auth.owner.userId,data.liveKey,reply);
 return saveTestKey(request,auth.owner.userId,data,reply)}

// Test key. Stripe is asked which account the key itself belongs to; nothing about the account comes from the browser.
// With the setting or a recorded account the key must belong to it. With neither, the owner first sees the key's account
// and confirms it (confirmAccount is only a yes, never an account id); the site then records that account beside the key.
async function saveTestKey(request:Request,ownerId:string,data:any,reply:Reply){
 if(!validTestKey(data?.testKey))return reply({error:'Use a restricted test key beginning rk_test_. Live keys and unrestricted secret keys are not accepted.'},400);
 if(await rateLimited(request,'stripe-setup:'+ownerId,5))return reply({error:'Too many attempts. Please wait a minute.'},429);
 try{
  const expected=await expectedStripeAccount(),recorded=await recordedStripeAccount();
  if(expected==='invalid')return reply({error:SETTING_INVALID},400);
  // Issue #308: a key Stripe won't let read the account still works; the account then comes from Stripe's refusal or the setting.
  const found=await keyAccount(stripeTestClient(data.testKey),expected?.source==='setting'?expected.id:null);
  if(found==='needs-setting')return reply({error:NEEDS_ACCOUNT_SETTING},400);
  if(expected&&found.id!==expected.id)return reply({error:expected.source==='setting'
   ?`This key belongs to a different Stripe account, ${named(found)}. The site is set to use the academy’s account ${expected.id}. Use a test key from that account.`
   :`This key belongs to a different Stripe account, ${named(found)}. The site is connected to ${named(expected)}. Use a test key from that account, or choose Connect a different Stripe account first.`},400);
  if(!expected&&data.confirmAccount!==true)return reply({configured:false,confirmAccount:true,account:found,message:`This key belongs to the Stripe account ${named(found)}. If this is the academy’s Stripe account, choose Yes, connect this account. The site then remembers it, and every later key must come from the same account.`});
  const now=new Date().toISOString();
  await env.DB!.batch([upsert('stripe-test',await sealStripeKey(data.testKey),ownerId,now),upsert('stripe-account',await sealStripeAccount(found),ownerId,now)]);
  await securityEvent(ownerId,'stripe_test_key_saved');
  if(recorded?.id!==found.id)await securityEvent(ownerId,'stripe_account_recorded',found.id);
  return reply({configured:true,mode:'test',account:{...found,source:expected?.source??'recorded'},checkoutEnabled:false,message:`Connected to ${named(found)}. Your test key is saved securely. Online payment stays off until a purchase type is opened, so nothing is charged.`});
 }catch(err){return reply({error:stripeSetupError(err,'test')},502)}
}

// Live key (issue #26). Accepted only when STRIPE_MODE is "live", only as a restricted rk_live_ key, and only for the
// academy's account: the setting, else the account the test key recorded. Stored in its own row with its own encryption label.
async function saveLiveKey(request:Request,ownerId:string,liveKey:unknown,reply:Reply){
 if(stripeMode()!=='live')return reply({error:'The site is in test mode, so only a restricted test key (starting rk_test_) can be saved here.'},400);
 if(!validKeyFor('live',liveKey))return reply({error:'Use a restricted live key beginning rk_live_. Unrestricted secret keys are not accepted.'},400);
 if(await rateLimited(request,'stripe-setup:'+ownerId,5))return reply({error:'Too many attempts. Please wait a minute.'},429);
 try{
  const expected=await expectedStripeAccount();
  if(expected==='invalid')return reply({error:SETTING_INVALID},400);
  if(!expected)return reply({error:'Save your test key first so the site knows your Stripe account.'},400);
  const account=await keyAccount(stripeClientFor('live',liveKey),expected.source==='setting'?expected.id:null);
  if(account==='needs-setting')return reply({error:NEEDS_ACCOUNT_SETTING},400);
  if(account.id!==expected.id)return reply({error:`This key belongs to a different Stripe account. Use the live key of ${named(expected)}.`},400);
  const encrypted=await sealStripeKeyFor('live',liveKey),now=new Date().toISOString();
  await upsert('stripe-live',encrypted,ownerId,now).run();
  await securityEvent(ownerId,'stripe_live_key_saved');
  return reply({configured:true,mode:'live',account:expected,checkoutEnabled:checkoutKinds().size>0,message:'Your live key is saved securely. Real cards are now charged for every purchase type that is open for online payment.'});
 }catch(err){return reply({error:stripeSetupError(err,'live')},502)}
}

// "Connect a different Stripe account" (issue #255). The page asks the owner to confirm first. Clears the saved test key
// and the recorded account, plus any saved live key, which belongs to the old account and must never charge for the new one.
// Only in test mode, and only when the site's setting does not fix the account.
async function resetAccount(request:Request,ownerId:string,confirmed:unknown,reply:Reply){
 if(confirmed!==true)return reply({error:'Invalid request.'},400);
 if(stripeMode()==='live')return reply({error:'The site is taking real payments, so its Stripe account can’t be changed here. Ask whoever maintains the site to switch back to test mode first.'},400);
 if(settingStripeAccount()!==null)return reply({error:'The academy’s Stripe account is fixed in the site’s settings, so it can’t be changed here. Ask whoever maintains the site.'},400);
 if(await rateLimited(request,'stripe-setup:'+ownerId,5))return reply({error:'Too many attempts. Please wait a minute.'},429);
 let previous='';try{previous=(await recordedStripeAccount())?.id??''}catch{previous=''}
 await env.DB!.prepare("DELETE FROM integration_secrets WHERE id IN ('stripe-test','stripe-account','stripe-live')").run();
 await securityEvent(ownerId,'stripe_account_reset',previous);
 return reply({configured:false,account:null,message:'Disconnected. The saved test key is removed and the site no longer remembers a Stripe account. Paste a restricted test key from the other account to connect it.'});
}
