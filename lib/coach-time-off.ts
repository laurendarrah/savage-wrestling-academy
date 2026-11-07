// Coach time off (issue #193). A coach asks for dates with a reason; the owner approves or declines. When the owner
// approves (#197 Q7):
//   A. the approval stays on the coach's time history (/coach-time and the owner's month review);
//   B. the other coaches in the same programs are told (in-app notice, and email once it is set up), never coaches in
//      other programs; the reason stays between the coach and the owner;
//   C. the coach's practices and lessons in those dates are listed for cover on the owner's Coach hours page.
// Nothing is cancelled or moved automatically.
import {env} from 'cloudflare:workers';
import {OWNER_EMAIL} from './account-auth';
import {academyDay, dayDate, fullDate, clockRange} from './datetime';
import {academyState} from './roster';
import {registrationCatalog} from './registration-catalog';
import {lessonHolders} from './lessons';
import {notify, quietly} from './notify';
import {validDay} from './coach-time';
import type {Coach} from './coach-timesheets';

type Row = {id: string; user_id: string; coach_email: string; coach_name: string; start_date: string; end_date: string; reason: string; status: string; programs: string;
  requested_at: string; decided_at: string | null; decided_by: string | null; decision_note: string | null; revision: number};
const COLUMNS = 'id,user_id,coach_email,coach_name,start_date,end_date,reason,status,programs,requested_at,decided_at,decided_by,decision_note,revision';
const db = () => env.DB!;
const fail = (status: number, error: string) => ({status, error});
const note = (v: unknown) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const PROGRAM_NAMES: Record<string, string> = {Elementary: 'SWA Development', Intermediate: 'SWA Intermediate', Advanced: 'SWA Advance'};
export const rangeText = (start: string, end: string) => start === end ? dayDate(start) : `${dayDate(start)} to ${dayDate(end)}`;
const audit = (actor: string, action: string, target: string) =>
  db().prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), actor, action, target, new Date().toISOString()).run();

export const view = (r: Row) => ({id: r.id, revision: r.revision, coachEmail: r.coach_email, coachName: r.coach_name, start: r.start_date, end: r.end_date,
  text: r.start_date === r.end_date ? fullDate(r.start_date) : `${fullDate(r.start_date)} to ${fullDate(r.end_date)}`, reason: r.reason, status: r.status,
  requestedAt: r.requested_at, decidedAt: r.decided_at, decisionNote: r.decision_note, programs: JSON.parse(r.programs || '[]')});

export async function myTimeOff(email: string) {
  return (await db().prepare(`SELECT ${COLUMNS} FROM coach_time_off WHERE coach_email=? ORDER BY start_date DESC,requested_at DESC LIMIT 60`).bind(email).all<Row>()).results.map(view);
}
// Notices addressed to a coach (team time off, decisions on their own requests, lessons booked with them).
export async function coachNotices(email: string) {
  return (await db().prepare('SELECT id,kind,subject,body,created_at FROM notifications WHERE email=? AND user_id IS NULL ORDER BY created_at DESC LIMIT 15').bind(email).all<any>()).results
    .map(n => ({id: n.id, kind: n.kind, subject: n.subject, body: n.body, at: n.created_at}));
}

