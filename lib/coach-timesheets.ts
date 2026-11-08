// Coach timesheets (issue #193): clocking in and out, the coach's own month, the owner's review and the month's file.
// The rules (rates, paid time, flags) are in lib/coach-time.ts. Every change bumps the shift's revision, so a stale page
// cannot overwrite a newer change, and is written to the shift's history and the security log.
import {env} from 'cloudflare:workers';
import {academyDay, fullDate} from './datetime';
import {academyState, sessionsOn} from './roster';
import {coachPayReport} from './coach-pay';
import {
  ENTRY_COLUMNS, PRACTICE_RATES, DUTY_LABEL, academyClock, academyInstant, addMonths, amountCents, canSubmitMonth, dutyOf, handDateAllowed, hoursText,
  isDuty, lastDayOf, monthLabel, monthOf, monthState, payrollCsv, scheduledMinutes, shiftView, totals, validClock, validDay, validMonth,
  type Entry, type Session, type TimeOff, type ShiftView
} from './coach-time';

export type Coach = {email: string; name: string; programs: string[]; owner?: boolean};
type Result = {status: number; error?: string; [k: string]: unknown};
const db = () => env.DB!;
const fail = (status: number, error: string): Result => ({status, error});
const ok = (extra: Record<string, unknown> = {}): Result => ({status: 200, ...extra});
const note = (v: unknown) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
const validId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
const validRevision = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;
const step = (by: string, action: string, extra: Record<string, unknown> = {}) => JSON.stringify({at: new Date().toISOString(), by, action, ...extra});
const audit = (actor: string, action: string, target: string) =>
  db().prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), actor, action, target.slice(0, 500), new Date().toISOString());

// ---------- Practices ----------
// What a coach can clock in for on a date: their programs' practices and every extra practice (Friday Night Live and
// the like). Camps and events are not practices; a coach working one clocks in without a practice and the owner sets
// the paid time.
export function choicesOn(state: any, date: string, programs: string[]): Session[] {
  return sessionsOn(state, date).filter(s => validClock(s.start) && validClock(s.end) && (s.type === 'practice' ? programs.includes(s.program!) : s.type === 'live'));
}
// The practice to offer first: the one running now (or starting within the hour), else the next today, else the last.
export function suggestedChoice(choices: Session[], nowMs: number) {
  const spans = choices.map(s => ({key: s.key, start: academyInstant(s.date, s.start!), end: academyInstant(s.date, s.end!)}));
  const running = spans.find(s => nowMs >= s.start - 3600000 && nowMs <= s.end);
  const next = spans.filter(s => s.start > nowMs).sort((a, b) => a.start - b.start)[0];
  const last = spans.filter(s => s.end < nowMs).sort((a, b) => b.end - a.end)[0];
  return (running ?? next ?? last)?.key ?? null;
}
function sessionsFor(state: any, dates: string[]) {
  const all: Session[] = [];
  for (const d of [...new Set(dates)]) all.push(...sessionsOn(state, d));
  return all;
}

// ---------- Reading ----------
async function entries(where: string, ...args: unknown[]) {
  return (await db().prepare(`SELECT ${ENTRY_COLUMNS} FROM coach_time_entries WHERE ${where} ORDER BY work_date,clock_in,id LIMIT 3001`).bind(...args).all<Entry>()).results;
}
async function approvedTimeOff(email: string | null, from: string, to: string) {
  const sql = `SELECT id,coach_email,coach_name,start_date,end_date FROM coach_time_off WHERE status='approved' AND start_date<=? AND end_date>=?${email ? ' AND coach_email=?' : ''} ORDER BY start_date`;
  return (await db().prepare(sql).bind(to, from, ...(email ? [email] : [])).all<TimeOff & {id: string; coach_email: string; coach_name: string}>()).results;
}
const timeOffView = (t: TimeOff & {id: string}) => ({id: t.id, start: t.start_date, end: t.end_date, text: t.start_date === t.end_date ? fullDate(t.start_date) : `${fullDate(t.start_date)} to ${fullDate(t.end_date)}`});

