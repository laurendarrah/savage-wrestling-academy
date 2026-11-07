// Issue #263: Site health's "Send a test alert" button. One email to the owner address through the owner-alert path,
// owner only, 3 an hour, logged, and never touching the real alerts' once-an-hour marker. With email not set up it
// says so and sends nothing.
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
// A clock the rate limit and the email read, so the test can move past the hour.
let clock = Date.parse('2026-11-09T15:00:00.000Z');
class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } }
let origin = () => 'https://swa.example';
let actor = {owner: true, id: 'supabase:owner-1'};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, fetch: (...a) => fetchMock(...a), crypto, TextEncoder, Uint8Array, Intl, Date: FakeDate, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console, Error,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {OWNER_EMAIL: 'savagewrestlingclub@gmail.com', appOrigin: () => origin(),
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
let fetchMock = async () => { throw Error('no network in tests'); };
const sent = [];
const provider = (status = 200) => { fetchMock = async (url, init) => { sent.push({url, body: JSON.parse(init.body)}); return new Response('{}', {status}); }; };
const api = load(path.resolve('app/api/site-health/route.ts'));
const alerts = load(path.resolve('lib/owner-alerts.ts'));
const {describeSecurityEvent} = load(path.resolve('lib/security-log.ts'));

const post = async (body = {action: 'test-alert'}, {from = 'https://swa.example', type = 'application/json'} = {}) => {
  const r = await api.POST(new Request('https://swa.example/api/site-health', {method: 'POST', headers: {origin: from, 'content-type': type, 'cf-connecting-ip': '203.0.113.9'}, body: JSON.stringify(body)}));
  return {status: r.status, body: await r.json()};
};
const marker = () => sqlite.prepare("SELECT payload, updated_at FROM academy_settings WHERE id='owner-alert'").get() ?? null;
const logged = () => sqlite.prepare("SELECT actor, action, target FROM security_events WHERE action='owner_test_alert' ORDER BY created_at, rowid").all().map(r => ({...r}));
const attempts = () => sqlite.prepare('SELECT COUNT(*) AS n FROM auth_attempts').get().n;

// --- Email not set up: says so, sends nothing, counts nothing, logs nothing ---
for (let i = 0; i < 5; i++) {
  const r = await post();
  assert.equal(r.status, 409); assert.equal(r.body.status, 'off');
  assert.match(r.body.error, /^Email isn’t set up yet/);
}
assert.equal(sent.length, 0); assert.deepEqual(logged(), []); assert.equal(attempts(), 0, 'no tries used up while email is off');
assert.equal(marker(), null);
assert.deepEqual(JSON.parse(JSON.stringify(await alerts.sendTestAlert())), {status: 'off', to: 'savagewrestlingclub@gmail.com', reason: null});

env.EMAIL_API_KEY = 'test-key'; env.MAIL_FROM = 'SWA <academy@swa.example>';
provider();

// --- Owner only, checked on the server; same-origin JSON only ---
actor = {owner: false, id: 'supabase:family-1'};
let r = await post();
assert.equal(r.status, 403); assert.match(r.body.error, /Owner sign-in/);
actor = {owner: true, id: 'supabase:owner-1'};
assert.equal((await post(undefined, {from: 'https://evil.example'})).status, 403, 'another site cannot trigger it');
assert.equal((await post(undefined, {type: 'text/plain'})).status, 415);
assert.equal((await post({action: 'something-else'})).status, 400);
assert.equal(sent.length, 0, 'nothing sent for a refused request'); assert.deepEqual(logged(), []);

// --- Sent: to the owner address, marked as a test, with a link from appOrigin(); logged ---
r = await post();
assert.equal(r.status, 200); assert.equal(r.body.status, 'sent'); assert.equal(r.body.to, 'savagewrestlingclub@gmail.com');
assert.match(r.body.message, /^Sent to savagewrestlingclub@gmail\.com\./);
assert.equal(sent.length, 1); assert.equal(sent[0].url, 'https://api.resend.com/emails/batch', 'the same email adapter as real alerts');
let mail = sent[0].body[0];
assert.deepEqual(mail.to, ['savagewrestlingclub@gmail.com']); assert.equal(mail.from, 'SWA <academy@swa.example>');
assert.equal(mail.subject, 'Test alert: no action needed');
assert.match(mail.text, /^Test alert: no action needed\./); assert.match(mail.text, /Nothing is wrong with the site/);
assert.match(mail.text, /https:\/\/swa\.example\/site-health/, 'link built from appOrigin()');
assert.deepEqual(logged(), [{actor: 'supabase:owner-1', action: 'owner_test_alert', target: 'sent'}]);

// --- The real alert throttle is untouched: no marker is written, and a real alert still goes out right after ---
assert.equal(marker(), null, 'a test alert writes no "last alerted" marker');
sqlite.prepare('INSERT INTO error_log VALUES (?,?,?,?,?,?)').run('e1', new Date(clock - 60000).toISOString(), 'GET', '/register', 500, 'boom');
assert.equal(await alerts.alertOwner(DB, new Date(clock)), 'sent', 'the test did not start the hour');
const real = marker(); assert.equal(sent.length, 2); assert.match(sent[1].body[0].subject, /^Site alert/);
// Inside the real alert's hour, a test alert still sends and leaves the marker exactly as it was.
clock += 5 * 60000;
r = await post(); assert.equal(r.status, 200); assert.equal(sent.length, 3);
assert.deepEqual(marker(), real, 'the test neither resets nor extends the real hour');
const status = await alerts.alertStatus(DB); assert.equal(status.last.count, 1, 'Alerts and email still shows the last real alert');
sqlite.prepare('INSERT INTO error_log VALUES (?,?,?,?,?,?)').run('e2', new Date(clock - 1000).toISOString(), 'GET', '/family', 500, 'boom');
assert.equal(await alerts.alertOwner(DB, new Date(clock)), 'waiting', 'the real throttle still holds');

// --- Rate limit: 3 an hour per owner, then a plain refusal; the next hour works again ---
r = await post(); assert.equal(r.status, 200); assert.equal(sent.length, 4);
r = await post(); assert.equal(r.status, 429); assert.match(r.body.error, /3 test alerts an hour/);
r = await post(); assert.equal(r.status, 429);
assert.equal(sent.length, 4, 'nothing sent past the limit'); assert.equal(logged().length, 3);
clock = Date.parse('2026-11-09T16:01:00.000Z');
r = await post(); assert.equal(r.status, 200, 'a new hour allows tests again'); assert.equal(sent.length, 5);

// --- The email service refuses: the adapter's reason in plain words, and logged ---
provider(403); clock = Date.parse('2026-11-09T18:00:00.000Z');
r = await post();
assert.equal(r.status, 502); assert.equal(r.body.status, 'failed'); assert.equal(r.body.reason, 'setup');
assert.match(r.body.error, /^The test alert didn’t send\. The email service didn’t accept the academy’s email settings/);
assert.deepEqual(logged().at(-1), {actor: 'supabase:owner-1', action: 'owner_test_alert', target: 'failed:setup'});
fetchMock = async () => { throw Error('network down'); };
r = await post(); assert.equal(r.status, 502); assert.match(r.body.error, /couldn’t be reached/);
assert.deepEqual(marker(), real, 'failures leave the real marker alone too');

// --- Without APP_ORIGIN the test still goes, without a link ---
provider(); origin = () => { throw Error('APP_ORIGIN is not set.'); }; clock = Date.parse('2026-11-09T20:00:00.000Z');
r = await post(); assert.equal(r.status, 200);
assert.ok(!/https?:\/\//.test(sent.at(-1).body[0].text)); assert.match(sent.at(-1).body[0].text, /Site health page in the owner dashboard/);
origin = () => 'https://swa.example';

// --- Security activity describes it in plain words ---
const names = {people: {}, you: ['supabase:owner-1'], approvals: {}, waitlist: {}, orders: {}, waivers: {}, wrestlers: {}, requests: {}, curricula: {}, coaches: {}};
let e = describeSecurityEvent({actor: 'supabase:owner-1', action: 'owner_test_alert', target: 'sent', created_at: '2026-11-09T15:00:00.000Z'}, names);
assert.equal(e.title, 'Test alert from Site health'); assert.equal(e.detail, 'Sent to the owner address'); assert.equal(e.who, 'You');
e = describeSecurityEvent({actor: 'supabase:owner-1', action: 'owner_test_alert', target: 'failed:busy', created_at: '2026-11-09T15:00:00.000Z'}, names);
assert.equal(e.detail, 'Didn’t send. Too many emails went out at once. Trying again usually works.');

// --- The page: the button, its explanation, and the answer in plain words ---
const html = readFileSync('app/site-health/screen.html', 'utf8');
const card = html.match(/<h2>Alerts and email<\/h2>[\s\S]*?<\/section>/)[0];
assert.match(card, /<button type="button" id="testAlert">Send a test alert<\/button>/, 'the button is in the Alerts and email card');
assert.match(card, /<p id="testResult" role="status" aria-live="polite">/, 'the answer is announced');
assert.match(card, /“Test alert: no action needed”/); assert.match(card, /Up to 3 an hour/); assert.match(card, /doesn’t change when the next real alert/);
assert.ok(!/(^|[}>])button\{/.test(html.match(/<style>([\s\S]*?)<\/style>/)[1]), 'the page styles only its own button, not the owner shell’s');
assert.match(readFileSync('app/site-health/route.ts', 'utf8'), /ownerPage\(request, html\)/, 'the page stays an owner page inside the owner shell');

const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
async function page(answer) {
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {hidden: false, disabled: false, className: '', textContent: '', innerHTML: ''}); return nodes.get(id); };
  const calls = [];
  const load = {health: {ok: true}, last24h: 0, errors: [], failedEmails: 0, alerts: {emailOn: true, to: 'savagewrestlingclub@gmail.com', last: null}};
  vm.runInNewContext(script, {document: {getElementById: el}, Date, String, Error, Intl, JSON,
    fetch: async (url, init) => { calls.push({url, init}); if (init?.method !== 'POST') return {ok: true, json: async () => load}; return answer(init); }});
  await new Promise(r => setImmediate(r));
  return {el, calls};
}
const reply = (status, body) => async () => ({ok: status < 300, status, json: async () => body});
let p = await page(reply(200, {status: 'sent', to: 'savagewrestlingclub@gmail.com', message: 'Sent to savagewrestlingclub@gmail.com. It can take a few minutes to arrive; if it doesn’t, check the spam folder.'}));
assert.equal(typeof p.el('testAlert').onclick, 'function');
let click = p.el('testAlert').onclick();
assert.equal(p.el('testAlert').disabled, true, 'no double sends while it works'); assert.equal(p.el('testResult').textContent, 'Sending…');
await click;
assert.equal(p.el('testAlert').disabled, false);
assert.match(p.el('testResult').textContent, /^Sent to savagewrestlingclub@gmail\.com\./); assert.equal(p.el('testResult').className, 'ok');
const sentCall = p.calls.find(c => c.init?.method === 'POST');
assert.equal(sentCall.url, '/api/site-health'); assert.equal(sentCall.init.method, 'POST');
assert.equal(sentCall.init.headers['Content-Type'], 'application/json'); assert.deepEqual(JSON.parse(sentCall.init.body), {action: 'test-alert'});

