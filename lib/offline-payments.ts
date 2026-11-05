// Owner-recorded payments taken outside Stripe: cash, check, Venmo and similar (issue #62).
// They use the same quotes, eligibility checks and orders table as online checkout, so the roster,
// member pricing and family page treat them exactly like online payments.
import {env} from 'cloudflare:workers';
import {quoteMembership, quoteBooking, type Quote} from './quotes';
import {membershipTerm} from './membership-term';
import {academyToday} from './public-schedule';
import {withinCapacity} from './capacity';
import {acceptStatement} from './waitlist';

export const METHODS = ['cash', 'check', 'venmo', 'zelle', 'card-in-person', 'other'] as const;
export const OFFLINE_KINDS = ['annual', 'walkin', 'event', 'live', 'lesson'] as const;
type Kind = typeof OFFLINE_KINDS[number];

export type OfflineInput = {
  userId: string; wrestlerId: string; kind: Kind;
  program?: string; date?: string; practiceId?: string;   // annual, walkin
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
  if (input.kind === 'annual' || input.kind === 'walkin')
    return quoteMembership(input.userId, {wrestlerId: input.wrestlerId, program: input.program, plan: input.kind, date: input.date, practiceId: input.practiceId});
  if (input.kind === 'event')
    return quoteBooking(input.userId, {type: 'event', wrestlerId: input.wrestlerId, id: input.eventId, option: input.option || 'full'});
  if (input.kind === 'lesson')
    return quoteBooking(input.userId, {type: 'lesson', wrestlerId: input.wrestlerId, format: input.format, openingId: input.openingId});
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
  const term = charge.kind === 'annual' ? membershipTerm(paidOn) : null;
  const id = crypto.randomUUID(), at = new Date().toISOString();
  const pricing = {...charge.pricing, method: input.method, note, recordedBy: ownerId, listedCents: charge.amountCents};
  try {
    await env.DB!.prepare(
      `INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'usd',?,?,'paid',?,0,?,?,?,?,?,'offline')`
    ).bind(id, input.userId, user!.email, quote.wrestler.id, quote.wrestler.name, charge.kind, charge.program, charge.itemId, charge.itemLabel,
      JSON.stringify(charge.dates), charge.baseCents, charge.baseCents - amount, amount, JSON.stringify(pricing), JSON.stringify({offline: true, recordedBy: ownerId, at}),
      charge.dedupeKey, at, at, paidOn + 'T12:00:00.000Z', term?.start ?? null, term?.end ?? null).run();
  } catch {
    return {status: 409, error: 'This wrestler already has a payment recorded for this item.'};
  }
  const slots = charge.kind === 'event' || charge.kind === 'lesson' ? charge.pricing.slots : null;
  if (typeof slots === 'number' && slots > 0 && !(await withinCapacity(id, charge.itemId, charge.dates, slots, charge.kind as 'event' | 'lesson'))) {
    await env.DB!.prepare("UPDATE orders SET status='canceled',updated_at=? WHERE id=?").bind(at, id).run();
    return {status: 409, error: charge.kind === 'lesson' ? 'This lesson time was just booked by another family. The payment was not recorded.' : 'This event just filled up. The payment was not recorded.'};
  }
  if (charge.kind === 'event') await acceptStatement(charge.itemId, input.userId, quote.wrestler.id, at).run();
  await env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), ownerId, 'offline_payment_recorded', `${id} ${charge.kind} ${amount}`, at).run();
  return {status: 200, orderId: id};
}

// Undo an offline payment entered by mistake. Online payments are refunded in Stripe instead.
export async function voidOffline(orderId: string, ownerId: string, reason: string) {
  const at = new Date().toISOString();
  const row = await env.DB!.prepare("SELECT id,source,status,pricing FROM orders WHERE id=?").bind(orderId).first<{id: string; source: string; status: string; pricing: string}>();
  if (!row) return {status: 404, error: 'Payment not found.'};
  if (row.source !== 'offline') return {status: 400, error: 'Online payments are refunded in Stripe, which updates this list automatically.'};
  if (row.status !== 'paid') return {status: 409, error: 'This payment is already voided.'};
  const pricing = {...JSON.parse(row.pricing || '{}'), voidedBy: ownerId, voidedAt: at, voidReason: String(reason || '').trim().slice(0, 300)};
  await env.DB!.batch([
    env.DB!.prepare("UPDATE orders SET status='canceled',pricing=?,updated_at=? WHERE id=? AND status='paid'").bind(JSON.stringify(pricing), at, orderId),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'offline_payment_voided', orderId, at)
  ]);
  return {status: 200};
}

