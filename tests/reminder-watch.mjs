// Issue #274: the morning reminders are no longer run inline by the first family, inbox or roster request of the day.
// The Worker watches them instead: after 10 AM New York, once per isolate per day, a request checks the day's marker;
// a missing run is recorded for the owner's alert and the reminders are run as the fallback, never awaited by a request.
// Site health shows the last run.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
let queries = 0;
const DB = {
  prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { queries++; return sqlite.prepare(sql).get(...a) ?? null; }, async all() { queries++; return {results: sqlite.prepare(sql).all(...a)}; }, async run() { queries++; return {meta: sqlite.prepare(sql).run(...a)}; },
    _execute() { const s = sqlite.prepare(sql); return s.columns().length ? {results: s.all(...a)} : {results: [], meta: s.run(...a)}; }}; },
  async batch(list) { queries++; sqlite.exec('BEGIN'); try { const r = list.map(s => s._execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }
};
const env = {DB};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console, TextEncoder, Uint8Array, Promise, AbortSignal,
      fetch: async () => new Response('{}', {status: 200}),
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test', OWNER_EMAIL: 'o@example.test'};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
const watch = load(path.resolve('lib/reminder-watch.ts'));
const errors = () => sqlite.prepare('SELECT path,status,message FROM error_log ORDER BY at').all();
// A stand-in for dailyReminders that keeps the same per-day marker the real one does.
let runs = 0;
const run = async (force, today) => { runs++; sqlite.prepare("INSERT OR IGNORE INTO academy_settings(id,payload,updated_at,updated_by) VALUES (?,'{}',?,'system')").run('reminders:' + today, new Date().toISOString()); return 3; };
// New York times on a November day (UTC-5): 7 AM, 9:59 AM, 10:00 AM, 3 PM.
const at = hm => new Date(`2026-11-09T${hm}:00-05:00`);

// Before the deadline nothing is checked, so early-morning requests cost no query.
watch.resetReminderWatch(); queries = 0;
assert.equal(await watch.reminderWatch(DB, at('07:00'), run), 'early'); assert.equal(await watch.reminderWatch(DB, at('09:59'), run), 'early');
assert.equal(queries, 0, 'no database work before 10 AM'); assert.equal(runs, 0);
// At 10 AM with no run that day: the miss is recorded for the owner's alert, then the reminders run as the fallback.
assert.equal(await watch.reminderWatch(DB, at('10:00'), run), 'ran');
assert.equal(runs, 1);
assert.deepEqual(errors().map(e => [e.path, e.status]), [['/daily-reminders-missed', 500]]);
assert.match(errors()[0].message, /had not run by 10 AM New York/);
const last = await watch.lastReminderRun(DB);
assert.equal(last.day, '2026-11-09'); assert.ok(last.at, 'and when');
// The rest of the day: the isolate remembers it checked, so later requests cost nothing.
queries = 0;
assert.equal(await watch.reminderWatch(DB, at('15:00'), run), 'checked'); assert.equal(queries, 0); assert.equal(runs, 1);
// Another isolate the same day reads the marker once and does nothing more.
watch.resetReminderWatch(); queries = 0;
assert.equal(await watch.reminderWatch(DB, at('15:00'), run), 'done'); assert.equal(queries, 1); assert.equal(runs, 1); assert.equal(errors().length, 1, 'no second miss recorded');
// The next day the cron ran at 7:41, so the 10 AM check finds the marker and records nothing.
sqlite.prepare("INSERT INTO academy_settings(id,payload,updated_at,updated_by) VALUES ('reminders:2026-11-10','{}','2026-11-10T12:41:00.000Z','system')").run();
watch.resetReminderWatch();
assert.equal(await watch.reminderWatch(DB, new Date('2026-11-10T10:30:00-05:00'), run), 'done'); assert.equal(errors().length, 1); assert.equal(runs, 1);
assert.deepEqual({...await watch.lastReminderRun(DB)}, {day: '2026-11-10', at: '2026-11-10T12:41:00.000Z'});
// A fallback that fails is recorded too, under the reminders' own path.
watch.resetReminderWatch();
assert.equal(await watch.reminderWatch(DB, new Date('2026-11-11T11:00:00-05:00'), async () => { throw Error('mail provider down'); }), 'failed');
assert.deepEqual(errors().slice(-2).map(e => e.path), ['/daily-reminders-missed', '/daily-reminders']);
assert.equal(await watch.reminderWatch(undefined, at('11:00'), run), 'early', 'no database: nothing to do');
// The owner alert names the miss in plain words.
const alerts = load(path.resolve('lib/owner-alerts.ts'));
assert.match(alerts.SCHEDULED_JOBS['/daily-reminders-missed'], /had not run by 10 AM New York/);
assert.match(alerts.alertEmail([{at: '2026-11-09T15:00:00Z', path: '/daily-reminders-missed', status: 500}], null).text, /morning reminders had not run by 10 AM/);

// No page route runs the reminders inline any more; the Worker's fetch() watches them in ctx.waitUntil.
for (const f of ['app/api/family/route.ts', 'app/api/inbox/route.ts', 'app/api/roster/route.ts']) assert.doesNotMatch(readFileSync(f, 'utf8'), /dailyReminders/, f);
const worker = readFileSync('build/worker.ts', 'utf8');
assert.match(worker, /ctx\.waitUntil\(reminderWatch\(db\)/, 'watched from the Worker, never awaited by the request');
assert.match(worker, /purgeStaleLookups\(\)\.catch\(failed\("usaw-lookups"\)\)/, 'the daily job purges stale USA Wrestling lookups (issue #274)');

// Site health shows the last reminder run and whether Supabase answers.
const page = readFileSync('app/site-health/screen.html', 'utf8');
assert.match(page, /Last reminder run: /); assert.match(page, /Sign-in service \(Supabase\): /);
console.log('Reminder watch: nothing before 10 AM New York, one check per isolate per day, a missed run is recorded and run as the fallback, routes no longer run it inline');
