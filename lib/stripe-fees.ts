// Stripe card processing fees (issue #42): the fee and net for every successful card payment, read from its charge's
// balance transaction and stored in stripe_fees.
//
// Fees are fetched here, after the fact, and never in the webhook. Marking an order paid stays one fast database write
// that depends only on the signed event, so a slow or failing fee lookup (Stripe down, a key without the Balance read
// permission, a balance transaction not settled yet) can never delay or block a payment, a roster or a family's page.
// The daily scheduled job runs this, and the owner can run it from /financials. Each run makes at most FEE_CALL_BUDGET
// Stripe calls, oldest payments first; a payment whose fee could not be read is tried again on the next run.
//
// Test and live stay apart: a run only reads payments made in the site's current Stripe mode, with that mode's key, and
// refuses a Stripe answer from the other mode.
import {env} from 'cloudflare:workers';
import {storedStripeKeyFor, stripeClientFor} from './stripe-test';
import {stripeMode} from './checkout-config';

export const FEE_CALL_BUDGET = 40;
export const KEY_PERMISSION_HELP = 'Stripe would not share card fees with the saved restricted key. In Stripe, give the key Balance (read) permission, as listed on Payment setup.';

export type FeeRun = {mode: 'test' | 'live'; checked: number; recorded: number; failed: number; waiting: number; error: string | null; skipped: 'no-key' | null};
type Fee = {chargeId: string; balanceTransaction: string; amountCents: number; feeCents: number; netCents: number; chargedAt: string};

const int = (v: unknown): v is number => Number.isSafeInteger(v);
const idOf = (v: any): string | null => typeof v === 'string' ? v : typeof v?.id === 'string' ? v.id : null;

// One-time card payments in this mode without a fee yet. Refunded ones too: Stripe keeps its fee on a refund.
const SINGLE_WAITING = `FROM orders o WHERE o.source='stripe' AND o.livemode=? AND o.kind<>'monthly' AND o.status IN ('paid','refunded') AND o.stripe_payment_intent IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM stripe_fees f WHERE f.payment_intent=o.stripe_payment_intent)`;
// Monthly memberships with fewer fees than counted payments.
const MONTHLY_WAITING = `FROM subscriptions s JOIN orders o ON o.id=s.order_id WHERE o.source='stripe' AND o.livemode=?
  AND s.payments_made > (SELECT count(*) FROM stripe_fees f WHERE f.order_id=s.order_id)`;

// The fee for one card payment from its PaymentIntent, retrieved with latest_charge.balance_transaction expanded.
// null while there is no settled balance transaction yet (it is tried again next run).
export function feeFromPaymentIntent(pi: any, livemode: number): Fee | null {
  if (!pi || typeof pi.id !== 'string') throw Error('Stripe returned no payment.');
  if (Boolean(pi.livemode) !== Boolean(livemode)) throw Error('Stripe returned a payment from the other mode.');
  const charge = pi.latest_charge, bt = charge?.balance_transaction;
  if (!charge || typeof charge !== 'object' || typeof charge.id !== 'string' || (charge.status !== undefined && charge.status !== 'succeeded')) return null;
  if (!bt || typeof bt !== 'object' || typeof bt.id !== 'string') return null;
  if (!int(bt.fee) || !int(bt.net) || !int(bt.amount) || bt.fee < 0 || bt.amount < 0) throw Error('Stripe returned a fee that is not whole cents.');
  if (String(bt.currency).toLowerCase() !== 'usd') throw Error('Stripe settled this payment in a currency other than US dollars.');
  const created = int(bt.created) ? bt.created : int(charge.created) ? charge.created : null;
  if (created === null) throw Error('Stripe returned no payment date.');
  return {chargeId: charge.id, balanceTransaction: bt.id, amountCents: bt.amount, feeCents: bt.fee, netCents: bt.net, chargedAt: new Date(created * 1000).toISOString()};
}

const refusedKey = (e: any) => ['StripePermissionError', 'StripeAuthenticationError'].includes(e?.type) || [401, 403].includes(e?.statusCode);

