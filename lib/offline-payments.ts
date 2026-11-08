// Owner-recorded payments taken outside Stripe: cash, check, Venmo and similar (issue #62).
// They use the same quotes, eligibility checks and orders table as online checkout, so the roster,
// member pricing and family page treat them exactly like online payments.
import {env} from 'cloudflare:workers';
import {quoteMembership, quoteBooking, type Quote} from './quotes';
import {academyToday} from './public-schedule';
import {withinCapacity} from './capacity';
import {noticePaymentRecorded, noticeLessonBooked, quietly} from './notify';
import {BATCH_SIZE, keysetPage, type Page, type SortCol} from './paging';
import {refundedByOrder, type RefundRow} from './card-refunds';
import {academyDay, academyDayStart} from './datetime';
import {collectorKeySql, collectorNameSql} from './collectors';

export const METHODS = ['cash', 'check', 'venmo', 'zelle', 'card-in-person', 'other'] as const;
// A membership paid upfront for the year is not offered, online or at the academy (decision Q9 in #197, issue #210).
export const OFFLINE_KINDS = ['walkin', 'event', 'live', 'lesson'] as const;
type Kind = typeof OFFLINE_KINDS[number];

export type OfflineInput = {
  userId: string; wrestlerId: string; kind: Kind;
  program?: string; date?: string; practiceId?: string;   // walkin
  eventId?: string; option?: string;                       // event
  liveId?: string;                                         // live (uses date)
  openingId?: string; format?: string;                     // lesson
  amountCents?: number; method?: string; note?: string; paidOn?: string;
};

const validDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;

// What the payment would record, using the same rules as checkout. Nothing is saved.
export async function previewOffline(input: OfflineInput): Promise<Quote> {
  if (!input || typeof input.userId !== 'string' || typeof input.wrestlerId !== 'string' || !(OFFLINE_KINDS as readonly string[]).includes(input.kind))
    return {ok: false, status: 400, error: 'Choose a family, wrestler and payment type.'};
  const family = await env.DB!.prepare('SELECT user_id FROM family_accounts WHERE user_id=?').bind(input.userId).first();
  if (!family) return {ok: false, status: 404, error: 'Family account not found.'};
  if (input.kind === 'walkin')
    return quoteMembership(input.userId, {wrestlerId: input.wrestlerId, program: input.program, plan: input.kind, date: input.date, practiceId: input.practiceId});
  if (input.kind === 'event')
    return quoteBooking(input.userId, {type: 'event', wrestlerId: input.wrestlerId, id: input.eventId, option: input.option || 'full'});
  if (input.kind === 'lesson')
    return quoteBooking(input.userId, {type: 'lesson', wrestlerId: input.wrestlerId, format: input.format, openingId: input.openingId}, {ownerRecording: true});
  return quoteBooking(input.userId, {type: 'live', wrestlerId: input.wrestlerId, id: input.liveId, date: input.date});
}

