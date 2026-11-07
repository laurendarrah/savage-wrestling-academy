// The academy's books (issue #194, decided in #197 Q8): income and expenses by month and year.
//
// One source of truth for every dollar:
// - Card payments, monthly installments and refunds are read from orders and stripe_events, which only the verified
//   Stripe webhook (lib/stripe-webhook.ts) marks paid or refunded.
// - Offline payments are read from orders too (lib/offline-payments.ts records them; a voided one drops out).
// - financial_entries holds only what the owner types in: expenses and other income.
// Nothing is copied into the books, so a payment can never be counted twice or go missing when it is voided or
// refunded. Amounts are whole cents. Stripe fees are not stored yet (#42), so card income is before fees.
import {env} from 'cloudflare:workers';
import {academyDay} from './datetime';
import {stripeMode} from './checkout-config';

export const ENTRY_KINDS = ['expense', 'income'] as const;
export type EntryKind = typeof ENTRY_KINDS[number];
// Suggestions only: the owner can type any category.
export const SUGGESTIONS: Record<EntryKind, string[]> = {
  expense: ['Rent', 'Equipment', 'Insurance', 'Utilities', 'Coach pay', 'Mats and cleaning', 'Tournament fees', 'Travel', 'Marketing', 'Software and fees', 'Supplies', 'Other'],
  income: ['Sponsorship', 'Donation', 'Fundraiser', 'Apparel', 'Concessions', 'Grant', 'Other'],
};
export const MAX_CENTS = 100000000;   // $1,000,000 for one entry; also enforced by the table
const FIRST_DAY = '2020-01-01';
export const academyToday = () => academyDay(new Date());

// What each kind of order is called in the books.
export const KIND_CATEGORY: Record<string, string> = {
  annual: 'Memberships, paid in full', monthly: 'Monthly memberships', walkin: 'Walk-ins', event: 'Camps, clinics and events', live: 'Friday Night Live', lesson: 'Private lessons',
};
const METHOD_LABEL: Record<string, string> = {cash: 'Cash', check: 'Check', venmo: 'Venmo', zelle: 'Zelle', 'card-in-person': 'Card in person', other: 'Other'};

export type LedgerLine = {
  id: string; date: string; type: 'income' | 'refund' | 'expense'; source: 'online' | 'offline' | 'owner';
  category: string; description: string; method: string; amountCents: number; note: string; receipt: string;
  entryId: string | null; revision: number | null;
};
export type Totals = {incomeCents: number; refundsCents: number; expensesCents: number; netCents: number};

export const validDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;
export const validMonth = (m: unknown): m is string => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && m >= FIRST_DAY.slice(0, 7) && m <= '2100-12';
const shift = (day: string, days: number) => new Date(Date.parse(day + 'T12:00:00Z') + days * 864e5).toISOString().slice(0, 10);
const lastDay = (month: string) => { const [y, m] = month.split('-').map(Number); return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max * 2 ? v.trim().replace(/\s+/g, ' ') : null;

// An entry the owner typed in, checked on the server. Amounts arrive as whole cents.
export function cleanEntry(input: any, today = academyToday()) {
  if (!input || !(ENTRY_KINDS as readonly string[]).includes(input.kind)) return {error: 'Choose an expense or other income.'} as const;
  if (!validDay(input.date) || input.date < FIRST_DAY || input.date > today) return {error: 'Choose the date the money came in or went out. It cannot be in the future.'} as const;
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > MAX_CENTS) return {error: 'Enter an amount between $0.01 and $1,000,000.00.'} as const;
  const category = text(input.category, 60), note = input.note === undefined ? '' : text(input.note, 300), receipt = input.receipt === undefined ? '' : text(input.receipt, 200);
  if (!category || category.length > 60 || /[\u0000-\u001f\u007f]/.test(category)) return {error: 'Enter a category of up to 60 characters, such as Rent.'} as const;
  if (note === null || note.length > 300) return {error: 'Keep the note to 300 characters.'} as const;
  if (receipt === null || receipt.length > 200) return {error: 'Keep the receipt reference to 200 characters.'} as const;
  return {entry: {kind: input.kind as EntryKind, date: input.date, amountCents: input.amountCents, category, note, receipt}} as const;
}

