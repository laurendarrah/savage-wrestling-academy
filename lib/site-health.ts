// Server errors and site health (issue #107). Every request that ends in a server error (status 500+ or an uncaught
// exception) is recorded with its method, path (never the query string, which can hold invite tokens), status and a
// short message, so the owner sees problems before a family reports them. Only the last 500 are kept.
type DB = D1Database | undefined;

export async function recordError(db: DB, request: Request, status: number, message: string) {
  if (!db) return;
  try {
    const path = new URL(request.url).pathname.slice(0, 200);
    await db.batch([
      db.prepare('INSERT INTO error_log(id,at,method,path,status,message) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(), new Date().toISOString(), request.method, path, status, message.slice(0, 300)),
      db.prepare('DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY at DESC LIMIT 500)')
    ]);
  } catch { /* never let error logging cause another error */ }
}

export async function recentErrors(db: D1Database, hours = 24 * 7) {
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const rows = (await db.prepare('SELECT at,method,path,status,message,request_id AS requestId,role FROM error_log WHERE at>=? ORDER BY at DESC').bind(since).all<any>()).results;
  const day = new Date(Date.now() - 86400000).toISOString();
  // Sign-in outages (issue #274): Supabase could not be reached, answered 503 by lib/api.ts; shown on Site health.
  return {errors: rows, last24h: rows.filter(r => r.at >= day).length, signInOutages24h: rows.filter(r => r.at >= day && Number(r.status) === 503 && /SignInUnavailable/.test(r.message)).length};
}

// Can Supabase be reached right now (issue #274)? One call to its health endpoint with a short time limit; the answer is
// only "yes", "no" or "not set up", never anything about accounts.
export async function supabaseReachable(url: string | undefined, ms = 4000): Promise<{configured: boolean; reachable: boolean | null; ms: number | null}> {
  if (!url) return {configured: false, reachable: null, ms: null};
  const started = Date.now();
  try {
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
    const r = await fetch(new URL('/auth/v1/health', url).href, {signal});
    return {configured: true, reachable: r.status < 500, ms: Date.now() - started};
  } catch {
    return {configured: true, reachable: false, ms: Date.now() - started};
  }
}

// The scheduled run notes when it last ran (issue #274), one row in academy_settings next to the reminder markers.
export const CRON_MARKER = 'cron-run';
export async function noteCronRun(db: DB, now = new Date()) {
  if (!db) return;
  try {
    await db.prepare("INSERT INTO academy_settings(id,payload,updated_at,updated_by) VALUES (?,?,?,'system') ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at")
      .bind(CRON_MARKER, JSON.stringify({at: now.toISOString()}), now.toISOString()).run();
  } catch { /* a missed note never fails the run */ }
}
export async function lastCronRun(db: DB): Promise<string | null> {
  if (!db) return null;
  try { return (await db.prepare('SELECT updated_at FROM academy_settings WHERE id=?').bind(CRON_MARKER).first<{updated_at: string}>())?.updated_at ?? null; } catch { return null; }
}

// Which services are set up (issue #274): presence only, never a value. The build id comes from the Deploy workflow's
// commit (vite.config.ts), "dev" otherwise.
export type HealthSettings = {EMAIL_API_KEY?: string; MAIL_FROM?: string; SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string; STRIPE_TEST_WEBHOOK_SECRET?: string; STRIPE_LIVE_WEBHOOK_SECRET?: string; STRIPE_MODE?: string};
export function configured(settings: HealthSettings) {
  const live = settings.STRIPE_MODE === 'live';
  return {email: !!(settings.EMAIL_API_KEY && settings.MAIL_FROM), supabase: !!(settings.SUPABASE_URL && settings.SUPABASE_PUBLISHABLE_KEY),
    stripeWebhook: !!(live ? settings.STRIPE_LIVE_WEBHOOK_SECRET : settings.STRIPE_TEST_WEBHOOK_SECRET)};
}

// For an uptime monitor: is the Worker running and can it read the database? No private data.
export async function health(db: DB, settings: HealthSettings = {}, build = 'dev') {
  const started = Date.now();
  try {
    if (!db) throw Error('no database');
    const [, cron] = await db.batch([db.prepare('SELECT 1'), db.prepare('SELECT updated_at FROM academy_settings WHERE id=?').bind(CRON_MARKER)]);
    const lastCron = (cron.results as {updated_at: string}[])[0]?.updated_at ?? null;
    return {ok: true, database: 'ok', ms: Date.now() - started, time: new Date().toISOString(), build, lastCronRun: lastCron, configured: configured(settings)};
  } catch {
    return {ok: false, database: 'unavailable', ms: Date.now() - started, time: new Date().toISOString(), build, lastCronRun: null, configured: configured(settings)};
  }
}