export async function recordOffline(input: OfflineInput, ownerId: string) {
  const quote = await previewOffline(input);
  if (!quote.ok) return {status: quote.status, error: quote.error};
  const charge = quote.charge;
  if (!charge) return {status: 400, error: 'This item has no price set, so a payment cannot be recorded for it.'};
  if (!(METHODS as readonly string[]).includes(String(input.method))) return {status: 400, error: 'Choose how the family paid.'};
  const amount = input.amountCents === undefined ? charge.amountCents : input.amountCents;
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > charge.baseCents)
    return {status: 400, error: `Enter an amount between $0.00 and the listed price of $${(charge.baseCents / 100).toFixed(2)}.`};
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';
  const paidOn = input.paidOn === undefined || input.paidOn === '' ? academyToday() : input.paidOn;
  if (!validDate(paidOn) || paidOn > academyToday()) return {status: 400, error: 'Choose the date the payment was received. It cannot be in the future.'};
  const user = await env.DB!.prepare('SELECT email FROM family_accounts WHERE user_id=?').bind(input.userId).first<{email: string}>();
  const id = crypto.randomUUID(), at = new Date().toISOString();
  const pricing = {...charge.pricing, method: input.method, note, recordedBy: ownerId, listedCents: charge.amountCents};
  // One transaction (issue #272, as receiveCash in lib/cash-bookings.ts): the payment, the link to a walk-in or extra
  // practice the family booked to pay at the academy (issue #248, so it stops showing as due and can't be collected
  // twice), and the security log line. The two later statements only apply when the order was inserted, and a duplicate
  // payment for the same item fails the whole batch, so a paid order can never sit beside a booking still due.
  try {
    await env.DB!.batch([
      env.DB!.prepare(
        `INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'usd',?,?,'paid',?,0,?,?,?,?,?,'offline')`
      ).bind(id, input.userId, user!.email, quote.wrestler.id, quote.wrestler.name, charge.kind, charge.program, charge.itemId, charge.itemLabel,
        JSON.stringify(charge.dates), charge.baseCents, charge.baseCents - amount, amount, JSON.stringify(pricing), JSON.stringify({offline: true, recordedBy: ownerId, at}),
        charge.dedupeKey, at, at, paidOn + 'T12:00:00.000Z', null, null),
      env.DB!.prepare("UPDATE cash_bookings SET status='paid',order_id=?,updated_at=? WHERE dedupe_key=? AND status='due' AND EXISTS (SELECT 1 FROM orders WHERE id=?)").bind(id, at, charge.dedupeKey, id),
      env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM orders WHERE id=?)')
        .bind(crypto.randomUUID(), ownerId, 'offline_payment_recorded', `${id} ${charge.kind} ${amount}`, at, id)
    ]);
  } catch {
    return {status: 409, error: 'This wrestler already has a payment recorded for this item.'};
  }
  // Seats are counted with this payment in place, so two owners recording the last seat at once both see it. Camps,
  // events and lessons are never booked to pay at the academy, so there is no cash booking to put back.
  const slots = charge.kind === 'event' || charge.kind === 'lesson' ? charge.pricing.slots : null;
  if (typeof slots === 'number' && slots > 0 && !(await withinCapacity(id, charge.itemId, charge.dates, slots, charge.kind as 'event' | 'lesson'))) {
    await env.DB!.batch([
      env.DB!.prepare("UPDATE orders SET status='canceled',updated_at=? WHERE id=?").bind(at, id),
      env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'offline_payment_voided', id, at)
    ]);
    return {status: 409, error: charge.kind === 'lesson' ? 'This lesson just filled up. The payment was not recorded.' : 'This event just filled up. The payment was not recorded.'};
  }
  await quietly(() => noticePaymentRecorded(id));
  if (charge.kind === 'lesson') await quietly(() => noticeLessonBooked(id));
  return {status: 200, orderId: id};
}

// Undo an offline payment entered by mistake. Online payments are refunded in Stripe instead. A mistaken "Cash received"
// (issue #248) is undone the same way, and its booking goes back to "pay at the academy", amount due.
export async function voidOffline(orderId: string, ownerId: string, reason: string) {
  const at = new Date().toISOString();
  const row = await env.DB!.prepare("SELECT id,source,status,pricing FROM orders WHERE id=?").bind(orderId).first<{id: string; source: string; status: string; pricing: string}>();
  if (!row) return {status: 404, error: 'Payment not found.'};
  if (row.source !== 'offline') return {status: 400, error: 'Online payments are refunded in Stripe, which updates this list automatically.'};
  if (row.status !== 'paid') return {status: 409, error: 'This payment is already voided.'};
  const pricing = {...JSON.parse(row.pricing || '{}'), voidedBy: ownerId, voidedAt: at, voidReason: String(reason || '').trim().slice(0, 300)};
  await env.DB!.batch([
    env.DB!.prepare("UPDATE orders SET status='canceled',pricing=?,updated_at=? WHERE id=? AND status='paid'").bind(JSON.stringify(pricing), at, orderId),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'offline_payment_voided', orderId, at),
    env.DB!.prepare("UPDATE cash_bookings SET status='due',order_id=NULL,updated_at=? WHERE order_id=? AND status='paid'").bind(at, orderId)
  ]);
  return {status: 200};
}

