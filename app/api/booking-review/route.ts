// Event, Friday Night Live and private lesson review. Pricing lives in lib/quotes.ts so the review and
// Stripe checkout always agree. Lessons remain inquiries with no online payment.
import {strongAccount,sameOrigin,accountReply} from '../../../lib/account-auth';
import {quoteBooking} from '../../../lib/quotes';
import {checkoutKinds} from '../../../lib/checkout-config';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const auth=await strongAccount(request),reply=(b:unknown,s=200)=>accountReply(b,s,auth.headers);
 if(!auth.user?.email_confirmed_at)return reply({error:'Sign-in required.'},401);
 if(auth.user.factors?.some(f=>f.status==='verified')&&!auth.strong)return reply({error:'Authenticator verification required.'},403);
 if(!sameOrigin(request))return reply({error:'Invalid request origin.'},403);
 if(!request.headers.get('content-type')?.includes('application/json'))return reply({error:'JSON required.'},415);
 const raw=await request.text();if(raw.length>2048)return reply({error:'Request too large.'},413);let input;try{input=JSON.parse(raw)}catch{return reply({error:'Invalid request.'},400)}
 const kinds=checkoutKinds(),quote=await quoteBooking(auth.user.id,input,{checkoutKinds:kinds});
 if(!quote.ok)return reply({error:quote.error,...(quote.extra??{})},quote.status);
 return reply({review:quote.review,paymentsEnabled:!!quote.charge&&kinds.has(quote.charge.kind)});
}
