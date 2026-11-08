// Real rosters from paid orders, active scholarships and walk-ins or extra practices booked to pay cash at the academy
// (issues #22, #248). No sample workspace data is used.
import {env} from 'cloudflare:workers';
import {publicSchedule} from './public-schedule';
import {cardStatus, type CardStatus} from './usaw';
import {currentWaiver} from './waivers';
import {CARRIED_NAME, LIVE_SIGNATURE, SIGNATURE_JOIN, signatureCounts} from './documents';
import {PROGRAM_ON} from './transfers';
import {fullDate} from './datetime';
import {collectorNameSql} from './collectors';

export type Session = {key: string; type: 'practice' | 'live' | 'event'; title: string; program: string | null; date: string; start: string | null; end: string | null};
// Pay at the academy (issue #248): a walk-in or extra practice booked to pay cash. 'due' shows "$40.00 due" and a Cash
// received button; 'paid' shows when it was collected and by whom ("Received by Coach Dana · 6:05 PM", issue #250: the
// coach's display name, never an email). An unpaid booking can still be checked in.
export type CashInfo = {bookingId: string; status: 'due' | 'paid'; cents: number; orderId: string | null; collectedAt: string | null; collectedBy: string | null};
export type Entry = {userId: string; wrestlerId: string; name: string; grade: string | null; parentName: string | null; phone: string | null; email: string | null; sources: string[]; checkedInAt: string | null; checkedInBy: string | null; card: CardStatus['state']; cardExpires: string | null; cardNote: string; waiverSigned: boolean | null; exceptions: string[]; checkInBlocked: string | null; cash: CashInfo | null};
export const PAY_AT_ACADEMY = 'Pay at the academy';
// The cash booking key for a session: walk-ins name the program and date, extra practices their id. A program has one
// practice a day, so the start time is left out (issue #272): the owner moving a practice's time keeps its walk-ins and
// cash bookings on the roster. Stored order and booking item ids still carry the start they were booked with.
export function cashKey(session: Session) {
  return session.type === 'practice' ? `walkin|${session.program}:${session.date}` : session.type === 'live' ? `live|${session.key.split(':')[1]}` : null;
}
// The same key from a cash booking row, for matching a booking to a session.
export const cashBookingKey = (b: {kind: string; program: string | null; item_id: string; session_date: string}) =>
  b.kind === 'walkin' ? `walkin|${b.program}:${b.session_date}` : `${b.kind}|${b.item_id}`;
// Attendance is keyed by the session key the wrestler was checked in under; for a practice, the start time is ignored
// when matching, so a check-in stays with its practice when the owner moves the time (issue #272).
export const sessionBase = (key: string) => key.startsWith('practice:') ? key.replace(/:\d\d:\d\d$/, '') : key;
// Allergies or medical notes and the emergency contact (issue #188, decided in #197 question 14). The roster is for staff
// only, and coaches get only their own programs' practices and the extra practices (canSee).
export type SafetyDetails = {allergies: string | null; emergencyName: string | null; emergencyPhone: string | null};
export type Scope = {role: 'owner'} | {role: 'coach'; programs: string[]};

export const validDate = (d: unknown): d is string =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;

const programNames: Record<string, string> = {Elementary: 'SWA Development', Intermediate: 'SWA Intermediate', Advanced: 'SWA Advance'};

export async function academyState(): Promise<any> {
  const row = await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload: string}>();
  return row ? JSON.parse(row.payload) : {};
}

// Every session that runs on a date: program practices, Friday Night Live style sessions, and camp, clinic or event days.
export function sessionsOn(state: any, date: string): Session[] {
  const s = publicSchedule(state, date.slice(0, 7), date);
  const names = new Map<string, string>((s.programs ?? []).map((p: any) => [p.id, p.name]));
  const practices: Session[] = s.practices.filter((p: any) => p.date === date).map((p: any) => ({
    key: `practice:${p.program}:${date}:${p.start}`, type: 'practice', title: names.get(p.program) ?? programNames[p.program] ?? p.program, program: p.program, date, start: p.start, end: p.end
  }));
  const live: Session[] = (s.liveClasses ?? []).filter((l: any) => l.date === date).map((l: any) => ({
    key: `live:${l.id}:${date}`, type: 'live', title: l.name, program: null, date, start: l.start, end: l.end
  }));
  // Camp, clinic and event days carry their own times when the owner set them (issue #189); otherwise null, which the
  // screens show as "Time to be announced". The session key has no time, so attendance stays put if a time changes.
  const events: Session[] = (s.events ?? []).filter((e: any) => e.dates.includes(date)).map((e: any) => {
    const timed = (e.schedule ?? []).find((x: any) => x.date === date);
    return {key: `event:${e.id}:${date}`, type: 'event', title: e.name, program: null, date, start: timed?.start ?? null, end: timed?.end ?? null};
  });
  return [...practices, ...live, ...events].sort((a, b) => (a.start ?? '99') .localeCompare(b.start ?? '99') || a.title.localeCompare(b.title));
}

