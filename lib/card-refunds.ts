// Card refunds as the books and the payments list read them (issue #42). Kept free of the Stripe SDK.
//
// The webhook stores one payment_refunds row per charge.refunded event with Stripe's running total (amount_refunded)
// for that card payment, never an increment. Read in Stripe's event order, the change from a payment's previous row is
// one refund, dated when Stripe sent the event. A repeated event is stored once (stripe_events), and an event that
// arrives late is still read in its place, so every delivery order gives the same refunds.

export type RefundRow = {id: string; order_id: string; payment_intent: string; amount_cents: number; refunded_cents: number; refunded_at: string};
export type RefundStep = RefundRow & {changeCents: number; previousCents: number};

const byStripeOrder = (a: RefundRow, b: RefundRow) => a.payment_intent.localeCompare(b.payment_intent) || a.refunded_at.localeCompare(b.refunded_at)
  || a.refunded_cents - b.refunded_cents || a.id.localeCompare(b.id);

// Each refund: the change in a payment's running total since its previous event. A change of zero (a repeated total)
// is not a refund. A drop would mean Stripe reversed a refund that failed; it comes back as a negative change.
export function refundSteps(rows: RefundRow[]): RefundStep[] {
  const steps: RefundStep[] = [];
  let intent = '', previous = 0;
  for (const r of [...rows].sort(byStripeOrder)) {
    if (r.payment_intent !== intent) { intent = r.payment_intent; previous = 0; }
    const change = r.refunded_cents - previous;
    if (change !== 0) steps.push({...r, changeCents: change, previousCents: previous});
    previous = r.refunded_cents;
  }
  return steps;
}

// Refunded so far for each order (summed over its card payments, so a monthly membership counts every month), and the
// date of the latest refund.
export function refundedByOrder(rows: RefundRow[]): Map<string, {cents: number; at: string}> {
  const latest = new Map<string, RefundRow>();
  for (const r of [...rows].sort(byStripeOrder)) latest.set(r.payment_intent, r);
  const lastChange = new Map<string, string>();
  for (const s of refundSteps(rows)) if ((lastChange.get(s.order_id) ?? '') < s.refunded_at) lastChange.set(s.order_id, s.refunded_at);
  const out = new Map<string, {cents: number; at: string}>();
  for (const r of latest.values()) {
    const o = out.get(r.order_id) ?? {cents: 0, at: lastChange.get(r.order_id) ?? r.refunded_at};
    o.cents += r.refunded_cents;
    out.set(r.order_id, o);
  }
  return out;
}
