// Issue #274: one error path for every API route. A handler that throws answers JSON with a request id instead of an
// empty 500; the error is in error_log with that id, the area and the role, with emails and values redacted; a Supabase
// outage is a 503 that never looks like a sign-out; the Worker alerts the owner once without recording it twice; and
// every app/api route is wrapped.
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
// A Supabase stand-in whose getUser() answer the test controls: a user, "no session", or a network failure.
const users = {owner: {id: 'owner-uuid', email: 'savagewrestlingclub@gmail.com', email_confirmed_at: 'y', factors: [{status: 'verified', factor_type: 'totp'}]}, coach: {id: 'coach-uuid', email: 'coach@example.test', email_confirmed_at: 'y'}, fam: {id: 'fam-uuid', email: 'fam@example.test', email_confirmed_at: 'y'}};
let outage = null;
const b64url = s => Buffer.from(s).toString('base64url');
const jwt = (sub, aal) => [b64url('{"alg":"HS256"}'), b64url(JSON.stringify({sub, aal})), b64url('sig')].join('.');
const env = {DB, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', APP_ORIGIN: 'https://academy.test'};
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, TextEncoder, TextDecoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, WeakMap, Object, Promise, console, Error, TypeError, AbortSignal, setTimeout, atob, btoa,
      fetch: async () => { throw Error('no network in tests'); },
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name === '@supabase/ssr') return {parseCookieHeader: raw => raw ? raw.split(';').map(v => ({name: v.trim().split('=')[0], value: v.trim().split('=')[1]})) : [], serializeCookieHeader: (n, v) => `${n}=${v}`,
          createServerClient(url, key, options) {
            const session = options.cookies.getAll().find(c => c.name === 'test-session')?.value;
            return {auth: {
              async getUser() { if (outage) return {data: {user: null}, error: outage}; return {data: {user: users[session] ?? null}, error: users[session] ? null : {status: 400, name: 'AuthSessionMissingError'}}; },
              async getSession() { return {data: {session: users[session] ? {access_token: jwt(users[session].id, session === 'owner' ? 'aal2' : 'aal1')} : null}, error: null}; },
            }};
          }};
        if (name.endsWith('/net')) return {timedFetch: () => fetch, SUPABASE_TIMEOUT_MS: 8000, EMAIL_TIMEOUT_MS: 10000, timeoutSignal: () => undefined};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
const api = load('lib/api.ts'), auth = load('lib/account-auth.ts');
const req = (p, session = '', ip = '203.0.113.1') => new Request('https://academy.test' + p, {headers: {cookie: session ? 'test-session=' + session : '', 'cf-connecting-ip': ip}});
const rows = () => sqlite.prepare('SELECT * FROM error_log ORDER BY at, id').all();
// Rows written in the same millisecond share `at`, so a row is found by the request id the response carried, never by position.
const rowFor = async r => sqlite.prepare('SELECT * FROM error_log WHERE request_id=?').get((await r.clone().json()).requestId);

// --- redact(): emails, quoted text, ids, tokens and long numbers leave the message; the shape stays ---
assert.equal(api.redact("D1_ERROR: UNIQUE constraint failed: orders.dedupe_key for pat@example.test value 'Sam Smith' id 3f2a1b4c-1111-2222-3333-444455556666 card 123456789 token abcdef0123456789abcdef0123456789"),
  "D1_ERROR: UNIQUE constraint failed: orders.dedupe_key for <email> value '…' id <id> card <number> token <token>");
assert.equal(api.redact('TypeError: Cannot read properties of undefined (reading "name")'), 'TypeError: Cannot read properties of undefined (reading "…")');
assert.equal(api.redact('x'.repeat(400)).length, 300);

