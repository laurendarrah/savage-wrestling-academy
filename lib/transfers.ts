// Program transfers on paid memberships (issue #74). The owner moves a membership to another program from an
// effective date. Eligibility uses the same server rules as registration (grade ranges, SWA Advance approval).
// No money moves: any price difference between programs is handled separately, since no policy is decided for it.
import {env} from 'cloudflare:workers';
import {familyProfile, checkCompetitionAccess} from './program-approval';
import {academyToday} from './public-schedule';
import {programDetails} from './program-names';
const programName = (id: string) => programDetails[id]?.name ?? id;

// SQL for "the program this membership order covered on date ?": the program before the first transfer that took
// effect after that date, or the current program. Use with alias `orders`, binding the date once.
export const PROGRAM_ON = `COALESCE((SELECT t.from_program FROM membership_transfers t WHERE t.order_id=orders.id AND t.effective_date>? ORDER BY t.effective_date,t.created_at LIMIT 1),orders.program)`;

export function programOn(order: {id: string; program: string}, transfers: {order_id: string; from_program: string; effective_date: string; created_at: string}[], date: string) {
  const later = transfers.filter(t => t.order_id === order.id && t.effective_date > date).sort((a, b) => a.effective_date.localeCompare(b.effective_date) || a.created_at.localeCompare(b.created_at));
  return later.length ? later[0].from_program : order.program;
}

const validDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;
const PROGRAMS = ['Elementary', 'Intermediate', 'Advanced'];

export async function activeMemberships() {
  const today = academyToday();
  const rows = (await env.DB!.prepare(`SELECT o.id,o.user_id,o.wrestler_id,o.wrestler_name,o.kind,o.program,o.term_start,o.term_end,o.email,f.payload AS family FROM orders o LEFT JOIN family_accounts f ON f.user_id=o.user_id
    WHERE o.status='paid' AND o.kind IN ('annual','monthly') AND o.term_end>=? ORDER BY o.wrestler_name`).bind(today).all<any>()).results;
  const transfers = (await env.DB!.prepare('SELECT * FROM membership_transfers ORDER BY created_at DESC').all<any>()).results;
  return {
    memberships: rows.map(r => {
      const fam = r.family ? JSON.parse(r.family) : {}, w = (fam.wrestlers || []).find((x: any) => x.id === r.wrestler_id);
      return {orderId: r.id, wrestler: r.wrestler_name, grade: w?.grade ?? null, parent: fam.parentName ?? '', email: r.email, kind: r.kind,
        programToday: programOn(r, transfers, today), program: r.program, termStart: r.term_start, termEnd: r.term_end};
    }),
    history: transfers.slice(0, 200).map(t => ({...t, wrestler: rows.find(r => r.id === t.order_id)?.wrestler_name ?? null}))
  };
}

export async function transferMembership(ownerId: string, input: any) {
  if (typeof input?.orderId !== 'string' || !PROGRAMS.includes(input.toProgram)) return {status: 400, error: 'Choose a membership and the program to move it to.'};
  const today = academyToday(), effective = input.effectiveDate || today;
  if (!validDate(effective) || effective < today) return {status: 400, error: 'Choose an effective date from today on.'};
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
  if (!reason) return {status: 400, error: 'Add a short reason, for example "moved up after evaluation".'};
  const o = await env.DB!.prepare("SELECT id,user_id,wrestler_id,program,term_start,term_end FROM orders WHERE id=? AND status='paid' AND kind IN ('annual','monthly')").bind(input.orderId).first<any>();
  if (!o) return {status: 404, error: 'Paid membership not found.'};
  if (effective > o.term_end) return {status: 400, error: 'The effective date is after this membership ends.'};
  const last = await env.DB!.prepare('SELECT max(effective_date) AS d FROM membership_transfers WHERE order_id=?').bind(o.id).first<{d: string | null}>();
  if (last?.d && effective < last.d) return {status: 409, error: 'This membership already has a later transfer. Choose a date on or after ' + last.d + '.'};
  if (o.program === input.toProgram) return {status: 409, error: 'This membership is already in ' + programName(input.toProgram) + '.'};
  const w = (await familyProfile(o.user_id))?.wrestlers.find(x => x.id === o.wrestler_id);
  if (!w) return {status: 409, error: 'The wrestler is no longer in the family profile. Contact the family first.'};
  const blocked = await checkCompetitionAccess(o.user_id, input.toProgram, w);
  if (blocked) return {status: 409, error: blocked};
  const other = await env.DB!.prepare(`SELECT 1 FROM orders WHERE id<>? AND user_id=? AND wrestler_id=? AND status='paid' AND kind IN ('annual','monthly') AND program=? AND term_end>=? LIMIT 1`)
    .bind(o.id, o.user_id, o.wrestler_id, input.toProgram, effective).first();
  if (other) return {status: 409, error: 'This wrestler already has a paid membership in ' + programName(input.toProgram) + '.'};
  const at = new Date().toISOString(), id = crypto.randomUUID();
  await env.DB!.batch([
    env.DB!.prepare('INSERT INTO membership_transfers(id,order_id,from_program,to_program,effective_date,reason,transferred_by,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, o.id, o.program, input.toProgram, effective, reason, ownerId, at),
    env.DB!.prepare('UPDATE orders SET program=?,updated_at=? WHERE id=?').bind(input.toProgram, at, o.id),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'membership_transferred', `${o.id} ${o.program}->${input.toProgram} ${effective}`, at)
  ]);
  return {status: 200, id};
}