// Every line in the books between two academy dates (inclusive), newest first.
export async function ledgerLines(from: string, to: string): Promise<LedgerLine[]> {
  // Payments are stored as UTC instants; read a day either side, then keep those whose New York date is in range.
  const lo = shift(from, -1), hi = shift(to, 2), live = stripeMode() === 'live' ? 1 : 0;
  const inRange = (d: string) => d >= from && d <= to;
  const [paid, installments, refunds, entries] = await env.DB!.batch([
    // Card payments for the current Stripe mode, and offline payments. A refunded payment still came in; its refund
    // goes out on the day it was refunded. Voided offline payments (status canceled) were never received.
    env.DB!.prepare(`SELECT o.id,o.paid_at,o.kind,o.item_label,o.wrestler_name,o.amount_cents,o.source,o.pricing,s.payments_total FROM orders o
      LEFT JOIN subscriptions s ON s.order_id=o.id
      WHERE o.status IN ('paid','refunded') AND o.paid_at IS NOT NULL AND o.paid_at>=? AND o.paid_at<? AND o.amount_cents>0
        AND (o.source='offline' OR (o.source='stripe' AND o.livemode=?))`).bind(lo, hi, live),
    // Monthly payments 2 to 12. The webhook counts each once (stripe_events) after checking the amount.
    env.DB!.prepare(`SELECT e.id,e.received_at,e.outcome,o.kind,o.item_label,o.wrestler_name,o.amount_cents FROM stripe_events e JOIN orders o ON o.id=e.order_id
      WHERE e.outcome GLOB 'installment-[0-9]*-of-[0-9]*' AND o.source='stripe' AND o.livemode=? AND o.amount_cents>0 AND e.received_at>=? AND e.received_at<?`).bind(live, lo, hi),
    // Full refunds, dated when Stripe reported them.
    env.DB!.prepare(`SELECT * FROM (SELECT o.id,o.kind,o.item_label,o.wrestler_name,o.amount_cents,
        COALESCE((SELECT min(received_at) FROM stripe_events WHERE order_id=o.id AND outcome='refunded'),o.updated_at) AS refunded_at
      FROM orders o WHERE o.status='refunded' AND o.source='stripe' AND o.livemode=? AND o.amount_cents>0) WHERE refunded_at>=? AND refunded_at<?`).bind(live, lo, hi),
    env.DB!.prepare(`SELECT id,kind,entry_date,amount_cents,category,note,receipt,revision FROM financial_entries
      WHERE deleted_at IS NULL AND entry_date>=? AND entry_date<=?`).bind(from, to),
  ]);
  const lines: LedgerLine[] = [];
  const base = {note: '', receipt: '', entryId: null, revision: null};
  for (const r of paid.results as any[]) {
    const date = academyDay(r.paid_at);
    if (!inRange(date)) continue;
    const offline = r.source === 'offline', p = offline ? JSON.parse(r.pricing || '{}') : {};
    const of = r.kind === 'monthly' ? ` (payment 1 of ${r.payments_total || 12})` : '';
    lines.push({...base, id: 'payment:' + r.id, date, type: 'income', source: offline ? 'offline' : 'online', category: KIND_CATEGORY[r.kind] ?? r.kind,
      description: `${r.item_label}${of} · ${r.wrestler_name}`, method: offline ? METHOD_LABEL[p.method] ?? 'Offline' : 'Card online', amountCents: r.amount_cents});
  }
  for (const r of installments.results as any[]) {
    const date = academyDay(r.received_at);
    if (!inRange(date)) continue;
    const [, made, total] = /^installment-(\d+)-of-(\d+)$/.exec(r.outcome) ?? [];
    lines.push({...base, id: 'installment:' + r.id, date, type: 'income', source: 'online', category: KIND_CATEGORY[r.kind] ?? r.kind,
      description: `${r.item_label} (payment ${made} of ${total}) · ${r.wrestler_name}`, method: 'Card online', amountCents: r.amount_cents});
  }
  for (const r of refunds.results as any[]) {
    const date = academyDay(r.refunded_at);
    if (!inRange(date)) continue;
    lines.push({...base, id: 'refund:' + r.id, date, type: 'refund', source: 'online', category: 'Refunds',
      description: `Refund: ${r.item_label} · ${r.wrestler_name}`, method: 'Card online', amountCents: r.amount_cents});
  }
  for (const r of entries.results as any[])
    lines.push({id: 'entry:' + r.id, date: r.entry_date, type: r.kind === 'income' ? 'income' : 'expense', source: 'owner', category: r.category,
      description: r.note, method: '', amountCents: r.amount_cents, note: r.note, receipt: r.receipt, entryId: r.id, revision: r.revision});
  return lines.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export function totals(lines: LedgerLine[]): Totals {
  const sum = (t: LedgerLine['type']) => lines.filter(l => l.type === t).reduce((n, l) => n + l.amountCents, 0);
  const incomeCents = sum('income'), refundsCents = sum('refund'), expensesCents = sum('expense');
  return {incomeCents, refundsCents, expensesCents, netCents: incomeCents - refundsCents - expensesCents};
}

// Category totals, largest first. Money in: payments by type and other income. Money out: expenses and refunds.
export function categories(lines: LedgerLine[]) {
  const group = (list: LedgerLine[]) => [...list.reduce((m, l) => m.set(l.category, (m.get(l.category) ?? 0) + l.amountCents), new Map<string, number>())]
    .map(([category, cents]) => ({category, cents})).sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category));
  return {in: group(lines.filter(l => l.type === 'income')), out: group(lines.filter(l => l.type !== 'income'))};
}

