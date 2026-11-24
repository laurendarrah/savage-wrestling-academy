// Removed coaches' records (issue #212; Justin's decision in #197, Q18, changed by his decision of Nov 23 on #246, issue
// #401). When a coach is removed for good:
//
// - Their pay records and signed coach contract are an archive, kept under their real name and email for good, never
//   anonymized or deleted: approved shifts, lesson payments that name them (and the lesson times those families booked),
//   cash they collected, payments the academy made to them, their W-9 status, their pay share, and their signed contract
//   with any request to sign it again. Contractor pay needs the real name for 1099s and audits. The owner sees the
//   archive from Coaches (coachArchive below).
// - Everything else is kept for 3 years from the removal date, then deleted: profile, invites, notices, time off,
//   lesson times nobody booked and shifts never approved. Records a family or the academy also depend on that are not
//   pay records (check-ins they made, practice plans they edited, the security log, recovery snapshots) are kept with the
//   coach replaced by "former-coach-<id>" (the removed_coaches row's id).
//
// Runs in the daily scheduled job (build/worker.ts) and again straight after a backup is restored
// (app/api/backups/route.ts). What happens to each table is in steps() below and in docs/policies/data-retention-draft.md.
//
// Safe to run any number of times: each step only matches rows that still carry the coach's email or account id, so a
// second run changes nothing. Work is done in batches of BATCH rows and at most MAX_STATEMENTS statements per run; a
// coach whose records are not all done yet stays "in progress" and the next run carries on.
//
// A restored backup can bring deleted rows back. removed_coaches keeps a hash of each coach's email (and, since #401, the
// email and name too, as the archive's index; rows cleaned before #401 have only the hash), so every run (and every
// restore) looks for that hash among the coach emails in the records that get cleaned and cleans them again. A coach
// who is on Coaches again (staff_access) is never touched.
import {env} from 'cloudflare:workers';
import {academyToday} from './public-schedule';
import {academyDay} from './datetime';

export const RETENTION_YEARS = 3;
export const FORMER_COACH = 'Former coach';
export const BATCH = 500, MAX_STATEMENTS = 100;
// A coach whose records are all done still takes one statement per step (12) plus the settings (4), so a run always
// has room to finish at least one coach.
const MIN_STATEMENTS = 24;
export const formerKey = (id: string) => 'former-coach-' + id;
const db = () => env.DB!;

// The last day the records are kept: the removal date plus 3 years (a removal on February 29 is kept until March 1).
export function keepUntil(removedOn: string) {
  // A date that is not a real date (only possible from a damaged backup file) never comes due.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(removedOn) || Number.isNaN(Date.parse(removedOn))) return '9999-12-31';
  const [y, m, d] = removedOn.split('-').map(Number);
  return new Date(Date.UTC(y + RETENTION_YEARS, m - 1, d)).toISOString().slice(0, 10);
}
// Cleaned from the day after keepUntil.
export const isDue = (removedOn: string, today: string) => keepUntil(removedOn) < today;

export async function emailHash(email: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('swa-removed-coach:' + email.trim().toLowerCase()));
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// The removed_coaches row for a permanent removal, written in the same batch as the removal itself and only if the coach
// is still a removed coach (active=0). The name kept is the one on Coaches. Removed again later: the clock restarts.
export async function recordRemoval(email: string, removedOn: string) {
  return db().prepare(`INSERT INTO removed_coaches(id,email_hash,email,name,removed_on,cleaned_at)
    SELECT ?,?,s.email,COALESCE(p.display_name,s.name),?,NULL FROM staff_access s LEFT JOIN coach_profiles p ON p.email=s.email WHERE s.email=? AND s.active=0
    ON CONFLICT(email_hash) DO UPDATE SET email=excluded.email,name=excluded.name,removed_on=excluded.removed_on,cleaned_at=NULL`)
    .bind(crypto.randomUUID(), await emailHash(email), removedOn, email);
}

