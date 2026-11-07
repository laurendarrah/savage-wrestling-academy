// Coach timesheets (issue #193): the rules, with no database. Rates, paid time, flags, the month rules and the CSV.
// Justin's decisions on #197:
//   Q1  practices pay a flat rate per hour by the role the coach worked: head coach $40, assistant $30.
//   Q4  pay covers only the scheduled practice time. No prep or cleanup allowance. Punches far outside the practice are
//       flagged for the owner, never paid automatically.
//   Q5  coaches are paid monthly and submit the whole month on or after its last day (academy time).
//   Q6  employee or contractor is NOT decided, so nothing here works out overtime or withholding, and the file says
//       "hours" and "amount" only.
// Lesson pay stays on /coach-pay (lib/coach-pay.ts), from what families paid; the CSV adds each coach's lesson share.
// All amounts are integer cents. Times are instants (ISO strings) shown in academy time (America/New_York).
import {ACADEMY_TIME_ZONE, academyDay, clockTime, dayDate} from './datetime';

// The one place the practice rates live, in cents per hour.
export const PRACTICE_RATES = {head: 4000, assistant: 3000} as const;
export type Duty = keyof typeof PRACTICE_RATES;
export const DUTY_LABEL: Record<Duty, string> = {head: 'Head coach', assistant: 'Assistant coach'};
export const isDuty = (d: unknown): d is Duty => d === 'head' || d === 'assistant';
// How far outside the practice a punch can be before it is flagged for the owner (flag only, never pay).
export const FLAG_MINUTES = 15;
const MINUTE = 60000;

export type Entry = {
  id: string; user_id: string; coach_email: string; coach_name: string; work_date: string;
  session_key: string | null; session_title: string | null; session_start: string | null; session_end: string | null;
  duty: string; source: string; clock_in: string; clock_out: string | null; fixed_in: string | null; fixed_out: string | null; coach_note: string | null;
  submitted_at: string | null; owner_minutes: number | null; owner_duty: string | null; owner_note: string | null;
  approved_at: string | null; approved_by: string | null; approved_minutes: number | null; approved_duty: string | null; approved_rate_cents: number | null; approved_cents: number | null;
  voided_at: string | null; voided_by: string | null; void_reason: string | null; history: string; revision: number; created_at: string;
};
export const ENTRY_COLUMNS = 'id,user_id,coach_email,coach_name,work_date,session_key,session_title,session_start,session_end,duty,source,clock_in,clock_out,fixed_in,fixed_out,coach_note,submitted_at,owner_minutes,owner_duty,owner_note,approved_at,approved_by,approved_minutes,approved_duty,approved_rate_cents,approved_cents,voided_at,voided_by,void_reason,history,revision,created_at';
// A practice or extra practice a shift can be tied to (lib/roster.ts sessionsOn gives them for a date).
export type Session = {key: string; type: string; title: string; program: string | null; date: string; start: string | null; end: string | null};
export type TimeOff = {start_date: string; end_date: string};

