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
import {REJECTIONS} from './stripe-outcomes';

type DB = D1Database | undefined;
export const ALERT_KEY = 'owner-alert';
export const ALERT_GAP_MS = 3600000;
const LOOKBACK_MS = 86400000;
// Scheduled jobs record their failures under these paths (build/worker.ts).
export const SCHEDULED_JOBS: Record<string, string> = {'/daily-reminders': 'The morning reminders (card and waiver reminders to families)',
  '/coach-retention': 'The daily cleanup of records of coaches removed more than 3 years ago',
  '/stripe-fees': 'Reading card fees from Stripe for the books (Income and expenses)'};
// Things that are not site errors but need the owner soon, recorded under these paths by the code that notices them
// (issue #272: lib/stripe-webhook.ts writes a line when a family disputes a card payment with their bank).
export const DISPUTE_PATH = '/stripe-dispute';
export const NOTICES: Record<string, string> = {[DISPUTE_PATH]: 'A family disputed a card payment with their bank. Open Payments (the payment says Disputed), then answer the dispute in Stripe before its deadline'};

type Marker = {sentAt?: string; coveredUntil?: string; count?: number; status?: string; reason?: string | null};
// A problem the alert covers: a server error (error_log) or, since issue #271, a Stripe payment message the site refused
// (security_events 'stripe_event_rejected', with path STRIPE_REFUSED and the refusal in `outcome`).
export const STRIPE_REFUSED = '/stripe-refused';
type ErrorRow = {at: string; path: string; status: number; outcome?: string};

