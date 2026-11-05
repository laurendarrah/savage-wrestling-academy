// Verified Stripe webhooks (issue #19). This is the only code path that marks an order paid or refunded.
// Each Stripe event id is stored once, so repeated, late or out-of-order deliveries cannot apply twice.
import {env} from 'cloudflare:workers';
import {academyToday} from './public-schedule';

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

type OrderRow = {id: string; status: string; kind: string; amount_cents: number; currency: string; livemode: number; stripe_session_id: string | null; dedupe_key: string};

// A 12-month term runs through the day before the same calendar date a year later.
// A February 29 start ends on February 28, because March 1 of the next year is "the same date" rolled over.
export function membershipTerm(start: string) {
  const [y, m, d] = start.split('-').map(Number);
  const end = new Date(Date.UTC(y + 1, m - 1, d) - 86400000).toISOString().slice(0, 10);
  return {start, end};
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
  return {outcome, orderId, duplicate: false};
}

async function plan(event: any, at: string): Promise<{outcome: string; orderId: string | null; writes: D1PreparedStatement[]}> {
  const obj = event.data?.object ?? {};
  const none = (outcome: string, orderId: string | null = null) => ({outcome, orderId, writes: []});

  if (event.type.startsWith('checkout.session.')) {
    const orderId = typeof obj.client_reference_id === 'string' ? obj.client_reference_id : typeof obj.metadata?.order_id === 'string' ? obj.metadata.order_id : null;
    if (!orderId) return none('ignored:no-order');
    const order = await env.DB!.prepare('SELECT id,status,kind,amount_cents,currency,livemode,stripe_session_id,dedupe_key FROM orders WHERE id=?').bind(orderId).first<OrderRow>();
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
      const term = order.kind === 'annual' ? membershipTerm(paidDate) : null;
      return {outcome: 'paid', orderId, writes: [
        // If the family started a newer checkout for the same item, that newer one is canceled so the paid order wins.
        env.DB!.prepare("UPDATE orders SET status='canceled',updated_at=? WHERE dedupe_key=? AND status='pending' AND id<>?").bind(at, order.dedupe_key, orderId),
        env.DB!.prepare("UPDATE orders SET status='paid',paid_at=?,updated_at=?,stripe_session_id=?,stripe_payment_intent=?,term_start=?,term_end=? WHERE id=? AND status IN ('pending','expired','canceled')")
          .bind(at, at, obj.id, typeof obj.payment_intent === 'string' ? obj.payment_intent : null, term?.start ?? null, term?.end ?? null, orderId)
      ]};
    }
    if (event.type === 'checkout.session.completed') return none('awaiting-payment', orderId);
    if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed')
      return {outcome: event.type === 'checkout.session.expired' ? 'expired' : 'payment-failed', orderId, writes: [
        env.DB!.prepare("UPDATE orders SET status='expired',updated_at=? WHERE id=? AND status='pending'").bind(at, orderId)
      ]};
    return none('ignored:' + event.type, orderId);
  }

  if (event.type === 'charge.refunded') {
    const intent = typeof obj.payment_intent === 'string' ? obj.payment_intent : null;
    if (!intent) return none('ignored:no-payment-intent');
    const order = await env.DB!.prepare("SELECT id,status,amount_cents FROM orders WHERE stripe_payment_intent=?").bind(intent).first<{id: string; status: string; amount_cents: number}>();
    if (!order) return none('ignored:unknown-payment');
    if (!obj.refunded || obj.amount_refunded !== order.amount_cents) return none('partial-refund', order.id);
    return {outcome: 'refunded', orderId: order.id, writes: [
      env.DB!.prepare("UPDATE orders SET status='refunded',updated_at=? WHERE id=? AND status='paid'").bind(at, order.id)
    ]};
  }
  return none('ignored:' + event.type);
}