// --- A thrown error: JSON with a request id, no-store, recorded with id, area and role ---
sqlite.exec('DELETE FROM error_log');
const boom = api.withApi(async request => { await auth.strongAccount(request); throw new Error('D1_ERROR: no such column: pat@example.test'); });
let r = await boom(req('/api/roster?date=2026-11-09&token=secret', 'fam'));
assert.equal(r.status, 500); assert.equal(r.headers.get('Cache-Control'), 'no-store');
let body = await r.json();
assert.equal(body.error, 'Something went wrong. Try again.'); assert.match(body.requestId, /^[0-9a-f-]{36}$/);
assert.equal(r.headers.get('X-Request-Id'), body.requestId); assert.equal(r.headers.get('X-SWA-Error-Recorded'), '1', 'tells the Worker it is already recorded');
let row = sqlite.prepare('SELECT * FROM error_log WHERE request_id=?').get(body.requestId);
assert.ok(row, 'recorded under the request id the page was given'); assert.equal(row.path, '/api/roster', 'the area, never the query string'); assert.equal(row.status, 500); assert.equal(row.role, 'family');
assert.match(row.message, /^Error: D1_ERROR: no such column: <email>$/, 'emails are redacted'); assert.ok(!JSON.stringify(row).includes('secret'));
// The role comes from the verified identity: the owner, a coach (from staff_access), or anonymous.
r = await boom(req('/api/payments', 'owner')); assert.equal((await rowFor(r)).role, 'owner');
sqlite.prepare("INSERT INTO staff_access VALUES ('coach@example.test','Coach','[\"Intermediate\"]',1,'x')").run();
r = await boom(req('/api/coach', 'coach')); assert.equal((await rowFor(r)).role, 'coach');
r = await boom(req('/api/coach')); assert.equal((await rowFor(r)).role, 'anon');
// A cookie that names an account nobody verified counts as anonymous.
r = await api.withApi(async () => { throw new Error('before any check'); })(req('/api/x', 'owner')); assert.equal((await rowFor(r)).role, 'anon', 'no verified identity, no role from the cookie');
// A handler that answers normally is untouched.
r = await api.withApi(async () => Response.json({ok: true}, {status: 201}))(req('/api/x')); assert.equal(r.status, 201); assert.equal((await r.json()).ok, true);
assert.equal(rows().length, 5);

// --- Supabase unreachable: 503 with its own wording, never 401 or a redirect, and recorded as such ---
for (const failure of [{status: 0, name: 'AuthRetryableFetchError', message: 'fetch failed'}, {status: 503, name: 'AuthApiError', message: 'service unavailable'}, {status: 500, code: 'unexpected_failure'}]) {
  outage = failure;
  r = await api.withApi(async request => { const a = await auth.strongAccount(request); return Response.json({user: a.user}); })(req('/api/family', 'fam'));
  assert.equal(r.status, 503, JSON.stringify(failure)); body = await r.json();
  assert.match(body.error, /Sign-in is temporarily unavailable/); assert.ok(body.requestId);
  row = sqlite.prepare('SELECT * FROM error_log WHERE request_id=?').get(body.requestId); assert.equal(row.status, 503); assert.match(row.message, /^SignInUnavailable: /); assert.equal(row.role, 'anon');
}
outage = null;
// "No session" is still just signed out: the route's own 401, not an outage.
r = await api.withApi(async request => { const a = await auth.strongAccount(request); return a.user ? Response.json({}) : Response.json({error: 'Sign-in required.'}, {status: 401}); })(req('/api/family'));
assert.equal(r.status, 401);
// A signed-in page answers 503 with a plain explanation instead of sending the person to sign in again.
const pages = load('lib/protected-page.ts');
outage = {status: 0, name: 'AuthRetryableFetchError'};
const page = await pages.familyPage(req('/family', 'fam'), '<html></html>');
assert.equal(page.status, 503); assert.equal(page.headers.get('Location'), null, 'no redirect to /login'); assert.match(await page.text(), /not signed out/);
assert.equal((await pages.ownerPage(req('/payments', 'owner'), '<html></html>')).status, 503);
outage = null;
assert.equal((await pages.familyPage(req('/family', 'fam'), '<html></html>')).status, 200, 'and works again when Supabase does');
assert.equal((await pages.familyPage(req('/family'), '<html></html>')).status, 303, 'signed out still goes to sign in');

