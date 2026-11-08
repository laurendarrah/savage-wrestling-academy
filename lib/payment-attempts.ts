// Two owner lists on /payments (issue #271).
// - Payment attempts: every online order, paid or not, with the last thing Stripe said about it in plain words, so "my
//   payment didn't go through" is answered in a minute: the family, when they tried, the Stripe checkout session to look
//   up in the Stripe dashboard, and what happened (abandoned, expired, refused and why, paid, refunded).
// - Payment needs attention: monthly memberships whose latest payment failed (subscriptions past_due), with how long the
//   wrestler stays on the roster (the grace, lib/membership-term.ts) and when it failed.
// Both only read. Nothing here changes an order; only the verified webhook does (lib/stripe-webhook.ts).
import {env} from 'cloudflare:workers';
import {attemptState, outcomeWords} from './stripe-outcomes';
import {GRACE_DAYS} from './membership-term';

export const ATTEMPTS_LIMIT = 200;
const text = (v: unknown) => typeof v === 'string' ? v.trim().slice(0, 120) : '';

export type Attempt = {id: string; at: string; status: string; state: ReturnType<typeof attemptState>; kind: string; item: string; amountCents: number; livemode: boolean;
  wrestler: string; parent: string; email: string; sessionId: string | null; lastEventAt: string | null; lastEventType: string | null; outcome: string | null; words: string};

// Newest first. `q` narrows to a family or wrestler by name or email; `days` is how far back to look (default 90).
export async function paymentAttempts(opts: {q?: unknown; days?: number; limit?: number} = {}): Promise<{attempts: Attempt[]; more: boolean}> {
  const q = text(opts.q).toLowerCase(), limit = Math.min(Math.max(Number(opts.limit) || ATTEMPTS_LIMIT, 1), 500);
  const since = new Date(Date.now() - (opts.days ?? 90) * 86400000).toISOString();
  const rows = (await env.DB!.prepare(`SELECT o.id,o.created_at,o.status,o.kind,o.item_label,o.amount_cents,o.livemode,o.wrestler_name,o.email,o.stripe_session_id,
      json_extract(f.payload,'$.parentName') AS parent,
      e.received_at AS event_at,e.type AS event_type,e.outcome
    FROM orders o LEFT JOIN family_accounts f ON f.user_id=o.user_id
    LEFT JOIN stripe_events e ON e.id=(SELECT id FROM stripe_events WHERE order_id=o.id ORDER BY received_at DESC, rowid DESC LIMIT 1)
    WHERE o.source='stripe' AND o.created_at>=? ${q ? "AND (lower(o.wrestler_name) LIKE ? OR lower(o.email) LIKE ? OR lower(COALESCE(json_extract(f.payload,'$.parentName'),'')) LIKE ?)" : ''}
    ORDER BY o.created_at DESC, o.id DESC LIMIT ?`).bind(...[since, ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []), limit + 1]).all<any>()).results;
  const attempts = rows.slice(0, limit).map(r => ({id: r.id, at: r.created_at, status: r.status, state: attemptState(r.outcome, r.status), kind: r.kind, item: r.item_label, amountCents: r.amount_cents, livemode: !!r.livemode,
    wrestler: r.wrestler_name, parent: r.parent || '', email: r.email, sessionId: r.stripe_session_id, lastEventAt: r.event_at ?? null, lastEventType: r.event_type ?? null, outcome: r.outcome ?? null,
    words: outcomeWords(r.outcome, r.status)}));
  return {attempts, more: rows.length > limit};
}

export type Attention = {orderId: string; wrestler: string; parent: string; email: string; phone: string; item: string; program: string | null; amountCents: number;
  paymentsMade: number; paymentsTotal: number; paidThrough: string; rosterThrough: string; failedAt: string | null; failures: number};

// Memberships whose latest monthly payment failed, oldest failure first.
export async function paymentAttention(): Promise<{attention: Attention[]; graceDays: number}> {
  const rows = (await env.DB!.prepare(`SELECT o.id,o.wrestler_name,o.email,o.item_label,o.program,o.amount_cents,o.term_end,s.payments_made,s.payments_total,s.paid_through,
      json_extract(f.payload,'$.parentName') AS parent,json_extract(f.payload,'$.phone') AS phone,
      (SELECT max(received_at) FROM stripe_events WHERE order_id=o.id AND outcome='installment-failed') AS failed_at,
      (SELECT count(*) FROM stripe_events e WHERE e.order_id=o.id AND e.outcome='installment-failed'
        AND e.received_at>COALESCE((SELECT max(received_at) FROM stripe_events WHERE order_id=o.id AND outcome GLOB 'installment-[0-9]*-of-[0-9]*'),'')) AS failures
    FROM subscriptions s JOIN orders o ON o.id=s.order_id LEFT JOIN family_accounts f ON f.user_id=o.user_id
    WHERE s.status='past_due' AND o.status='paid' ORDER BY failed_at, o.id`).all<any>()).results;
  return {graceDays: GRACE_DAYS, attention: rows.map(r => ({orderId: r.id, wrestler: r.wrestler_name, parent: r.parent || '', email: r.email, phone: r.phone || '', item: r.item_label, program: r.program ?? null, amountCents: r.amount_cents,
    paymentsMade: r.payments_made, paymentsTotal: r.payments_total, paidThrough: r.paid_through, rosterThrough: r.term_end, failedAt: r.failed_at ?? null, failures: Math.max(1, Number(r.failures ?? 0))}))};
}
