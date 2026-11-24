// Canceling a monthly membership online (decided Nov 13, 2026 on #2, issue #314). A family cancels from their own
// account, as easily as they signed up (NY GBL §527-a): one button, one short confirmation, done. The owner can do the
// same for a family from Payments. Cancelling stops every later charge; the membership stays active through the end of
// the month already paid for (the paid-through day), with no partial refund and no fee.
// - An active membership is set to cancel at the end of its paid period at Stripe (cancel_at_period_end), so Stripe
//   charges nothing more and ends it on the next billing day. A past-due one is canceled at Stripe at once, so Stripe
//   stops retrying the failed payment; its paid month has already ended.
// - The site records the last day (subscriptions.cancel_at), writes a security event, and confirms it to the family.
// - The membership's end itself, with the roster, comes only from the verified webhook (customer.subscription.deleted,
//   lib/stripe-webhook.ts). Nothing here marks anything paid or refunded.
import {env} from 'cloudflare:workers';
import {storedStripeKeyFor, stripeClientFor} from './stripe-test';
import {noticeMembershipCanceled, quietly} from './notify';
import {programName} from './program-names';

type Result = {status: number; error?: string; endsOn?: string; wrestler?: string};
type Row = {id: string; user_id: string; wrestler_name: string; livemode: number; stripe_subscription_id: string; sub_status: string; paid_through: string; cancel_at: string | null; payments_total: number | null};

// by.userId limits a family to its own memberships; the owner (by.role 'owner') may cancel any family's.
export async function cancelMembership(orderId: unknown, by: {userId: string; role: 'family' | 'owner'}): Promise<Result> {
  if (typeof orderId !== 'string' || !/^[0-9a-f-]{36}$/.test(orderId)) return {status: 400, error: 'Choose a membership.'};
  const m = await env.DB!.prepare(`SELECT o.id,o.user_id,o.wrestler_name,o.livemode,s.stripe_subscription_id,s.status AS sub_status,s.paid_through,s.cancel_at,s.payments_total
    FROM orders o JOIN subscriptions s ON s.order_id=o.id WHERE o.id=? AND o.kind='monthly' AND o.status='paid' ${by.role === 'family' ? 'AND o.user_id=?' : ''}`)
    .bind(...(by.role === 'family' ? [orderId, by.userId] : [orderId])).first<Row>();
  // Another family's membership reads exactly like one that does not exist.
  if (!m) return {status: 404, error: 'Membership not found.'};
  if (m.sub_status === 'paused') return {status: 409, error: 'This membership is paused, so nothing more is charged. There is nothing to cancel.'};
  if (!['active', 'past_due'].includes(m.sub_status)) return {status: 409, error: 'This membership has already ended.'};
  // A cancellation already asked for: cancel_at on a month-to-month membership. A membership from the earlier 12-month
  // plan carries its planned end there instead, and can still be canceled.
  if (m.payments_total === null && m.cancel_at) return {status: 409, error: `This membership is already canceled. ${m.wrestler_name} can practice through the end of the paid month.`};
  const mode = m.livemode ? 'live' : 'test';
  const key = await storedStripeKeyFor(mode);
  if (!key) return {status: 503, error: 'Canceling online isn’t available right now. Nothing changed. Please try again in a few minutes, or tell the academy and they will cancel it for you.'};
  const stripe: any = stripeClientFor(mode, key);
  const comment = by.role === 'family' ? 'Canceled by the family on the website' : 'Canceled by the academy on the website';
  try {
    if (m.sub_status === 'past_due') await stripe.subscriptions.cancel(m.stripe_subscription_id, {cancellation_details: {comment}}, {idempotencyKey: `cancel-now-${m.id}`});
    else await stripe.subscriptions.update(m.stripe_subscription_id, {cancel_at_period_end: true, cancellation_details: {comment}, metadata: {canceled_by: by.role}}, {idempotencyKey: `cancel-${m.id}`});
  } catch {
    return {status: 502, error: 'Stripe didn’t answer, so nothing changed. Please try again in a minute.'};
  }
  const at = new Date().toISOString();
  await env.DB!.batch([
    env.DB!.prepare("UPDATE subscriptions SET cancel_at=?,updated_at=? WHERE order_id=? AND status IN ('active','past_due')").bind(m.paid_through, at, m.id),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), by.userId, 'membership_canceled', `${m.id} ${by.role}`, at)
  ]);
  await quietly(() => noticeMembershipCanceled(m.id, by.role, m.paid_through));
  return {status: 200, endsOn: m.paid_through, wrestler: m.wrestler_name};
}

// ---------- The owner's Memberships page (issue #413) ----------
// Every monthly membership that is still running: active, past due (a card payment failed and Stripe is retrying),
// paused (Stripe gave up), or canceled but not ended yet (it runs to the paid-through day). Ended ones are left out; their
// orders stay on Payments. Justin decided on Nov 24 that the owner cancels from here and that there is no freeze.
export type MembershipState = 'active' | 'ending' | 'past_due' | 'paused';
export type OwnerMembership = {orderId: string; wrestler: string; parent: string; email: string; program: string | null; amountCents: number;
  startedOn: string; paidThrough: string; endsOn: string | null; state: MembershipState; canCancel: boolean; plan: 'monthly' | 'twelve-month'; livemode: boolean};
export async function ownerMemberships(): Promise<{memberships: OwnerMembership[]}> {
  const rows = (await env.DB!.prepare(`SELECT o.id,o.wrestler_name,o.email,o.program,o.amount_cents,o.livemode,s.status,s.term_start,s.paid_through,s.cancel_at,s.payments_total,
      json_extract(f.payload,'$.parentName') AS parent
    FROM subscriptions s JOIN orders o ON o.id=s.order_id LEFT JOIN family_accounts f ON f.user_id=o.user_id
    WHERE s.status IN ('active','past_due','paused') AND o.status='paid' ORDER BY o.wrestler_name COLLATE NOCASE, o.id LIMIT 2000`).all<any>()).results;
  return {memberships: rows.map(r => {
    // A month-to-month membership with cancel_at set has been canceled and runs to that day. On the earlier 12-month plan
    // cancel_at holds its planned end, so it is still active and can be canceled.
    // A canceled one reads as canceled even while its last payment is still failing, since cancelMembership refuses it again.
    const twelve = r.payments_total !== null, ending = !twelve && !!r.cancel_at && (r.status === 'active' || r.status === 'past_due');
    const state: MembershipState = r.status === 'paused' ? 'paused' : ending ? 'ending' : r.status === 'past_due' ? 'past_due' : 'active';
    return {orderId: r.id, wrestler: r.wrestler_name, parent: r.parent || '', email: r.email, program: r.program ? programName(r.program) : null, amountCents: r.amount_cents,
      startedOn: r.term_start, paidThrough: r.paid_through, endsOn: r.cancel_at ?? null, state, canCancel: state === 'active' || state === 'past_due',
      plan: twelve ? 'twelve-month' : 'monthly', livemode: r.livemode === 1};
  })};
}