export async function requestTimeOff(coach: Coach, userId: string, input: any, now = new Date()) {
  const today = academyDay(now), start = input?.start, end = input?.end, reason = note(input?.reason);
  if (!validDay(start) || !validDay(end)) return fail(400, 'Choose the first and last day.');
  if (end < start) return fail(400, 'The last day must be on or after the first day.');
  if (start < addDays(today, -31)) return fail(400, 'Time off can start at most a month ago.');
  if (end > addDays(start, 365)) return fail(400, 'Ask for at most a year at a time.');
  if (reason.length < 3 || reason.length > 300) return fail(400, 'Add a short reason (up to 300 characters). Only the academy sees it.');
  const id = crypto.randomUUID();
  const saved = await db().prepare(`INSERT INTO coach_time_off(id,user_id,coach_email,coach_name,start_date,end_date,reason,status,requested_at)
    SELECT ?,?,?,?,?,?,?,'pending',? WHERE NOT EXISTS (SELECT 1 FROM coach_time_off WHERE coach_email=? AND status IN ('pending','approved') AND start_date<=? AND end_date>=?) RETURNING id`)
    .bind(id, userId, coach.email, coach.name, start, end, reason, now.toISOString(), coach.email, end, start).first();
  if (!saved) return fail(409, 'Those dates overlap a request you already have waiting or approved.');
  await audit(userId, 'coach_time_off_requested', `${id} ${start}..${end}`);
  return {status: 200, id};
}
export async function withdrawTimeOff(coach: Coach, userId: string, input: any) {
  const r = await db().prepare(`UPDATE coach_time_off SET status='withdrawn',decided_at=?,decided_by=?,revision=revision+1 WHERE id=? AND coach_email=? AND revision=? AND status='pending' RETURNING id`)
    .bind(new Date().toISOString(), coach.email, String(input?.id ?? ''), coach.email, input?.revision).first();
  if (!r) return fail(409, 'Only a request that is still waiting can be withdrawn. Refresh the page.');
  await audit(userId, 'coach_time_off_withdrawn', String(input.id));
  return {status: 200};
}

// Q7 B: the other active coaches who share a program with this coach. The coach and the owner (who approved it) are not
// told; coaches in other programs are not told.
export async function sameProgramCoaches(email: string, programs: string[]) {
  const rows = (await db().prepare('SELECT email,name,programs FROM staff_access WHERE active=1 AND email<>? AND email<>?').bind(email, OWNER_EMAIL).all<{email: string; name: string; programs: string}>()).results;
  return rows.map(r => ({...r, programs: JSON.parse(r.programs) as string[]})).filter(r => r.programs.some(p => programs.includes(p)));
}

export async function decideTimeOff(ownerId: string, input: any) {
  const decision = input?.decision;
  if (decision !== 'approve' && decision !== 'decline') return fail(400, 'Choose approve or decline.');
  const r = await db().prepare(`SELECT ${COLUMNS} FROM coach_time_off WHERE id=?`).bind(String(input?.id ?? '')).first<Row>();
  if (!r || r.revision !== input?.revision || r.status !== 'pending') return fail(409, 'This request changed since you opened the page. Refresh and try again.');
  const decisionNote = note(input.note);
  if (decisionNote.length > 300) return fail(400, 'Keep the note under 300 characters.');
  const staff = await db().prepare('SELECT programs FROM staff_access WHERE email=?').bind(r.coach_email).first<{programs: string}>();
  const programs: string[] = staff ? JSON.parse(staff.programs) : [];
  const status = decision === 'approve' ? 'approved' : 'declined', at = new Date().toISOString();
  const saved = await db().prepare(`UPDATE coach_time_off SET status=?,programs=?,decided_at=?,decided_by=?,decision_note=?,revision=revision+1 WHERE id=? AND revision=? AND status='pending' RETURNING id`)
    .bind(status, JSON.stringify(programs), at, ownerId, decisionNote || null, r.id, r.revision).first();
  if (!saved) return fail(409, 'This request changed since you opened the page. Refresh and try again.');
  await audit(ownerId, 'coach_time_off_' + status, r.id);
  const when = rangeText(r.start_date, r.end_date);
  const notices = [{userId: null, email: r.coach_email, kind: 'coach_time_off_' + status, dedupeKey: `time-off-decided:${r.id}`, link: '/coach-time',
    subject: status === 'approved' ? `Time off approved: ${when}` : `Time off not approved: ${when}`,
    body: status === 'approved' ? `Your time off for ${when} is approved. The academy will arrange cover for your practices and lessons.${decisionNote ? ' Note from the academy: ' + decisionNote : ''}`
      : `Your time off request for ${when} was not approved.${decisionNote ? ' Note from the academy: ' + decisionNote : ''} Talk with the academy if you have questions.`}];
  let told = 0;
  if (status === 'approved') {
    const team = await sameProgramCoaches(r.coach_email, programs);
    for (const c of team) {
      const shared = c.programs.filter(p => programs.includes(p)).map(p => PROGRAM_NAMES[p] ?? p).join(' and ');
      notices.push({userId: null, email: c.email, kind: 'coach_time_off_team', dedupeKey: `time-off-team:${r.id}:${c.email}`, link: '/coach-time',
        subject: `${r.coach_name} is away ${when}`,
        body: `${r.coach_name} has approved time off ${r.start_date === r.end_date ? 'on' : 'from'} ${when}. You both coach ${shared}. The academy is arranging cover; nothing on the schedule changes unless the academy tells you.`});
    }
    told = team.length;
  }
  await quietly(() => notify(notices));
  return {status: 200, told};
}