// USA Wrestling card at check-in (decision Q11 in #197, issue #210). A wrestler is checked in only with a card verified by
// the owner or by the USA Wrestling lookup (#202) and current on the session date: cardStatus(...).state === 'verified',
// the same answer as cardVerification() in lib/usaw.ts, with the day's reviews loaded in one query in rosterFor(). A
// missing, expired, rejected or not-yet-verified card blocks check-in. The owner's card exception (issue #89), which lets
// a wrestler book despite the card, also lets them be checked in on the dates it covers, exactly as it does for booking.
// Returns the plain reason staff see, or null when check-in is allowed.
export function checkInBlock(e: Pick<Entry, 'name' | 'card' | 'cardExpires' | 'cardNote' | 'exceptions'>, scope: Scope): string | null {
  if (e.card === 'verified' || e.exceptions.includes('usaw')) return null;
  const why = e.card === 'missing' ? 'there is no USA Wrestling card on file'
    : e.card === 'expired' ? `the USA Wrestling card expired ${e.cardExpires ? fullDate(e.cardExpires) : ''}`.trim()
    : e.card === 'invalid' ? `the academy marked the USA Wrestling card not valid${e.cardNote ? ` (${e.cardNote})` : ''}`
    : e.card === 'recheck' ? 'the USA Wrestling card was changed and the academy has not checked it yet'
    : 'the USA Wrestling card has not been verified yet';
  // What to do next. A card on file only needs the academy's check; anything else needs the family, or an exception.
  const check = e.card === 'current' || e.card === 'recheck';
  return `${e.name} can't be checked in: ${why}. ` + (scope.role === 'owner'
    ? (check ? 'Check it and mark it verified on the USA Wrestling cards page.' : 'The family needs to update the card. To let the wrestler in meanwhile, allow an exception on the USA Wrestling cards page.')
    : (check ? 'Ask the owner to verify the card.' : 'Ask the family to update the card, or the owner to allow an exception.'));
}

// Coaches see their own programs' practices and, since issue #250, every extra practice (Friday Night Live and the like),
// which belongs to no program: any active coach can check those wrestlers in and take their cash. Camps, clinics and
// events stay with the owner. receiveCash (lib/cash-bookings.ts) uses this too, so the server allows exactly what the
// coach's check-in list shows.
export function canSee(scope: Scope, session: Session) {
  return scope.role === 'owner' || session.type === 'live' || (session.type === 'practice' && !!session.program && scope.programs.includes(session.program));
}

type Raw = {userId: string; wrestlerId: string; name: string; source: string};

// Who is entitled to attend a session, and why.
async function entitled(session: Session): Promise<Raw[]> {
  const d = session.date, rows: Raw[] = [];
  const add = (list: {user_id: string; wrestler_id: string; wrestler_name: string}[], source: string) =>
    list.forEach(r => rows.push({userId: r.user_id, wrestlerId: r.wrestler_id, name: r.wrestler_name, source}));
  if (session.type === 'practice') {
    // The program on that date, so a transfer (issue #74) does not rewrite earlier rosters.
    add((await env.DB!.prepare(`SELECT user_id,wrestler_id,wrestler_name FROM orders WHERE status='paid' AND kind IN ('annual','monthly') AND ${PROGRAM_ON}=? AND term_start<=? AND term_end>=?`)
      .bind(d, session.program, d, d).all<any>()).results, 'Member');
    // Walk-ins and cash bookings by program and date, not by the start time they were booked with (issue #272).
    add((await env.DB!.prepare(`SELECT user_id,wrestler_id,wrestler_name FROM orders WHERE status='paid' AND kind='walkin' AND program=? AND EXISTS (SELECT 1 FROM json_each(orders.dates) WHERE value=?)`)
      .bind(session.program, d).all<any>()).results, 'Walk-in paid');
    add((await env.DB!.prepare(`SELECT user_id,wrestler_id,wrestler_name FROM cash_bookings WHERE status='due' AND kind='walkin' AND program=? AND session_date=?`)
      .bind(session.program, d).all<any>()).results, PAY_AT_ACADEMY);
    add((await env.DB!.prepare(`SELECT user_id,wrestler_id,wrestler_name FROM scholarship_awards WHERE status='active' AND program=? AND user_id IS NOT NULL AND wrestler_id IS NOT NULL AND accepted_at IS NOT NULL AND substr(accepted_at,1,10)<=?`)
      .bind(session.program, d).all<any>()).results, 'Scholarship');
  } else {
    const [, id] = session.key.split(':');
    add((await env.DB!.prepare(`SELECT user_id,wrestler_id,wrestler_name FROM orders WHERE status='paid' AND kind=? AND item_id=? AND EXISTS (SELECT 1 FROM json_each(orders.dates) WHERE value=?)`)
      .bind(session.type, id, d).all<any>()).results, session.type === 'live' ? 'Paid' : 'Registered');
    if (session.type === 'live')
      add((await env.DB!.prepare(`SELECT user_id,wrestler_id,wrestler_name FROM cash_bookings WHERE status='due' AND kind='live' AND item_id=? AND session_date=?`)
        .bind(id, d).all<any>()).results, PAY_AT_ACADEMY);
  }
  return rows;
}

