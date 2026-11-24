// Payments to coaches and each coach's balance (issue #370, decided by Lauren on Nov 19, 2026: "all of the money
// going in and coming out via payroll should be recorded and viewable on the dashboard").
//
// The site works out what a coach earned; the owner pays outside the site (check, bank transfer, cash) and records
// each payment here, once. Owner only.
//
// - Earned is money the academy owes for certain: practice pay the owner has approved (the amounts frozen at approval,
//   lib/coach-timesheets.ts) plus the coach's share of paid private lessons dated up to today (lib/coach-pay.ts).
// - Not counted as earned yet: practice shifts that are not approved, shown beside the balance as "not approved yet",
//   and lessons paid for but not taught yet.
// - Paid is the sum of the payments recorded here. Still owed is earned less paid. A coach paid more than they have
//   earned so far (paid before the month was approved) is "paid ahead", never a negative amount owed.
// - The books read these payments as money out under Coach pay (lib/financials.ts), so nothing is typed twice.
// - A payment entered by mistake is deleted. The security log keeps one line for each payment recorded or deleted.
import {env} from 'cloudflare:workers';
import {academyDay} from './datetime';
import {coachPayReport} from './coach-pay';
import {ENTRY_COLUMNS, shiftAmount, type Entry} from './coach-time';
import {w9s, type W9} from './coach-w9';

export const PAY_METHODS = {check: 'Check', cash: 'Cash', bank: 'Bank transfer', zelle: 'Zelle', venmo: 'Venmo', other: 'Other'} as const;
export type PayMethod = keyof typeof PAY_METHODS;
export const PAY_CATEGORY = 'Coach pay';
export const MAX_CENTS = 100000000, FIRST_DAY = '2020-01-01', LAST_DAY = '2100-12-31', LISTED = 200;

type Result = {status: number; error?: string; [k: string]: unknown};
type Row = {id: string; coach_email: string; coach_name: string; paid_on: string; amount_cents: number; method: string; period_from: string | null; period_to: string | null; note: string; created_at: string};
export type CoachPaymentView = {id: string; coachEmail: string; coach: string; paidOn: string; amountCents: number; method: string; methodLabel: string; periodFrom: string | null; periodTo: string | null; note: string};
export type CoachBalance = {
  email: string; name: string; active: boolean;
  practiceCents: number;          // approved practice pay, all time
  lessonCents: number;            // the coach's share of paid lessons dated up to today, all time
  lessonShareSet: boolean;        // false: this coach has lessons and no pay share is set, so their share reads $0
  earnedCents: number; paidCents: number;
  owedCents: number;              // earned less paid, never below 0
  aheadCents: number;             // paid more than earned so far
  pendingCents: number;           // practice pay on shifts that are not approved yet
  payments: number; lastPaidOn: string | null;
};

const db = () => env.DB!;
const fail = (status: number, error: string): Result => ({status, error});
const validDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;
const validId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
const money = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const audit = (actor: string, action: string, target: string) =>
  db().prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), actor, action, target.slice(0, 500), new Date().toISOString());
const view = (r: Row): CoachPaymentView => ({id: r.id, coachEmail: r.coach_email, coach: r.coach_name, paidOn: r.paid_on, amountCents: r.amount_cents, method: r.method,
  methodLabel: PAY_METHODS[r.method as PayMethod] ?? 'Other', periodFrom: r.period_from, periodTo: r.period_to, note: r.note});
// One payment in words, for the security log: "coach email · $120.00 · 2026-11-19 · Check · for 2026-11-01 to 2026-11-15".
const words = (r: Pick<Row, 'coach_email' | 'amount_cents' | 'paid_on' | 'method' | 'period_from' | 'period_to'>) =>
  `${r.coach_email} · ${money(r.amount_cents)} · ${r.paid_on} · ${PAY_METHODS[r.method as PayMethod] ?? 'Other'}${r.period_from && r.period_to ? ` · for ${r.period_from} to ${r.period_to}` : ''}`;

