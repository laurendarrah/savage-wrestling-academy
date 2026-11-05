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
export async function seatHolders(eventId: string, dates: string[], now = Date.now()) {
  const since = new Date(now - HOLD_MINUTES * 60000).toISOString();
  const rows = (await env.DB!.prepare(
    `SELECT id,dates FROM orders WHERE kind='event' AND item_id=? AND (status='paid' OR (status='pending' AND created_at>=?)) ORDER BY created_at,id`
  ).bind(eventId, since).all<{id: string; dates: string}>()).results;
  const byDate = new Map<string, string[]>(dates.map(d => [d, []]));
  for (const r of rows) for (const d of JSON.parse(r.dates) as string[]) byDate.get(d)?.push(r.id);
  return byDate;
}

export async function seatsLeft(eventId: string, dates: string[], slots: number) {
  const holders = await seatHolders(eventId, dates);
  return Math.min(...dates.map(d => slots - (holders.get(d)?.length ?? 0)));
}

// After inserting a pending order: does it rank within the limit on every date it needs?
export async function withinCapacity(orderId: string, eventId: string, dates: string[], slots: number) {
  const holders = await seatHolders(eventId, dates);
  return dates.every(d => { const i = holders.get(d)!.indexOf(orderId); return i >= 0 && i < slots; });
}
