// Private lessons booked against real coach openings (issue #70). A coach posts one-hour openings; a family picks one,
// a lesson format at the owner's price, and pays. A paid lesson (or a checkout in progress) takes the opening, so it
// cannot be booked twice. Formats without an owner price are not bookable online.
import {env} from 'cloudflare:workers';
import {privateFormats} from './public-schedule';
import {HOLD_MINUTES} from './capacity';

export type LessonSettings = {prices: Record<string, number | null>; splits: Record<string, number>; defaultSplit: number | null};
const EMPTY: LessonSettings = {prices: {}, splits: {}, defaultSplit: null};

export async function lessonSettings(): Promise<LessonSettings> {
  const row = await env.DB!.prepare("SELECT payload FROM academy_settings WHERE id='lessons'").first<{payload: string}>();
  if (!row) return {...EMPTY, prices: {}, splits: {}};
  const p = JSON.parse(row.payload);
  return {prices: p.prices ?? {}, splits: p.splits ?? {}, defaultSplit: p.defaultSplit ?? null};
}

const cents = (v: unknown) => v === null || v === '' || v === undefined ? null : Number.isSafeInteger(v) && (v as number) >= 50 && (v as number) <= 100000 ? v as number : undefined;
const pct = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100 ? v as number : undefined;

// Prices per format in cents (null = not bookable online), coach pay as a percentage per coach email (issue #75).
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

export type Opening = {id: string; date: string; start: string; end: string; coach: string; coachEmail: string};

// Openings a family can still book: in the future, from an active coach, and not taken or held by a checkout.
export async function openLessons(today: string, nowMinutes = academyMinutes()): Promise<Opening[]> {
  const since = new Date(Date.now() - HOLD_MINUTES * 60000).toISOString();
  const rows = (await env.DB!.prepare(
    `SELECT o.id,o.date,o.start,o.end,s.name AS coach,s.email AS coachEmail FROM coach_openings o JOIN staff_access s ON s.email=o.coach_email AND s.active=1
     WHERE o.date>=? AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.kind='lesson' AND x.item_id=o.id AND (x.status='paid' OR (x.status='pending' AND x.created_at>=?)))
     ORDER BY o.date,o.start,s.name LIMIT 500`
  ).bind(today, since).all<Opening>()).results;
  return rows.filter(o => o.date > today || toMinutes(o.start) > nowMinutes);
}

export async function lessonOpening(id: unknown, today: string, nowMinutes = academyMinutes()): Promise<Opening | null> {
  if (typeof id !== 'string' || id.length > 80) return null;
  const o = await env.DB!.prepare(
    `SELECT o.id,o.date,o.start,o.end,s.name AS coach,s.email AS coachEmail FROM coach_openings o JOIN staff_access s ON s.email=o.coach_email AND s.active=1 WHERE o.id=?`
  ).bind(id).first<Opening>();
  if (!o || o.date < today || (o.date === today && toMinutes(o.start) <= nowMinutes)) return null;
  return o;
}

// Is this opening taken by a paid lesson or held by a checkout in progress?
export async function openingTaken(openingId: string) {
  const since = new Date(Date.now() - HOLD_MINUTES * 60000).toISOString();
  return !!(await env.DB!.prepare("SELECT 1 FROM orders WHERE kind='lesson' AND item_id=? AND (status='paid' OR (status='pending' AND created_at>=?)) LIMIT 1").bind(openingId, since).first());
}

// A coach's openings with the lesson booked into each, for the coach page.
export async function coachSchedule(userId: string) {
  const rows = (await env.DB!.prepare(
    `SELECT o.id,o.date,o.start,o.end,x.id AS orderId,x.wrestler_name AS wrestler,x.pricing,f.payload AS family,x.email
     FROM coach_openings o LEFT JOIN orders x ON x.kind='lesson' AND x.item_id=o.id AND x.status='paid' LEFT JOIN family_accounts f ON f.user_id=x.user_id
     WHERE o.user_id=? ORDER BY o.date,o.start`
  ).bind(userId).all<any>()).results;
  return rows.map(r => {
    const p = r.pricing ? JSON.parse(r.pricing) : null, fam = r.family ? JSON.parse(r.family) : null;
    return {id: r.id, date: r.date, start: r.start, end: r.end,
      booking: r.orderId ? {wrestler: r.wrestler, format: p?.formatName ?? '', partners: p?.partners ?? '', parent: fam?.parentName ?? '', phone: fam?.phone ?? '', email: r.email} : null};
  });
}
