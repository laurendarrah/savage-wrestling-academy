// Private lessons booked against real coach openings (issues #70, #177). A coach posts one-hour openings. Every
// wrestler is booked and paid for by their own family at the owner's per-wrestler price, so each one goes through the
// card and waiver checks. Seats are per wrestler: a paid order (or a checkout in progress) takes one.
// - An ordinary open time (no format) takes one one-on-one wrestler, or a family can turn it into a private partner or
//   small group (closed): never listed, joined only through its invite link.
// - A coach can post a partner or small-group opening (coach-hosted), listed for every family until its spots fill.
// Formats without an owner price are not bookable online.
import {env} from 'cloudflare:workers';
import {privateFormats} from './public-schedule';
import {HOLD_MINUTES} from './capacity';
import {cardProblem} from './usaw';
import {waiverProblem} from './waivers';
import {familyProfile} from './program-approval';
import {securityEvent} from './security-events';
import {notify, quietly} from './notify';
import {dayTime} from './datetime';

export type LessonSettings = {prices: Record<string, number | null>; splits: Record<string, number>; defaultSplit: number | null};
// Justin's decision on #197 (Q2): a lesson pays the coach 65% by default, for every lesson type. A share set for one
// coach on /lesson-settings replaces it for that coach; clearing the default field goes back to 65%.
export const DEFAULT_LESSON_SHARE = 65;
const EMPTY: LessonSettings = {prices: {}, splits: {}, defaultSplit: DEFAULT_LESSON_SHARE};

export async function lessonSettings(): Promise<LessonSettings> {
  const row = await env.DB!.prepare("SELECT payload FROM academy_settings WHERE id='lessons'").first<{payload: string}>();
  if (!row) return {...EMPTY, prices: {}, splits: {}};
  const p = JSON.parse(row.payload);
  return {prices: p.prices ?? {}, splits: p.splits ?? {}, defaultSplit: p.defaultSplit ?? DEFAULT_LESSON_SHARE};
}

const cents = (v: unknown) => v === null || v === '' || v === undefined ? null : Number.isSafeInteger(v) && (v as number) >= 50 && (v as number) <= 100000 ? v as number : undefined;
const pct = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100 ? v as number : undefined;

// Prices per format in cents, per wrestler (null = not bookable online), coach pay as a percentage per coach email (issue #75).
export async function saveLessonSettings(input: any, ownerId: string) {
  const current = await lessonSettings(), next: LessonSettings = {prices: {...current.prices}, splits: {...current.splits}, defaultSplit: current.defaultSplit};
  if (input?.prices !== undefined) {
    if (!input.prices || typeof input.prices !== 'object') return {status: 400, error: 'Check the lesson prices.'};
    for (const f of privateFormats) {
      if (!(f.id in input.prices)) continue;
      const c = cents(input.prices[f.id]);
      if (c === undefined) return {status: 400, error: `Enter a price between $0.50 and $1,000 for ${f.name}, or leave it blank.`};
      next.prices[f.id] = c;
    }
  }
  if (input?.splits !== undefined) {
    if (!input.splits || typeof input.splits !== 'object' || Array.isArray(input.splits)) return {status: 400, error: 'Check the coach pay percentages.'};
    const splits: Record<string, number> = {};
    for (const [email, v] of Object.entries(input.splits)) {
      if (!/^[^@\s]{1,64}@[^@\s]{1,190}$/.test(email)) return {status: 400, error: 'Check the coach pay percentages.'};
      if (v === null || v === '') continue;
      const n = pct(v); if (n === undefined) return {status: 400, error: 'Coach pay must be a whole percentage from 0 to 100.'};
      splits[email.toLowerCase()] = n;
    }
    next.splits = splits;
  }
  if (input?.defaultSplit !== undefined) {
    const n = input.defaultSplit === null || input.defaultSplit === '' ? null : pct(input.defaultSplit);
    if (n === undefined) return {status: 400, error: 'Coach pay must be a whole percentage from 0 to 100.'};
    next.defaultSplit = n;
  }
  const at = new Date().toISOString();
  await env.DB!.batch([
    env.DB!.prepare("INSERT INTO academy_settings(id,payload,updated_at,updated_by) VALUES ('lessons',?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,updated_by=excluded.updated_by")
      .bind(JSON.stringify(next), at, ownerId),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'lesson_settings_saved', 'lessons', at)
  ]);
  return {status: 200, settings: next};
}