// Coaches removed permanently before removal dates were recorded (#207, before #212) get one from their
// coach_permanently_removed entry in the security log (its target is the email), unless they are on Coaches again.
export async function recordEarlierRemovals() {
  const rows = (await db().prepare(`SELECT lower(target) AS email,max(created_at) AS at FROM security_events WHERE action='coach_permanently_removed'
    AND target LIKE '%@%' AND lower(target) NOT IN (SELECT email FROM staff_access) GROUP BY lower(target)`).all<{email: string; at: string}>()).results;
  if (!rows.length) return 0;
  const known = new Set((await db().prepare('SELECT email_hash FROM removed_coaches').all<{email_hash: string}>()).results.map(r => r.email_hash));
  let added = 0;
  for (const r of rows) {
    const hash = await emailHash(r.email);
    if (known.has(hash)) continue;
    added += changes(await db().prepare('INSERT OR IGNORE INTO removed_coaches(id,email_hash,email,name,removed_on,cleaned_at) VALUES (?,?,?,NULL,?,NULL)')
      .bind(crypto.randomUUID(), hash, r.email, academyDay(r.at)).run());
  }
  return added;
}

// Coaches removed for good, for the owner's Coaches page: when their other records go (keepUntil) or went (cleaned),
// and their pay archive (#401). Coaches cleaned before #401 have no email left and are not listed.
export async function removedCoaches() {
  const rows = (await db().prepare(`SELECT email,name,removed_on,cleaned_at FROM removed_coaches
    WHERE email IS NOT NULL AND email NOT IN (SELECT email FROM staff_access) ORDER BY removed_on DESC,email`)
    .all<{email: string; name: string | null; removed_on: string; cleaned_at: string | null}>()).results;
  return rows.map(r => ({email: r.email, name: r.name || r.email, removedOn: r.removed_on, keepUntil: keepUntil(r.removed_on), cleaned: !!r.cleaned_at}));
}

type Tomb = {id: string; email_hash: string; email: string | null; removed_on: string; cleaned_at: string | null};
type Step = {table: string; kind: 'deleted' | 'anonymized'; sql: string; args: unknown[]};
const del = (table: string, where: string, args: unknown[]): Step =>
  ({table, kind: 'deleted', sql: `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE (${where}) LIMIT ?)`, args});
const set = (table: string, change: string, changeArgs: unknown[], where: string, args: unknown[]): Step =>
  ({table, kind: 'anonymized', sql: `UPDATE ${table} SET ${change} WHERE rowid IN (SELECT rowid FROM ${table} WHERE (${where}) LIMIT ?)`, args: [...changeArgs, ...args]});
const inList = (col: string) => `${col} IN (SELECT value FROM json_each(?))`;

