// Problem alerts for the owner (issue #47). When the site records new server errors, or a scheduled job fails
// (both land in error_log, lib/site-health.ts), the owner gets an email with counts, the kind of problem and a link
// to /site-health. Never more than one an hour: problems in between go in the next alert, which is sent with the next
// problem after the hour or by the morning scheduled run, whichever comes first. The email carries no error
// messages, stack traces, query strings or family details, only page areas and counts.
//
// The "last alerted" marker is one row in academy_settings (id 'owner-alert'), next to the daily reminders' per-day
// markers. It holds only times, a count and the send result. Backups include academy_settings, and restore never
// overwrites an existing row, so a restored marker cannot change alert timing on a live site.
import {OWNER_EMAIL, appOrigin} from './account-auth';
import {emailConfigured, failureWords, sendEmailsDetailed} from './email';
import {when} from './datetime';

type DB = D1Database | undefined;
export const ALERT_KEY = 'owner-alert';
export const ALERT_GAP_MS = 3600000;
const LOOKBACK_MS = 86400000;
// Scheduled jobs record their failures under these paths (build/worker.ts).
export const SCHEDULED_JOBS: Record<string, string> = {'/daily-reminders': 'The morning reminders (card and waiver reminders to families)'};

type Marker = {sentAt?: string; coveredUntil?: string; count?: number; status?: string; reason?: string | null};
type ErrorRow = {at: string; path: string; status: number};

// "/api/checkout/session" -> "/api/checkout", "/register" -> "/register". Paths never carry a query string.
export function area(path: string) {
  const parts = String(path || '/').split('/').filter(Boolean);
  if (!parts.length) return '/';
  return parts[0] === 'api' ? '/api/' + (parts[1] ?? '') : '/' + parts[0];
}
const kind = (status: number) => status === 502 || status === 503 || status === 504 ? 'timed out or unavailable' : 'unexpected error';
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function alertEmail(rows: ErrorRow[], origin: string | null, now = new Date()) {
  const jobs = new Map<string, number>(), pages = new Map<string, number>();
  for (const r of rows) {
    if (SCHEDULED_JOBS[r.path]) jobs.set(r.path, (jobs.get(r.path) ?? 0) + 1);
    else { const key = `${area(r.path)}: ${kind(Number(r.status))}`; pages.set(key, (pages.get(key) ?? 0) + 1); }
  }
  const lines: string[] = [];
  if (jobs.size) lines.push('Scheduled jobs that didn\'t finish:', ...[...jobs].map(([p, n]) => `- ${SCHEDULED_JOBS[p]}: ${plural(n, 'time')}`), '');
  if (pages.size) lines.push('Server errors, by page:', ...[...pages].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k} (${n})`), '');
  const first = rows[0]?.at, last = rows.at(-1)?.at;
  const span = first && last && first !== last ? `between ${when(first, now)} and ${when(last, now)}` : `at ${when(first ?? now, now)}`;
  const subject = jobs.size && !pages.size ? 'Site alert: a scheduled job didn\'t finish' : `Site alert: ${plural(rows.length, 'new problem')} on the academy site`;
  const text = [`The Savage Wrestling Academy site recorded ${plural(rows.length, 'new problem')} ${span} (New York time).`, '', ...lines,
    origin ? `See what happened on the Site health page (owner sign-in needed):\n${origin}/site-health` : 'See what happened on the Site health page in the owner dashboard.', '',
    'One or two errors right after an update can be normal. A steady stream means something needs fixing, so share the Site health page with whoever maintains the site.', '',
    'You get at most one of these emails an hour. Anything that happens in between is in the next one.', '', '—', 'Savage Wrestling Academy site'].join('\n');
  return {subject, text};
}

async function marker(db: D1Database) {
  const row = await db.prepare('SELECT payload, updated_at FROM academy_settings WHERE id=?').bind(ALERT_KEY).first<{payload: string; updated_at: string}>();
  let value: Marker = {};
  try { value = row ? JSON.parse(row.payload) : {}; } catch { value = {}; }
  return {row, value};
}

// Sends an alert if there are new problems, email is set up and the last alert was more than an hour ago.
// Never throws. Returns what happened, for tests and logs.
export async function alertOwner(db: DB, now = new Date()): Promise<'off' | 'none' | 'waiting' | 'sent' | 'failed'> {
  try {
    if (!db || !emailConfigured()) return 'off';
    const {row, value} = await marker(db);
    if (value.sentAt && now.getTime() - Date.parse(value.sentAt) < ALERT_GAP_MS) return 'waiting';
    const floor = new Date(now.getTime() - LOOKBACK_MS).toISOString();
    const after = value.coveredUntil && value.coveredUntil > floor ? value.coveredUntil : floor;
    const rows = (await db.prepare('SELECT at, path, status FROM error_log WHERE at>? AND at<=? ORDER BY at, id LIMIT 500').bind(after, now.toISOString()).all<ErrorRow>()).results;
    if (!rows.length) return 'none';
    // Claim the alert before sending, so two errors at the same moment send one email between them.
    const at = now.toISOString(), next: Marker = {sentAt: at, coveredUntil: rows.at(-1)!.at, count: rows.length, status: 'sending', reason: null};
    const claim = row
      ? await db.prepare('UPDATE academy_settings SET payload=?, updated_at=? WHERE id=? AND updated_at=?').bind(JSON.stringify(next), at, ALERT_KEY, row.updated_at).run()
      : await db.prepare("INSERT OR IGNORE INTO academy_settings(id,payload,updated_at,updated_by) VALUES (?,?,?,'system')").bind(ALERT_KEY, JSON.stringify(next), at).run();
    if (Number(claim.meta?.changes ?? (claim as any).changes ?? 0) !== 1) return 'waiting';
    let origin: string | null = null;
    try { origin = appOrigin(); } catch { origin = null; }
    const [result] = await sendEmailsDetailed([{to: OWNER_EMAIL, ...alertEmail(rows, origin, now)}]);
    const status = result.status === 'sent' ? 'sent' : 'failed';
    await db.prepare('UPDATE academy_settings SET payload=? WHERE id=? AND updated_at=?').bind(JSON.stringify({...next, status, reason: result.reason}), ALERT_KEY, at).run();
    return status;
  } catch (error) {
    console.error('owner alert failed', error);
    return 'failed';
  }
}

// For the Site health page: is alerting on, and how did the last alert go?
export async function alertStatus(db: D1Database) {
  const {value} = await marker(db);
  return {
    emailOn: emailConfigured(), to: OWNER_EMAIL, gapMinutes: ALERT_GAP_MS / 60000,
    last: value.sentAt ? {at: value.sentAt, count: value.count ?? 0, sent: value.status === 'sent', reason: value.status === 'failed' ? failureWords(value.reason) : null} : null
  };
}