export type PaymentFilters = {from?: string; to?: string; status?: string; kind?: string; source?: string};
export async function listPayments(f: PaymentFilters) {
  const where = ["o.status IN ('paid','refunded','canceled')", "(o.status<>'canceled' OR o.source='offline')"], args: unknown[] = [];
  if (validDate(f.from)) { where.push('substr(o.paid_at,1,10)>=?'); args.push(f.from); }
  if (validDate(f.to)) { where.push('substr(o.paid_at,1,10)<=?'); args.push(f.to); }
  if (['paid', 'refunded', 'canceled'].includes(String(f.status))) { where.push('o.status=?'); args.push(f.status); }
  if (['annual', 'monthly', 'walkin', 'event', 'live', 'lesson'].includes(String(f.kind))) { where.push('o.kind=?'); args.push(f.kind); }
  if (['stripe', 'offline'].includes(String(f.source))) { where.push('o.source=?'); args.push(f.source); }
  const rows = (await env.DB!.prepare(
    `SELECT o.id,o.paid_at,o.status,o.source,o.kind,o.program,o.item_label,o.dates,o.wrestler_name,o.email,o.amount_cents,o.base_cents,o.discount_cents,o.pricing,o.term_start,o.term_end,f.payload AS family
     FROM orders o LEFT JOIN family_accounts f ON f.user_id=o.user_id WHERE ${where.join(' AND ')} AND o.paid_at IS NOT NULL ORDER BY o.paid_at DESC LIMIT 2000`
  ).bind(...args).all<any>()).results;
  const payments = rows.map(r => {
    const p = JSON.parse(r.pricing || '{}'), fam = r.family ? JSON.parse(r.family) : {};
    return {id: r.id, paidOn: String(r.paid_at).slice(0, 10), status: r.status === 'canceled' ? 'voided' : r.status, source: r.source, kind: r.kind, program: r.program,
      item: r.item_label, dates: JSON.parse(r.dates || '[]'), wrestler: r.wrestler_name, parent: fam.parentName || '', email: r.email, phone: fam.phone || '',
      amountCents: r.amount_cents, listCents: r.base_cents, discountCents: r.discount_cents, method: r.source === 'offline' ? p.method : 'stripe', note: p.note || '', voidReason: p.voidReason || '',
      termStart: r.term_start, termEnd: r.term_end};
  });
  const sum = (pred: (x: any) => boolean) => payments.filter(pred).reduce((n, x) => n + x.amountCents, 0);
  return {payments, totals: {
    collectedCents: sum(x => x.status === 'paid'), onlineCents: sum(x => x.status === 'paid' && x.source === 'stripe'),
    offlineCents: sum(x => x.status === 'paid' && x.source === 'offline'), refundedCents: sum(x => x.status === 'refunded'), count: payments.filter(x => x.status === 'paid').length
  }, truncated: rows.length >= 2000};
}

const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
export function paymentsCsv(payments: Awaited<ReturnType<typeof listPayments>>['payments']) {
  const head = ['Paid on', 'Status', 'Paid via', 'Method', 'Type', 'Item', 'Dates', 'Wrestler', 'Parent', 'Email', 'Phone', 'Amount', 'List price', 'Discount', 'Term start', 'Term end', 'Note', 'Void reason'];
  const money = (c: number) => (c / 100).toFixed(2);
  const lines = payments.map(p => [p.paidOn, p.status, p.source === 'offline' ? 'Offline' : 'Online', p.method, p.kind, p.item, p.dates.join(' '), p.wrestler, p.parent, p.email, p.phone,
    money(p.amountCents), money(p.listCents), money(p.discountCents), p.termStart ?? '', p.termEnd ?? '', p.note, p.voidReason].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}