p = await page(reply(409, {status: 'off', error: 'Email isn’t set up yet, so no test alert was sent. Try again once email is set up.'}));
await p.el('testAlert').onclick();
assert.match(p.el('testResult').textContent, /^Email isn’t set up yet/); assert.equal(p.el('testResult').className, '');
p = await page(reply(502, {status: 'failed', reason: 'refused', error: 'The test alert didn’t send. The email service refused the message.'}));
await p.el('testAlert').onclick();
assert.equal(p.el('testResult').textContent, 'The test alert didn’t send. The email service refused the message.'); assert.equal(p.el('testResult').className, 'bad');
p = await page(reply(429, {error: 'You can send 3 test alerts an hour. Please try again later.'}));
await p.el('testAlert').onclick(); assert.match(p.el('testResult').textContent, /3 test alerts an hour/);
p = await page(async () => { throw TypeError('Failed to fetch'); });
await p.el('testAlert').onclick();
assert.match(p.el('testResult').textContent, /couldn’t be reached/); assert.equal(p.el('testAlert').disabled, false);

// --- Help page and runbook ---
assert.match(readFileSync('app/help/owner/screen.html', 'utf8'), /<strong>Send a test alert<\/strong> under <strong>Alerts and email<\/strong>[\s\S]*“Test alert: no action needed”[\s\S]*“Email isn’t set up yet”/);
const runbook = readFileSync('docs/RUNBOOK.md', 'utf8');
assert.match(runbook, /### Check that alert emails arrive[\s\S]*\*\*Send a test alert\*\*[\s\S]*"Email isn't set up yet"[\s\S]*3 test alerts an hour/);
assert.match(runbook, /\[check alert emails arrive\]\(#check-that-alert-emails-arrive\)/);
assert.match(readFileSync('docs/LAUNCH_TEST_PASS.md', 'utf8'), /\*\*Send a test alert\*\*/);

console.log('Test alert tests passed');
