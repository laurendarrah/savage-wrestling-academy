// Camp, clinic and event seat limits (issue #36). A seat is taken by a paid registration, held by a checkout started
// within the hold window, or held by a booking to pay cash at the academy that is still unpaid (#273; once the cash is
// received, the paid order holds it instead). A full-camp registration takes a seat on every day; a single day takes one.
import {env} from 'cloudflare:workers';

export const HOLD_MINUTES = 35; // Checkout sessions expire after 30 minutes; keep a small margin.

// The owner's seat limit for an event, or null when unlimited.
export function eventSlots(state: any, eventId: string): number | null {
  const e = (Array.isArray(state?.events) ? state.events : []).find((x: any) => x?.id === eventId);
  const n = Number(e?.slots);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Order ids (and, for events, unpaid cash booking ids) holding a seat on each date, oldest first.
export async function seatHolders(eventId: string, dates: string[], now = Date.now(), kind: 'event' | 'lesson' = 'event') {
  const since = new Date(now - HOLD_MINUTES * 60000).toISOString();
  const rows = (await env.DB!.prepare(kind === 'event'
    ? `SELECT id,dates,created_at FROM orders WHERE kind='event' AND item_id=?1 AND (status='paid' OR (status='pending' AND created_at>=?2))
       UNION ALL SELECT id,CASE WHEN json_array_length(dates)>0 THEN dates ELSE json_array(session_date) END,created_at FROM cash_bookings WHERE kind='event' AND item_id=?1 AND status='due'
       ORDER BY created_at,id`
    : `SELECT id,dates,created_at FROM orders WHERE kind='lesson' AND item_id=?1 AND (status='paid' OR (status='pending' AND created_at>=?2)) ORDER BY created_at,id`
  ).bind(eventId, since).all<{id: string; dates: string}>()).results;
  const byDate = new Map<string, string[]>(dates.map(d => [d, []]));
  for (const r of rows) for (const d of JSON.parse(r.dates) as string[]) byDate.get(d)?.push(r.id);
  return byDate;
}

type Family = {userId: string; wrestlerId: string};
// There are no waitlists (decision Q10 in #197, issue #210): a full camp or event is simply full. Old waitlist rows stay
// in the database and backups for the record, but an old seat offer no longer holds a seat.

// Spots in a family-requested lesson group kept for the organising family's own wrestlers (issue #177), until each of
// them is paid for (or held by a checkout). A wrestler's own kept spot is not counted against them.
export async function lessonReserved(openingId: string, except?: Family | null, now = Date.now()) {
  const o = await env.DB!.prepare('SELECT organizer_id,organizer_wrestlers FROM coach_openings WHERE id=?').bind(openingId).first<{organizer_id: string | null; organizer_wrestlers: string | null}>();
  if (!o?.organizer_id) return 0;
  const kept: string[] = JSON.parse(o.organizer_wrestlers || '[]');
  const since = new Date(now - HOLD_MINUTES * 60000).toISOString();
  const held = new Set((await env.DB!.prepare("SELECT wrestler_id FROM orders WHERE kind='lesson' AND item_id=? AND user_id=? AND (status='paid' OR (status='pending' AND created_at>=?))")
    .bind(openingId, o.organizer_id, since).all<{wrestler_id: string}>()).results.map(r => r.wrestler_id));
  return kept.filter(w => !held.has(w) && !(except && except.userId === o.organizer_id && except.wrestlerId === w)).length;
}

export async function seatsLeft(eventId: string, dates: string[], slots: number, kind: 'event' | 'lesson' = 'event', family?: Family | null) {
  const holders = await seatHolders(eventId, dates, Date.now(), kind);
  const kept = kind === 'lesson' ? await lessonReserved(eventId, family) : 0;
  return Math.min(...dates.map(d => slots - (holders.get(d)?.length ?? 0) - kept));
}

// After inserting a pending order: does it rank within the limit on every date it needs?
// Lessons use the same rule with one seat per wrestler, up to the lesson's spots (issues #70, #177). Spots kept for an
// organising family's wrestlers are reserved for them.
export async function withinCapacity(orderId: string, eventId: string, dates: string[], slots: number, kind: 'event' | 'lesson' = 'event') {
  const holders = await seatHolders(eventId, dates, Date.now(), kind);
  const own = kind === 'lesson' ? await env.DB!.prepare('SELECT user_id AS userId,wrestler_id AS wrestlerId FROM orders WHERE id=?').bind(orderId).first<Family>() : null;
  const kept = kind === 'lesson' ? await lessonReserved(eventId, own) : 0;
  return dates.every(d => { const i = holders.get(d)!.indexOf(orderId); return i >= 0 && i < slots - kept; });
}
