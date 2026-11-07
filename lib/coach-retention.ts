// Removed coaches' records (issue #212; Justin's decision in #197, Q18): when a coach is removed for good, all their
// records are kept for 3 years from the removal date, then deleted. Runs in the daily scheduled job (build/worker.ts)
// and again straight after a backup is restored (app/api/backups/route.ts).
//
// Records that only the coach has are deleted. Records that a family or the academy's books also depend on are kept,
// with the coach's identity replaced by "former-coach-<id>" (the removed_coaches row's id) and the name "Former coach",
// so a family's payment history, the books and pay totals for past months do not change. What happens to each table is
// in STEPS below and in docs/policies/data-retention-draft.md.
//
// Safe to run any number of times: each step only matches rows that still carry the coach's email or account id, so a
// second run changes nothing. Work is done in batches of BATCH rows and at most MAX_STATEMENTS statements per run; a
// coach whose records are not all done yet stays "in progress" and the next run carries on.
//
// A restored backup can bring deleted rows back. removed_coaches keeps a hash of each coach's email after their email is
// cleared, so every run (and every restore) looks for that hash among the coach emails in the data and cleans those
// records again. A coach who is on Coaches again (staff_access) is never touched.
import {env} from 'cloudflare:workers';
import {academyToday} from './public-schedule';

export const RETENTION_YEARS = 3;
export const FORMER_COACH = 'Former coach';
export const BATCH = 500, MAX_STATEMENTS = 100;
// A coach whose records are all done still takes one statement per step (17) plus the settings (4), so a run always
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

