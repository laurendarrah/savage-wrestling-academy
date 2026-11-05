// Coach pay report (issue #75): paid lessons taught in a period, per coach, at the owner's split.
// Based on what the family actually paid (online or recorded offline). Refunded and voided lessons are excluded.
import {env} from 'cloudflare:workers';
import {lessonSettings} from './lessons';

export type PayLine = {orderId: string; date: string; start: string; wrestler: string; format: string; paidCents: number; source: string};
export type CoachPay = {coachEmail: string; coach: string; lessons: number; grossCents: number; splitPct: number | null; owedCents: number | null; academyCents: number | null; lines: PayLine[]};

const validDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;

export async function coachPayReport(from: unknown, to: unknown) {
  if (!validDate(from) || !validDate(to) || from > to) return {error: 'Choose a start and end date.'} as const;
  const settings = await lessonSettings();
  const rows = (await env.DB!.prepare(
    `SELECT o.id,o.dates,o.wrestler_name,o.amount_cents,o.pricing,o.source,s.name AS staffName FROM orders o
     LEFT JOIN staff_access s ON s.email=json_extract(o.pricing,'$.coachEmail')
     WHERE o.kind='lesson' AND o.status='paid' AND json_extract(o.dates,'$[0]')>=? AND json_extract(o.dates,'$[0]')<=?
     ORDER BY json_extract(o.dates,'$[0]'),json_extract(o.pricing,'$.start')`
  ).bind(from, to).all<any>()).results;
  const byCoach = new Map<string, CoachPay>();
  for (const r of rows) {
    const p = JSON.parse(r.pricing || '{}'), email = String(p.coachEmail || '').toLowerCase();
    if (!byCoach.has(email)) {
      const split = settings.splits[email] ?? settings.defaultSplit;
      byCoach.set(email, {coachEmail: email, coach: r.staffName || p.coachName || email || 'Unknown coach', lessons: 0, grossCents: 0, splitPct: split ?? null, owedCents: null, academyCents: null, lines: []});
    }
    const c = byCoach.get(email)!;
    c.lessons++; c.grossCents += r.amount_cents;
    c.lines.push({orderId: r.id, date: JSON.parse(r.dates)[0], start: p.start || '', wrestler: r.wrestler_name, format: p.formatName || p.format || '', paidCents: r.amount_cents, source: r.source});
  }
  const coaches = [...byCoach.values()].map(c => {
    // Each lesson is rounded to the cent, as in the CSV, so the report and the export always agree;
    // the coach and academy shares of every lesson add up to what was paid.
    const owed = c.splitPct === null ? null : c.lines.reduce((n, l) => n + Math.round(l.paidCents * c.splitPct! / 100), 0);
    return {...c, owedCents: owed, academyCents: owed === null ? null : c.grossCents - owed};
  }).sort((a, b) => a.coach.localeCompare(b.coach));
  const sum = (f: (c: CoachPay) => number | null) => coaches.reduce((n, c) => n + (f(c) ?? 0), 0);
  return {from, to, coaches, totals: {lessons: sum(c => c.lessons), grossCents: sum(c => c.grossCents), owedCents: sum(c => c.owedCents), academyCents: sum(c => c.academyCents), unsetCoaches: coaches.filter(c => c.splitPct === null).length}};
}

const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
export function coachPayCsv(coaches: CoachPay[]) {
  const money = (c: number | null) => c === null ? '' : (c / 100).toFixed(2);
  const head = ['Coach', 'Coach email', 'Lesson date', 'Start', 'Wrestler', 'Lesson type', 'Paid via', 'Paid', 'Coach share %', 'Coach owed', 'Academy'];
  const lines = coaches.flatMap(c => c.lines.map(l => {
    const owed = c.splitPct === null ? null : Math.round(l.paidCents * c.splitPct / 100);
    return [c.coach, c.coachEmail, l.date, l.start, l.wrestler, l.format, l.source === 'offline' ? 'Offline' : 'Online', money(l.paidCents), c.splitPct ?? '', money(owed), money(owed === null ? null : l.paidCents - owed)].map(csvCell).join(',');
  }));
  return [head.join(','), ...lines].join('\r\n') + '\r\n';
}