export async function rosterFor(date: string, scope: Scope) {
  const state = await academyState();
  const sessions = sessionsOn(state, date).filter(s => canSee(scope, s));
  const lists: Raw[][] = [];
  for (const session of sessions) lists.push(await entitled(session));
  const userIds = [...new Set(lists.flat().map(r => r.userId))];
  // Everything per wrestler is loaded once for the whole day (issue #92), not queried entry by entry.
  const ids = JSON.stringify(userIds), waiver = await currentWaiver();
  const [fams, reviews, signed, exceptions, attendance, cashRows] = await env.DB!.batch([
    env.DB!.prepare('SELECT user_id,email,payload FROM family_accounts WHERE user_id IN (SELECT value FROM json_each(?))').bind(ids),
    env.DB!.prepare('SELECT user_id,wrestler_id,number,expires,status,note,reviewed_at FROM usaw_reviews WHERE user_id IN (SELECT value FROM json_each(?))').bind(ids),
    env.DB!.prepare(`SELECT s.user_id,s.wrestler_id,s.wrestler_name,${CARRIED_NAME} FROM waiver_signatures s ${SIGNATURE_JOIN} WHERE s.version_id=? AND s.user_id IN (SELECT value FROM json_each(?)) AND ${LIVE_SIGNATURE}`).bind(waiver?.id ?? '', ids),
    env.DB!.prepare('SELECT user_id,wrestler_id,rule FROM booking_exceptions WHERE revoked_at IS NULL AND starts_on<=? AND ends_on>=? AND user_id IN (SELECT value FROM json_each(?))').bind(date, date, ids),
    env.DB!.prepare('SELECT session_key,user_id,wrestler_id,checked_in_at,checked_in_by FROM attendance WHERE session_date=?').bind(date),
    env.DB!.prepare(`SELECT b.id,b.kind,b.program,b.item_id,b.session_date,b.user_id,b.wrestler_id,b.amount_cents,b.status,b.order_id,o.paid_at,${collectorNameSql('o')} AS collected_by
      FROM cash_bookings b LEFT JOIN orders o ON o.id=b.order_id AND o.status='paid' WHERE b.session_date=? AND b.status IN ('due','paid')`).bind(date)
  ]);
  const families = new Map<string, any>((fams.results as any[]).map(r => [r.user_id, {email: r.email, ...JSON.parse(r.payload)}]));
  const review = new Map<string, any>((reviews.results as any[]).map(r => [`${r.user_id}|${r.wrestler_id}`, r]));
  // Signed for this wrestler (issue #271): the same entry, by the family's saved names (lib/documents.ts signatureCounts).
  const signedBy = new Map<string, any[]>();
  for (const r of signed.results as any[]) { const k = `${r.user_id}|${r.wrestler_id}`; if (!signedBy.has(k)) signedBy.set(k, []); signedBy.get(k)!.push(r); }
  const hasSigned = (k: string, w: any, kids: any[]) => (signedBy.get(k) ?? []).some(s => signatureCounts(s, w, kids));
  const excepted = new Map<string, string[]>();
  for (const r of exceptions.results as any[]) { const k = `${r.user_id}|${r.wrestler_id}`; if (!excepted.has(k)) excepted.set(k, []); if (!excepted.get(k)!.includes(r.rule)) excepted.get(k)!.push(r.rule); }
  const checked = new Map<string, {checked_in_at: string; checked_in_by: string}>();
  for (const r of attendance.results as any[]) checked.set(`${sessionBase(r.session_key)}|${r.user_id}|${r.wrestler_id}`, r);
  const cashOf = new Map<string, CashInfo>();
  for (const r of cashRows.results as any[]) cashOf.set(`${cashBookingKey(r)}|${r.user_id}|${r.wrestler_id}`,
    {bookingId: r.id, status: r.status, cents: r.amount_cents, orderId: r.order_id, collectedAt: r.paid_at ?? null, collectedBy: r.collected_by ?? null});

  const result: (Session & {entries: Entry[]; checkedIn: number})[] = [];
  sessions.forEach((session, i) => {
    const merged = new Map<string, Entry & SafetyDetails>();
    for (const r of lists[i]) {
      const k = `${r.userId}|${r.wrestlerId}`;
      if (merged.has(k)) { const e = merged.get(k)!; if (!e.sources.includes(r.source)) e.sources.push(r.source); continue; }
      const f = families.get(r.userId) ?? null, w = f?.wrestlers?.find((x: any) => x.id === r.wrestlerId);
      const c = checked.get(`${sessionBase(session.key)}|${k}`);
      // Card status on the session date (issue #68). Only a verified card, or the owner's exception, allows check-in (#210).
      const card = w ? cardStatus(w, review.get(k) ?? null, date) : {state: 'missing' as const, expires: '', note: ''};
      const entryExceptions = ['usaw', 'waiver'].filter(x => excepted.get(k)?.includes(x));
      const name = w?.name ?? r.name, ck = cashKey(session);
      merged.set(k, {
        userId: r.userId, wrestlerId: r.wrestlerId, name, grade: w?.grade ?? null,
        parentName: f?.parentName || null, phone: f?.phone || null, email: scope.role === 'owner' ? f?.email ?? null : null,
        allergies: w?.allergies || null, emergencyName: f?.emergencyContactName || null, emergencyPhone: f?.emergencyContactPhone || null,
        sources: [r.source], checkedInAt: c?.checked_in_at ?? null, checkedInBy: scope.role === 'owner' ? c?.checked_in_by ?? null : null,
        card: card.state, cardExpires: card.expires || null, cardNote: card.note,
        waiverSigned: waiver ? hasSigned(k, {id: r.wrestlerId, name}, f?.wrestlers ?? []) : null,
        exceptions: entryExceptions,
        checkInBlocked: checkInBlock({name, card: card.state, cardExpires: card.expires || null, cardNote: card.note, exceptions: entryExceptions}, scope),
        cash: ck ? cashOf.get(`${ck}|${k}`) ?? null : null
      });
    }
    const entries = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
    result.push({...session, entries, checkedIn: entries.filter(e => e.checkedInAt).length});
  });
  return result;
}

