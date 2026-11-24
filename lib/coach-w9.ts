// W-9 tracking for coaches (issue #400; Justin's decision on #246, Nov 23, 2026). Coaches are paid as independent
// contractors (#331), so the academy needs each coach's W-9 for the 1099. The site records only that the owner has a
// coach's W-9 and the day it came in. The W-9 itself stays with the owner or the accountant: nothing here accepts or
// stores a tax ID, a Social Security number or a file. Owner only (app/api/staff/route.ts). Each change is in the
// security log.
//
// Kept by email, not on the coach's staff record, so a coach removed for good keeps their W-9 status with their pay
// records (lib/coach-retention.ts).
import {env} from 'cloudflare:workers';
import {academyDay} from './datetime';

export type W9 = {receivedOn: string};
type Result = {status: number; error?: string; [k: string]: unknown};
const db = () => env.DB!;
const fail = (status: number, error: string): Result => ({status, error});
const validDay = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;
export const FIRST_DAY = '2020-01-01';
const audit = (actor: string, action: string, target: string) =>
  db().prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), actor, action, target, new Date().toISOString());

// Every coach's W-9, by lowercase email.
export async function w9s(): Promise<Map<string, W9>> {
  const rows = (await db().prepare('SELECT lower(email) AS email,received_on FROM coach_w9').all<{email: string; received_on: string}>()).results;
  return new Map(rows.map(r => [r.email, {receivedOn: r.received_on}]));
}

// The owner marks a coach's W-9 received on a day (today or earlier), or changes that day.
export async function markW9(actor: string, email: string, receivedOn: unknown, now = new Date()): Promise<Result> {
  const today = academyDay(now);
  if (!validDay(receivedOn) || receivedOn < FIRST_DAY || receivedOn > today) return fail(400, 'Choose the day the W-9 came in. It cannot be in the future.');
  const coach = await db().prepare('SELECT 1 FROM staff_access WHERE lower(email)=?').bind(email).first();
  if (!coach) return fail(404, 'Coach not found.');
  await db().batch([
    db().prepare('INSERT INTO coach_w9(email,received_on,recorded_at,recorded_by) VALUES (?,?,?,?) ON CONFLICT(email) DO UPDATE SET received_on=excluded.received_on,recorded_at=excluded.recorded_at,recorded_by=excluded.recorded_by')
      .bind(email, receivedOn, now.toISOString(), actor),
    audit(actor, 'coach_w9_received', `${email} ${receivedOn}`),
  ]);
  return {status: 200, w9: {receivedOn}};
}

// The owner takes the mark off (set by mistake, or the W-9 needs redoing).
export async function clearW9(actor: string, email: string): Promise<Result> {
  const gone = await db().prepare('DELETE FROM coach_w9 WHERE email=? RETURNING received_on').bind(email).first<{received_on: string}>();
  if (!gone) return fail(404, 'This coach has no W-9 marked. Refresh the page.');
  await audit(actor, 'coach_w9_cleared', `${email} ${gone.received_on}`).run();
  return {status: 200, w9: null};
}
