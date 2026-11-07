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
  const rows = (await db.prepare('SELECT at,method,path,status,message FROM error_log WHERE at>=? ORDER BY at DESC').bind(since).all<any>()).results;
  const day = new Date(Date.now() - 86400000).toISOString();
  return {errors: rows, last24h: rows.filter(r => r.at >= day).length};
}

// For an uptime monitor: is the Worker running and can it read the database? No private data.
export async function health(db: DB) {
  const started = Date.now();
  try {
    if (!db) throw Error('no database');
    await db.prepare('SELECT 1').first();
    return {ok: true, database: 'ok', ms: Date.now() - started, time: new Date().toISOString()};
  } catch {
    return {ok: false, database: 'unavailable', ms: Date.now() - started, time: new Date().toISOString()};
  }
}