// "/api/checkout/session" -> "/api/checkout", "/register" -> "/register". Paths never carry a query string.
export function area(path: string) {
  const parts = String(path || '/').split('/').filter(Boolean);
  if (!parts.length) return '/';
  return parts[0] === 'api' ? '/api/' + (parts[1] ?? '') : '/' + parts[0];
}
const kind = (status: number) => status === 502 || status === 503 || status === 504 ? 'timed out or unavailable' : 'unexpected error';
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function alertEmail(rows: ErrorRow[], origin: string | null, now = new Date()) {
  const jobs = new Map<string, number>(), pages = new Map<string, number>(), notices = new Map<string, number>(), refused = new Map<string, number>();
  for (const r of rows) {
    if (r.path === STRIPE_REFUSED) { const key = REJECTIONS[r.outcome ?? ''] ?? 'Stripe sent a payment message the site could not match.'; refused.set(key, (refused.get(key) ?? 0) + 1); }
    else if (SCHEDULED_JOBS[r.path]) jobs.set(r.path, (jobs.get(r.path) ?? 0) + 1);
    else if (NOTICES[r.path]) notices.set(r.path, (notices.get(r.path) ?? 0) + 1);
    else { const key = `${area(r.path)}: ${kind(Number(r.status))}`; pages.set(key, (pages.get(key) ?? 0) + 1); }
  }
  const lines: string[] = [];
  if (notices.size) lines.push('Needs your attention:', ...[...notices].map(([p, n]) => `- ${NOTICES[p]}${n > 1 ? ` (${plural(n, 'time')})` : ''}`), '');
  if (jobs.size) lines.push('Scheduled jobs that didn\'t finish:', ...[...jobs].map(([p, n]) => `- ${SCHEDULED_JOBS[p]}: ${plural(n, 'time')}`), '');
  if (pages.size) lines.push('Server errors, by page:', ...[...pages].sort((a, b) => b[1] - a[1]).map(([k, n]) => `- ${k} (${n})`), '');
  if (refused.size) lines.push('Payment messages from Stripe the site refused (the Payment attempts list on Payments shows which family and purchase):', ...[...refused].map(([k, n]) => `- ${k} (${n})`), '');
  const first = rows[0]?.at, last = rows.at(-1)?.at;
  const span = first && last && first !== last ? `between ${when(first, now)} and ${when(last, now)}` : `at ${when(first ?? now, now)}`;
  const only = (m: Map<string, unknown>) => m.size && [jobs, pages, notices, refused].every(x => x === m || !x.size);
  const subject = notices.has(DISPUTE_PATH) && !jobs.size && !pages.size && !refused.size ? 'Site alert: a family disputed a card payment'
    : only(refused) ? `Site alert: ${plural(rows.length, 'payment message')} from Stripe refused`
    : only(jobs) ? 'Site alert: a scheduled job didn\'t finish' : `Site alert: ${plural(rows.length, 'new problem')} on the academy site`;
  const text = [`The Savage Wrestling Academy site recorded ${plural(rows.length, 'new problem')} ${span} (New York time).`, '', ...lines,
    origin ? `See what happened on the Site health page (owner sign-in needed):\n${origin}/site-health${refused.size ? `\nand under Payment attempts on Payments:\n${origin}/payments#attempts` : ''}` : 'See what happened on the Site health page in the owner dashboard' + (refused.size ? ', and under Payment attempts on Payments.' : '.'), '',
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
    // error_log keeps only the latest 500 rows (lib/site-health.ts), so this reads every problem there is (issue #46).
    // Refused Stripe messages (issue #271) are the security log's 'stripe_event_rejected' rows, "eventId rejected:why".
    const [errors, refused] = await db.batch([
      db.prepare('SELECT at, path, status FROM error_log WHERE at>? AND at<=? ORDER BY at, id').bind(after, now.toISOString()),
      db.prepare("SELECT created_at AS at, target FROM security_events WHERE action='stripe_event_rejected' AND created_at>? AND created_at<=? ORDER BY created_at, id LIMIT 200").bind(after, now.toISOString())]);
    const rows: ErrorRow[] = [...(errors.results as ErrorRow[]), ...(refused.results as {at: string; target: string}[]).map(r => ({at: r.at, path: STRIPE_REFUSED, status: 0, outcome: String(r.target).split(' ')[1] ?? ''}))]
      .sort((a, b) => a.at.localeCompare(b.at));
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

// A test alert (issue #263), so the owner can check alert emails arrive without waiting for a real problem. It goes to
// the same owner address through the same email adapter as a real alert, says plainly that nothing needs doing, and
// links to /site-health. It never reads or writes the "last alerted" marker, so it neither delays nor stands in for a
// real alert. The caller (app/api/site-health) checks the owner, rate-limits and logs it.
export const TEST_ALERT_SUBJECT = 'Test alert: no action needed';
export function testAlertEmail(origin: string | null, now = new Date()) {
  const text = ['Test alert: no action needed.', '',
    `This is a test of the Savage Wrestling Academy site's problem alerts, sent from the Site health page at ${when(now, now)} (New York time). Nothing is wrong with the site.`, '',
    'Real alerts come to this address the same way when new site errors appear or a scheduled job doesn\'t finish, at most once an hour.', '',
    origin ? `Site health page (owner sign-in needed):\n${origin}/site-health` : 'See the Site health page in the owner dashboard.', '', '—', 'Savage Wrestling Academy site'].join('\n');
  return {subject: TEST_ALERT_SUBJECT, text};
}
export type TestAlertResult = {status: 'off' | 'sent' | 'failed'; to: string; reason: string | null};
export async function sendTestAlert(now = new Date()): Promise<TestAlertResult> {
  if (!emailConfigured()) return {status: 'off', to: OWNER_EMAIL, reason: null};
  let origin: string | null = null;
  try { origin = appOrigin(); } catch { origin = null; }
  const [result] = await sendEmailsDetailed([{to: OWNER_EMAIL, ...testAlertEmail(origin, now)}]);
  if (result.status === 'skipped') return {status: 'off', to: OWNER_EMAIL, reason: null};
  return result.status === 'sent' ? {status: 'sent', to: OWNER_EMAIL, reason: null} : {status: 'failed', to: OWNER_EMAIL, reason: result.reason ?? 'unreachable'};
}

// For the Site health page: is alerting on, and how did the last alert go?
export async function alertStatus(db: D1Database) {
  const {value} = await marker(db);
  return {
    emailOn: emailConfigured(), to: OWNER_EMAIL, gapMinutes: ALERT_GAP_MS / 60000,
    last: value.sentAt ? {at: value.sentAt, count: value.count ?? 0, sent: value.status === 'sent', reason: value.status === 'failed' ? failureWords(value.reason) : null} : null
  };
}