// ---------- Dates and times ----------
const validDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;
export const validClock = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
export const validMonth = (m: unknown): m is string => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && +m.slice(0, 4) >= 2020 && +m.slice(0, 4) <= 2100;
export {validDay};
const wall = new Intl.DateTimeFormat('en-US', {timeZone: ACADEMY_TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});
// Minutes the academy's wall clock is ahead of UTC at an instant (-240 in summer, -300 in winter).
function offsetAt(ms: number) {
  const p = Object.fromEntries(wall.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / MINUTE) * MINUTE) / MINUTE;
}
// "2026-11-07", "18:00" in academy time -> the instant, in milliseconds. Daylight saving is handled by asking twice.
export function academyInstant(ymd: string, hhmm: string) {
  const base = Date.parse(`${ymd}T${hhmm}:00Z`);
  let t = base - offsetAt(base) * MINUTE;
  t = base - offsetAt(t) * MINUTE;
  return t;
}
// An instant -> "HH:MM" on the academy's clock.
export function academyClock(at: string | number) {
  const p = Object.fromEntries(wall.formatToParts(new Date(at)).map(x => [x.type, x.value]));
  return `${p.hour}:${p.minute}`;
}
export const monthOf = (ymd: string) => ymd.slice(0, 7);
export function lastDayOf(month: string) {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
export function addMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
// Q5: a month can be submitted on or after its last day, in academy time.
export const canSubmitMonth = (month: string, today: string) => today >= lastDayOf(month);
// Shifts can be added by hand for the current month and the one before (a coach who forgot to clock in), up to today.
export const handDateAllowed = (date: string, today: string) => validDay(date) && date <= today && monthOf(date) >= addMonths(monthOf(today), -1);
export const monthLabel = (month: string) => new Date(month + '-15T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'long', year: 'numeric'});

// ---------- Paid time ----------
export function workedRange(e: Entry) {
  const start = Date.parse(e.fixed_in ?? e.clock_in), outAt = e.fixed_out ?? e.clock_out;
  return {start, end: outAt ? Date.parse(outAt) : null};
}
export function practiceRange(e: Entry) {
  return e.session_key && validClock(e.session_start) && validClock(e.session_end)
    ? {start: academyInstant(e.work_date, e.session_start), end: academyInstant(e.work_date, e.session_end)} : null;
}
// Q4: the paid time is the part of the shift inside the scheduled practice, in whole minutes. Time before or after the
// practice is never paid automatically, and a shift with no practice pays nothing until the owner sets its paid time.
export function scheduledMinutes(e: Entry) {
  const w = workedRange(e), p = practiceRange(e);
  if (!p || w.end === null) return 0;
  return Math.max(0, Math.floor((Math.min(w.end, p.end) - Math.max(w.start, p.start)) / MINUTE));
}
export const dutyOf = (e: Entry): Duty => (isDuty(e.approved_duty) ? e.approved_duty : isDuty(e.owner_duty) ? e.owner_duty : isDuty(e.duty) ? e.duty : 'assistant');
export function paidMinutes(e: Entry) {
  if (e.voided_at) return 0;
  if (e.approved_at && e.approved_minutes !== null) return e.approved_minutes;
  return e.owner_minutes ?? scheduledMinutes(e);
}
export const amountCents = (minutes: number, rateCents: number) => Math.round(minutes * rateCents / 60);
export function shiftAmount(e: Entry) {
  if (e.voided_at) return 0;
  if (e.approved_at && e.approved_cents !== null) return e.approved_cents;
  return amountCents(paidMinutes(e), PRACTICE_RATES[dutyOf(e)]);
}
export const rateOf = (e: Entry) => e.approved_at && e.approved_rate_cents !== null ? e.approved_rate_cents : PRACTICE_RATES[dutyOf(e)];
export function statusOf(e: Entry): 'voided' | 'open' | 'draft' | 'submitted' | 'approved' {
  if (e.voided_at) return 'voided';
  if (e.approved_at) return 'approved';
  if (!e.clock_out) return 'open';
  return e.submitted_at ? 'submitted' : 'draft';
}
// Every duration a coach or the owner reads: "3 h 44 min", "2 h", "45 min", never "224 min" (issue #223). The pages
// use the same rule from public/hours-text.js.
export function hoursText(minutes: number) {
  const total = Math.max(0, Math.floor(Number(minutes) || 0)), h = Math.floor(total / 60), m = total % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}
export const money = (cents: number) => '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ---------- Flags for the owner ----------
// Each flag is a plain sentence. Flags never change pay; the owner decides whether to correct anything.
export function shiftFlags(e: Entry, ctx: {sessions?: Session[]; timeOff?: TimeOff[]} = {}) {
  const flags: string[] = [];
  if (e.voided_at) return flags;
  const w = workedRange(e), p = practiceRange(e), mins = (ms: number) => Math.round(ms / MINUTE);
  if (w.end === null) flags.push('Still clocked in: no clock-out yet.');
  if (e.source === 'hand') flags.push('Added by hand, not clocked' + (e.coach_note ? ': ' + e.coach_note : '.'));
  else if (e.fixed_in || e.fixed_out) flags.push(`Times changed by the coach (clocked ${clockTime(academyClock(e.clock_in))}–${e.clock_out ? clockTime(academyClock(e.clock_out)) : 'no clock-out'})` + (e.coach_note ? ': ' + e.coach_note : '.'));
  if (!p) flags.push('No scheduled practice, so no time is paid unless the owner sets it.');
  else {
    const name = e.session_title || 'the practice';
    if (p.start - w.start > FLAG_MINUTES * MINUTE) flags.push(`Clocked in ${hoursText(mins(p.start - w.start))} before ${name} started.`);
    if (w.start - p.start > FLAG_MINUTES * MINUTE) flags.push(`Clocked in ${hoursText(mins(w.start - p.start))} after ${name} started.`);
    if (w.end !== null) {
      if (p.end - w.end > FLAG_MINUTES * MINUTE) flags.push(`Clocked out ${hoursText(mins(p.end - w.end))} before ${name} ended.`);
      if (w.end - p.end > FLAG_MINUTES * MINUTE) flags.push(`Clocked out ${hoursText(mins(w.end - p.end))} after ${name} ended.`);
      const extra = mins((w.end - w.start) - (p.end - p.start));
      // Longer than the practice plus both 15-minute windows: time that is clearly not paid.
      if (extra > 2 * FLAG_MINUTES) flags.push(`Clocked ${hoursText(mins(w.end - w.start))}, ${hoursText(extra)} longer than the practice. Only the practice time is paid.`);
      // Back to back: the shift runs into another practice that starts soon after this one ends.
      const next = (ctx.sessions ?? []).filter(s => s.key !== e.session_key && s.date === e.work_date && validClock(s.start))
        .map(s => ({s, at: academyInstant(s.date, s.start!)})).filter(x => x.at >= p.end && x.at - p.end <= FLAG_MINUTES * MINUTE && w.end! > x.at)
        .sort((a, b) => a.at - b.at)[0];
      if (next) flags.push(`Ran into ${next.s.title} at ${clockTime(next.s.start)}. Only ${name} is paid on this shift; clock in separately for each practice.`);
    }
  }
  if ((ctx.timeOff ?? []).some(t => t.start_date <= e.work_date && t.end_date >= e.work_date)) flags.push('This day is in the coach’s approved time off.');
  return flags;
}

// ---------- Views ----------
const history = (e: Entry) => { try { const h = JSON.parse(e.history); return Array.isArray(h) ? h : []; } catch { return []; } };
export function shiftView(e: Entry, ctx: {sessions?: Session[]; timeOff?: TimeOff[]} = {}) {
  const w = workedRange(e), minutes = paidMinutes(e), duty = dutyOf(e);
  return {
    id: e.id, revision: e.revision, coachEmail: e.coach_email, coachName: e.coach_name, date: e.work_date, dateText: dayDate(e.work_date),
    session: e.session_key ? {key: e.session_key, title: e.session_title, start: e.session_start, end: e.session_end} : null,
    duty, dutyLabel: DUTY_LABEL[duty], source: e.source,
    clockIn: e.clock_in, clockOut: e.clock_out, inTime: academyClock(w.start), outTime: w.end === null ? null : academyClock(w.end),
    clockedMinutes: w.end === null ? null : Math.max(0, Math.round((w.end - w.start) / MINUTE)), scheduledMinutes: scheduledMinutes(e),
    paidMinutes: minutes, rateCents: rateOf(e), amountCents: shiftAmount(e),
    ownerSet: e.owner_minutes !== null || e.owner_duty !== null ? {minutes: e.owner_minutes, duty: e.owner_duty, note: e.owner_note} : null,
    coachNote: e.coach_note, status: statusOf(e), submittedAt: e.submitted_at, approvedAt: e.approved_at,
    voidedAt: e.voided_at, voidReason: e.void_reason, flags: shiftFlags(e, ctx), history: history(e)
  };
}
export type ShiftView = ReturnType<typeof shiftView>;
const PROGRAM_NAMES: Record<string, string> = {Elementary: 'SWA Development', Intermediate: 'SWA Intermediate', Advanced: 'SWA Advance'};
// Totals for a set of shifts, with a breakdown by program (or extra practice) and role.
export function totals(views: ShiftView[]) {
  const live = views.filter(v => v.status !== 'voided');
  const groups = new Map<string, {label: string; duty: string; minutes: number; amountCents: number; shifts: number}>();
  for (const v of live) {
    const program = v.session?.key.startsWith('practice:') ? v.session.key.split(':')[1] : null;
    const label = program ? PROGRAM_NAMES[program] ?? program : v.session ? v.session.title ?? 'Extra practice' : 'No scheduled practice';
    const k = label + '|' + v.duty, g = groups.get(k) ?? {label, duty: v.dutyLabel, minutes: 0, amountCents: 0, shifts: 0};
    g.minutes += v.paidMinutes; g.amountCents += v.amountCents; g.shifts++; groups.set(k, g);
  }
  return {
    shifts: live.length, minutes: live.reduce((n, v) => n + v.paidMinutes, 0), amountCents: live.reduce((n, v) => n + v.amountCents, 0),
    open: live.filter(v => v.status === 'open').length, drafts: live.filter(v => v.status === 'draft').length,
    submitted: live.filter(v => v.status === 'submitted').length, approved: live.filter(v => v.status === 'approved').length,
    flagged: live.filter(v => v.flags.length).length,
    breakdown: [...groups.values()].sort((a, b) => a.label.localeCompare(b.label) || a.duty.localeCompare(b.duty))
  };
}
// Where a coach's month stands.
export function monthState(t: ReturnType<typeof totals>) {
  if (!t.shifts) return 'empty';
  if (t.open || t.drafts) return 'not-submitted';
  if (t.submitted) return 'submitted';
  return 'approved';
}

// ---------- The month's file ----------
// One line per approved practice shift, one line per coach for their private lesson share (from lib/coach-pay.ts), and
// a total per coach. Hours and amounts only: no overtime, no withholding, no employment wording (#197 Q6 is open).
const csvCell = (v: unknown) => { const s = String(v ?? ''); const lead = /^[\s﻿]*[=+\-@]|^[\t\r]/.test(s); return /[",\n\r]/.test(s) || lead ? '"' + (lead ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
const dollars = (c: number) => (c / 100).toFixed(2);
export type PayrollCoach = {email: string; name: string; shifts: ShiftView[]; notApproved: number; lessons: {lessons: number; grossCents: number; splitPct: number | null; owedCents: number | null} | null};
export function payrollCsv(month: string, coaches: PayrollCoach[]) {
  const head = ['Coach', 'Coach email', 'Month', 'Line', 'Date', 'Program or lesson', 'Role', 'Hours', 'Rate', 'Amount', 'Note'];
  const lines: unknown[][] = [];
  for (const c of [...coaches].sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email))) {
    let total = 0;
    for (const s of c.shifts.filter(v => v.status === 'approved').sort((a, b) => a.date.localeCompare(b.date) || a.clockIn.localeCompare(b.clockIn))) {
      total += s.amountCents;
      lines.push([c.name, c.email, month, 'Practice', s.date, s.session?.title ?? 'No scheduled practice', s.dutyLabel, (s.paidMinutes / 60).toFixed(2), dollars(s.rateCents) + ' per hour', dollars(s.amountCents), s.ownerSet?.note ?? '']);
    }
    if (c.lessons && c.lessons.lessons) {
      const owed = c.lessons.owedCents;
      if (owed !== null) total += owed;
      lines.push([c.name, c.email, month, 'Private lessons', '', `${c.lessons.lessons} lesson${c.lessons.lessons === 1 ? '' : 's'}, ${dollars(c.lessons.grossCents)} paid by families`, '', '',
        c.lessons.splitPct === null ? '' : c.lessons.splitPct + '% share', owed === null ? '' : dollars(owed), owed === null ? 'No lesson share set on lesson settings' : 'From the coach pay report']);
    }
    lines.push([c.name, c.email, month, 'Total', '', '', '', (c.shifts.filter(v => v.status === 'approved').reduce((n, v) => n + v.paidMinutes, 0) / 60).toFixed(2), '', dollars(total),
      c.notApproved ? `${c.notApproved} practice shift${c.notApproved === 1 ? ' is' : 's are'} not approved yet and not included` : '']);
  }
  return [head, ...lines].map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export {academyDay};