// collector (issue #250): who collected an offline payment, by the account that recorded it (lib/collectors.ts), so the
// owner can reconcile each coach's cash at the end of a night.
export type PaymentFilters = {from?: string; to?: string; status?: string; kind?: string; source?: string; collector?: string};
// Payments, newest first. The list comes a page at a time (keyset on paid_at and id, issue #46); the totals and the
// number of matching payments are worked out in the database over every match, not just the page shown.
const PAYMENT_COLS: SortCol[] = [{expr: 'o.paid_at', desc: true}, {expr: 'o.id', desc: true}];
const PAYMENT_FIELDS = 'o.id,o.paid_at,o.updated_at,o.status,o.source,o.kind,o.program,o.item_label,o.dates,o.wrestler_name,o.email,o.amount_cents,o.base_cents,o.discount_cents,o.pricing,o.term_start,o.term_end,s.payments_made,f.payload AS family,'
  + `${collectorKeySql('o')} AS collector_key,${collectorNameSql('o')} AS collector_name`;
const nextDay = (d: string) => new Date(Date.parse(d + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
const validCollector = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
function paymentWhere(f: PaymentFilters) {
  const where = ["o.status IN ('paid','refunded','canceled')", "(o.status<>'canceled' OR o.source='offline')", 'o.paid_at IS NOT NULL'], args: unknown[] = [];
  // From and to are New York days (issue #250): a payment at 7:30 PM counts on that evening, not the next UTC day.
  if (validDate(f.from)) { where.push('o.paid_at>=?'); args.push(academyDayStart(f.from)); }
  if (validDate(f.to)) { where.push('o.paid_at<?'); args.push(academyDayStart(nextDay(f.to))); }
  if (['paid', 'refunded', 'canceled'].includes(String(f.status))) { where.push('o.status=?'); args.push(f.status); }
  if (['annual', 'monthly', 'walkin', 'event', 'live', 'lesson'].includes(String(f.kind))) { where.push('o.kind=?'); args.push(f.kind); }
  if (['stripe', 'offline'].includes(String(f.source))) { where.push('o.source=?'); args.push(f.source); }
  if (validCollector(f.collector)) { where.push(`${collectorKeySql('o')}=?`); args.push(f.collector); }
  return {where: where.join(' AND '), args};
}
// Card refunds (full or partial), Stripe fees and card disputes for a page or batch of payments (issues #42, #272).
export type DisputeInfo = {status: 'open' | 'won' | 'lost'; amountCents: number; at: string};
type CardMoney = {refunded: Map<string, {cents: number; at: string}>; fees: Map<string, {n: number; fee: number; net: number}>; oldRefundAt: Map<string, string>; disputes: Map<string, DisputeInfo>};
// The state of an order's dispute from its rows in event order: open until Stripe closes it (won or lost); the bank
// giving the money back also means won, in case the closed event is late.
export function disputeStates(rows: {order_id: string; kind: string; amount_cents: number; status: string | null; occurred_at: string; id: string}[]) {
  const out = new Map<string, DisputeInfo>();
  for (const r of [...rows].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id))) {
    const d = out.get(r.order_id) ?? {status: 'open' as const, amountCents: r.amount_cents, at: r.occurred_at};
    d.at = r.occurred_at; if (r.amount_cents) d.amountCents = r.amount_cents;
    if (r.kind === 'created') d.status = 'open';
    else if (r.kind === 'funds_reinstated') d.status = 'won';
    else if (r.kind === 'closed') d.status = r.status === 'won' ? 'won' : r.status === 'lost' ? 'lost' : d.status;
    out.set(r.order_id, d);
  }
  return out;
}
async function cardMoney(rows: any[]): Promise<CardMoney> {
  const ids = JSON.stringify(rows.filter(r => r.source === 'stripe').map(r => r.id)), inIds = 'order_id IN (SELECT value FROM json_each(?))';
  if (ids === '[]') return {refunded: new Map(), fees: new Map(), oldRefundAt: new Map(), disputes: new Map()};
  const [refundRows, feeRows, oldRefunds, disputeRows] = await env.DB!.batch([
    env.DB!.prepare(`SELECT id,order_id,payment_intent,amount_cents,refunded_cents,refunded_at FROM payment_refunds WHERE ${inIds}`).bind(ids),
    env.DB!.prepare(`SELECT order_id,count(*) AS n,sum(fee_cents) AS fee,sum(net_cents) AS net FROM stripe_fees WHERE ${inIds} GROUP BY order_id`).bind(ids),
    env.DB!.prepare(`SELECT order_id,min(received_at) AS at FROM stripe_events WHERE outcome='refunded' AND ${inIds} GROUP BY order_id`).bind(ids),
    env.DB!.prepare(`SELECT id,order_id,kind,amount_cents,status,occurred_at FROM payment_disputes WHERE ${inIds}`).bind(ids)]);
  return {refunded: refundedByOrder(refundRows.results as RefundRow[]),
    fees: new Map((feeRows.results as {order_id: string; n: number; fee: number; net: number}[]).map(f => [f.order_id, f])),
    oldRefundAt: new Map((oldRefunds.results as {order_id: string; at: string}[]).map(e => [e.order_id, e.at])),
    disputes: disputeStates(disputeRows.results as any[])};
}
const viewsOf = async (rows: any[]) => { const m = await cardMoney(rows); return rows.map(r => paymentView(r, m)); };
function paymentView(r: any, m: CardMoney) {
  const p = JSON.parse(r.pricing || '{}'), fam = r.family ? JSON.parse(r.family) : {};
  // A full refund recorded before refund amounts were stored has no refund rows; it refunded the whole amount.
  const back = m.refunded.get(r.id) ?? (r.source === 'stripe' && r.status === 'refunded' ? {cents: r.amount_cents as number, at: m.oldRefundAt.get(r.id) ?? r.updated_at} : null);
  // Card payments behind this row: one, or each monthly payment so far. The fee shows once Stripe's fee is in for all of them.
  const cardPayments: number = r.source === 'stripe' ? (r.kind === 'monthly' ? r.payments_made ?? 1 : 1) : 0, fee = m.fees.get(r.id);
  const feeKnown = cardPayments > 0 && !!fee && fee.n >= cardPayments;
  // The New York day it was paid, like the date filter.
  const paidOn = Number.isFinite(Date.parse(r.paid_at)) ? academyDay(r.paid_at) : String(r.paid_at).slice(0, 10);
  return {id: r.id as string, paidOn, status: r.status === 'canceled' ? 'voided' : r.status as string, source: r.source as string, kind: r.kind as string, program: r.program as string | null,
    item: r.item_label as string, dates: JSON.parse(r.dates || '[]') as string[], wrestler: r.wrestler_name as string, parent: fam.parentName || '', email: r.email as string, phone: fam.phone || '',
    amountCents: r.amount_cents as number, listCents: r.base_cents as number, discountCents: r.discount_cents as number, method: r.source === 'offline' ? p.method : 'stripe', note: p.note || '', voidReason: p.voidReason || '',
    // Who collected it (issue #250): a coach's display name, "Owner" or "Former coach"; empty for an online payment.
    collectedBy: (r.collector_name as string | null) ?? '', collectorKey: (r.collector_key as string | null) ?? '', collectedAt: r.source === 'offline' && typeof p.collectedAt === 'string' ? p.collectedAt : null,
    termStart: r.term_start as string | null, termEnd: r.term_end as string | null,
    refundedCents: back?.cents ?? 0, refundedOn: back && Number.isFinite(Date.parse(back.at)) ? academyDay(back.at) : '', cardPayments,
    feeCents: feeKnown ? fee!.fee : null, netCents: feeKnown ? fee!.net : null,
    // A card dispute (issue #272): open, won or lost. The payment itself stays as paid; the books move the money.
    dispute: m.disputes.get(r.id) ?? null};
}
// Refunded so far for one order, in SQL: the latest Stripe total of each of its card payments, or the whole amount for a
// full refund recorded before refund amounts were stored. Matches paymentView, so the totals match the rows.
const REFUNDED_SQL = `COALESCE((SELECT sum(r.refunded_cents) FROM payment_refunds r WHERE r.order_id=o.id AND NOT EXISTS (SELECT 1 FROM payment_refunds r2
    WHERE r2.payment_intent=r.payment_intent AND (r2.refunded_at>r.refunded_at OR (r2.refunded_at=r.refunded_at AND (r2.refunded_cents>r.refunded_cents OR (r2.refunded_cents=r.refunded_cents AND r2.id>r.id)))))),
  CASE WHEN o.status='refunded' AND o.source='stripe' THEN o.amount_cents ELSE 0 END)`;
