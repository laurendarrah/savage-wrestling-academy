// Stripe Checkout for one-time purchases (issue #18).
// Orders are created as 'pending' here and only become 'paid' through a verified webhook (lib/stripe-webhook.ts).
import {env} from 'cloudflare:workers';
import {storedStripeKey, stripeTestClient} from './stripe-test';
import {academyToday} from './public-schedule';
import type {Charge} from './quotes';

export {ONLINE_KINDS, checkoutKinds} from './checkout-config';
export const MIN_CHARGE_CENTS = 50;
const SESSION_MINUTES = 30;

export class CheckoutError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Buyer = {id: string; email: string};
type Wrestler = {id: string; name: string};

const now = () => new Date().toISOString();

export async function startCheckout(buyer: Buyer, wrestler: Wrestler, charge: Charge, origin: string, termsUrl: string): Promise<{orderId: string; url: string}> {
  if (charge.amountCents < MIN_CHARGE_CENTS) throw new CheckoutError(400, 'This item has no amount to pay online. Contact the academy.');
  const key = await storedStripeKey();
  if (!key) throw new CheckoutError(503, 'Online payment is not set up yet.');
  const stripe = stripeTestClient(key);

  await releaseStalePending(stripe, charge.dedupeKey);

  const id = crypto.randomUUID(), at = now();
  const terms = JSON.stringify({url: termsUrl, acceptedAt: at, academyDate: academyToday()});
  try {
    await env.DB!.prepare(
      `INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'usd',?,?,'pending',?,0,?,?)`
    ).bind(id, buyer.id, buyer.email, wrestler.id, wrestler.name, charge.kind, charge.program, charge.itemId, charge.itemLabel,
      JSON.stringify(charge.dates), charge.baseCents, charge.discountCents, charge.amountCents, JSON.stringify(charge.pricing), terms, charge.dedupeKey, at, at).run();
  } catch {
    throw new CheckoutError(409, 'This is already paid or a payment for it is in progress. Check your family account.');
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: id,
      customer_email: buyer.email,
      line_items: [{quantity: 1, price_data: {currency: 'usd', unit_amount: charge.amountCents, product_data: {name: charge.itemLabel, description: `For ${wrestler.name}`}}}],
      metadata: {order_id: id, kind: charge.kind, wrestler_id: wrestler.id},
      payment_intent_data: {metadata: {order_id: id}},
      success_url: `${origin}/family?checkout=success&order=${id}`,
      cancel_url: `${origin}/family?checkout=canceled&order=${id}`,
      expires_at: Math.floor(Date.now() / 1000) + SESSION_MINUTES * 60
    }, {idempotencyKey: `order-${id}`});
  } catch {
    await env.DB!.prepare("UPDATE orders SET status='canceled',updated_at=? WHERE id=? AND status='pending'").bind(now(), id).run();
    throw new CheckoutError(502, 'Could not start secure checkout. Nothing was charged. Please try again.');
  }
  if (!session.url) throw new CheckoutError(502, 'Could not start secure checkout. Nothing was charged.');
  await env.DB!.prepare('UPDATE orders SET stripe_session_id=?,livemode=?,updated_at=? WHERE id=?').bind(session.id, session.livemode ? 1 : 0, now(), id).run();
  return {orderId: id, url: session.url};
}

// A family who abandons checkout and tries again gets a fresh session. The old session is expired at Stripe
// first. If Stripe refuses because it was already paid, the new checkout is refused instead of charging twice.
async function releaseStalePending(stripe: ReturnType<typeof stripeTestClient>, dedupeKey: string) {
  const open = await env.DB!.prepare("SELECT id,status,stripe_session_id FROM orders WHERE dedupe_key=? AND status IN ('pending','paid')")
    .bind(dedupeKey).first<{id: string; status: string; stripe_session_id: string | null}>();
  if (!open) return;
  if (open.status === 'paid') throw new CheckoutError(409, 'This is already paid. View it in your family account.');
  if (open.stripe_session_id) {
    try { await stripe.checkout.sessions.expire(open.stripe_session_id); }
    catch { throw new CheckoutError(409, 'A payment for this is already being processed. Check your family account in a minute.'); }
  }
  await env.DB!.prepare("UPDATE orders SET status='expired',updated_at=? WHERE id=? AND status='pending'").bind(now(), open.id).run();
}