// Check-in only succeeds for a wrestler who is on that session's roster and whose USA Wrestling card allows it (#210).
// A walk-in booked to pay at the academy and not paid yet can be checked in (issue #248): cash is often handed over at the
// door, so the amount due stays on the roster instead of blocking the wrestler.
export async function checkIn(date: string, sessionKey: string, userId: string, wrestlerId: string, scope: Scope, actor: string) {
  const sessions = await rosterFor(date, scope);
  const session = sessions.find(s => s.key === sessionKey);
  if (!session) return {status: 404, error: 'This session is not on your roster for that date.'};
  const entry = session.entries.find(e => e.userId === userId && e.wrestlerId === wrestlerId);
  if (!entry) return {status: 409, error: 'This wrestler is not registered or paid for this session.'};
  if (entry.checkInBlocked) return {status: 409, error: entry.checkInBlocked, cardBlocked: true};
  // Already checked in, possibly under the practice's earlier time: nothing to add.
  if (entry.checkedInAt) return {status: 200};
  await env.DB!.prepare('INSERT OR IGNORE INTO attendance(id,session_key,session_date,user_id,wrestler_id,wrestler_name,source,checked_in_at,checked_in_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), sessionKey, date, userId, wrestlerId, entry.name, entry.sources.join(', '), new Date().toISOString(), actor).run();
  return {status: 200};
}

export async function undoCheckIn(date: string, sessionKey: string, userId: string, wrestlerId: string, scope: Scope) {
  const sessions = await rosterFor(date, scope);
  if (!sessions.some(s => s.key === sessionKey)) return {status: 404, error: 'This session is not on your roster for that date.'};
  // A practice check-in may have been recorded under an earlier start time (issue #272).
  const like = sessionKey.startsWith('practice:') ? sessionBase(sessionKey) + ':__:__' : sessionKey;
  await env.DB!.prepare('DELETE FROM attendance WHERE session_date=? AND user_id=? AND wrestler_id=? AND (session_key=? OR session_key LIKE ?)').bind(date, userId, wrestlerId, sessionKey, like).run();
  return {status: 200};
}
