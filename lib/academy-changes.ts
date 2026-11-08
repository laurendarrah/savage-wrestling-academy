// What an academy settings save would do to real bookings, and what it changed (issue #272).
//
// Rosters are rebuilt from the saved schedule (lib/roster.ts), so a save that drops a practice date (a day off, a
// shorter or removed season, a weekday taken out) or an event or extra-practice date leaves the families who paid for
// that session, or booked it to pay cash at the academy, with nowhere to go: their payment stays, the roster forgets
// them and a cash booking stays due for ever. blockedChanges() lists those sessions, in plain words, so the owner's save
// can be refused until they are moved or refunded. Only sessions the saved settings still offer today count, so a save
// never gets stuck on something that was already gone; past dates are not checked (attendance keeps its own record).
// A practice whose time changes on the same day is not a problem: walk-ins are keyed by program and date.
//
// changeSummary() is the one line written to security_events for every save: prices, schedules, events, extra
// practices and team codes, so Security activity shows what changed and when.
import {env} from 'cloudflare:workers';
import {sessionsOn, type Session} from './roster';
import {clockTime, dayDate, fullDate} from './datetime';
import {upgradeProgramNames} from './program-names';

type Group = {kind: 'walkin' | 'event' | 'live'; id: string; date: string; paid: number; cash: number};