const paymentsPage = (f: PaymentFilters, cursor: unknown, limit: number) => {
  const {where, args} = paymentWhere(f);
  return keysetPage<any>({select: PAYMENT_FIELDS, from: 'FROM orders o LEFT JOIN family_accounts f ON f.user_id=o.user_id LEFT JOIN subscriptions s ON s.order_id=o.id', where, args, cols: PAYMENT_COLS, keyOf: r => [r.paid_at, r.id], cursor, limit});
};
// Paid offline payments for each person who collected them, over every filter but the collector: a small total per coach
// for the day or range chosen (issue #250). cashCents is the cash part, the money a coach hands over at the end of a night.
async function totalsByCollector(f: PaymentFilters) {
  const {where, args} = paymentWhere({...f, collector: undefined});
  const rows = (await env.DB!.prepare(`SELECT ${collectorKeySql('o')} AS k,${collectorNameSql('o')} AS name,max(o.paid_at) AS last,count(*) AS n,sum(o.amount_cents) AS cents,
      COALESCE(sum(CASE WHEN json_extract(o.pricing,'$.method')='cash' THEN o.amount_cents END),0) AS cash
    FROM orders o WHERE ${where} AND o.source='offline' AND o.status='paid' AND ${collectorKeySql('o')} IS NOT NULL GROUP BY k ORDER BY cents DESC,name`).bind(...args)
    .all<{k: string; name: string; n: number; cents: number; cash: number}>()).results;
  return rows.map(r => ({key: r.k, name: r.name, count: Number(r.n), cents: Number(r.cents), cashCents: Number(r.cash)}));
}
// Everyone who has collected an offline payment, for the filter: the name from their latest payment.
export async function paymentCollectors() {
  const rows = (await env.DB!.prepare(`SELECT ${collectorKeySql('o')} AS k,${collectorNameSql('o')} AS name,max(o.paid_at) AS last FROM orders o
    WHERE o.source='offline' AND o.paid_at IS NOT NULL AND ${collectorKeySql('o')} IS NOT NULL GROUP BY k`).all<{k: string; name: string}>()).results;
  return rows.map(r => ({key: r.k, name: r.name})).sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}
