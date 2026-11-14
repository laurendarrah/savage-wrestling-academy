// Stripe Checkout for one-time purchases (issue #18).
// Orders are created as 'pending' here and only become 'paid' through a verified webhook (lib/stripe-webhook.ts).
import {env} from 'cloudflare:workers';
import {stripeReason} from './stripe-key-check';
import {storedStripeKeyFor, stripeClientFor, stripeMode} from './stripe-test';
import {academyToday} from './public-schedule';
import type {Charge} from './quotes';
import {withinCapacity} from './capacity';

export {ONLINE_KINDS, checkoutKinds} from './checkout-config';
export const MIN_CHARGE_CENTS = 50;
const SESSION_MINUTES = 30;
// Stripe refuses a Checkout Session that expires less than 30 minutes after Stripe itself creates it. Asking for exactly
// 30 minutes arrives a moment short and every checkout fails (found on the live site, Nov 13). stripe-mock doesn't
// enforce it, so keep this margin.
export const SESSION_MARGIN_SECONDS = 120;
export const sessionExpiry = (nowMs: number) => Math.floor(nowMs / 1000) + SESSION_MINUTES * 60 + SESSION_MARGIN_SECONDS;

export class CheckoutError extends Error {
  // `reason` is for the owner's Site health page only (issue #315); the family sees `message`.
  constructor(public status: number, message: string, public reason = '') { super(message); }
}

type Buyer = {id: string; email: string};
type Wrestler = {id: string; name: string};

const now = () => new Date().toISOString();

export async function startCheckout(buyer: Buyer, wrestler: Wrestler, charge: Charge, origin: string, termsUrl: string): Promise<{orderId: string; url: string}> {
  if (charge.amountCents < MIN_CHARGE_CENTS) throw new CheckoutError(400, 'This item has no amount to pay online. Contact the academy.');
  const mode = stripeMode();
  const key = await storedStripeKeyFor(mode);
  if (!key) throw new CheckoutError(503, 'Online payment is not set up yet.');
  const stripe = stripeClientFor(mode, key);

  await releaseStalePending(stripe, charge.dedupeKey);

  const id = crypto.randomUUID(), at = now();
  const terms = JSON.stringify({url: termsUrl, acceptedAt: at, academyDate: academyToday()});
  try {
    await env.DB!.prepare(
      `INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'usd',?,?,'pending',?,?,?,?)`
    ).bind(id, buyer.id, buyer.email, wrestler.id, wrestler.name, charge.kind, charge.program, charge.itemId, charge.itemLabel,
      JSON.stringify(charge.dates), charge.baseCents, charge.discountCents, charge.amountCents, JSON.stringify(charge.pricing), terms, charge.dedupeKey, mode === 'live' ? 1 : 0, at, at).run();
  } catch {
    throw new CheckoutError(409, 'This is already paid or a payment for it is in progress. Check your family account.');
  }
  // Two families racing for the last seat: the earlier order keeps it, the later one is released before Stripe.
  const slots = charge.kind === 'event' || charge.kind === 'lesson' ? charge.pricing.slots : null;
  if (typeof slots === 'number' && slots > 0 && !(await withinCapacity(id, charge.itemId, charge.dates, slots, charge.kind as 'event' | 'lesson'))) {
    await env.DB!.prepare("UPDATE orders SET status='canceled',updated_at=? WHERE id=? AND status='pending'").bind(now(), id).run();
    throw new CheckoutError(409, charge.kind === 'lesson' ? 'This lesson just filled up. Nothing was charged. Choose another time.' : 'This event just filled up. Nothing was charged.');
  }

  let session;
  try {
    const common = {
      client_reference_id: id,
      customer_email: buyer.email,
      metadata: {order_id: id, kind: charge.kind, wrestler_id: wrestler.id},
      success_url: `${origin}/family?checkout=success&order=${id}`,
      cancel_url: `${origin}/family?checkout=canceled&order=${id}`,
      expires_at: sessionExpiry(Date.now())
    };
    const product = {name: charge.itemLabel, description: `For ${wrestler.name}`};
    session = await stripe.checkout.sessions.create(charge.kind === 'monthly'
      // Month to month (decided Nov 13, 2026 on #2): Stripe charges the same amount every month, on the same day, until
      // the membership is canceled. The price is fixed at checkout, so a later price change never reaches it.
      ? {...common, mode: 'subscription', line_items: [{quantity: 1, price_data: {currency: 'usd', unit_amount: charge.amountCents, recurring: {interval: 'month'}, product_data: product}}],
         subscription_data: {metadata: {order_id: id}, description: `${charge.itemLabel}, renews every month until canceled`}}
      : {...common, mode: 'payment', line_items: [{quantity: 1, price_data: {currency: 'usd', unit_amount: charge.amountCents, product_data: product}}],
         payment_intent_data: {metadata: {order_id: id}}},
      {idempotencyKey: `order-${id}`});
  } catch (err) {
    await env.DB!.prepare("UPDATE orders SET status='canceled',updated_at=? WHERE id=? AND status='pending'").bind(now(), id).run();
    throw new CheckoutError(502, 'Could not start secure checkout. Nothing was charged. Please try again.', stripeReason(err));
  }
  if (!session.url) throw new CheckoutError(502, 'Could not start secure checkout. Nothing was charged.');
  await env.DB!.prepare('UPDATE orders SET stripe_session_id=?,livemode=?,updated_at=? WHERE id=?').bind(session.id, session.livemode ? 1 : 0, now(), id).run();
  return {orderId: id, url: session.url};
}

// A family who abandons checkout and tries again gets a fresh session. The old session is expired at Stripe
// first. If Stripe refuses because it was already paid, the new checkout is refused instead of charging twice.
async function releaseStalePending(stripe: ReturnType<typeof stripeClientFor>, dedupeKey: string) {
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
