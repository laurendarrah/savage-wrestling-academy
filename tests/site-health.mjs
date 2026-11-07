// Issue #107: server errors are recorded for the owner, and /api/health reports whether the site is up.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {
  prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }, async run() { return {meta: sqlite.prepare(sql).run(...a)}; },
    _execute() { const s = sqlite.prepare(sql); return s.columns().length ? {results: s.all(...a)} : {results: [], meta: s.run(...a)}; }}; },
  async batch(list) { sqlite.exec('BEGIN'); try { const r = list.map(s => s._execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }
};
const env = {DB};
let actor = {owner: true, id: 'owner-id'};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, btoa, TextEncoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test',
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, headers: new Headers()}),
          strongAccount: async () => ({user: {id: actor.id, email: actor.id + '@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.endsWith('/access-control')) return {accountRole: async () => actor.coach ? {role: 'coach', staff: {email: actor.coach, name: 'Coach Dana', programs: actor.programs ?? ['Intermediate']}} : {role: 'family', staff: null}};
        if (name.endsWith('/stripe-test')) return {storedStripeKeyFor: async () => null, stripeClientFor: () => null, stripeMode: () => 'test'};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}









let handlerResult = null;
// The Worker entry with a stand-in request handler.
const worker = (() => {
  const module = {exports: {}};
  vm.runInNewContext(ts.transpileModule(readFileSync('build/worker.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText.replace(/import\.meta\.env\.DEV/g, 'false'),
    {module, exports: module.exports, crypto, URL, Response, Request, Date, console, Error, String,
      require(name) {
        if (name === 'vinext/server/fetch-handler') return {default: {fetch: async () => { if (handlerResult instanceof Error) throw handlerResult; return handlerResult; }}};
        if (name.endsWith('/site-health')) return load(path.resolve('lib/site-health.ts'));
        if (name.endsWith('/page-chrome')) return load(path.resolve('lib/page-chrome.ts'));
        if (name.endsWith('/owner-alerts')) return {alertOwner: async db => { alerts.push(db); return 'off'; }};
        if (name.endsWith('/notify')) return {dailyReminders: async () => { reminders++; if (reminderFails) throw Error('mail provider down'); return 0; }};
        if (name.endsWith('/coach-retention')) return {cleanupRemovedCoaches: async () => { cleanups++; if (cleanupFails) throw Error('D1 busy'); return {}; }};
        if (name.endsWith('/stripe-fees')) return {recordStripeFees: async () => { feeRuns++; return feeRun; }};
        if (name.endsWith('/backup-records')) return {clearStaleStaging: async () => { stagingRuns++; if (stagingFails) throw Error('staging cleanup failed'); }};
        throw Error('unexpected ' + name);
      }});
  return module.exports.default;
})();
let stagingRuns = 0, stagingFails = false, reminders = 0, reminderFails = false, cleanups = 0, cleanupFails = false, feeRuns = 0, feeRun = {mode: 'test', checked: 0, recorded: 0, failed: 0, waiting: 0, error: null, skipped: null};
const alerts = [];
const pending = [];
const ctx = {waitUntil: p => pending.push(p)};
const hit = async (url, result) => { handlerResult = result; pending.length = 0; let thrown = null; let res = null; try { res = await worker.fetch(new Request(url), {DB}, ctx); } catch (e) { thrown = e; } await Promise.all(pending); return {res, thrown}; };
const rows = () => sqlite.prepare('SELECT * FROM error_log ORDER BY at').all();

// Normal responses are not recorded.
await hit('https://swa.test/family', new Response('ok', {status: 200}));
await hit('https://swa.test/api/x', new Response('nope', {status: 404}));
assert.equal(rows().length, 0);
assert.equal(alerts.length, 0, 'no alert without an error');
// A 500 is recorded without the query string (invite links carry tokens).
await hit('https://swa.test/scholarship?token=secret-invite-token', new Response('boom', {status: 500, statusText: 'Internal Server Error'}));
assert.equal(rows().length, 1); assert.equal(rows()[0].path, '/scholarship'); assert.equal(rows()[0].status, 500);
assert.ok(!JSON.stringify(rows()).includes('secret-invite-token'));
assert.equal(alerts.length, 1, 'each recorded error checks whether to alert the owner (issue #47)'); assert.equal(alerts[0], DB);
// An uncaught exception is recorded and still surfaces.
const r = await hit('https://swa.test/api/roster', new Error('D1_ERROR: no such table: orders'));
assert.ok(r.thrown); assert.match(rows().at(-1).message, /no such table: orders/);
// Only the last 500 are kept.
for (let i = 0; i < 505; i++) sqlite.prepare("INSERT INTO error_log VALUES (?,?,?,?,?,?)").run('old' + i, new Date(Date.now() - 864e5 * 3 - i * 1000).toISOString(), 'GET', '/old', 500, 'old');
await hit('https://swa.test/new', new Response('', {status: 503}));
assert.equal(rows().length, 500); assert.ok(rows().some(x => x.path === '/new'));

// Health check: public, no private data.
const healthApi = load(path.resolve('app/api/health/route.ts'));
let h = await healthApi.GET(); assert.equal(h.status, 200); const hb = await h.json();
assert.equal(hb.ok, true); assert.equal(hb.database, 'ok'); assert.deepEqual(Object.keys(hb).sort(), ['database', 'ms', 'ok', 'time']);

// Owner page data: owner only, recent errors and the 24-hour count.
const siteApi = load(path.resolve('app/api/site-health/route.ts'));
actor = {owner: false, id: 'p1'}; assert.equal((await siteApi.GET(new Request('https://a.test/x'))).status, 403);
actor = {owner: true, id: 'owner-id'}; const s = await (await siteApi.GET(new Request('https://a.test/x'))).json();
assert.equal(s.last24h, 3, 'three errors today'); assert.ok(s.errors.length >= 3); assert.equal(s.health.ok, true);
// The daily schedule sends reminders; a failure is recorded for the owner instead of vanishing.
let before = alerts.length;
pending.length = 0; await worker.scheduled({cron: '41 12 * * *'}, {DB}, ctx); await Promise.all(pending);
assert.equal(reminders, 1, 'scheduled run should send daily reminders');
reminderFails = true;
pending.length = 0; await worker.scheduled({cron: '41 12 * * *'}, {DB}, ctx); await Promise.all(pending);
const last = sqlite.prepare('SELECT * FROM error_log ORDER BY at DESC LIMIT 1').get();
assert.equal(last.path, '/daily-reminders'); assert.match(last.message, /mail provider down/);
assert.equal(alerts.length, before + 2, 'every scheduled run checks alerts, after a failure is recorded');
// The removed-coach cleanup (#212) runs after the reminders, even when they fail; its own failure is recorded too.
assert.equal(cleanups, 2, 'the cleanup runs every day, after the reminders');
reminderFails = false; cleanupFails = true;
pending.length = 0; await worker.scheduled({cron: '41 12 * * *'}, {DB}, ctx); await Promise.all(pending);
const failed = sqlite.prepare('SELECT * FROM error_log ORDER BY at DESC LIMIT 1').get();
assert.equal(failed.path, '/coach-retention'); assert.match(failed.message, /D1 busy/);
assert.equal(alerts.length, before + 3, 'one alert check per run');
// The same run reads Stripe card fees (issue #42). A fee that can't be read is recorded for the owner, without blocking
// the reminders or the cleanup.
assert.equal(feeRuns, 3, 'every scheduled run reads card fees');
cleanupFails = false; feeRun = {...feeRun, checked: 3, failed: 3, error: 'Stripe would not share card fees with the saved restricted key.'};
pending.length = 0; await worker.scheduled({cron: '41 12 * * *'}, {DB}, ctx); await Promise.all(pending);
const feeError = sqlite.prepare("SELECT * FROM error_log WHERE path='/stripe-fees' ORDER BY at DESC LIMIT 1").get();
assert.match(feeError.message, /3 card fee\(s\) not read: Stripe would not share/); assert.equal(reminders, 4, 'reminders still sent'); assert.equal(cleanups, 4, 'the cleanup still runs');
assert.equal(alerts.length, before + 4);
// Unfinished restore uploads from the Backups page are removed every day (issue #221); a failure is recorded too.
assert.equal(stagingRuns, 4, 'every scheduled run clears stale restore uploads');
feeRun = {...feeRun, checked: 0, failed: 0, error: null}; stagingFails = true;
pending.length = 0; await worker.scheduled({cron: '41 12 * * *'}, {DB}, ctx); await Promise.all(pending);
assert.match(sqlite.prepare("SELECT * FROM error_log WHERE path='/restore-staging' ORDER BY at DESC LIMIT 1").get().message, /staging cleanup failed/);
assert.equal(reminders, 5, 'reminders still sent'); assert.equal(alerts.length, before + 5);
assert.match(readFileSync('vite.config.ts', 'utf8'), /crons: \["41 12 \* \* \*"\]/);
console.log('Site health tests passed');
