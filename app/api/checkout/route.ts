// Start Stripe Checkout for a reviewed purchase (issue #18). The amount comes from lib/quotes.ts, never the browser.
import {strongAccount, accountReply, sameOrigin} from '../../../lib/account-auth';
import {quoteMembership, quoteBooking} from '../../../lib/quotes';
import {checkoutKinds, startCheckout, CheckoutError} from '../../../lib/checkout';
import {rateLimited} from '../../../lib/rate-limit';
import {cashBookingDue} from '../../../lib/cash-bookings';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await strongAccount(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.user?.email_confirmed_at || !auth.user.email) return reply({error: 'Sign-in required.'}, 401);
  if (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong) return reply({error: 'Authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  if (Number(request.headers.get('content-length') ?? 0) > 2048) return reply({error: 'Request too large.'}, 413);
  const raw = await request.text();
  if (raw.length > 2048) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (!input || !['membership', 'booking'].includes(input.source)) return reply({error: 'Choose what to pay for.'}, 400);
  if (input.acceptTerms !== true) return reply({error: 'Please read and accept the terms before paying.'}, 400);
  if (await rateLimited(request, 'checkout:' + auth.user.id, 10)) return reply({error: 'Too many attempts. Please wait a minute.'}, 429);

  const kinds = checkoutKinds();
  const quote = input.source === 'membership' ? await quoteMembership(auth.user.id, input, {checkoutKinds: kinds}) : await quoteBooking(auth.user.id, input, {checkoutKinds: kinds});
  if (!quote.ok) return reply({error: quote.error, ...(quote.extra ?? {})}, quote.status);
  if (!quote.charge) return reply({error: 'This item cannot be paid online. Contact the academy.'}, 400);
  if (!kinds.has(quote.charge.kind)) return reply({error: 'Online payment for this is not open yet.'}, 403);
  // Booked to pay cash at the academy (issue #248): one or the other, never both.
  if (await cashBookingDue(quote.charge.dedupeKey))
    return reply({error: 'This is already booked to pay cash at the academy. To pay online instead, cancel that booking in your family account first.'}, 409);

  try {
    const termsUrl = quote.charge.kind === 'monthly' ? '/membership-terms' : '/membership-terms#camps';
    const {orderId, url} = await startCheckout({id: auth.user.id, email: auth.user.email}, quote.wrestler, quote.charge, new URL(request.url).origin, termsUrl);
    return reply({orderId, url, amountCents: quote.charge.amountCents});
  } catch (e) {
    if (e instanceof CheckoutError) return reply({error: e.message}, e.status);
    return reply({error: 'Could not start secure checkout. Nothing was charged.'}, 500);
  }
}