// Every step, in order. Steps that need the coach's account ids come before the rows those ids are read from are
// deleted, and a run stops at the first step it could not finish, so an interrupted coach is picked up where it was.
const UNPAID_SHIFT = 'approved_at IS NULL OR voided_at IS NOT NULL';
function steps(email: string, key: string, accounts: string[]): Step[] {
  const ids = JSON.stringify(accounts);
  const coachOpening = `(coach_email=? OR (coach_email IS NULL AND ${inList('user_id')}))`;
  return [
    // Shared with families: who checked a wrestler in. The check-in itself stays (the family's attendance).
    set('attendance', 'checked_in_by=?', [key], inList('checked_in_by'), [ids]),
    // Practice plans stay for the program; only who last edited one changes.
    set('practice_plans', 'updated_by=?', [key], inList('updated_by'), [ids]),
    // The security log keeps every event; the coach's email and account in it are replaced. A target that names the
    // coach is their email, alone or followed by a space and details (coach_period_approved; coach_month_approved before #399).
    set('security_events', 'target=?||substr(target,?)', [key, email.length + 1], 'lower(target)=? OR lower(substr(target,1,?))=?', [email, email.length + 1, email + ' ']),
    set('security_events', 'actor=?', [key], `${inList('actor')} AND (action LIKE 'coach%' OR action LIKE 'practice_plan%' OR action='cash_received')`, [ids]),
    // Notices about the coach's time off (to them and to the coaches covering), and every notice to the coach.
    del('notifications', `kind LIKE 'coach_time_off%' AND EXISTS (SELECT 1 FROM coach_time_off t WHERE t.coach_email=?
      AND (notifications.dedupe_key='time-off-decided:'||t.id OR substr(notifications.dedupe_key,1,length(t.id)+15)='time-off-team:'||t.id||':'))`, [email]),
    del('notifications', 'user_id IS NULL AND lower(email)=?', [email]),
    // Kept as they are, under the coach's name (the pay archive, #401), so they have no step here: lesson payments that
    // name the coach (orders) and the lesson times those families booked (coach_openings), cash they collected (orders),
    // approved shifts (coach_time_entries), payments to them (coach_payments), their W-9 status (coach_w9), and their
    // signed contract with any request to sign it again (waiver_signatures, signature_reissues).
    // Lesson times nobody booked go.
    del('coach_openings', `${coachOpening} AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.kind='lesson' AND x.item_id=coach_openings.id)`, [email, ids]),
    // Shifts that were never approved, or were voided, are not pay records: deleted.
    del('coach_time_entries', `coach_email=? AND (${UNPAID_SHIFT})`, [email]),
    del('coach_time_off', 'coach_email=?', [email]),
    del('coach_profiles', 'email=?', [email]),
    del('coach_invites', 'lower(email)=?', [email]),
    // The last few recovery snapshots (copies of the lesson times taken before each restore) name the coach too.
    set('recovery_snapshots', 'payload=replace(payload,?,?)', [JSON.stringify(email), JSON.stringify(key)], 'instr(payload,?)>0', [JSON.stringify(email)]),
  ];
}

const changes = (r: any) => Number(r?.meta?.changes ?? r?.changes ?? 0);

// Every coach email still found in the records the cleanup deletes, for matching cleaned coaches after a restore. The
// pay archive (#401) is left out: it keeps the coach's email for good, and finding it is no reason to run again.
async function candidateEmails() {
  const rows = (await db().prepare(`SELECT DISTINCT lower(e) AS e FROM (
      SELECT coach_email AS e FROM coach_openings o WHERE NOT EXISTS (SELECT 1 FROM orders x WHERE x.kind='lesson' AND x.item_id=o.id)
      UNION SELECT coach_email FROM coach_time_entries WHERE ${UNPAID_SHIFT} UNION SELECT coach_email FROM coach_time_off
      UNION SELECT email FROM coach_profiles UNION SELECT email FROM coach_invites UNION SELECT email FROM notifications WHERE user_id IS NULL)
    WHERE e IS NOT NULL AND e NOT LIKE 'former-coach-%'`).all<{e: string}>()).results.map(r => r.e);
  const settings = await readSettings();
  return [...new Set([...rows, ...(settings.website?.coaches ?? [])].map(e => String(e).toLowerCase()))];
}

async function readSettings() {
  const rows = (await db().prepare("SELECT id,payload FROM academy_settings WHERE id IN ('lessons','website')").all<{id: string; payload: string}>()).results;
  const out: Record<string, any> = {};
  for (const r of rows) { try { out[r.id] = JSON.parse(r.payload); } catch { /* left alone */ } }
  return out;
}

// Owner settings that name the coach: they leave the public team page's coach list. Their lesson pay share stays under
// their email (#401), beside the lesson payments that name them, so pay for past months adds up the same.
async function settingsStep(email: string, key: string) {
  const rows = (await db().prepare("SELECT id,payload FROM academy_settings WHERE id IN ('lessons','website')").all<{id: string; payload: string}>()).results;
  let n = 0;
  for (const r of rows) {
    let p: any;
    try { p = JSON.parse(r.payload); } catch { continue; }
    let changed = false;
    if (r.id === 'website' && Array.isArray(p?.coaches) && p.coaches.some((c: unknown) => String(c).toLowerCase() === email)) {
      p.coaches = p.coaches.filter((c: unknown) => String(c).toLowerCase() !== email); changed = true;
    }
    if (!changed) continue;
    // Only if the settings did not change meanwhile; otherwise the next run tries again.
    n += changes(await db().prepare("UPDATE academy_settings SET payload=?,updated_at=?,updated_by='system' WHERE id=? AND payload=?")
      .bind(JSON.stringify(p), new Date().toISOString(), r.id, r.payload).run());
  }
  return n;
}