// What each coach was paid in a calendar year, for the 1099s (issue #400), from the payments recorded here, with each
// coach's W-9 status. A year from 2020 to the current one; anything else is the current year.
export type YearTotal = {email: string; name: string; paidCents: number; payments: number; w9: W9 | null};
export async function yearTotals(yearInput: unknown, today = academyDay(new Date())) {
  const thisYear = Number(today.slice(0, 4)), asked = Number(yearInput);
  const year = Number.isInteger(asked) && asked >= 2020 && asked <= thisYear ? asked : thisYear;
  const [rows, years, staff] = await db().batch([
    db().prepare('SELECT lower(coach_email) AS email,max(coach_name) AS name,sum(amount_cents) AS cents,count(*) AS n FROM coach_payments WHERE paid_on>=? AND paid_on<=? GROUP BY lower(coach_email)').bind(year + '-01-01', year + '-12-31'),
    db().prepare("SELECT DISTINCT substr(paid_on,1,4) AS y FROM coach_payments WHERE paid_on>='2020-01-01'"),
    db().prepare('SELECT lower(email) AS email,name FROM staff_access'),
  ]);
  const names = new Map((staff.results as any[]).map(s => [s.email, s.name])), w9 = await w9s();
  const coaches: YearTotal[] = (rows.results as any[]).map(r => ({email: r.email, name: names.get(r.email) ?? r.name, paidCents: Number(r.cents) || 0, payments: Number(r.n) || 0, w9: w9.get(r.email) ?? null}))
    .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  const list = [...new Set([thisYear, ...(years.results as any[]).map(r => Number(r.y)).filter(y => y >= 2020 && y <= thisYear)])].sort((a, b) => b - a);
  return {year, years: list, coaches, totalCents: coaches.reduce((n, c) => n + c.paidCents, 0), noW9: coaches.filter(c => !c.w9).length};
}
// The year's totals as a spreadsheet for the accountant: one line per coach. No tax IDs: the site has none.
const csvCell = (v: unknown) => { const s = String(v ?? ''); const lead = /^[\s\ufeff]*[=+\-@]|^[\t\r]/.test(s); return /[",\n\r]/.test(s) || lead ? '"' + (lead ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
export function yearCsv(t: Awaited<ReturnType<typeof yearTotals>>) {
  const lines = [['Coach', 'Coach email', 'Year', 'Paid in the year', 'Payments', 'W-9 received'],
    ...t.coaches.map(c => [c.name, c.email, t.year, (c.paidCents / 100).toFixed(2), c.payments, c.w9 ? c.w9.receivedOn : 'Not on file']),
    ['Total', '', t.year, (t.totalCents / 100).toFixed(2), t.coaches.reduce((n, c) => n + c.payments, 0), '']];
  return lines.map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// Every coach's balance, the payments recorded (newest first, the latest 200) and the totals the dashboard shows.
export async function payroll(today = academyDay(new Date())) {
  const month = today.slice(0, 7);
  const [staff, approved, waiting, paid, list, inMonth] = await db().batch([
    db().prepare('SELECT lower(email) AS email,name,active FROM staff_access'),
    db().prepare('SELECT coach_email,max(coach_name) AS coach_name,sum(COALESCE(approved_cents,0)) AS cents FROM coach_time_entries WHERE approved_at IS NOT NULL AND voided_at IS NULL GROUP BY coach_email'),
    db().prepare(`SELECT ${ENTRY_COLUMNS} FROM coach_time_entries WHERE approved_at IS NULL AND voided_at IS NULL AND clock_out IS NOT NULL LIMIT 5001`),
    db().prepare('SELECT coach_email,max(coach_name) AS coach_name,sum(amount_cents) AS cents,count(*) AS n,max(paid_on) AS last FROM coach_payments GROUP BY coach_email'),
    db().prepare('SELECT id,coach_email,coach_name,paid_on,amount_cents,method,period_from,period_to,note,created_at FROM coach_payments ORDER BY paid_on DESC,created_at DESC,id LIMIT ?').bind(LISTED + 1),
    db().prepare('SELECT COALESCE(sum(amount_cents),0) AS cents,count(*) AS n FROM coach_payments WHERE paid_on>=? AND paid_on<=?').bind(month + '-01', month + '-31'),
  ]);
  const lessons = await coachPayReport(FIRST_DAY, today);
  const coaches = new Map<string, CoachBalance>();
  const coach = (email: string, name?: string | null) => {
    const key = String(email || '').toLowerCase();
    if (!coaches.has(key)) coaches.set(key, {email: key, name: name || key || 'Unknown coach', active: false, practiceCents: 0, lessonCents: 0, lessonShareSet: true, earnedCents: 0, paidCents: 0, owedCents: 0, aheadCents: 0, pendingCents: 0, payments: 0, lastPaidOn: null});
    return coaches.get(key)!;
  };
  // The name on Coaches wins; a coach who is no longer there keeps the name on their records.
  for (const s of staff.results as any[]) coach(s.email, s.name).active = !!s.active;
  for (const r of approved.results as any[]) coach(r.coach_email, r.coach_name).practiceCents = Number(r.cents) || 0;
  for (const e of waiting.results as Entry[]) coach(e.coach_email, e.coach_name).pendingCents += shiftAmount(e);
  if (!('error' in lessons)) for (const c of lessons.coaches) { const b = coach(c.coachEmail, c.coach); b.lessonCents = c.owedCents ?? 0; b.lessonShareSet = c.owedCents !== null; }
  for (const r of paid.results as any[]) { const b = coach(r.coach_email, r.coach_name); b.paidCents = Number(r.cents) || 0; b.payments = Number(r.n) || 0; b.lastPaidOn = r.last; }
  const rows = [...coaches.values()].map(b => {
    const earned = b.practiceCents + b.lessonCents, balance = earned - b.paidCents;
    return {...b, earnedCents: earned, owedCents: Math.max(0, balance), aheadCents: Math.max(0, -balance)};
  }).filter(b => b.active || b.earnedCents || b.paidCents || b.pendingCents || !b.lessonShareSet).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const sum = (f: (b: CoachBalance) => number) => rows.reduce((n, b) => n + f(b), 0);
  const payments = (list.results as Row[]).slice(0, LISTED).map(view), month0 = inMonth.results[0] as any;
  return {
    today, methods: Object.entries(PAY_METHODS).map(([value, label]) => ({value, label})), coaches: rows, payments, morePayments: list.results.length > LISTED,
    totals: {earnedCents: sum(b => b.earnedCents), paidCents: sum(b => b.paidCents), owedCents: sum(b => b.owedCents), aheadCents: sum(b => b.aheadCents), pendingCents: sum(b => b.pendingCents),
      paidThisMonthCents: Number(month0?.cents) || 0, paymentsThisMonth: Number(month0?.n) || 0, shareNotSet: rows.filter(b => !b.lessonShareSet).length},
  };
}

// The owner records a payment made to a coach. The amount is whatever was paid: the site never changes it.
export async function addPayment(ownerId: string, input: any, now = new Date()): Promise<Result> {
  const today = academyDay(now), email = typeof input?.coach === 'string' ? input.coach.trim().toLowerCase() : '';
  const known = (await payroll(today)).coaches.find(c => c.email === email);
  if (!email || !known) return fail(400, 'Choose the coach you paid.');
  if (!validDay(input.paidOn) || input.paidOn < FIRST_DAY || input.paidOn > today) return fail(400, 'Choose the date you paid. It cannot be in the future.');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > MAX_CENTS) return fail(400, 'Enter the amount you paid, between $0.01 and $1,000,000.00.');
  if (typeof input.method !== 'string' || !Object.hasOwn(PAY_METHODS, input.method)) return fail(400, 'Choose how you paid.');
  const from = input.periodFrom || null, to = input.periodTo || null;
  if ((from === null) !== (to === null)) return fail(400, 'Give both dates the payment covers, or leave both empty.');
  if (from !== null && (!validDay(from) || !validDay(to) || from < FIRST_DAY || to > LAST_DAY || from > to)) return fail(400, 'Choose the first and last day the payment covers.');
  const note = input.note === undefined || input.note === null ? '' : typeof input.note === 'string' && input.note.length <= 600 ? input.note.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : null;
  if (note === null || note.length > 300) return fail(400, 'Keep the note to 300 characters.');
  // The same payment sent twice (a double click, a page sent again) is recorded once.
  const again = await db().prepare('SELECT 1 FROM coach_payments WHERE coach_email=? AND paid_on=? AND amount_cents=? AND method=? AND created_at>? LIMIT 1')
    .bind(email, input.paidOn, input.amountCents, input.method, new Date(now.getTime() - 120000).toISOString()).first();
  if (again) return fail(409, 'That payment was just recorded. It is in the list below.');
  const row = {id: crypto.randomUUID(), coach_email: email, coach_name: known.name, paid_on: input.paidOn as string, amount_cents: input.amountCents as number, method: input.method as string, period_from: from, period_to: to, note, created_at: now.toISOString()};
  await db().batch([
    db().prepare('INSERT INTO coach_payments(id,coach_email,coach_name,paid_on,amount_cents,method,period_from,period_to,note,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(row.id, row.coach_email, row.coach_name, row.paid_on, row.amount_cents, row.method, row.period_from, row.period_to, row.note, row.created_at, ownerId),
    audit(ownerId, 'coach_payment_recorded', words(row)),
  ]);
  return {status: 200, payment: view(row)};
}

// A payment entered by mistake is deleted, and the coach's balance goes back to what it was.
export async function deletePayment(ownerId: string, input: any): Promise<Result> {
  if (!validId(input?.id)) return fail(400, 'Invalid request.');
  const gone = await db().prepare('DELETE FROM coach_payments WHERE id=? RETURNING coach_email,amount_cents,paid_on,method,period_from,period_to').bind(input.id).first<Row>();
  if (!gone) return fail(404, 'That payment is no longer in the list. Refresh the page.');
  await audit(ownerId, 'coach_payment_deleted', words(gone)).run();
  return {status: 200};
}

// Payments between two dates, as the books read them (lib/financials.ts).
export const paymentsBetweenSql = 'SELECT id,coach_name,paid_on,amount_cents,method,period_from,period_to,note FROM coach_payments WHERE paid_on>=? AND paid_on<=?';