// How many card payments in the current mode are still waiting for their fee.
export async function feesWaiting(live = stripeMode() === 'live' ? 1 : 0): Promise<number> {
  const row = await env.DB!.prepare(`SELECT (SELECT count(*) ${SINGLE_WAITING}) + COALESCE((SELECT sum(s.payments_made - (SELECT count(*) FROM stripe_fees f WHERE f.order_id=s.order_id)) ${MONTHLY_WAITING}),0) AS n`)
    .bind(live, live).first<{n: number}>();
  return row?.n ?? 0;
}

export async function recordStripeFees(budget = FEE_CALL_BUDGET): Promise<FeeRun> {
  const mode = stripeMode(), live = mode === 'live' ? 1 : 0;
  const run: FeeRun = {mode, checked: 0, recorded: 0, failed: 0, waiting: 0, error: null, skipped: null};
  const [single, monthly] = await env.DB!.batch([
    env.DB!.prepare(`SELECT o.id,o.stripe_payment_intent AS intent ${SINGLE_WAITING} ORDER BY o.paid_at,o.id LIMIT ?`).bind(live, budget),
    env.DB!.prepare(`SELECT s.order_id,s.stripe_subscription_id AS sub,o.amount_cents ${MONTHLY_WAITING} ORDER BY o.paid_at,o.id LIMIT ?`).bind(live, budget)]);
  const singles = single.results as {id: string; intent: string}[], subs = monthly.results as {order_id: string; sub: string; amount_cents: number}[];
  if (!singles.length && !subs.length) return run;
  const key = await storedStripeKeyFor(mode);
  if (!key) return {...run, skipped: 'no-key', waiting: await feesWaiting(live)};
  const stripe: any = stripeClientFor(mode, key);
  let calls = 0, stop = false;
  const save = (orderId: string, intent: string, f: Fee) => env.DB!.prepare(`INSERT INTO stripe_fees(payment_intent,order_id,charge_id,balance_transaction,amount_cents,fee_cents,net_cents,charged_at,livemode,recorded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(payment_intent) DO NOTHING`).bind(intent, orderId, f.chargeId, f.balanceTransaction, f.amountCents, f.feeCents, f.netCents, f.chargedAt, live, new Date().toISOString()).run();
  const failed = (e: any) => {
    run.failed++;
    if (refusedKey(e)) { run.error = KEY_PERMISSION_HELP; stop = true; }
    else run.error ??= e instanceof Error ? e.message.slice(0, 200) : 'Stripe could not be reached.';
  };
  const feeFor = async (orderId: string, intent: string) => {
    run.checked++; calls++;
    try {
      const fee = feeFromPaymentIntent(await stripe.paymentIntents.retrieve(intent, {expand: ['latest_charge.balance_transaction']}), live);
      if (fee) { await save(orderId, intent, fee); run.recorded++; }
    } catch (e) { failed(e); }
  };

  for (const o of singles) { if (stop || calls >= budget) break; await feeFor(o.id, o.intent); }

  // A monthly membership's payments are its subscription's paid invoices. Only invoices for the membership's monthly
  // amount count, as in the webhook, so a fee is never recorded for a payment the books do not count.
  for (const s of subs) {
    if (stop || calls >= budget) break;
    try {
      calls++;
      const invoices = (await stripe.invoices.list({subscription: s.sub, status: 'paid', limit: 24, expand: ['data.payments']})).data ?? [];
      const known = new Set(((await env.DB!.prepare('SELECT payment_intent FROM stripe_fees WHERE order_id=?').bind(s.order_id).all<{payment_intent: string}>()).results).map(r => r.payment_intent));
      for (const inv of invoices) {
        if (stop || calls >= budget) break;
        if (Boolean(inv.livemode) !== Boolean(live)) throw Error('Stripe returned an invoice from the other mode.');
        if (inv.amount_paid !== s.amount_cents) continue;
        let payments = inv.payments?.data;
        if (!Array.isArray(payments)) { calls++; payments = (await stripe.invoicePayments.list({invoice: inv.id, limit: 10})).data ?? []; }
        for (const p of payments) {
          const intent = p?.status === 'paid' && p.payment?.type === 'payment_intent' ? idOf(p.payment.payment_intent) : null;
          if (!intent || known.has(intent) || stop || calls >= budget) continue;
          known.add(intent);
          await feeFor(s.order_id, intent);
        }
      }
    } catch (e) { failed(e); }
  }
  run.waiting = await feesWaiting(live);
  return run;
}