// The coach's month, their open shift, what they can clock in for today, and their team notices.
export async function coachMonth(coach: Coach, monthInput: unknown, now = new Date()) {
  const today = academyDay(now), month = validMonth(monthInput) ? monthInput : monthOf(today), from = month + '-01', to = lastDayOf(month);
  const state = await academyState();
  const rows = await entries('coach_email=? AND work_date BETWEEN ? AND ?', coach.email, from, to);
  const off = await approvedTimeOff(coach.email, from, to);
  const sessions = sessionsFor(state, rows.map(r => r.work_date));
  const views = rows.map(r => shiftView(r, {sessions, timeOff: off}));
  const open = (await entries('coach_email=? AND clock_out IS NULL AND voided_at IS NULL', coach.email))[0] ?? null;
  const last = await db().prepare('SELECT duty FROM coach_time_entries WHERE coach_email=? ORDER BY created_at DESC LIMIT 1').bind(coach.email).first<{duty: string}>();
  const choices = choicesOn(state, today, coach.programs);
  const t = totals(views);
  return {
    month, monthLabel: monthLabel(month), today, previous: addMonths(month, -1), next: month < monthOf(today) ? addMonths(month, 1) : null,
    rates: rateList(), shifts: views, totals: t, state: monthState(t), canSubmit: canSubmitMonth(month, today) && t.drafts > 0 && !t.open,
    submitOpens: lastDayOf(month), submitOpensText: fullDate(lastDayOf(month)), timeOff: off.map(timeOffView),
    open: open ? shiftView(open, {sessions: sessionsFor(state, [open.work_date])}) : null,
    choices: choices.map(s => ({key: s.key, title: s.title, start: s.start, end: s.end})), suggested: suggestedChoice(choices, now.getTime()),
    lastDuty: isDuty(last?.duty) ? last!.duty : null, handMonths: [monthOf(today), addMonths(monthOf(today), -1)]
  };
}
export const rateList = () => (Object.keys(PRACTICE_RATES) as (keyof typeof PRACTICE_RATES)[]).map(d => ({duty: d, label: DUTY_LABEL[d], centsPerHour: PRACTICE_RATES[d]}));

// Practices a coach could tie a hand-added shift to, on a date.
export async function choicesFor(coach: Coach, date: unknown, now = new Date()) {
  if (!validDay(date) || !handDateAllowed(date, academyDay(now))) return fail(400, 'Choose a date in this month or last month, up to today.');
  const list = choicesOn(await academyState(), date, coach.programs);
  return ok({date, choices: list.map(s => ({key: s.key, title: s.title, start: s.start, end: s.end}))});
}

// ---------- Coach actions ----------
export async function clockIn(coach: Coach, userId: string, input: any, now = new Date()) {
  if (!isDuty(input?.duty)) return fail(400, 'Choose Head coach or Assistant coach.');
  const today = academyDay(now), state = await academyState();
  let session: Session | null = null;
  if (input.session !== null && input.session !== undefined && input.session !== '') {
    session = choicesOn(state, today, coach.programs).find(s => s.key === input.session) ?? null;
    if (!session) return fail(409, 'That practice is not on today’s schedule for your programs. Refresh and choose again.');
  }
  const id = crypto.randomUUID(), at = now.toISOString();
  const saved = await db().prepare(`INSERT OR IGNORE INTO coach_time_entries(id,user_id,coach_email,coach_name,work_date,session_key,session_title,session_start,session_end,duty,source,clock_in,history,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'clock',?,?,?) RETURNING id`)
    .bind(id, userId, coach.email, coach.name, today, session?.key ?? null, session?.title ?? null, session?.start ?? null, session?.end ?? null, input.duty, at, '[' + step('coach', 'clocked in') + ']', at).first();
  if (!saved) return fail(409, 'You are already clocked in. Clock out first.');
  await audit(userId, 'coach_clock_in', id).run();
  return ok({id});
}