// The month's lines and totals, with the month-by-month figures and totals for its year.
export async function ledgerReport(month: string) {
  const year = month.slice(0, 4), all = await ledgerLines(`${year}-01-01`, `${year}-12-31`);
  const lines = all.filter(l => l.date.startsWith(month));
  const months = Array.from({length: 12}, (_, i) => { const m = `${year}-${String(i + 1).padStart(2, '0')}`; return {month: m, ...totals(all.filter(l => l.date.startsWith(m)))}; });
  return {month, year, today: academyToday(), stripeMode: stripeMode(), totals: totals(lines), yearTotals: totals(all), months, categories: categories(lines), lines, suggestions: SUGGESTIONS};
}

export function periodBounds(q: URLSearchParams) {
  const year = q.get('year'), month = q.get('month');
  if (year !== null) return validMonth(year + '-01') ? {from: `${year}-01-01`, to: `${year}-12-31`, label: year} : null;
  const m = month ?? academyToday().slice(0, 7);
  return validMonth(m) ? {from: `${m}-01`, to: lastDay(m), label: m} : null;
}

// Spreadsheet-safe cell: quotes commas and line breaks, and stops a cell from starting a formula.
const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@\t]/.test(s) ? '"' + (/^[=+\-@\t]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
const SOURCE_LABEL = {online: 'Card payment', offline: 'Offline payment', owner: 'Entered by owner'};
const TYPE_LABEL = {income: 'Income', refund: 'Refund', expense: 'Expense'};
export function ledgerCsv(lines: LedgerLine[]) {
  const money = (c: number) => (c / 100).toFixed(2);
  const head = ['Date', 'Type', 'From', 'Category', 'Description', 'Paid by', 'Money in', 'Money out', 'Receipt reference'];
  const rows = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).map(l => [l.date, TYPE_LABEL[l.type], SOURCE_LABEL[l.source], l.category, l.description, l.method,
    l.type === 'income' ? money(l.amountCents) : '', l.type === 'income' ? '' : money(l.amountCents), l.receipt].map(csvCell).join(','));
  return [head.join(','), ...rows].join('\r\n') + '\r\n';
}
