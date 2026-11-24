// A coach's pay archive (issue #401; Justin's decision on #246, Nov 23, 2026): everything the academy keeps for good
// about what it paid a coach, under the coach's real name, for 1099s and audits. The owner opens it from Coaches, for a
// coach removed for good (or any coach). Owner only (app/api/staff/route.ts). Read only: nothing here changes a record.
//
// Approved practice pay (coach_time_entries), the coach's share of private lessons families paid for (lib/coach-pay.ts),
// cash they collected at the door (orders), payments the academy made to them (coach_payments), their W-9 status
// (coach_w9) and their signed coach contract, with any copy the owner asked them to sign again (waiver_signatures).
import {env} from 'cloudflare:workers';
import {academyDay} from './datetime';
import {coachPayReport} from './coach-pay';

const db = () => env.DB!;
const FIRST_DAY = '2020-01-01', LISTED = 200;
type Year = {year: string; practiceCents: number; lessonCents: number; paidCents: number};

export async function coachArchive(emailInput: unknown, today = academyDay(new Date())) {
  const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return {status: 400, error: 'Choose a coach.'};
  const [shifts, payments, cash, w9, contracts, who] = await db().batch([
    db().prepare(`SELECT substr(work_date,1,4) AS y,count(*) AS n,sum(COALESCE(approved_minutes,0)) AS minutes,sum(COALESCE(approved_cents,0)) AS cents,min(work_date) AS first,max(work_date) AS last
      FROM coach_time_entries WHERE lower(coach_email)=? AND approved_at IS NOT NULL AND voided_at IS NULL GROUP BY y ORDER BY y`).bind(email),
    db().prepare('SELECT id,paid_on,amount_cents,method,period_from,period_to,note FROM coach_payments WHERE lower(coach_email)=? ORDER BY paid_on DESC,created_at DESC,id LIMIT ?').bind(email, LISTED + 1),
    db().prepare(`SELECT count(*) AS n,COALESCE(sum(amount_cents),0) AS cents FROM orders WHERE source='offline' AND status='paid' AND lower(json_extract(pricing,'$.collectedByEmail'))=?`).bind(email),
    db().prepare('SELECT received_on FROM coach_w9 WHERE lower(email)=?').bind(email),
    db().prepare(`SELECT s.id,s.signer,s.signed_at,v.title,r.reissued_at,r.reason FROM waiver_signatures s JOIN waiver_versions v ON v.id=s.version_id
      LEFT JOIN signature_reissues r ON r.signature_id=s.id WHERE v.kind='coach_contract' AND lower(s.email)=? ORDER BY s.signed_at DESC`).bind(email),
    db().prepare(`SELECT name FROM (SELECT name,1 AS o FROM removed_coaches WHERE lower(email)=? UNION ALL SELECT name,2 FROM staff_access WHERE lower(email)=?
      UNION ALL SELECT max(coach_name),3 FROM coach_payments WHERE lower(coach_email)=? UNION ALL SELECT max(coach_name),4 FROM coach_time_entries WHERE lower(coach_email)=?) WHERE name IS NOT NULL ORDER BY o LIMIT 1`).bind(email, email, email, email),
  ]);
  // Every payment's total and per year (not only the latest 200 listed).
  const paidByYear = (await db().prepare('SELECT substr(paid_on,1,4) AS y,count(*) AS n,sum(amount_cents) AS cents FROM coach_payments WHERE lower(coach_email)=? GROUP BY y').bind(email).all<{y: string; n: number; cents: number}>()).results;
  // Lesson shares by the year the lesson was taught, up to today.
  const report = await coachPayReport(FIRST_DAY, today), mine = 'error' in report ? undefined : report.coaches.find(c => c.coachEmail === email);
  const years = new Map<string, Year>();
  const year = (y: string) => { if (!years.has(y)) years.set(y, {year: y, practiceCents: 0, lessonCents: 0, paidCents: 0}); return years.get(y)!; };
  for (const r of shifts.results as any[]) year(r.y).practiceCents += Number(r.cents) || 0;
  for (const r of paidByYear) year(r.y).paidCents += Number(r.cents) || 0;
  if (mine && mine.splitPct !== null) {
    // The share is worked out on each year's lessons, as the pay report does for a period.
    const byYear = new Map<string, number>();
    for (const l of mine.lines) byYear.set(l.date.slice(0, 4), (byYear.get(l.date.slice(0, 4)) ?? 0) + l.netCents);
    for (const [y, net] of byYear) year(y).lessonCents += Math.round(net * mine.splitPct / 100);
  }
  const sum = (list: any[], k: string) => list.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  const practice = shifts.results as any[], listed = payments.results as any[], c0 = (cash.results[0] ?? {}) as any;
  return {
    status: 200, email, name: (who.results[0] as any)?.name ?? email,
    practice: {shifts: sum(practice, 'n'), minutes: sum(practice, 'minutes'), cents: sum(practice, 'cents'), first: practice[0]?.first ?? null, last: practice.at(-1)?.last ?? null},
    lessons: mine ? {lessons: mine.lessons, grossCents: mine.grossCents, splitPct: mine.splitPct, owedCents: mine.owedCents} : null,
    cash: {payments: Number(c0.n) || 0, cents: Number(c0.cents) || 0},
    paid: {payments: sum(paidByYear, 'n'), cents: sum(paidByYear, 'cents'), list: listed.slice(0, LISTED).map(r => ({id: r.id, paidOn: r.paid_on, amountCents: r.amount_cents, method: r.method, periodFrom: r.period_from, periodTo: r.period_to, note: r.note})), more: listed.length > LISTED},
    w9: (w9.results[0] as any)?.received_on ? {receivedOn: (w9.results[0] as any).received_on} : null,
    contracts: (contracts.results as any[]).map(r => ({id: r.id, title: r.title, signer: r.signer, signedAt: r.signed_at, replaced: r.reissued_at ? {at: r.reissued_at, reason: r.reason} : null})),
    years: [...years.values()].sort((a, b) => b.year.localeCompare(a.year)),
  };
}