async function ownShift(coach: Coach, id: unknown) {
  if (!validId(id)) return null;
  return await db().prepare(`SELECT ${ENTRY_COLUMNS} FROM coach_time_entries WHERE id=? AND coach_email=?`).bind(id, coach.email).first<Entry>();
}
export async function clockOut(coach: Coach, userId: string, input: any, now = new Date()) {
  const e = await ownShift(coach, input?.id);
  if (!e || e.clock_out || e.voided_at) return fail(409, 'You are not clocked in on that shift. Refresh the page.');
  if (Date.parse(e.clock_in) >= now.getTime()) return fail(409, 'Clock out after you clock in.');
  const r = await db().prepare(`UPDATE coach_time_entries SET clock_out=?,revision=revision+1,history=json_insert(history,'$[#]',json(?)) WHERE id=? AND clock_out IS NULL AND voided_at IS NULL RETURNING id`)
    .bind(now.toISOString(), step('coach', 'clocked out'), e.id).first();
  if (!r) return fail(409, 'You are not clocked in on that shift. Refresh the page.');
  await audit(userId, 'coach_clock_out', e.id).run();
  return ok();
}

// A coach may change their own shift until they send the month: clock times on the same day, with a reason.
function editable(e: Entry | null, revision: unknown): string | null {
  if (!e) return 'That shift is not yours or no longer exists.';
  if (e.voided_at) return 'That shift was removed.';
  if (e.approved_at) return 'The academy already approved that shift.';
  if (e.submitted_at) return 'You already sent this shift to the academy. Ask the academy to correct it.';
  if (e.revision !== revision) return 'This shift changed since you opened the page. Refresh and try again.';
  return null;
}
function timesFor(date: string, input: any, now: Date) {
  if (!validClock(input?.in) || !validClock(input?.out)) return {error: 'Enter the start and end times.'};
  if (input.in >= input.out) return {error: 'The end time must be after the start time, on the same day.'};
  const start = academyInstant(date, input.in), end = academyInstant(date, input.out);
  if (end > now.getTime() + 60000) return {error: 'The end time cannot be in the future.'};
  return {start, end};
}
async function overlaps(email: string, date: string, start: number, end: number, except = '') {
  const rows = await entries('coach_email=? AND work_date=? AND voided_at IS NULL AND id<>?', email, date, except);
  return rows.some(r => { const s = Date.parse(r.fixed_in ?? r.clock_in), o = r.fixed_out ?? r.clock_out, e = o ? Date.parse(o) : Infinity; return s < end && e > start; });
}
export async function fixTimes(coach: Coach, userId: string, input: any, now = new Date()) {
  const e = await ownShift(coach, input?.id), problem = editable(e, input?.revision);
  if (problem) return fail(409, problem);
  const reason = note(input.reason);
  if (reason.length < 3 || reason.length > 300) return fail(400, 'Say briefly why the times changed (up to 300 characters).');
  const t = timesFor(e!.work_date, input, now);
  if ('error' in t) return fail(400, t.error!);
  if (await overlaps(coach.email, e!.work_date, t.start, t.end, e!.id)) return fail(409, 'Those times overlap another of your shifts that day.');
  const before = `${academyClock(e!.fixed_in ?? e!.clock_in)}–${e!.fixed_out ?? e!.clock_out ? academyClock((e!.fixed_out ?? e!.clock_out)!) : 'open'}`, after = `${input.in}–${input.out}`;
  // A shift still open is closed by the fix: the moment of the fix is kept as its clock-out punch.
  const r = await db().prepare(`UPDATE coach_time_entries SET fixed_in=?,fixed_out=?,clock_out=COALESCE(clock_out,?),coach_note=?,revision=revision+1,history=json_insert(history,'$[#]',json(?))
    WHERE id=? AND revision=? AND submitted_at IS NULL AND approved_at IS NULL AND voided_at IS NULL RETURNING id`)
    .bind(new Date(t.start).toISOString(), new Date(t.end).toISOString(), now.toISOString(), reason, step('coach', 'changed times', {from: before, to: after, note: reason}), e!.id, e!.revision).first();
  if (!r) return fail(409, 'This shift changed since you opened the page. Refresh and try again.');
  await audit(userId, 'coach_shift_fixed', `${e!.id} ${before}->${after}`).run();
  return ok();
}
export async function addShift(coach: Coach, userId: string, input: any, now = new Date()) {
  const today = academyDay(now), date = input?.date;
  if (!validDay(date) || !handDateAllowed(date, today)) return fail(400, 'You can add a shift for this month or last month, up to today.');
  if (!isDuty(input.duty)) return fail(400, 'Choose Head coach or Assistant coach.');
  const reason = note(input.reason);
  if (reason.length < 3 || reason.length > 300) return fail(400, 'Say briefly why this shift was not clocked (up to 300 characters).');
  const month = monthOf(date);
  const done = await db().prepare('SELECT 1 FROM coach_time_entries WHERE coach_email=? AND work_date BETWEEN ? AND ? AND approved_at IS NOT NULL LIMIT 1').bind(coach.email, month + '-01', lastDayOf(month)).first();
  if (done) return fail(409, `The academy already approved ${monthLabel(month)}. Ask the academy to add this shift.`);
  let session: Session | null = null;
  if (input.session) {
    session = choicesOn(await academyState(), date, coach.programs).find(s => s.key === input.session) ?? null;
    if (!session) return fail(409, 'That practice is not on the schedule for your programs that day.');
  }
  const t = timesFor(date, input, now);
  if ('error' in t) return fail(400, t.error!);
  if (await overlaps(coach.email, date, t.start, t.end)) return fail(409, 'Those times overlap another of your shifts that day.');
  const id = crypto.randomUUID(), at = now.toISOString();
  await db().prepare(`INSERT INTO coach_time_entries(id,user_id,coach_email,coach_name,work_date,session_key,session_title,session_start,session_end,duty,source,clock_in,clock_out,coach_note,history,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'hand',?,?,?,?,?)`)
    .bind(id, userId, coach.email, coach.name, date, session?.key ?? null, session?.title ?? null, session?.start ?? null, session?.end ?? null, input.duty,
      new Date(t.start).toISOString(), new Date(t.end).toISOString(), reason, '[' + step('coach', 'added by hand', {note: reason}) + ']', at).run();
  await audit(userId, 'coach_shift_added', `${id} ${date} ${input.in}-${input.out}`).run();
  return ok({id});
}
export async function removeShift(coach: Coach, userId: string, input: any) {
  const e = await ownShift(coach, input?.id), problem = editable(e, input?.revision);
  if (problem) return fail(409, problem);
  const reason = note(input.reason) || 'Removed by the coach';
  if (reason.length > 300) return fail(400, 'Keep the reason under 300 characters.');
  const r = await db().prepare(`UPDATE coach_time_entries SET voided_at=?,voided_by=?,void_reason=?,revision=revision+1,history=json_insert(history,'$[#]',json(?))
    WHERE id=? AND revision=? AND submitted_at IS NULL AND approved_at IS NULL AND voided_at IS NULL RETURNING id`)
    .bind(new Date().toISOString(), coach.email, reason, step('coach', 'removed', {note: reason}), e!.id, e!.revision).first();
  if (!r) return fail(409, 'This shift changed since you opened the page. Refresh and try again.');
  await audit(userId, 'coach_shift_removed', e!.id).run();
  return ok();
}
// Q5: the whole month, on or after its last day.
export async function submitMonth(coach: Coach, userId: string, input: any, now = new Date()) {
  const month = input?.month, today = academyDay(now);
  if (!validMonth(month) || month > monthOf(today)) return fail(400, 'Choose a month.');
  if (!canSubmitMonth(month, today)) return fail(409, `You can send ${monthLabel(month)} from ${fullDate(lastDayOf(month))}, its last day.`);
  const from = month + '-01', to = lastDayOf(month);
  if (await db().prepare('SELECT 1 FROM coach_time_entries WHERE coach_email=? AND work_date BETWEEN ? AND ? AND clock_out IS NULL AND voided_at IS NULL').bind(coach.email, from, to).first())
    return fail(409, 'Clock out first. A shift in this month is still open.');
  const at = now.toISOString();
  const r = await db().prepare(`UPDATE coach_time_entries SET submitted_at=?,revision=revision+1,history=json_insert(history,'$[#]',json(?))
    WHERE coach_email=? AND work_date BETWEEN ? AND ? AND clock_out IS NOT NULL AND submitted_at IS NULL AND approved_at IS NULL AND voided_at IS NULL RETURNING id`)
    .bind(at, step('coach', 'sent to the academy'), coach.email, from, to).all();
  if (!r.results.length) return fail(409, `There is nothing new to send for ${monthLabel(month)}.`);
  await audit(userId, 'coach_month_submitted', `${month} ${r.results.length}`).run();
  return ok({sent: r.results.length});
}

