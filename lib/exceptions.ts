// Owner exceptions to the booking blocks (issue #89). For a specific wrestler and a date range, the owner can let
// bookings through despite a missing or expired USA Wrestling card ("usaw"), an unsigned waiver ("waiver") or an
// unsigned Parent Consent Form ("parent_consent", issue #195).
// An exception covers a booking only if every booked date falls inside it. A reason and an end date are required.
// A card exception also lets the wrestler be checked in on the dates it covers (decision Q11 in #197, issue #210).
import {env} from 'cloudflare:workers';
import {academyToday} from './public-schedule';

export type Rule = 'usaw' | 'waiver' | 'parent_consent';
const RULES: Rule[] = ['usaw', 'waiver', 'parent_consent'];
const validDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export async function exceptionFor(userId: string, wrestlerId: string, rule: Rule, dates: string[]) {
  const first = [...dates].sort()[0], last = [...dates].sort().at(-1);
  return await env.DB!.prepare('SELECT id,ends_on AS endsOn,reason FROM booking_exceptions WHERE user_id=? AND wrestler_id=? AND rule=? AND revoked_at IS NULL AND starts_on<=? AND ends_on>=? ORDER BY ends_on DESC LIMIT 1')
    .bind(userId, wrestlerId, rule, first, last).first<{id: string; endsOn: string; reason: string}>();
}

export async function grantException(ownerId: string, input: any) {
  if (typeof input?.userId !== 'string' || typeof input.wrestlerId !== 'string' || !RULES.includes(input.rule)) return {status: 400, error: 'Choose a wrestler and what to allow.'};
  const today = academyToday(), startsOn = input.startsOn || today;
  if (!validDate(startsOn) || !validDate(input.endsOn) || input.endsOn < startsOn || input.endsOn < today) return {status: 400, error: 'Choose an end date from today on.'};
  if (input.endsOn > addDays(today, 366)) return {status: 400, error: 'An exception can last up to one year. Grant a new one later if needed.'};
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
  if (reason.length < 3) return {status: 400, error: 'Add the reason, for example "renewal pending with USA Wrestling".'};
  const row = await env.DB!.prepare('SELECT payload FROM family_accounts WHERE user_id=?').bind(input.userId).first<{payload: string}>();
  if (!row || !(JSON.parse(row.payload).wrestlers || []).some((w: any) => w.id === input.wrestlerId)) return {status: 404, error: 'Wrestler not found.'};
  const id = crypto.randomUUID(), at = new Date().toISOString();
  await env.DB!.batch([
    env.DB!.prepare('INSERT INTO booking_exceptions(id,user_id,wrestler_id,rule,starts_on,ends_on,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, input.userId, input.wrestlerId, input.rule, startsOn, input.endsOn, reason, ownerId, at),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'booking_exception_granted', `${input.rule} ${input.userId}/${input.wrestlerId} until ${input.endsOn}`, at)
  ]);
  return {status: 200, id};
}

export async function revokeException(ownerId: string, id: unknown) {
  if (typeof id !== 'string') return {status: 400, error: 'Choose an exception.'};
  const at = new Date().toISOString();
  const r = await env.DB!.prepare('UPDATE booking_exceptions SET revoked_at=?,revoked_by=? WHERE id=? AND revoked_at IS NULL').bind(at, ownerId, id).run();
  if (!(r.meta?.changes ?? (r as any).changes)) return {status: 404, error: 'Exception not found.'};
  await env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'booking_exception_removed', id, at).run();
  return {status: 200};
}

// Exceptions still in force (ending today or later), newest first, with family and wrestler names.
export async function activeExceptions() {
  const rows = (await env.DB!.prepare('SELECT e.*,f.payload AS family FROM booking_exceptions e LEFT JOIN family_accounts f ON f.user_id=e.user_id WHERE e.revoked_at IS NULL AND e.ends_on>=? ORDER BY e.created_at DESC')
    .bind(academyToday()).all<any>()).results;
  return rows.map(r => {
    const p = r.family ? JSON.parse(r.family) : {}, w = (p.wrestlers || []).find((x: any) => x.id === r.wrestler_id);
    return {id: r.id, userId: r.user_id, wrestlerId: r.wrestler_id, wrestler: w?.name ?? 'Removed wrestler', parent: p.parentName ?? '', rule: r.rule, startsOn: r.starts_on, endsOn: r.ends_on, reason: r.reason, createdAt: r.created_at};
  });
}