// Minutes since midnight, New York time.
export function academyMinutes(now = new Date()) {
  const [h, m] = new Intl.DateTimeFormat('en-GB', {timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(now).split(':').map(Number);
  return h * 60 + m;
}
const toMinutes = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);

// Spots per format (decision in issue #177): one-on-one 1, partner 2, small group 3 to 6.
export const GROUP_SPOTS = {min: 3, max: 6};
export function lessonSpots(format: unknown, spots: unknown): {format: string | null; capacity: number | null} | {error: string} {
  if (format === null || format === undefined || format === '') return {format: null, capacity: null};
  if (format === 'one-on-one') return {format, capacity: 1};
  if (format === 'partner') return {format, capacity: 2};
  if (format === 'small-group') {
    const n = typeof spots === 'string' && /^\d+$/.test(spots) ? Number(spots) : spots;
    if (!Number.isInteger(n) || (n as number) < GROUP_SPOTS.min || (n as number) > GROUP_SPOTS.max) return {error: `A small group has ${GROUP_SPOTS.min} to ${GROUP_SPOTS.max} spots.`};
    return {format, capacity: n as number};
  }
  return {error: 'Choose a lesson type.'};
}

export type Opening = {id: string; date: string; start: string; end: string; coach: string; coachEmail: string; format: string | null; capacity: number;
  closed: boolean; inviteCode: string | null; organizerId: string | null; organizerWrestlers: string[]};
export type Holder = {id: string; userId: string; wrestlerId: string; wrestler: string; status: string; email: string; family: string | null; pricing: string};

// The coach's name is the one on their profile (issue #190), or their staff name until they save one.
const SELECT = `SELECT o.id,o.date,o.start,o.end,o.format,o.capacity,o.closed,o.invite_code,o.organizer_id,o.organizer_wrestlers,COALESCE(p.display_name,s.name) AS coach,s.email AS coachEmail
  FROM coach_openings o JOIN staff_access s ON s.email=o.coach_email AND s.active=1 LEFT JOIN coach_profiles p ON p.email=s.email`;
const opening = (r: any): Opening => ({id: r.id, date: r.date, start: r.start, end: r.end, coach: r.coach, coachEmail: r.coachEmail, format: r.format ?? null,
  capacity: Number.isInteger(r.capacity) && r.capacity > 0 ? r.capacity : 1, closed: r.closed === 1, inviteCode: r.invite_code ?? null,
  organizerId: r.organizer_id ?? null, organizerWrestlers: r.organizer_wrestlers ? JSON.parse(r.organizer_wrestlers) : []});
const upcoming = (o: {date: string; start: string}, today: string, nowMinutes: number) => o.date > today || (o.date === today && toMinutes(o.start) > nowMinutes);

// Paid orders and checkouts in progress on each opening, oldest first.
export async function lessonHolders(ids: string[]): Promise<Map<string, Holder[]>> {
  const out = new Map<string, Holder[]>(ids.map(id => [id, []]));
  const since = new Date(Date.now() - HOLD_MINUTES * 60000).toISOString();
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const rows = (await env.DB!.prepare(
      `SELECT x.id,x.user_id AS userId,x.wrestler_id AS wrestlerId,x.wrestler_name AS wrestler,x.status,x.email,x.item_id,x.pricing,f.payload AS family
       FROM orders x LEFT JOIN family_accounts f ON f.user_id=x.user_id
       WHERE x.kind='lesson' AND x.item_id IN (${part.map(() => '?').join(',')}) AND (x.status='paid' OR (x.status='pending' AND x.created_at>=?)) ORDER BY x.created_at,x.id`
    ).bind(...part, since).all<any>()).results;
    for (const r of rows) out.get(r.item_id)?.push({id: r.id, userId: r.userId, wrestlerId: r.wrestlerId, wrestler: r.wrestler, status: r.status, email: r.email, family: r.family, pricing: r.pricing});
  }
  return out;
}
// Organiser wrestlers whose kept spot is not yet paid for, with their names from the organiser's profile.
function keptWrestlers(o: Opening, holders: Holder[], profile: any) {
  return o.organizerWrestlers.filter(w => !holders.some(h => h.userId === o.organizerId && h.wrestlerId === w))
    .map(w => ({id: w, name: String((profile?.wrestlers ?? []).find((x: any) => x.id === w)?.name ?? 'Wrestler')}));
}
export const spotsLeft = (o: Opening, holders: Holder[]) => Math.max(0, o.capacity - holders.length - keptWrestlers(o, holders, null).length);