export async function listPayments(f: PaymentFilters, page: {cursor?: unknown; limit?: number} = {}) {
  const {where, args} = paymentWhere(f);
  const [rows, t, byCollector, collectors] = await Promise.all([paymentsPage(f, page.cursor, page.limit ?? 100),
    // Collected leaves out refunds: a refunded payment entirely, and what was refunded so far from one that is still paid
    // (issue #42). Fees are every Stripe fee recorded for the matching payments.
    env.DB!.prepare(`SELECT count(*) AS matched,
        COALESCE(sum(CASE WHEN x.status='paid' THEN x.amount_cents-x.back END),0) AS collected,
        COALESCE(sum(CASE WHEN x.status='paid' AND x.source='stripe' THEN x.amount_cents-x.back END),0) AS online,
        COALESCE(sum(CASE WHEN x.status='paid' AND x.source='offline' THEN x.amount_cents END),0) AS offline,
        COALESCE(sum(x.back),0) AS refunded, COALESCE(sum(x.fee),0) AS fees,
        COALESCE(sum(x.status='paid'),0) AS paid
      FROM (SELECT o.status,o.source,o.amount_cents,${REFUNDED_SQL} AS back,(SELECT COALESCE(sum(fee_cents),0) FROM stripe_fees WHERE order_id=o.id) AS fee
        FROM orders o WHERE ${where}) x`).bind(...args).first<Record<string, number>>(), totalsByCollector(f), paymentCollectors()]);
  return {payments: await viewsOf(rows.rows), next: rows.next, matched: Number(t?.matched ?? 0), byCollector, collectors, totals: {
    collectedCents: Number(t?.collected ?? 0), onlineCents: Number(t?.online ?? 0), offlineCents: Number(t?.offline ?? 0), refundedCents: Number(t?.refunded ?? 0),
    feesCents: Number(t?.fees ?? 0), count: Number(t?.paid ?? 0)
  }};
}

