// Waitlists for full camps and events (issue #73). Families join when an event is full. The owner chooses whom to
// offer a freed seat to and for how long. An offer holds the seat for that family (lib/capacity.ts) until it expires.
// If the owner ticked "pass on", an expired offer goes to the next family waiting, in the order they joined.
// There is no email yet (issue #72): families see offers in their account, and the owner can email them.
import {env} from 'cloudflare:workers';
import {familyProfile} from './program-approval';
import {publicSchedule, academyToday} from './public-schedule';
import {eventSlots, seatsLeft} from './capacity';

const nowIso = () => new Date().toISOString();
const hoursFrom = (h: number) => new Date(Date.now() + h * 3600000).toISOString();

async function academyState(): Promise<any> {
  const row = await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload: string}>();
  return row ? JSON.parse(row.payload) : {};
}
async function eventById(id: string) {
  const state = await academyState(), today = academyToday();
  const e = publicSchedule(state, today.slice(0, 7), today).events.find((x: any) => x.id === id);
  return e ? {event: e, slots: eventSlots(state, id)} : null;
}

// Expire lapsed offers, passing each seat on to the next family when the owner asked for that.
export async function settleOffers(eventId?: string) {
  const at = nowIso();
  const lapsed = (await env.DB!.prepare(`SELECT id,event_id,offer_hours,auto_next,offered_by FROM waitlist_entries WHERE status='offered' AND offer_expires_at<=? ${eventId ? 'AND event_id=?' : ''} ORDER BY offer_expires_at`)
    .bind(...(eventId ? [at, eventId] : [at])).all<any>()).results;
  for (const o of lapsed) {
    const done = await env.DB!.prepare("UPDATE waitlist_entries SET status='expired',closed_at=? WHERE id=? AND status='offered'").bind(at, o.id).run();
    if (!o.auto_next || !(done.meta?.changes ?? (done as any).changes)) continue;
    const next = await env.DB!.prepare("SELECT id FROM waitlist_entries WHERE event_id=? AND status='waiting' ORDER BY created_at,id LIMIT 1").bind(o.event_id).first<{id: string}>();
    if (next) await env.DB!.prepare("UPDATE waitlist_entries SET status='offered',offered_at=?,offer_expires_at=?,offer_hours=?,auto_next=1,offered_by=? WHERE id=? AND status='waiting'")
      .bind(at, hoursFrom(o.offer_hours), o.offer_hours, o.offered_by, next.id).run();
  }
}

export async function activeOffer(eventId: string, userId: string, wrestlerId: string) {
  return await env.DB!.prepare("SELECT id,option,offer_expires_at FROM waitlist_entries WHERE event_id=? AND user_id=? AND wrestler_id=? AND status='offered' AND offer_expires_at>?")
    .bind(eventId, userId, wrestlerId, nowIso()).first<{id: string; option: string; offer_expires_at: string}>();
}

// Called when a family pays for an event (online or recorded by the owner): their offer or waiting entry is done.
export function acceptStatement(eventId: string, userId: string, wrestlerId: string, at: string) {
  return env.DB!.prepare("UPDATE waitlist_entries SET status='accepted',closed_at=? WHERE event_id=? AND user_id=? AND wrestler_id=? AND status IN ('waiting','offered')").bind(at, eventId, userId, wrestlerId);
}

export async function joinWaitlist(user: {id: string; email: string}, input: any) {
  const found = typeof input?.eventId === 'string' ? await eventById(input.eventId) : null;
  if (!found) return {status: 404, error: 'This event is no longer available.'};
  const {event, slots} = found;
  const w = (await familyProfile(user.id))?.wrestlers.find(x => x.id === input.wrestlerId);
  if (!w) return {status: 404, error: 'Choose a saved wrestler from your family account.'};
  const option = input.option && input.option !== 'full' ? String(input.option) : 'full';
  if (option !== 'full' && !event.dates.includes(option)) return {status: 400, error: 'Choose a day of this event.'};
  const dates = option === 'full' ? event.dates : [option];
  await settleOffers(event.id);
  const full = event.full || (slots !== null && await seatsLeft(event.id, dates, slots, 'event', {userId: user.id, wrestlerId: w.id}) <= 0);
  if (!full) return {status: 409, error: 'There are seats left. Book it now instead of joining the waitlist.'};
  try {
    await env.DB!.prepare("INSERT INTO waitlist_entries(id,event_id,option,dates,user_id,wrestler_id,wrestler_name,email,status,created_at) VALUES (?,?,?,?,?,?,?,?,'waiting',?)")
      .bind(crypto.randomUUID(), event.id, option, JSON.stringify(dates), user.id, w.id, w.name, user.email, nowIso()).run();
  } catch {
    return {status: 409, error: `${w.name} is already on this waitlist.`};
  }
  return {status: 200};
}