// Openings a family can still book: in the future, from an active coach, not a private group, with a spot left.
// The owner (recording payments) also sees private groups. Invite codes are never included.
export async function openLessons(today: string, nowMinutes = academyMinutes(), opts: {includeClosed?: boolean} = {}) {
  const rows = (await env.DB!.prepare(`${SELECT} WHERE o.date>=? ${opts.includeClosed ? '' : 'AND o.closed=0'} ORDER BY o.date,o.start,coach`).bind(today).all<any>()).results
    .map(opening).filter(o => upcoming(o, today, nowMinutes));
  const holders = await lessonHolders(rows.map(o => o.id));
  const organizers = new Map<string, string>();
  for (const o of rows) if (o.closed && o.organizerId && !organizers.has(o.organizerId))
    organizers.set(o.organizerId, (await familyProfile(o.organizerId))?.parentName || 'A family');
  // A spot kept for an organiser's wrestler is still open to that wrestler, so the owner can record its payment.
  return rows.map(o => ({id: o.id, date: o.date, start: o.start, end: o.end, coach: o.coach, coachEmail: o.coachEmail, format: o.format, capacity: o.capacity,
    spotsLeft: spotsLeft(o, holders.get(o.id)!), unpaid: o.capacity - holders.get(o.id)!.length,
    ...(opts.includeClosed ? {closed: o.closed, organizer: o.closed ? organizers.get(o.organizerId!) ?? 'A family' : null, kept: keptWrestlers(o, holders.get(o.id)!, null).length} : {})}))
    .filter(o => o.unpaid > 0).map(({unpaid, ...o}) => o);
}

export async function lessonOpening(id: unknown, today: string, nowMinutes = academyMinutes()): Promise<Opening | null> {
  if (typeof id !== 'string' || id.length > 80) return null;
  const r = await env.DB!.prepare(`${SELECT} WHERE o.id=?`).bind(id).first<any>();
  if (!r) return null;
  const o = opening(r);
  return upcoming(o, today, nowMinutes) ? o : null;
}
const validCode = (code: unknown): code is string => typeof code === 'string' && /^[A-Za-z0-9_-]{32}$/.test(code);
export async function openingByInvite(code: unknown, today: string, nowMinutes = academyMinutes()): Promise<Opening | null> {
  if (!validCode(code)) return null;
  const r = await env.DB!.prepare(`${SELECT} WHERE o.invite_code=? AND o.closed=1`).bind(code).first<any>();
  if (!r) return null;
  const o = opening(r);
  return upcoming(o, today, nowMinutes) ? o : null;
}
// May this family book into this opening? A private group needs its organiser or its invite code.
export const mayJoin = (o: Opening, userId: string, invite?: unknown) => !o.closed || o.organizerId === userId || (validCode(invite) && invite === o.inviteCode);

// Is any spot in this opening taken by a paid lesson or held by a checkout in progress?
export async function openingTaken(openingId: string) {
  return ((await lessonHolders([openingId])).get(openingId) ?? []).length > 0;
}