// Q7 C: what needs cover while a coach is away. Practices of the programs the coach had when it was approved, and the
// coach's own lesson times (with how many wrestlers are booked). Listed only; nothing is cancelled.
export async function coverFor(r: ReturnType<typeof view>, state: any) {
  const months = new Set<string>();
  for (let d = r.start; d <= r.end && months.size < 14; d = addDays(d, 1)) months.add(d.slice(0, 7));
  const practices: {date: string; title: string; time: string}[] = [];
  for (const m of months) {
    const cat = registrationCatalog(state, m, '0000-01-01'), names = new Map(cat.programs.map((p: any) => [p.id, p.name]));
    for (const p of cat.practices) if (p.date >= r.start && p.date <= r.end && r.programs.includes(p.program))
      practices.push({date: p.date, title: String(names.get(p.program) ?? PROGRAM_NAMES[p.program] ?? p.program), time: clockRange(p.start, p.end)});
  }
  const openings = (await db().prepare('SELECT id,date,start,end,format FROM coach_openings WHERE coach_email=? AND date BETWEEN ? AND ? ORDER BY date,start LIMIT 200').bind(r.coachEmail, r.start, r.end)
    .all<{id: string; date: string; start: string; end: string; format: string | null}>()).results;
  const holders = openings.length ? await lessonHolders(openings.map(o => o.id)) : new Map();
  const lessons = openings.map(o => ({date: o.date, time: clockRange(o.start, o.end), booked: (holders.get(o.id) ?? []).length}));
  return {practices: practices.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)).slice(0, 120), lessons};
}
// The owner's list: requests waiting for a decision, and approved time off that has not ended, each with its cover list.
export async function ownerTimeOff(now = new Date()) {
  const today = academyDay(now), state = await academyState();
  const pending = (await db().prepare(`SELECT ${COLUMNS} FROM coach_time_off WHERE status='pending' ORDER BY start_date,requested_at LIMIT 200`).all<Row>()).results.map(view);
  const approved = (await db().prepare(`SELECT ${COLUMNS} FROM coach_time_off WHERE status='approved' AND end_date>=? ORDER BY start_date LIMIT 100`).bind(today).all<Row>()).results.map(view);
  const withCover = [];
  for (const a of approved) withCover.push({...a, cover: await coverFor(a, state)});
  // A pending request shows what would need cover too, using the coach's programs today.
  const staff = new Map((await db().prepare('SELECT email,programs FROM staff_access').all<{email: string; programs: string}>()).results.map(s => [s.email, JSON.parse(s.programs) as string[]]));
  const pendingWithCover = [];
  for (const p of pending) pendingWithCover.push({...p, cover: await coverFor({...p, programs: staff.get(p.coachEmail) ?? []}, state)});
  return {pending: pendingWithCover, approved: withCover, today};
}