export type RetentionSummary = {due: number; finished: number; inProgress: number; deleted: number; anonymized: number};

export async function cleanupRemovedCoaches(opts: {today?: string; batch?: number; maxStatements?: number} = {}): Promise<RetentionSummary> {
  const today = opts.today ?? academyToday(), size = opts.batch ?? BATCH;
  let left = Math.max(opts.maxStatements ?? MAX_STATEMENTS, MIN_STATEMENTS);
  const sum: RetentionSummary = {due: 0, finished: 0, inProgress: 0, deleted: 0, anonymized: 0};
  await recordEarlierRemovals();
  const due = (await db().prepare('SELECT id,email_hash,email,removed_on,cleaned_at FROM removed_coaches ORDER BY removed_on,id').all<Tomb>()).results
    .filter(t => isDue(t.removed_on, today));
  if (!due.length) return sum;
  sum.due = due.length;
  const staff = new Set((await db().prepare('SELECT email FROM staff_access').all<{email: string}>()).results.map(r => r.email.toLowerCase()));
  // Coaches not cleaned yet, by their email; coaches already cleaned, by finding their email hash in the data.
  const work: {tomb: Tomb; email: string}[] = due.filter(t => !t.cleaned_at && t.email).map(tomb => ({tomb, email: tomb.email!.toLowerCase()}));
  const cleaned = new Map(due.filter(t => t.cleaned_at).map(t => [t.email_hash, t]));
  if (cleaned.size) for (const email of await candidateEmails()) {
    const tomb = cleaned.get(await emailHash(email));
    if (tomb) work.push({tomb, email});
  }
  for (const {tomb, email} of work) {
    if (staff.has(email)) continue; // back on Coaches: their records are current again
    const key = formerKey(tomb.id);
    const accounts = (await db().prepare(`SELECT user_id AS id FROM coach_openings WHERE coach_email=? UNION SELECT user_id FROM coach_time_entries WHERE coach_email=?
      UNION SELECT user_id FROM coach_time_off WHERE coach_email=?
      UNION SELECT s.user_id FROM waiver_signatures s JOIN waiver_versions v ON v.id=s.version_id WHERE v.kind='coach_contract' AND lower(s.email)=?
      UNION SELECT json_extract(pricing,'$.recordedBy') FROM orders WHERE source='offline' AND lower(json_extract(pricing,'$.collectedByEmail'))=?`)
      .bind(email, email, email, email, email).all<{id: string}>()).results.map(r => r.id).filter(id => id && !id.startsWith('former-coach-'));
    let done = true;
    for (const step of steps(email, key, accounts)) {
      for (;;) {
        if (left <= 0) { done = false; break; }
        left--;
        const n = changes(await db().prepare(step.sql).bind(...step.args, size).run());
        sum[step.kind] += n;
        if (n < size) break;
      }
      if (!done) break;
    }
    if (done && left >= 4) { left -= 4; sum.anonymized += await settingsStep(email, key); } else done = false;
    if (!done) { sum.inProgress++; break; }
    if (!tomb.cleaned_at) {
      // The email and name stay: they index the pay archive (#401).
      await db().prepare('UPDATE removed_coaches SET cleaned_at=? WHERE id=? AND cleaned_at IS NULL').bind(new Date().toISOString(), tomb.id).run();
      sum.finished++;
    }
  }
  // One line in the security log for a run that changed anything; never a name or email.
  if (sum.deleted || sum.anonymized || sum.finished)
    await db().prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)')
      .bind(crypto.randomUUID(), 'system', 'coach_records_deleted', `finished:${sum.finished} in-progress:${sum.inProgress} deleted:${sum.deleted} anonymized:${sum.anonymized}`, new Date().toISOString()).run();
  return sum;
}