// Coaches removed for good whose records are still kept, for the owner's Coaches page.
export async function removedCoaches() {
  const rows = (await db().prepare(`SELECT email,name,removed_on FROM removed_coaches
    WHERE cleaned_at IS NULL AND email IS NOT NULL AND email NOT IN (SELECT email FROM staff_access) ORDER BY removed_on DESC,email`)
    .all<{email: string; name: string | null; removed_on: string}>()).results;
  return rows.map(r => ({email: r.email, name: r.name || r.email, removedOn: r.removed_on, keepUntil: keepUntil(r.removed_on)}));
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
function steps(email: string, key: string, accounts: string[]): Step[] {
  const ids = JSON.stringify(accounts);
  const coachOpening = `(coach_email=? OR (coach_email IS NULL AND ${inList('user_id')}))`;
  return [
    // Shared with families: who checked a wrestler in. The check-in itself stays (the family's attendance).
    set('attendance', 'checked_in_by=?', [key], inList('checked_in_by'), [ids]),
    // Practice plans stay for the program; only who last edited one changes.
    set('practice_plans', 'updated_by=?', [key], inList('updated_by'), [ids]),
    // The security log keeps every event; the coach's email and account in it are replaced. A target that names the
    // coach is their email, alone or followed by a space and details (coach_month_approved).
    set('security_events', 'target=?||substr(target,?)', [key, email.length + 1], 'lower(target)=? OR lower(substr(target,1,?))=?', [email, email.length + 1, email + ' ']),
    set('security_events', 'actor=?', [key], `${inList('actor')} AND (action LIKE 'coach%' OR action LIKE 'practice_plan%')`, [ids]),
    // Notices about the coach's time off (to them and to the coaches covering), and every notice to the coach.
    del('notifications', `kind LIKE 'coach_time_off%' AND EXISTS (SELECT 1 FROM coach_time_off t WHERE t.coach_email=?
      AND (notifications.dedupe_key='time-off-decided:'||t.id OR substr(notifications.dedupe_key,1,length(t.id)+15)='time-off-team:'||t.id||':'))`, [email]),
    del('notifications', 'user_id IS NULL AND lower(email)=?', [email]),
    // A family's lesson payment stays exactly as paid; the coach on it becomes "Former coach".
    set('orders', `pricing=json_set(pricing,'$.coachEmail',?,'$.coachName',?),
      item_label=CASE WHEN json_extract(pricing,'$.coachName') IS NULL THEN item_label ELSE replace(item_label,' with '||json_extract(pricing,'$.coachName')||', ',' with '||?||', ') END`,
      [key, FORMER_COACH, FORMER_COACH], `kind='lesson' AND lower(json_extract(pricing,'$.coachEmail'))=?`, [email]),
    // Lesson times nobody booked go; booked ones stay (families' orders point at them) under the former-coach key.
    del('coach_openings', `${coachOpening} AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.kind='lesson' AND x.item_id=coach_openings.id)`, [email, ids]),
    set('coach_openings', 'coach_email=?,user_id=?', [key, key], coachOpening, [email, ids]),
    // Approved shifts are the pay record for their month: kept with the minutes, rate and amount, without the coach,
    // their notes or the change history. Shifts that were never approved, or were voided, are deleted.
    set('coach_time_entries', "user_id=?,coach_email=?,coach_name=?,coach_note=NULL,owner_note=NULL,void_reason=NULL,history='[]'", [key, key, FORMER_COACH],
      'coach_email=? AND approved_at IS NOT NULL AND voided_at IS NULL', [email]),
    del('coach_time_entries', 'coach_email=?', [email]),
    del('coach_time_off', 'coach_email=?', [email]),
    // Their signed contract (the contract text itself stays: other coaches signed it too).
    del('waiver_signatures', "lower(email)=? AND version_id IN (SELECT id FROM waiver_versions WHERE kind='coach_contract')", [email]),
    del('coach_profiles', 'email=?', [email]),
    del('coach_invites', 'lower(email)=?', [email]),
    // The last few recovery snapshots (copies of the lesson times taken before each restore) name the coach too.
    set('recovery_snapshots', 'payload=replace(payload,?,?)', [JSON.stringify(email), JSON.stringify(key)], 'instr(payload,?)>0', [JSON.stringify(email)]),
  ];
}

const changes = (r: any) => Number(r?.meta?.changes ?? r?.changes ?? 0);

// Every coach email still found in the data, for matching cleaned coaches after a restore.
async function candidateEmails() {
  const rows = (await db().prepare(`SELECT DISTINCT lower(e) AS e FROM (
      SELECT coach_email AS e FROM coach_openings UNION SELECT coach_email FROM coach_time_entries UNION SELECT coach_email FROM coach_time_off
      UNION SELECT email FROM coach_profiles UNION SELECT email FROM coach_invites UNION SELECT email FROM notifications WHERE user_id IS NULL
      UNION SELECT s.email FROM waiver_signatures s JOIN waiver_versions v ON v.id=s.version_id WHERE v.kind='coach_contract'
      UNION SELECT json_extract(pricing,'$.coachEmail') FROM orders WHERE kind='lesson')
    WHERE e IS NOT NULL AND e NOT LIKE 'former-coach-%'`).all<{e: string}>()).results.map(r => r.e);
  const settings = await readSettings();
  return [...new Set([...rows, ...Object.keys(settings.lessons?.splits ?? {}), ...(settings.website?.coaches ?? [])].map(e => String(e).toLowerCase()))];
}

async function readSettings() {
  const rows = (await db().prepare("SELECT id,payload FROM academy_settings WHERE id IN ('lessons','website')").all<{id: string; payload: string}>()).results;
  const out: Record<string, any> = {};
  for (const r of rows) { try { out[r.id] = JSON.parse(r.payload); } catch { /* left alone */ } }
  return out;
}

// Owner settings that name the coach: their pay share moves to the former-coach key, so pay for past months still adds
// up the same; they leave the public team page's coach list.
async function settingsStep(email: string, key: string) {
  const rows = (await db().prepare("SELECT id,payload FROM academy_settings WHERE id IN ('lessons','website')").all<{id: string; payload: string}>()).results;
  let n = 0;
  for (const r of rows) {
    let p: any;
    try { p = JSON.parse(r.payload); } catch { continue; }
    let changed = false;
    if (r.id === 'lessons' && p?.splits && typeof p.splits === 'object') {
      for (const k of Object.keys(p.splits)) if (k.toLowerCase() === email) { if (!(key in p.splits)) p.splits[key] = p.splits[k]; delete p.splits[k]; changed = true; }
    }
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
      UNION SELECT s.user_id FROM waiver_signatures s JOIN waiver_versions v ON v.id=s.version_id WHERE v.kind='coach_contract' AND lower(s.email)=?`)
      .bind(email, email, email, email).all<{id: string}>()).results.map(r => r.id).filter(id => id && !id.startsWith('former-coach-'));
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
      await db().prepare('UPDATE removed_coaches SET email=NULL,name=NULL,cleaned_at=? WHERE id=? AND cleaned_at IS NULL').bind(new Date().toISOString(), tomb.id).run();
      sum.finished++;
    }
  }
  // One line in the security log for a run that changed anything; never a name or email.
  if (sum.deleted || sum.anonymized || sum.finished)
    await db().prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)')
      .bind(crypto.randomUUID(), 'system', 'coach_records_deleted', `finished:${sum.finished} in-progress:${sum.inProgress} deleted:${sum.deleted} anonymized:${sum.anonymized}`, new Date().toISOString()).run();
  return sum;
}