// 24 random bytes as base64url: 192 bits in 32 characters.
function inviteCode() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// A private group as a family sees it. The organiser also gets the invite code and who has joined; an invited family
// sees the lesson, who organised it and the spots left.
export async function groupView(o: Opening, userId: string) {
  const holders = (await lessonHolders([o.id])).get(o.id)!;
  const profile = o.organizerId ? await familyProfile(o.organizerId) : null;
  const mine = o.organizerId === userId;
  return {id: o.id, date: o.date, start: o.start, end: o.end, coach: o.coach, format: o.format, capacity: o.capacity, spotsLeft: spotsLeft(o, holders),
    organizer: profile?.parentName || 'A family', mine, booked: holders.filter(h => h.userId === userId).map(h => h.wrestlerId),
    ...(mine ? {inviteCode: o.inviteCode, roster: [...holders.map(h => ({wrestler: h.wrestler, status: h.status === 'paid' ? 'paid' : 'paying', own: h.userId === userId})),
      ...keptWrestlers(o, holders, profile).map(k => ({wrestler: k.name, status: 'kept', own: true}))]} : {})};
}

// The private groups this family organised that have not happened yet.
export async function familyGroups(userId: string, today: string, nowMinutes = academyMinutes()) {
  const rows = (await env.DB!.prepare(`${SELECT} WHERE o.organizer_id=? AND o.closed=1 AND o.date>=? ORDER BY o.date,o.start`).bind(userId, today).all<any>()).results
    .map(opening).filter(o => upcoming(o, today, nowMinutes));
  return Promise.all(rows.map(o => groupView(o, userId)));
}

// A family turns an ordinary open time into a private partner or small group (issue #177). Their own wrestlers take
// spots, kept for them until paid for; the rest are for families they invite. Every wrestler passes the card and
// waiver checks first. Nothing is charged here: each family pays for their own wrestler.
export async function requestGroup(userId: string, input: any, today: string): Promise<{status: number; error?: string; group?: any; extra?: Record<string, unknown>}> {
  if (!input || !['partner', 'small-group'].includes(input.format)) return {status: 400, error: 'Choose a partner lesson or a small group.'};
  const spots = lessonSpots(input.format, input.format === 'partner' ? 2 : input.spots);
  if ('error' in spots) return {status: 400, error: spots.error};
  const ids = Array.isArray(input.wrestlerIds) ? [...new Set(input.wrestlerIds.filter((x: unknown) => typeof x === 'string'))] as string[] : [];
  if (!ids.length) return {status: 400, error: 'Choose your wrestler.'};
  if (ids.length > spots.capacity!) return {status: 400, error: `This group has ${spots.capacity} spots. Choose fewer wrestlers or more spots.`};
  const profile = await familyProfile(userId), wrestlers = ids.map(id => profile?.wrestlers.find(w => w.id === id));
  if (wrestlers.some(w => !w)) return {status: 404, error: 'Saved wrestler not found in your account.'};
  const o = await lessonOpening(input.openingId, today);
  if (!o || o.closed || o.format !== null || await openingTaken(o.id)) return {status: 409, error: 'This lesson time is no longer available. Choose another time.'};
  const name = privateFormats.find(f => f.id === input.format)!.name;
  if (typeof (await lessonSettings()).prices[input.format] !== 'number') return {status: 409, error: `${name}s are not open for online booking yet. Contact the academy to arrange one.`};
  for (const w of wrestlers) {
    const card = await cardProblem(userId, w!, [o.date]);
    if (card) return {status: 403, error: card, extra: {usawRequired: true}};
    const waiver = await waiverProblem(userId, w!, [o.date]);
    if (waiver) return {status: 403, error: waiver, extra: {waiverRequired: true}};
  }
  const since = new Date(Date.now() - HOLD_MINUTES * 60000).toISOString();
  const row = await env.DB!.prepare(
    `UPDATE coach_openings SET format=?,capacity=?,closed=1,invite_code=?,organizer_id=?,organizer_wrestlers=? WHERE id=? AND format IS NULL AND closed=0
     AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.kind='lesson' AND x.item_id=coach_openings.id AND (x.status='paid' OR (x.status='pending' AND x.created_at>=?))) RETURNING id`
  ).bind(input.format, spots.capacity, inviteCode(), userId, JSON.stringify(ids), o.id, since).first();
  if (!row) return {status: 409, error: 'Another family just took this lesson time. Choose another time.'};
  await securityEvent(userId, 'lesson_group_requested', o.id);
  return {status: 200, group: await groupView((await lessonOpening(o.id, today))!, userId)};
}

