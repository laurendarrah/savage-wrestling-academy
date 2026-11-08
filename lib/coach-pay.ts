// Coach pay report (issues #75, #177): paid lessons taught in a period, per coach, at the owner's split.
// Based on what each family actually paid for their own wrestler (online or recorded offline), summed per wrestler, so
// a partner or small-group lesson counts once as a lesson and once per wrestler in it. Refunded and voided are excluded.
// A partial card refund (issue #272) comes off the lesson before the split: the coach's share is of what the academy
// kept, and the line says how much went back (lib/card-refunds.ts, the same figure Payments shows).
import {env} from 'cloudflare:workers';
import {lessonSettings} from './lessons';
import {refundedByOrder, type RefundRow} from './card-refunds';

export type PayLine = {orderId: string; date: string; start: string; wrestler: string; format: string; paidCents: number; refundedCents: number; netCents: number; source: string};
// grossCents is what the academy kept for the coach's lessons: paid minus refunded. refundedCents is the part that went back.
export type CoachPay = {coachEmail: string; coach: string; lessons: number; wrestlers: number; grossCents: number; refundedCents: number; splitPct: number | null; owedCents: number | null; academyCents: number | null; lines: PayLine[]};

const validDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;

export async function coachPayReport(from: unknown, to: unknown) {
  if (!validDate(from) || !validDate(to) || from > to) return {error: 'Choose a start and end date.'} as const;
  const settings = await lessonSettings();
  const rows = (await env.DB!.prepare(
    `SELECT o.id,o.item_id,o.dates,o.wrestler_name,o.amount_cents,o.pricing,o.source,s.name AS staffName FROM orders o
     LEFT JOIN staff_access s ON s.email=json_extract(o.pricing,'$.coachEmail')
     WHERE o.kind='lesson' AND o.status='paid' AND json_extract(o.dates,'$[0]')>=? AND json_extract(o.dates,'$[0]')<=?
     ORDER BY json_extract(o.dates,'$[0]'),json_extract(o.pricing,'$.start')`
  ).bind(from, to).all<any>()).results;
  // Partial refunds of these lessons, as Stripe's running total per card payment (issue #42).
  const refunds = rows.length ? (await env.DB!.prepare('SELECT id,order_id,payment_intent,amount_cents,refunded_cents,refunded_at FROM payment_refunds WHERE order_id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(rows.map(r => r.id))).all<RefundRow>()).results : [];
  const refunded = refundedByOrder(refunds);
  const byCoach = new Map<string, CoachPay>(), seen = new Set<string>();
  for (const r of rows) {
    const p = JSON.parse(r.pricing || '{}'), email = String(p.coachEmail || '').toLowerCase();
    if (!byCoach.has(email)) {
      const split = settings.splits[email] ?? settings.defaultSplit;
      byCoach.set(email, {coachEmail: email, coach: r.staffName || p.coachName || email || 'Unknown coach', lessons: 0, wrestlers: 0, grossCents: 0, refundedCents: 0, splitPct: split ?? null, owedCents: null, academyCents: null, lines: []});
    }
    const c = byCoach.get(email)!;
    const lesson = r.item_id + '|' + JSON.parse(r.dates)[0];
    if (!seen.has(lesson)) { seen.add(lesson); c.lessons++; }
    const back = Math.min(r.amount_cents, refunded.get(r.id)?.cents ?? 0), net = r.amount_cents - back;
    c.wrestlers++; c.grossCents += net; c.refundedCents += back;
    c.lines.push({orderId: r.id, date: JSON.parse(r.dates)[0], start: p.start || '', wrestler: r.wrestler_name, format: p.formatName || p.format || '', paidCents: r.amount_cents, refundedCents: back, netCents: net, source: r.source});
  }
  const coaches = [...byCoach.values()].map(c => {
    // Each lesson is rounded to the cent, as in the CSV, so the report and the export always agree;
    // the coach and academy shares of every lesson add up to what the academy kept.
    const owed = c.splitPct === null ? null : c.lines.reduce((n, l) => n + lineOwed(l, c.splitPct!), 0);
    return {...c, owedCents: owed, academyCents: owed === null ? null : c.grossCents - owed};
  }).sort((a, b) => a.coach.localeCompare(b.coach));
  const sum = (f: (c: CoachPay) => number | null) => coaches.reduce((n, c) => n + (f(c) ?? 0), 0);
  return {from, to, coaches, totals: {lessons: sum(c => c.lessons), wrestlers: sum(c => c.wrestlers), grossCents: sum(c => c.grossCents), refundedCents: sum(c => c.refundedCents),
    owedCents: sum(c => c.owedCents), academyCents: sum(c => c.academyCents), unsetCoaches: coaches.filter(c => c.splitPct === null).length}};
}
// The coach's share of one lesson line: the split of what the academy kept after any refund, to the cent.
export const lineOwed = (l: Pick<PayLine, 'netCents'>, splitPct: number) => Math.round(l.netCents * splitPct / 100);

const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
export function coachPayCsv(coaches: CoachPay[]) {
  const money = (c: number | null) => c === null ? '' : (c / 100).toFixed(2);
  const head = ['Coach', 'Coach email', 'Lesson date', 'Start', 'Wrestler', 'Lesson type', 'Paid via', 'Paid', 'Refunded', 'Kept', 'Coach share %', 'Coach owed', 'Academy'];
  const lines = coaches.flatMap(c => c.lines.map(l => {
    const owed = c.splitPct === null ? null : lineOwed(l, c.splitPct);
    return [c.coach, c.coachEmail, l.date, l.start, l.wrestler, l.format, l.source === 'offline' ? 'Offline' : 'Online', money(l.paidCents), l.refundedCents ? money(l.refundedCents) : '', money(l.netCents),
      c.splitPct ?? '', money(owed), money(owed === null ? null : l.netCents - owed)].map(csvCell).join(',');
  }));
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}
