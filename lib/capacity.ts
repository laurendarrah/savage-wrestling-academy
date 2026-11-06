// Camp, clinic and event seat limits (issue #36). A seat is taken by a paid registration, or held by a checkout
// started within the hold window. A full-camp registration takes a seat on every day; a single day takes one day.
import {env} from 'cloudflare:workers';

export const HOLD_MINUTES = 35; // Checkout sessions expire after 30 minutes; keep a small margin.

// The owner's seat limit for an event, or null when unlimited.
export function eventSlots(state: any, eventId: string): number | null {
  const e = (Array.isArray(state?.events) ? state.events : []).find((x: any) => x?.id === eventId);
  const n = Number(e?.slots);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Order ids holding a seat on each date, oldest first.
export async function seatHolders(eventId: string, dates: string[], now = Date.now(), kind: 'event' | 'lesson' = 'event') {
  const since = new Date(now - HOLD_MINUTES * 60000).toISOString();
  const rows = (await env.DB!.prepare(
    `SELECT id,dates FROM orders WHERE kind=? AND item_id=? AND (status='paid' OR (status='pending' AND created_at>=?)) ORDER BY created_at,id`
  ).bind(kind, eventId, since).all<{id: string; dates: string}>()).results;
  const byDate = new Map<string, string[]>(dates.map(d => [d, []]));
  for (const r of rows) for (const d of JSON.parse(r.dates) as string[]) byDate.get(d)?.push(r.id);
  return byDate;
}

type Family = {userId: string; wrestlerId: string};
// Seats held by waitlist offers that have not expired (issue #73), per date. A family's own offer is not counted
// against them: the offer is their seat.
export async function offerHolds(eventId: string, dates: string[], except?: Family | null, now = Date.now()) {
  const rows = (await env.DB!.prepare("SELECT dates,user_id,wrestler_id FROM waitlist_entries WHERE event_id=? AND status='offered' AND offer_expires_at>?")
    .bind(eventId, new Date(now).toISOString()).all<{dates: string; user_id: string; wrestler_id: string}>()).results;
  const held = new Map<string, number>(dates.map(d => [d, 0]));
  for (const r of rows) {
    if (except && r.user_id === except.userId && r.wrestler_id === except.wrestlerId) continue;
    for (const d of JSON.parse(r.dates) as string[]) if (held.has(d)) held.set(d, held.get(d)! + 1);
  }
  return held;
}

// Spots in a family-requested lesson group kept for the organising family's own wrestlers (issue #177), until each of
// them is paid for (or held by a checkout). Like a waitlist offer, a wrestler's own kept spot is not counted against them.
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
  const offers = kind === 'event' ? await offerHolds(eventId, dates, family) : null;
  const kept = kind === 'lesson' ? await lessonReserved(eventId, family) : 0;
  return Math.min(...dates.map(d => slots - (holders.get(d)?.length ?? 0) - (offers?.get(d) ?? 0) - kept));
}

// After inserting a pending order: does it rank within the limit on every date it needs?
// Lessons use the same rule with one seat per wrestler, up to the lesson's spots (issues #70, #177). Seats offered to
// other families from the waitlist, and spots kept for an organising family's wrestlers, are reserved for them.
export async function withinCapacity(orderId: string, eventId: string, dates: string[], slots: number, kind: 'event' | 'lesson' = 'event') {
  const holders = await seatHolders(eventId, dates, Date.now(), kind);
  const own = await env.DB!.prepare('SELECT user_id AS userId,wrestler_id AS wrestlerId FROM orders WHERE id=?').bind(orderId).first<Family>();
  const offers = kind === 'event' ? await offerHolds(eventId, dates, own) : null;
  const kept = kind === 'lesson' ? await lessonReserved(eventId, own) : 0;
  return dates.every(d => { const i = holders.get(d)!.indexOf(orderId); return i >= 0 && i < slots - (offers?.get(d) ?? 0) - kept; });
}
