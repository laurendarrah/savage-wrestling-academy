// Verified Stripe webhooks (issue #19). This is the only code path that marks an order paid or refunded, and the only one
// that records refund amounts (issue #42).
// Each Stripe event id is stored once, so repeated, late or out-of-order deliveries cannot apply twice.
import {env} from 'cloudflare:workers';
import {academyToday} from './public-schedule';
import {noticeLessonBooked, quietly} from './notify';
import {membershipTerm, paidThroughAfter} from './membership-term';
export {membershipTerm, paidThroughAfter};
import {storedStripeKeyFor, stripeClientFor} from './stripe-test';

const encoder = new TextEncoder();
export const SIGNATURE_TOLERANCE_SECONDS = 300;

function hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function sameString(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Stripe's scheme: header "t=<unix>,v1=<hex hmac>[,v1=...]", HMAC-SHA256 over "<t>.<raw body>" with the endpoint secret.
export async function verifyStripeSignature(raw: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const parts = header.split(',').map(p => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!t || !/^\d{1,12}$/.test(t) || !signatures.length) return false;
  if (Math.abs(nowSeconds - Number(t)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${t}.${raw}`)));
  return signatures.some(s => sameString(s, expected));
}

type OrderRow = {id: string; user_id: string; wrestler_id: string; status: string; kind: string; amount_cents: number; currency: string; livemode: number; stripe_session_id: string | null; dedupe_key: string; item_id: string; dates: string; pricing: string};


const PAYMENTS = 12;

// Set the subscription to end exactly 12 months after its billing anchor, so Stripe never sends a 13th invoice.
async function setTwelvePaymentEnd(livemode: number, subscriptionId: string) {
  const mode = livemode ? 'live' : 'test';
  const key = await storedStripeKeyFor(mode);
  if (!key) throw new Error('Stripe key missing; let Stripe retry this event.');
  const stripe = stripeClientFor(mode, key);
  const sub: any = await stripe.subscriptions.retrieve(subscriptionId);
  const anchor = new Date((sub.billing_cycle_anchor ?? sub.start_date) * 1000);
  const cancel = new Date(anchor);
  cancel.setUTCFullYear(anchor.getUTCFullYear() + 1);
  const cancelAt = Math.floor(cancel.getTime() / 1000);
  await stripe.subscriptions.update(subscriptionId, {cancel_at: cancelAt, proration_behavior: 'none', metadata: {...(sub.metadata ?? {}), payments: String(PAYMENTS)}});
  return new Date(cancelAt * 1000).toISOString();
}

async function overLimit(order: OrderRow): Promise<string | null> {
  const slots = Number(JSON.parse(order.pricing || '{}').slots);
  if (!Number.isInteger(slots) || slots <= 0) return null;
  for (const d of JSON.parse(order.dates) as string[]) {
    const row = await env.DB!.prepare("SELECT count(*) n FROM orders WHERE kind=? AND item_id=? AND status='paid' AND id<>? AND EXISTS (SELECT 1 FROM json_each(orders.dates) WHERE value=?)")
      .bind(order.kind, order.item_id, order.id, d).first<{n: number}>();
    if ((row?.n ?? 0) >= slots) return `${d}: ${(row?.n ?? 0) + 1} paid for ${slots} seats`;
  }
  return null;
}

type RefundOrder = {id: string; status: string; kind: string; amount_cents: number; livemode: number};
const REFUND_ORDER = 'o.id,o.status,o.kind,o.amount_cents,o.livemode';

// A refund of one monthly payment (issue #42). Its charge names only its PaymentIntent, which orders don't hold for
// monthly memberships. Use the payment's recorded fee row if there is one; otherwise ask Stripe which invoice that
// payment paid (Invoices read permission), and so which subscription. Only when there is a monthly membership in that
// mode; a Stripe error is thrown so Stripe sends the event again.
async function monthlyPaymentOrder(intent: string, live: boolean): Promise<RefundOrder | null> {
  const known = await env.DB!.prepare(`SELECT ${REFUND_ORDER} FROM stripe_fees f JOIN orders o ON o.id=f.order_id WHERE f.payment_intent=?`).bind(intent).first<RefundOrder>();
  if (known) return known;
  const any = await env.DB!.prepare("SELECT 1 AS x FROM subscriptions s JOIN orders o ON o.id=s.order_id WHERE o.livemode=? LIMIT 1").bind(live ? 1 : 0).first();
  if (!any) return null;
  const mode = live ? 'live' : 'test';
  const key = await storedStripeKeyFor(mode);
  if (!key) throw new Error('Stripe key missing; let Stripe retry this event.');
  const stripe: any = stripeClientFor(mode, key);
  const found = await stripe.invoicePayments.list({payment: {type: 'payment_intent', payment_intent: intent}, expand: ['data.invoice'], limit: 3});
  for (const p of found?.data ?? []) {
    const sub = p?.invoice?.parent?.subscription_details?.subscription, id = typeof sub === 'string' ? sub : sub?.id;
    if (typeof id !== 'string') continue;
    const order = await env.DB!.prepare(`SELECT ${REFUND_ORDER} FROM subscriptions s JOIN orders o ON o.id=s.order_id WHERE s.stripe_subscription_id=?`).bind(id).first<RefundOrder>();
    if (order) return order;
  }
  return null;
}

export type Outcome = {outcome: string; orderId: string | null};

export async function applyStripeEvent(event: any): Promise<Outcome & {duplicate: boolean}> {
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return {outcome: 'rejected:malformed', orderId: null, duplicate: false};
  const seen = await env.DB!.prepare('SELECT outcome,order_id FROM stripe_events WHERE id=?').bind(event.id).first<{outcome: string; order_id: string | null}>();
  if (seen) return {outcome: seen.outcome, orderId: seen.order_id, duplicate: true};

  const at = new Date().toISOString();
  const {outcome, orderId, writes} = await plan(event, at);
  const record = env.DB!.prepare('INSERT INTO stripe_events(id,type,order_id,outcome,received_at) VALUES (?,?,?,?,?)').bind(event.id, event.type, orderId, outcome, at);
  try {
    await env.DB!.batch([record, ...writes]);
  } catch (e) {
    // A concurrent delivery of the same event wins the primary key; treat this one as a duplicate.
    const again = await env.DB!.prepare('SELECT outcome,order_id FROM stripe_events WHERE id=?').bind(event.id).first<{outcome: string; order_id: string | null}>();
    if (again) return {outcome: again.outcome, orderId: again.order_id, duplicate: true};
    throw e;
  }
  if (outcome.startsWith('rejected:'))
    await env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)')
      .bind(crypto.randomUUID(), 'stripe', 'stripe_event_rejected', `${event.id} ${outcome}`, at).run();
  // A paid lesson tells the coach and the family (issue #105); other notices are not needed for online payments.
  if (outcome.startsWith('paid') && orderId) await quietly(() => noticeLessonBooked(orderId));
  return {outcome, orderId, duplicate: false};
}

async function plan(event: any, at: string): Promise<{outcome: string; orderId: string | null; writes: D1PreparedStatement[]}> {
  const obj = event.data?.object ?? {};
  const none = (outcome: string, orderId: string | null = null) => ({outcome, orderId, writes: []});

  if (event.type.startsWith('checkout.session.')) {
    const orderId = typeof obj.client_reference_id === 'string' ? obj.client_reference_id : typeof obj.metadata?.order_id === 'string' ? obj.metadata.order_id : null;
    if (!orderId) return none('ignored:no-order');
    const order = await env.DB!.prepare('SELECT id,user_id,wrestler_id,status,kind,amount_cents,currency,livemode,stripe_session_id,dedupe_key,item_id,dates,pricing FROM orders WHERE id=?').bind(orderId).first<OrderRow>();
    if (!order) return none('rejected:unknown-order', orderId);
    if (order.stripe_session_id && order.stripe_session_id !== obj.id) return none('rejected:session-mismatch', orderId);
    if (Boolean(obj.livemode) !== Boolean(order.livemode)) return none('rejected:mode-mismatch', orderId);

    const paid = (event.type === 'checkout.session.completed' && obj.payment_status === 'paid') || event.type === 'checkout.session.async_payment_succeeded';
    if (paid) {
      if (obj.amount_total !== order.amount_cents || String(obj.currency).toLowerCase() !== order.currency) return none('rejected:amount-mismatch', orderId);
      if (order.status === 'paid' || order.status === 'refunded') return none('ignored:already-' + order.status, orderId);
      // Two completed payments for the same item: keep the first, and flag this one for a manual refund.
      const other = await env.DB!.prepare("SELECT id FROM orders WHERE dedupe_key=? AND status='paid' AND id<>?").bind(order.dedupe_key, orderId).first<{id: string}>();
      if (other) return none('rejected:duplicate-payment-refund-needed', orderId);
      const paidDate = academyToday();
      if (order.kind === 'monthly') {
        const subscriptionId = typeof obj.subscription === 'string' ? obj.subscription : typeof obj.subscription?.id === 'string' ? obj.subscription.id : null;
        if (!subscriptionId) return none('rejected:no-subscription', orderId);
        const cancelAt = await setTwelvePaymentEnd(order.livemode, subscriptionId);
        const full = membershipTerm(paidDate), paidThrough = paidThroughAfter(paidDate, 1);
        return {outcome: 'paid', orderId, writes: [
          env.DB!.prepare("UPDATE orders SET status='canceled',updated_at=? WHERE dedupe_key=? AND status='pending' AND id<>?").bind(at, order.dedupe_key, orderId),
          env.DB!.prepare("UPDATE orders SET status='paid',paid_at=?,updated_at=?,stripe_session_id=?,term_start=?,term_end=? WHERE id=? AND status IN ('pending','expired','canceled')")
            .bind(at, at, obj.id, full.start, paidThrough, orderId),
          // The first of 12 payments is counted here; the matching subscription_create invoice is ignored.
          env.DB!.prepare("INSERT INTO subscriptions(order_id,stripe_subscription_id,status,payments_made,payments_total,term_start,term_end,paid_through,cancel_at,updated_at) VALUES (?,?,'active',1,?,?,?,?,?,?)")
            .bind(orderId, subscriptionId, PAYMENTS, full.start, full.end, paidThrough, cancelAt, at)
        ]};
      }
      // Upfront memberships are no longer sold (#210), but a checkout started before then whose event arrives late
      // still records its 12-month term.
      const term = order.kind === 'annual' ? membershipTerm(paidDate) : null;
      // A payment that completes after its seat hold lapsed can push an event over its limit. The payment stands
      // (money was taken), and the owner is warned so they can add a seat or refund.
      // A lesson paid this way is double-booked; the owner refunds one or moves it to another opening.
      const overCapacity = order.kind === 'event' || order.kind === 'lesson' ? await overLimit(order) : null;
      const warn = overCapacity ? [env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)')
        .bind(crypto.randomUUID(), 'stripe', order.kind === 'lesson' ? 'lesson_double_booked' : 'event_over_capacity', `${orderId} ${overCapacity}`, at)] : [];
      return {outcome: overCapacity ? 'paid-over-capacity' : 'paid', orderId, writes: [...warn,
        // If the family started a newer checkout for the same item, that newer one is canceled so the paid order wins.
        env.DB!.prepare("UPDATE orders SET status='canceled',updated_at=? WHERE dedupe_key=? AND status='pending' AND id<>?").bind(at, order.dedupe_key, orderId),
        env.DB!.prepare("UPDATE orders SET status='paid',paid_at=?,updated_at=?,stripe_session_id=?,stripe_payment_intent=?,term_start=?,term_end=? WHERE id=? AND status IN ('pending','expired','canceled')")
          .bind(at, at, obj.id, typeof obj.payment_intent === 'string' ? obj.payment_intent : null, term?.start ?? null, term?.end ?? null, orderId)
      ]};
    }
    if (event.type === 'checkout.session.completed') return none('awaiting-payment', orderId);
    if ((event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') && order.status !== 'pending')
      return none('ignored:already-' + order.status, orderId);
    if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed')
      return {outcome: event.type === 'checkout.session.expired' ? 'expired' : 'payment-failed', orderId, writes: [
        env.DB!.prepare("UPDATE orders SET status='expired',updated_at=? WHERE id=? AND status='pending'").bind(at, orderId)
      ]};
    return none('ignored:' + event.type, orderId);
  }

  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const subscriptionId = typeof obj.subscription === 'string' ? obj.subscription : obj.parent?.subscription_details?.subscription ?? null;
    if (typeof subscriptionId !== 'string') return none('ignored:no-subscription');
    if (obj.billing_reason === 'subscription_create') return none('ignored:first-payment-counted-at-checkout');
    const sub = await env.DB!.prepare('SELECT s.order_id,s.status,s.payments_made,s.payments_total,s.term_start,s.term_end,o.amount_cents FROM subscriptions s JOIN orders o ON o.id=s.order_id WHERE s.stripe_subscription_id=?')
      .bind(subscriptionId).first<{order_id: string; status: string; payments_made: number; payments_total: number; term_start: string; term_end: string; amount_cents: number}>();
    // A later invoice for a subscription we have not recorded yet: let Stripe retry once checkout completion arrives.
    if (!sub) throw new Error('Unknown subscription; retry later.');
    if (event.type === 'invoice.payment_failed')
      return {outcome: 'installment-failed', orderId: sub.order_id, writes: [
        env.DB!.prepare("UPDATE subscriptions SET status='past_due',updated_at=? WHERE order_id=? AND status IN ('active','past_due')").bind(at, sub.order_id)
      ]};
    if (obj.amount_paid !== sub.amount_cents) return none('rejected:amount-mismatch', sub.order_id);
    if (sub.payments_made >= sub.payments_total) return none('rejected:payment-beyond-term-refund-needed', sub.order_id);
    const made = sub.payments_made + 1;
    const paidThrough = made >= sub.payments_total ? sub.term_end : paidThroughAfter(sub.term_start, made);
    return {outcome: `installment-${made}-of-${sub.payments_total}`, orderId: sub.order_id, writes: [
      env.DB!.prepare("UPDATE subscriptions SET payments_made=?,paid_through=?,status='active',updated_at=? WHERE order_id=? AND payments_made=?").bind(made, paidThrough, at, sub.order_id, sub.payments_made),
      env.DB!.prepare('UPDATE orders SET term_end=?,updated_at=? WHERE id=?').bind(paidThrough, at, sub.order_id)
    ]};
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = await env.DB!.prepare('SELECT order_id,payments_made,payments_total FROM subscriptions WHERE stripe_subscription_id=?').bind(obj.id).first<{order_id: string; payments_made: number; payments_total: number}>();
    if (!sub) return none('ignored:unknown-subscription');
    const ended = sub.payments_made >= sub.payments_total ? 'completed' : 'canceled';
    return {outcome: 'subscription-' + ended, orderId: sub.order_id, writes: [
      env.DB!.prepare('UPDATE subscriptions SET status=?,updated_at=? WHERE order_id=?').bind(ended, at, sub.order_id)
    ]};
  }

  // Refunds (issue #42). amount_refunded is Stripe's running total for the payment, so it is stored as it is, never added
  // up, with the event's own time: a replay is stored once (stripe_events), and a late or out-of-order event still lands
  // in its place, so the books come out the same in any delivery order (lib/card-refunds.ts). A full refund of a
  // one-time payment marks the order refunded, as before; a partial one leaves it paid. Refunding one monthly payment
  // records the refund but does not end the membership.
  if (event.type === 'charge.refunded') {
    const intent = typeof obj.payment_intent === 'string' ? obj.payment_intent : typeof obj.payment_intent?.id === 'string' ? obj.payment_intent.id : null;
    if (!intent) return none('ignored:no-payment-intent');
    const live = Boolean(event.livemode ?? obj.livemode);
    const order = await env.DB!.prepare(`SELECT ${REFUND_ORDER} FROM orders o WHERE o.stripe_payment_intent=? AND o.source='stripe'`).bind(intent).first<RefundOrder>()
      ?? await monthlyPaymentOrder(intent, live);
    if (!order) return none('ignored:unknown-payment');
    if (live !== Boolean(order.livemode)) return none('rejected:mode-mismatch', order.id);
    const total = obj.amount_refunded;
    if (!Number.isSafeInteger(total) || total < 0 || total > order.amount_cents) return none('rejected:refund-amount', order.id);
    const refundedAt = Number.isSafeInteger(event.created) && event.created > 0 ? new Date(event.created * 1000).toISOString() : at;
    const history = env.DB!.prepare('INSERT INTO payment_refunds(id,order_id,payment_intent,charge_id,amount_cents,refunded_cents,refunded_at,livemode,received_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(event.id, order.id, intent, typeof obj.id === 'string' ? obj.id : null, order.amount_cents, total, refundedAt, order.livemode, at);
    const full = obj.refunded === true && total === order.amount_cents;
    if (order.kind === 'monthly') return {outcome: full ? 'installment-refunded' : 'installment-partial-refund', orderId: order.id, writes: [history]};
    if (!full) return {outcome: 'partial-refund', orderId: order.id, writes: [history]};
    return {outcome: 'refunded', orderId: order.id, writes: [history,
      env.DB!.prepare("UPDATE orders SET status='refunded',updated_at=? WHERE id=? AND status='paid'").bind(at, order.id)
    ]};
  }
  return none('ignored:' + event.type);
}