export async function withdraw(userId: string, entryId: unknown) {
  if (typeof entryId !== 'string') return {status: 400, error: 'Choose a waitlist entry.'};
  const r = await env.DB!.prepare("UPDATE waitlist_entries SET status='withdrawn',closed_at=? WHERE id=? AND user_id=? AND status IN ('waiting','offered')").bind(nowIso(), entryId, userId).run();
  return (r.meta?.changes ?? (r as any).changes) ? {status: 200} : {status: 404, error: 'Waitlist entry not found.'};
}

export async function offerSeat(ownerId: string, entryId: unknown, hours: unknown, autoNext: unknown) {
  if (typeof entryId !== 'string') return {status: 400, error: 'Choose a family.'};
  if (!Number.isInteger(hours) || (hours as number) < 1 || (hours as number) > 168) return {status: 400, error: 'Hold the seat for 1 to 168 hours.'};
  const at = nowIso();
  const r = await env.DB!.prepare("UPDATE waitlist_entries SET status='offered',offered_at=?,offer_expires_at=?,offer_hours=?,auto_next=?,offered_by=? WHERE id=? AND status='waiting'")
    .bind(at, hoursFrom(hours as number), hours, autoNext === true ? 1 : 0, ownerId, entryId).run();
  if (!(r.meta?.changes ?? (r as any).changes)) return {status: 409, error: 'This family is no longer waiting. Reload the list.'};
  await env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'waitlist_offer', entryId, at).run();
  return {status: 200};
}

export async function removeEntry(ownerId: string, entryId: unknown) {
  if (typeof entryId !== 'string') return {status: 400, error: 'Choose a family.'};
  const r = await env.DB!.prepare("UPDATE waitlist_entries SET status='removed',closed_at=? WHERE id=? AND status IN ('waiting','offered')").bind(nowIso(), entryId).run();
  return (r.meta?.changes ?? (r as any).changes) ? {status: 200} : {status: 404, error: 'Waitlist entry not found.'};
}

export async function familyWaitlist(userId: string) {
  await settleOffers();
  const state = await academyState(), names = new Map((state.events ?? []).map((e: any) => [e.id, e.name]));
  const rows = (await env.DB!.prepare("SELECT * FROM waitlist_entries WHERE user_id=? AND (status IN ('waiting','offered') OR closed_at>=?) ORDER BY created_at DESC")
    .bind(userId, new Date(Date.now() - 30 * 86400000).toISOString()).all<any>()).results;
  const out = [];
  for (const r of rows) {
    const ahead = r.status === 'waiting' ? (await env.DB!.prepare("SELECT count(*) n FROM waitlist_entries WHERE event_id=? AND status='waiting' AND (created_at<? OR (created_at=? AND id<?))").bind(r.event_id, r.created_at, r.created_at, r.id).first<{n: number}>())!.n : null;
    out.push({id: r.id, eventId: r.event_id, event: names.get(r.event_id) ?? 'Event', option: r.option, dates: JSON.parse(r.dates), wrestler: r.wrestler_name, status: r.status,
      position: ahead === null ? null : ahead + 1, offerExpiresAt: r.status === 'offered' ? r.offer_expires_at : null, joinedAt: r.created_at});
  }
  return out;
}

export async function ownerWaitlists() {
  await settleOffers();
  const state = await academyState();
  const rows = (await env.DB!.prepare("SELECT w.*,f.payload AS family FROM waitlist_entries w LEFT JOIN family_accounts f ON f.user_id=w.user_id WHERE w.status IN ('waiting','offered') OR w.closed_at>=? ORDER BY w.created_at,w.id")
    .bind(new Date(Date.now() - 14 * 86400000).toISOString()).all<any>()).results;
  const events = [...new Set(rows.map(r => r.event_id))].map(id => {
    const e = (state.events ?? []).find((x: any) => x.id === id), slots = eventSlots(state, id);
    let position = 0;
    return {eventId: id, name: e?.name ?? 'Archived event', dates: e?.dates ?? [], slots, manuallyFull: Number(e?.slots) === 0,
      entries: rows.filter(r => r.event_id === id).map(r => {
        const fam = r.family ? JSON.parse(r.family) : {};
        return {id: r.id, wrestler: r.wrestler_name, parent: fam.parentName ?? '', email: r.email, phone: fam.phone ?? '', option: r.option, status: r.status,
          position: r.status === 'waiting' ? ++position : null, joinedAt: r.created_at, offerExpiresAt: r.offer_expires_at, autoNext: !!r.auto_next};
      })};
  });
  for (const e of events) (e as any).seatsLeft = e.slots === null || !e.dates.length ? null : await seatsLeft(e.eventId, e.dates, e.slots);
  return events;
}