// The organiser can call off a private group while nobody has paid for a spot. The time opens again for everyone.
export async function cancelGroup(userId: string, openingId: unknown, today: string) {
  const o = await lessonOpening(openingId, today);
  if (!o || !o.closed || o.organizerId !== userId) return {status: 404, error: 'Group not found.'};
  if (await openingTaken(o.id)) return {status: 409, error: 'A spot in this group is already paid for. Message the academy to change it.'};
  await env.DB!.prepare('UPDATE coach_openings SET format=NULL,capacity=NULL,closed=0,invite_code=NULL,organizer_id=NULL,organizer_wrestlers=NULL WHERE id=? AND organizer_id=?').bind(o.id, userId).run();
  await securityEvent(userId, 'lesson_group_canceled', o.id);
  return {status: 200};
}

// Whose openings (issue #239): the coach's staff email, which families book against, and the account the coach signs in
// with. Openings match either, so ones made before issue #70 (no email yet) and ones the owner added before the coach
// ever opened coach home (filed under a placeholder account until then, claimOpenings) both belong to the coach.
// The same functions serve coach home and the owner, so the rules are the same for both. byOwner only changes wording.
export type CoachRef = {email: string; name: string; userId: string};
type Who = {byOwner?: boolean};
const MINE = '(coach_email=? OR user_id=?)';
const mine = (c: CoachRef) => [c.email.toLowerCase(), c.userId];
// How many weeks a repeating opening can cover (issue #190): up to 12 weeks ahead (#197, question 21).
export const MAX_WEEKS = 12;
export const pendingAccount = (email: string) => 'staff:' + email.toLowerCase();
// The account an owner-added opening is filed under: the coach's own account when the site has seen it sign in as this
// coach, otherwise the placeholder.
export async function coachAccount(email: string) {
  const e = email.toLowerCase(), real = "user_id NOT LIKE 'staff:%' AND user_id NOT LIKE 'former-coach-%'";
  const r = await env.DB!.prepare(`SELECT user_id FROM coach_openings WHERE coach_email=? AND ${real} UNION ALL SELECT user_id FROM coach_time_entries WHERE coach_email=? AND ${real}
    UNION ALL SELECT user_id FROM coach_time_off WHERE coach_email=? AND ${real} LIMIT 1`).bind(e, e, e).first<{user_id: string}>();
  return r?.user_id ?? pendingAccount(e);
}
// On coach home: link openings made before issue #70 to the coach's email, and claim the ones the owner added for them.
export async function claimOpenings(coach: CoachRef) {
  await env.DB!.batch([
    env.DB!.prepare('UPDATE coach_openings SET coach_email=? WHERE user_id=? AND coach_email IS NULL').bind(coach.email.toLowerCase(), coach.userId),
    env.DB!.prepare('UPDATE coach_openings SET user_id=? WHERE coach_email=? AND user_id=?').bind(coach.userId, coach.email.toLowerCase(), pendingAccount(coach.email))
  ]);
}

const realDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
const clockText = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const addDays = (date: string, n: number) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// Adds a one-hour opening. The lesson type (issue #177): blank is an ordinary open time; partner and small group are
// coach-hosted groups. Repeat weekly (issue #190): the same time, type and spots on the same weekday for up to MAX_WEEKS
// weeks, each week its own opening. A week that overlaps one of the coach's openings is skipped, never doubled.
export async function addOpenings(coach: CoachRef, input: any, who: Who = {}): Promise<{status: number; error?: string; created?: string[]; skipped?: string[]}> {
  if (!realDate(input?.date) || !clockText(input.start) || !clockText(input.end)) return {status: 400, error: 'Choose a valid date and times.'};
  if (toMinutes(input.end) - toMinutes(input.start) !== 60) return {status: 400, error: 'Each opening must be exactly one hour.'};
  const type = lessonSpots(input.format, input.spots);
  if ('error' in type) return {status: 400, error: type.error};
  const weeks = input.weeks === undefined || input.weeks === null ? 1 : typeof input.weeks === 'string' && /^\d+$/.test(input.weeks) ? Number(input.weeks) : input.weeks;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) return {status: 400, error: `Repeat for 1 to ${MAX_WEEKS} weeks.`};
  const dates = Array.from({length: weeks}, (_, i) => addDays(input.date, 7 * i));
  const insert = (date: string) => env.DB!.prepare(`INSERT INTO coach_openings (id,user_id,date,start,end,coach_email,format,capacity) SELECT ?,?,?,?,?,?,?,?
    WHERE NOT EXISTS (SELECT 1 FROM coach_openings WHERE ${MINE} AND date=? AND start<? AND end>?) RETURNING date`)
    .bind(crypto.randomUUID(), coach.userId, date, input.start, input.end, coach.email.toLowerCase(), type.format, type.capacity, ...mine(coach), date, input.end, input.start);
  const results = await env.DB!.batch(dates.map(insert));
  const created = dates.filter((_, i) => (results[i] as any).results?.length), skipped = dates.filter(d => !created.includes(d));
  const theirs = who.byOwner ? `one of ${coach.name}’s existing openings` : 'one of your existing openings';
  if (!created.length) return {status: 409, error: weeks === 1 ? `This opening overlaps ${theirs}.` : `Every one of those weeks overlaps ${theirs}.`};
  return {status: 200, created, skipped};
}

// Removes an opening nobody has booked. A paid lesson or a checkout in progress keeps it, checked again in the delete
// itself so a checkout that starts meanwhile still wins. A family's private group request on this time is called off
// with it, and the family is told (issue #177).
export async function removeOpening(coach: CoachRef, id: unknown, who: Who = {}): Promise<{status: number; error?: string; removed?: {date: string; start: string}}> {
  if (typeof id !== 'string' || id.length > 80) return {status: 404, error: 'Opening not found.'};
  const booked = `A family has booked this lesson (or is paying for it now). ${who.byOwner ? 'Move or refund it' : 'Ask the academy to move or refund it'} before removing the opening.`;
  if (await openingTaken(id)) return {status: 409, error: booked};
  const since = new Date(Date.now() - HOLD_MINUTES * 60000).toISOString();
  const row = await env.DB!.prepare(`DELETE FROM coach_openings WHERE id=? AND ${MINE}
    AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.kind='lesson' AND x.item_id=coach_openings.id AND (x.status='paid' OR (x.status='pending' AND x.created_at>=?))) RETURNING date,start,organizer_id`)
    .bind(id, ...mine(coach), since).first<{date: string; start: string; organizer_id: string | null}>();
  if (!row) return await env.DB!.prepare(`SELECT 1 FROM coach_openings WHERE id=? AND ${MINE}`).bind(id, ...mine(coach)).first() ? {status: 409, error: booked} : {status: 404, error: 'Opening not found.'};
  if (row.organizer_id) {
    const fam = await env.DB!.prepare('SELECT email FROM family_accounts WHERE user_id=?').bind(row.organizer_id).first<{email: string}>();
    if (fam) await quietly(() => notify([{userId: row.organizer_id, email: fam.email, kind: 'lesson_group_canceled', dedupeKey: `lesson-group-off:${id}`, link: '/lesson',
      subject: `Lesson called off: ${dayTime(row.date, row.start)}`,
      body: `${coach.name} can no longer teach at ${dayTime(row.date, row.start)}, so the private group you asked for is called off. Nothing was paid for it. Choose another time on the lesson page.`}]));
  }
  return {status: 200, removed: {date: row.date, start: row.start}};
}