async function bookedSessions(today: string): Promise<Group[]> {
  const [walkPaid, walkCash, eventPaid, livePaid, liveCash] = await env.DB!.batch([
    env.DB!.prepare("SELECT program AS id,value AS date,count(*) AS n FROM orders,json_each(orders.dates) WHERE status='paid' AND kind='walkin' AND value>=? GROUP BY program,value").bind(today),
    env.DB!.prepare("SELECT program AS id,session_date AS date,count(*) AS n FROM cash_bookings WHERE status='due' AND kind='walkin' AND session_date>=? GROUP BY program,session_date").bind(today),
    env.DB!.prepare("SELECT item_id AS id,value AS date,count(*) AS n FROM orders,json_each(orders.dates) WHERE status='paid' AND kind='event' AND value>=? GROUP BY item_id,value").bind(today),
    env.DB!.prepare("SELECT item_id AS id,value AS date,count(*) AS n FROM orders,json_each(orders.dates) WHERE status='paid' AND kind='live' AND value>=? GROUP BY item_id,value").bind(today),
    env.DB!.prepare("SELECT item_id AS id,session_date AS date,count(*) AS n FROM cash_bookings WHERE status='due' AND kind='live' AND session_date>=? GROUP BY item_id,session_date").bind(today)
  ]);
  const groups = new Map<string, Group>();
  const add = (kind: Group['kind'], rows: any[], field: 'paid' | 'cash') => {
    for (const r of rows) {
      const key = `${kind}|${r.id}|${r.date}`, g = groups.get(key) ?? {kind, id: String(r.id), date: String(r.date), paid: 0, cash: 0};
      g[field] += Number(r.n); groups.set(key, g);
    }
  };
  add('walkin', walkPaid.results as any[], 'paid'); add('walkin', walkCash.results as any[], 'cash');
  add('event', eventPaid.results as any[], 'paid'); add('live', livePaid.results as any[], 'paid'); add('live', liveCash.results as any[], 'cash');
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

// The session a booking group is for, if the settings offer it on that date.
function sessionFor(state: any, g: Group, cache: Map<string, Session[]>): Session | null {
  if (!cache.has(g.date)) { try { cache.set(g.date, sessionsOn(state, g.date)); } catch { cache.set(g.date, []); } }
  const sessions = cache.get(g.date)!;
  return (g.kind === 'walkin' ? sessions.find(s => s.type === 'practice' && s.program === g.id)
    : sessions.find(s => s.type === g.kind && s.key.split(':')[1] === g.id)) ?? null;
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const MAX_LISTED = 6;

// The sessions a save would drop that families have paid for or booked. Empty when the save is safe.
export async function blockedChanges(oldState: any, newState: any, today: string): Promise<string[]> {
  if (!oldState) return [];
  const groups = await bookedSessions(today);
  if (!groups.length) return [];
  const before = new Map<string, Session[]>(), after = new Map<string, Session[]>(), problems: string[] = [];
  for (const g of groups) {
    const was = sessionFor(oldState, g, before);
    if (!was || sessionFor(newState, g, after)) continue;
    const what = g.kind === 'walkin' ? [g.paid ? plural(g.paid, 'paid walk-in') : '', g.cash ? plural(g.cash, 'cash booking') : ''].filter(Boolean).join(' and ')
      : g.kind === 'event' ? plural(g.paid, 'paid registration') : [g.paid ? plural(g.paid, 'paid booking') : '', g.cash ? plural(g.cash, 'cash booking') : ''].filter(Boolean).join(' and ');
    const when = was.start ? `${dayDate(g.date)}, ${clockTime(was.start)}` : dayDate(g.date);
    problems.push(`${was.title} on ${when} has ${what}`);
  }
  return problems;
}

// The refusal the owner reads on the dashboard.
export function blockedMessage(problems: string[]) {
  const shown = problems.slice(0, MAX_LISTED), more = problems.length - shown.length;
  return `This change would remove sessions that families have paid for or booked: ${shown.join('; ')}${more > 0 ? `; and ${plural(more, 'more session')}` : ''}. `
    + 'Move or refund those bookings first (refund in Stripe, void or cancel on Payments), or keep those dates. Changing a practice time keeps its bookings.';
}

// ---------- What changed ----------
const money = (c: unknown) => Number.isInteger(c) ? '$' + ((c as number) / 100).toFixed(2) : 'unset';
const dollars = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? '$' + v.toFixed(2) : 'unset';
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const list = (v: unknown) => Array.isArray(v) ? v : [];
const byId = (v: unknown) => new Map(list(v).filter((x: any) => x && typeof x === 'object' && typeof x.id === 'string').map((x: any) => [x.id as string, x]));
const span = (s: any) => `${fullDate(s.start)} to ${fullDate(s.end)}`;
const seasonKey = (s: any) => `${s.program}|${s.start}|${s.end}`;
const seasonText = (s: any, names: Map<string, string>) => `${names.get(s.program) ?? s.program} ${span(s)}`;

export function changeSummary(oldState: any, newState: any): string {
  if (!oldState) return 'first save';
  const o = upgradeProgramNames(oldState), n = upgradeProgramNames(newState), out: string[] = [];
  const names = new Map<string, string>(list(n.programs).map((p: any) => [p.id, p.name]));
  // Prices and names, per program.
  const oldPrograms = byId(o.programs);
  for (const p of list(n.programs)) {
    const was = oldPrograms.get(p.id); if (!was) { out.push(`${p.name} published`); continue; }
    if (was.name !== p.name) out.push(`${was.name} renamed ${p.name}`);
    if (was.priceCents !== p.priceCents) out.push(`${p.name} monthly ${money(was.priceCents)} → ${money(p.priceCents)}`);
    if (was.walkInPriceCents !== p.walkInPriceCents) out.push(`${p.name} walk-in ${money(was.walkInPriceCents)} → ${money(p.walkInPriceCents)}`);
  }
  // Seasons have no id: match on program and dates; a change to days, times or days off shows as "changed".
  const oldSeasons = new Map(list(o.seasons).map((s: any) => [seasonKey(s), s])), newSeasons = new Map(list(n.seasons).map((s: any) => [seasonKey(s), s]));
  for (const [k, s] of newSeasons) { const was = oldSeasons.get(k); if (!was) out.push(`schedule added: ${seasonText(s, names)}`); else if (!same(was.weekly, s.weekly) || !same(was.excludedDates, s.excludedDates)) out.push(`schedule changed: ${seasonText(s, names)}`); }
  for (const [k, s] of oldSeasons) if (!newSeasons.has(k)) out.push(`schedule removed: ${seasonText(s, names)}`);
  // Events, extra practices and team codes, by id.
  const oldEvents = byId(o.events), newEvents = byId(n.events);
  for (const [id, e] of newEvents) {
    const was = oldEvents.get(id); if (!was) { out.push(`event added: ${e.name}`); continue; }
    const changes = [was.name !== e.name ? `renamed ${e.name}` : '', !same(was.price, e.price) ? `price ${dollars(was.price)} → ${dollars(e.price)}` : '', !same(was.day, e.day) ? `day price ${dollars(was.day)} → ${dollars(e.day)}` : '',
      !same(was.slots, e.slots) ? `seats ${was.slots} → ${e.slots}` : '', !same(was.dates, e.dates) ? 'dates changed' : '', !same(was.schedule, e.schedule) ? 'times changed' : '',
      !!was.archived !== !!e.archived ? (e.archived ? 'archived' : 'unarchived') : ''].filter(Boolean);
    if (changes.length) out.push(`${was.name}: ${changes.join(', ')}`);
  }
  for (const [id, e] of oldEvents) if (!newEvents.has(id)) out.push(`event removed: ${e.name}`);
  const oldExtra = byId(o.extraPractices), newExtra = byId(n.extraPractices);
  for (const [id, p] of newExtra) {
    const was = oldExtra.get(id); if (!was) { out.push(`extra practice added: ${p.name}`); continue; }
    const changes = [was.name !== p.name ? `renamed ${p.name}` : '', was.memberCents !== p.memberCents ? `member price ${money(was.memberCents)} → ${money(p.memberCents)}` : '',
      was.nonMemberCents !== p.nonMemberCents ? `non-member price ${money(was.nonMemberCents)} → ${money(p.nonMemberCents)}` : '', !same(was.dates, p.dates) ? 'dates changed' : '',
      was.start !== p.start || was.end !== p.end ? 'time changed' : '', was.enabled !== p.enabled ? (p.enabled ? 'offered' : 'not offered') : ''].filter(Boolean);
    if (changes.length) out.push(`${was.name}: ${changes.join(', ')}`);
  }
  for (const [id, p] of oldExtra) if (!newExtra.has(id)) out.push(`extra practice removed: ${p.name}`);
  const oldCodes = byId(o.teamCodes), newCodes = byId(n.teamCodes);
  for (const [id, c] of newCodes) {
    const was = oldCodes.get(id); if (!was) { out.push(`team code added: ${c.code} ${c.percent}%`); continue; }
    const changes = [was.code !== c.code ? `now ${c.code}` : '', was.percent !== c.percent ? `${was.percent}% → ${c.percent}%` : '', was.active !== c.active ? (c.active ? 'active' : 'inactive') : '', !same(was.programs, c.programs) ? 'programs changed' : ''].filter(Boolean);
    if (changes.length) out.push(`team code ${was.code}: ${changes.join(', ')}`);
  }
  for (const [id, c] of oldCodes) if (!newCodes.has(id)) out.push(`team code removed: ${c.code}`);
  const text = out.length ? out.join('; ') : 'no change to prices, schedules, events, extra practices or team codes';
  return text.length > 500 ? text.slice(0, 497) + '…' : text;
}