// --- The identity is worked out once per request, and the level comes from the session token ---
const counting = load('lib/account-auth.ts');
const request = req('/api/roster', 'owner');
const [a, b, c] = await Promise.all([counting.ownerIdentity(request), counting.strongAccount(request), counting.verifiedAccount(request)]);
assert.equal(a.owner.userId, 'supabase:owner-uuid'); assert.equal(b.strong, true, 'aal2 from the token'); assert.equal(c.user.id, 'owner-uuid');
assert.equal(a.headers, b.headers, 'one headers object per request, so cookie refreshes are not lost');
assert.equal((await counting.strongAccount(req('/api/roster', 'fam'))).strong, true, 'no authenticator needed by default (#306)');
env.STAFF_MFA = 'on';
assert.equal((await counting.strongAccount(req('/api/roster', 'fam'))).strong, false, 'aal1 without an authenticator when STAFF_MFA=on');
delete env.STAFF_MFA;

// --- The Worker: an error the wrapper recorded is alerted once, not recorded twice, and the mark never leaves ---
const site = load('lib/site-health.ts');
const alerts = [];
const worker = (() => {
  const module = {exports: {}};
  vm.runInNewContext(ts.transpileModule(readFileSync('build/worker.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, URL, Response, Request, Headers, Date, Promise, console, Error, String,
      require(name) {
        if (name === 'vinext/server/fetch-handler') return {default: {fetch: async () => handlerResult}};
        if (name.endsWith('/site-health')) return site;
        if (name.endsWith('/page-chrome')) return load('lib/page-chrome.ts');
        if (name.endsWith('/api')) return api;
        if (name.endsWith('/owner-alerts')) return {alertOwner: async () => { alerts.push(1); return 'off'; }};
        if (name.endsWith('/reminder-watch')) return {reminderWatch: async () => 'early'};
        return {dailyReminders: async () => 0, cleanupRemovedCoaches: async () => ({}), recordStripeFees: async () => ({error: null}), clearStaleStaging: async () => {}, purgeStaleLookups: async () => 0};
      }});
  return module.exports.default;
})();
let handlerResult;
const pending = [], ctx = {waitUntil: p => pending.push(p)};
sqlite.exec('DELETE FROM error_log');
handlerResult = await boom(req('/api/roster', 'fam'));
pending.length = 0; const out = await worker.fetch(req('/api/roster', 'fam'), {DB}, ctx); await Promise.all(pending);
assert.equal(out.status, 500); assert.equal(out.headers.get('X-SWA-Error-Recorded'), null, 'the internal mark is removed');
assert.ok(out.headers.get('X-Request-Id'), 'the request id stays for the page');
assert.equal(rows().length, 1, 'recorded once, by the wrapper'); assert.equal(alerts.length, 1, 'and the owner is alerted');
// A 500 from anywhere else is still recorded by the Worker, as before.
handlerResult = new Response('boom', {status: 500, statusText: 'Internal Server Error'});
pending.length = 0; await worker.fetch(req('/family'), {DB}, ctx); await Promise.all(pending);
assert.equal(rows().length, 2); assert.equal(rows().filter(x => x.request_id === null).length, 1, 'the Worker-recorded row has no request id');

// --- Every API route is wrapped, and only the wrapped handlers are exported ---
const routes = readdirSync('app/api').map(d => `app/api/${d}/route.ts`);
for (const f of routes) {
  const src = readFileSync(f, 'utf8');
  assert.match(src, /from '\.\.\/\.\.\/\.\.\/lib\/api'/, f + ' imports the wrapper');
  const exported = [...src.matchAll(/^export const (GET|POST|PUT|PATCH|DELETE) = withApi\(\1_\);/gm)].map(m => m[1]);
  assert.ok(exported.length >= 1, f + ' exports wrapped handlers');
  assert.doesNotMatch(src, /^export async function (GET|POST|PUT|PATCH|DELETE)\(/m, f + ': no handler is exported unwrapped');
}
// Pages show the reference the wrapper returned, where they already show the error.
assert.match(readFileSync('app/site-health/screen.html', 'utf8'), /reference '\+e\.requestId\.slice\(0,8\)/);
console.log(`API errors: JSON with a request id, recorded with area and role and redacted, 503 for a Supabase outage, one Worker record and alert, ${routes.length} routes wrapped`);