// Every matching payment, newest first, in batches: for the spreadsheet export, which never stops at a page.
export async function* allPayments(f: PaymentFilters, size = BATCH_SIZE) {
  let cursor: string | null = null;
  do {
    const page: Page<any> = await paymentsPage(f, cursor, size);
    yield await viewsOf(page.rows);
    cursor = page.next;
  } while (cursor);
}

const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
export function paymentsCsv(payments: ReturnType<typeof paymentView>[]) {
  // Refunded, Stripe fee and Net cover every card payment behind the row: one, or each monthly payment so far (Card
  // payments). A blank fee means Stripe's fee isn't recorded yet. Net after Stripe fee is before any refund, as Stripe shows it.
  // Collected by (issue #250): the coach's display name, Owner or Former coach for an offline payment; blank online.
  // Dispute (issue #272): "Open", "Won" or "Lost" when the family's bank disputed the card payment; blank otherwise.
  const head = ['Paid on', 'Status', 'Paid via', 'Method', 'Collected by', 'Type', 'Item', 'Dates', 'Wrestler', 'Parent', 'Email', 'Phone', 'Amount', 'List price', 'Discount', 'Term start', 'Term end', 'Note', 'Void reason',
    'Dispute', 'Refunded', 'Refunded on', 'Card payments', 'Stripe fee', 'Net after Stripe fee'];
  const money = (c: number) => (c / 100).toFixed(2), card = (p: typeof payments[number], v: string) => p.source === 'stripe' ? v : '';
  const lines = payments.map(p => [p.paidOn, p.status, p.source === 'offline' ? 'Offline' : 'Online', p.method, p.collectedBy, p.kind, p.item, p.dates.join(' '), p.wrestler, p.parent, p.email, p.phone,
    money(p.amountCents), money(p.listCents), money(p.discountCents), p.termStart ?? '', p.termEnd ?? '', p.note, p.voidReason,
    p.dispute ? {open: 'Open', won: 'Won', lost: 'Lost'}[p.dispute.status] : '',
    p.refundedCents ? money(p.refundedCents) : '', p.refundedOn, card(p, String(p.cardPayments)), card(p, p.feeCents === null ? '' : money(p.feeCents)), card(p, p.netCents === null ? '' : money(p.netCents))].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}