// Changes the lesson type or spots of an opening. Once anything is booked the type stays, and the spots cannot drop
// below the wrestlers booked. A family's private group is theirs, so neither the coach nor the owner changes it here.
export async function updateOpening(coach: CoachRef, input: any, who: Who = {}) {
  const o = typeof input?.id === 'string' ? await env.DB!.prepare(`SELECT id,format,closed FROM coach_openings WHERE id=? AND ${MINE}`).bind(input.id, ...mine(coach)).first<{id: string; format: string | null; closed: number}>() : null;
  if (!o) return {status: 404, error: 'Opening not found.'};
  if (o.closed === 1) return {status: 409, error: `A family asked for this time as a private group, so the lesson type is theirs. ${who.byOwner ? 'Message the family' : 'Ask the academy'} to change it.`};
  const next = lessonSpots(input.format, input.spots);
  if ('error' in next) return {status: 400, error: next.error};
  const booked = ((await lessonHolders([o.id])).get(o.id) ?? []).length;
  if (booked && (next.format ?? 'one-on-one') !== (o.format ?? 'one-on-one')) return {status: 409, error: 'A family has booked this lesson, so its type can’t change.'};
  if (booked > (next.capacity ?? 1)) return {status: 409, error: `${booked} wrestlers are booked, so this lesson needs at least ${booked} spots.`};
  await env.DB!.prepare(`UPDATE coach_openings SET format=?,capacity=? WHERE id=? AND ${MINE}`).bind(next.format, next.capacity, o.id, ...mine(coach)).run();
  return {status: 200};
}

// A coach's openings with each lesson's roster, for the coach page: the wrestlers with their parent's name and phone,
// spots left, and whether the coach posted it or a family asked for it as a private group.
// from: only lessons on or after this date (the owner's view of a coach lists what is still to come).
export async function coachSchedule(coach: CoachRef, from = '') {
  const rows = (await env.DB!.prepare(
    `SELECT o.id,o.date,o.start,o.end,o.format,o.capacity,o.closed,o.organizer_id,o.organizer_wrestlers,f.payload AS organizer FROM coach_openings o
     LEFT JOIN family_accounts f ON f.user_id=o.organizer_id WHERE (o.coach_email=? OR o.user_id=?) AND o.date>=? ORDER BY o.date,o.start`
  ).bind(...mine(coach), from).all<any>()).results;
  const holders = await lessonHolders(rows.map(r => r.id));
  const names = new Map(privateFormats.map(f => [f.id, f.name]));
  return rows.map(r => {
    const o = opening({...r, coach: '', coachEmail: ''}), list = holders.get(r.id)!, org = r.organizer ? JSON.parse(r.organizer) : null;
    const fam = (h: Holder) => h.family ? JSON.parse(h.family) : {};
    // Lessons booked before issue #177 carry the type they were booked as, and any typed-in training partners.
    const old = list.length ? JSON.parse(list[0].pricing || '{}') : null;
    const format = o.format ?? (list.length ? old?.format ?? 'one-on-one' : null);
    return {id: r.id, date: r.date, start: r.start, end: r.end, format, formatName: format ? names.get(format) ?? old?.formatName ?? '' : '',
      capacity: o.capacity, spotsLeft: spotsLeft(o, list), hosted: o.closed ? 'family' : o.format && o.capacity > 1 ? 'coach' : null,
      organizer: o.closed ? org?.parentName || 'A family' : null, partners: old?.partners ?? '',
      roster: [...list.map(h => ({wrestler: h.wrestler, parent: fam(h).parentName ?? '', phone: fam(h).phone ?? '', email: h.email, status: h.status === 'paid' ? 'paid' : 'paying'})),
        ...keptWrestlers(o, list, org).map(k => ({wrestler: k.name, parent: org?.parentName ?? '', phone: org?.phone ?? '', email: '', status: 'kept'}))]};
  });
}
