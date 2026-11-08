import {env} from 'cloudflare:workers';
import {strongAccount,accountReply,sameOrigin} from '../../../lib/account-auth';
import {quoteMembership} from '../../../lib/quotes';
import {checkoutKinds} from '../../../lib/checkout-config';
import {registrationCatalog} from '../../../lib/registration-catalog';
import {withApi} from '../../../lib/api';
export const dynamic='force-dynamic';
export const GET = withApi(GET_); async function GET_(request:Request){
 const auth=await strongAccount(request);
 if(!auth.user?.email_confirmed_at)return accountReply({error:'Sign-in required.'},401,auth.headers);
 if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return accountReply({error:'Authenticator verification required.'},403,auth.headers);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const month=new URL(request.url).searchParams.get('month')||today.slice(0,7);
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<2020||Number(month.slice(0,4))>2100)return accountReply({error:'Choose a valid month.'},400,auth.headers);
 const row=await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload:string}>();
 return accountReply(registrationCatalog(row?JSON.parse(row.payload):{},month,today),200,auth.headers);
}

// Registration review is authorized on the server. A browser flag cannot grant approval.
// Pricing and eligibility live in lib/quotes.ts so the review and Stripe checkout always agree.
export const POST = withApi(POST_); async function POST_(request:Request){
 const auth=await strongAccount(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(!auth.user?.email_confirmed_at)return reply({error:'Sign-in required.'},401);
 if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return reply({error:'Authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>2048)return reply({error:'Request too large.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 const kinds=checkoutKinds(),quote=await quoteMembership(auth.user.id,input,{checkoutKinds:kinds});
 if(!quote.ok)return reply({error:quote.error,...(quote.extra??{})},quote.status);
 // A walk-in with a price can always be booked to pay cash at the academy (issue #248), even while online checkout is closed.
 return reply({review:quote.review,paymentsEnabled:!!quote.charge&&kinds.has(quote.charge.kind),cashEnabled:quote.charge?.kind==='walkin'});
}