// ---------- Owner ----------
export async function ownerMonth(monthInput: unknown, coachInput: unknown, now = new Date()) {
  const today = academyDay(now), month = validMonth(monthInput) ? monthInput : monthOf(today), from = month + '-01', to = lastDayOf(month);
  const filter = typeof coachInput === 'string' && coachInput ? coachInput.toLowerCase() : null;
  const state = await academyState();
  const rows = await entries(filter ? 'work_date BETWEEN ? AND ? AND coach_email=?' : 'work_date BETWEEN ? AND ?', from, to, ...(filter ? [filter] : []));
  if (rows.length > 3000) return fail(409, 'This month has too many shifts to show at once. Choose one coach.');
  const off = await approvedTimeOff(filter, from, to);
  const sessions = sessionsFor(state, rows.map(r => r.work_date));
  const pay = await coachPayReport(from, to);
  const lessons = new Map('error' in pay ? [] : pay.coaches.map(c => [c.coachEmail, c]));
  const staff = (await db().prepare('SELECT email,name,programs,active FROM staff_access ORDER BY name').all<{email: string; name: string; programs: string; active: number}>()).results;
  // Every coach with shifts, lessons or approved time off this month (time off stays on their history, #197 Q7 A).
  const emails = new Set([...rows.map(r => r.coach_email), ...off.map(o => o.coach_email), ...(filter ? [] : [...lessons.keys()].filter(Boolean))]);
  if (filter) emails.add(filter);
  const coaches = [...emails].map(email => {
    const s = staff.find(x => x.email === email), mine = rows.filter(r => r.coach_email === email), myOff = off.filter(o => o.coach_email === email);
    const views = mine.map(r => shiftView(r, {sessions, timeOff: myOff})), t = totals(views), l = lessons.get(email);
    return {email, name: s?.name ?? mine[0]?.coach_name ?? l?.coach ?? email, active: s?.active === 1, programs: s ? JSON.parse(s.programs) : [],
      shifts: views, totals: t, state: monthState(t), timeOff: myOff.map(timeOffView),
      lessons: l ? {lessons: l.lessons, grossCents: l.grossCents, refundedCents: l.refundedCents, splitPct: l.splitPct, owedCents: l.owedCents} : null};
  }).sort((a, b) => a.name.localeCompare(b.name));
  const sum = (f: (c: typeof coaches[number]) => number) => coaches.reduce((n, c) => n + f(c), 0);
  return ok({
    month, monthLabel: monthLabel(month), today, previous: addMonths(month, -1), next: addMonths(month, 1), rates: rateList(), coach: filter,
    coaches, choices: staff.map(s => ({email: s.email, name: s.name, active: s.active === 1})),
    overall: {minutes: sum(c => c.totals.minutes), practiceCents: sum(c => c.totals.amountCents), approvedCents: sum(c => c.shifts.filter(v => v.status === 'approved').reduce((n, v) => n + v.amountCents, 0)),
      lessonCents: sum(c => c.lessons?.owedCents ?? 0), waiting: sum(c => c.totals.submitted), notSent: sum(c => c.totals.drafts + c.totals.open), flagged: sum(c => c.totals.flagged)}
  });
}
async function shift(id: unknown) {
  return validId(id) ? await db().prepare(`SELECT ${ENTRY_COLUMNS} FROM coach_time_entries WHERE id=?`).bind(id).first<Entry>() : null;
}
// The owner sets the paid time (hours and minutes) and role of a shift, with a reason. The clock punches stay as they
// were; the change is kept on the shift's history and in the security log.
export async function ownerCorrect(ownerId: string, input: any) {
  const e = await shift(input?.id);
  if (!e || e.revision !== input?.revision) return fail(409, 'This shift changed since you opened the page. Refresh and try again.');
  if (e.voided_at || e.approved_at) return fail(409, e.voided_at ? 'That shift is void.' : 'Undo the month’s approval before correcting a shift.');
  if (!e.clock_out) return fail(409, 'The coach is still clocked in on that shift. Void it, or wait for the coach to clock out or fix it.');
  const hours = input.hours, minutes = input.minutes;
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || hours * 60 + minutes > 1440) return fail(400, 'Enter the paid time in hours (0 to 24) and minutes (0 to 59).');
  if (!isDuty(input.duty)) return fail(400, 'Choose Head coach or Assistant coach.');
  const reason = note(input.reason);
  if (reason.length < 3 || reason.length > 300) return fail(400, 'Add a reason for the correction (up to 300 characters).');
  const total = hours * 60 + minutes, beforeMin = e.owner_minutes ?? scheduledMinutes(e), beforeDuty = dutyOf(e);
  const r = await db().prepare(`UPDATE coach_time_entries SET owner_minutes=?,owner_duty=?,owner_note=?,revision=revision+1,history=json_insert(history,'$[#]',json(?))
    WHERE id=? AND revision=? AND approved_at IS NULL AND voided_at IS NULL RETURNING id`)
    .bind(total, input.duty, reason, step('owner', 'corrected', {from: `${hoursText(beforeMin)} ${DUTY_LABEL[beforeDuty]}`, to: `${hoursText(total)} ${DUTY_LABEL[input.duty as 'head']}`, note: reason}), e.id, e.revision).first();
  if (!r) return fail(409, 'This shift changed since you opened the page. Refresh and try again.');
  await audit(ownerId, 'coach_shift_corrected', `${e.id} ${beforeMin}min ${beforeDuty}->${total}min ${input.duty}`).run();
  return ok();
}
// Void a mistaken shift (a test punch, a double clock-in). It stays on record and is never paid.
export async function ownerVoid(ownerId: string, input: any) {
  const e = await shift(input?.id);
  if (!e || e.revision !== input?.revision) return fail(409, 'This shift changed since you opened the page. Refresh and try again.');
  if (e.voided_at) return fail(409, 'That shift is already void.');
  if (e.approved_at) return fail(409, 'Undo the month’s approval before voiding a shift.');
  const reason = note(input.reason);
  if (reason.length < 3 || reason.length > 300) return fail(400, 'Add a reason for voiding the shift (up to 300 characters).');
  const r = await db().prepare(`UPDATE coach_time_entries SET voided_at=?,voided_by=?,void_reason=?,revision=revision+1,history=json_insert(history,'$[#]',json(?))
    WHERE id=? AND revision=? AND approved_at IS NULL AND voided_at IS NULL RETURNING id`)
    .bind(new Date().toISOString(), ownerId, reason, step('owner', 'voided', {note: reason}), e.id, e.revision).first();
  if (!r) return fail(409, 'This shift changed since you opened the page. Refresh and try again.');
  await audit(ownerId, 'coach_shift_voided', e.id).run();
  return ok();
}
// Approve a coach's sent month: exactly the shifts the owner reviewed (ids and revisions), and only when nothing else in
// the month is still open or unsent. The minutes, role, rate and amount are copied onto each shift.
export async function approveMonth(ownerId: string, input: any) {
  const month = input?.month, email = typeof input?.coach === 'string' ? input.coach.toLowerCase() : '';
  const list = input?.shifts;
  if (!validMonth(month) || !email || !Array.isArray(list) || !list.length || list.length > 500 || !list.every((s: any) => validId(s?.id) && validRevision(s?.revision))
    || new Set(list.map((s: any) => s.id)).size !== list.length) return fail(400, 'Choose the coach’s month to approve.');
  const from = month + '-01', to = lastDayOf(month);
  const rows = await entries('coach_email=? AND work_date BETWEEN ? AND ? AND voided_at IS NULL AND approved_at IS NULL', email, from, to);
  const unsent = rows.filter(r => !r.clock_out || !r.submitted_at).length;
  if (unsent) return fail(409, `This coach has ${unsent} shift${unsent === 1 ? '' : 's'} in ${monthLabel(month)} not sent yet. Approve once the whole month is sent.`);
  const seen = new Map(list.map((s: any) => [s.id, s.revision]));
  if (rows.length !== list.length || rows.some(r => seen.get(r.id) !== r.revision)) return fail(409, 'The month changed since you opened the page. Refresh and review it again.');
  const at = new Date().toISOString();
  const values = rows.map(r => { const minutes = r.owner_minutes ?? scheduledMinutes(r), duty = dutyOf(r), rate = PRACTICE_RATES[duty];
    return {id: r.id, revision: r.revision, minutes, duty, rate, cents: amountCents(minutes, rate)}; });
  const pick = (k: string) => `(SELECT json_extract(value,'$.${k}') FROM json_each(?) WHERE json_extract(value,'$.id')=coach_time_entries.id)`;
  const data = JSON.stringify(values);
  const r = await db().prepare(`UPDATE coach_time_entries SET approved_at=?,approved_by=?,approved_minutes=${pick('minutes')},approved_duty=${pick('duty')},approved_rate_cents=${pick('rate')},approved_cents=${pick('cents')},
      revision=revision+1,history=json_insert(history,'$[#]',json(?))
    WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND approved_at IS NULL AND voided_at IS NULL AND submitted_at IS NOT NULL
      AND (SELECT count(*) FROM coach_time_entries e JOIN json_each(?) j ON e.id=json_extract(j.value,'$.id') AND e.revision=json_extract(j.value,'$.revision')
           WHERE e.coach_email=? AND e.work_date BETWEEN ? AND ? AND e.approved_at IS NULL AND e.voided_at IS NULL AND e.submitted_at IS NOT NULL AND e.clock_out IS NOT NULL)=?
      AND (SELECT count(*) FROM coach_time_entries WHERE coach_email=? AND work_date BETWEEN ? AND ? AND approved_at IS NULL AND voided_at IS NULL)=?
    RETURNING id`)
    .bind(at, ownerId, data, data, data, data, step('owner', 'approved'), data, data, email, from, to, values.length, email, from, to, values.length).all();
  if (r.results.length !== values.length) return fail(409, 'The month changed since you opened the page. Refresh and review it again.');
  const cents = values.reduce((n, v) => n + v.cents, 0);
  await audit(ownerId, 'coach_month_approved', `${email} ${month} ${values.length} ${cents}`).run();
  return ok({approved: values.length, cents});
}
export async function unapproveMonth(ownerId: string, input: any) {
  const month = input?.month, email = typeof input?.coach === 'string' ? input.coach.toLowerCase() : '';
  if (!validMonth(month) || !email) return fail(400, 'Choose the coach’s month.');
  const reason = note(input.reason);
  if (reason.length < 3 || reason.length > 300) return fail(400, 'Add a reason for undoing the approval (up to 300 characters).');
  const r = await db().prepare(`UPDATE coach_time_entries SET approved_at=NULL,approved_by=NULL,approved_minutes=NULL,approved_duty=NULL,approved_rate_cents=NULL,approved_cents=NULL,
      revision=revision+1,history=json_insert(history,'$[#]',json(?)) WHERE coach_email=? AND work_date BETWEEN ? AND ? AND approved_at IS NOT NULL RETURNING id`)
    .bind(step('owner', 'approval undone', {note: reason}), email, month + '-01', lastDayOf(month)).all();
  if (!r.results.length) return fail(409, 'Nothing in that month is approved.');
  await audit(ownerId, 'coach_month_unapproved', `${email} ${month} ${r.results.length}`).run();
  return ok({reopened: r.results.length});
}
// The month's file: approved practice hours at the role's rate, plus each coach's private lesson share.
export async function monthCsv(monthInput: unknown) {
  if (!validMonth(monthInput)) return fail(400, 'Choose a month.');
  const view = await ownerMonth(monthInput, null);
  if (view.status !== 200) return view;
  const coaches = (view.coaches as any[]).map(c => ({email: c.email, name: c.name, shifts: c.shifts as ShiftView[], lessons: c.lessons,
    notApproved: (c.shifts as ShiftView[]).filter(s => s.status !== 'approved' && s.status !== 'voided').length}));
  return ok({csv: payrollCsv(monthInput, coaches), month: monthInput});
}
