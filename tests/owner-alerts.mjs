// Issue #47: the owner is emailed about new server errors and failed scheduled jobs, at most once an hour, with
// counts and a link only. With email not set up nothing is sent and nothing fails.
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
let origin = () => 'https://swa.example';
let actor = {owner: true, id: 'owner-id'};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, fetch: (...a) => fetchMock(...a), crypto, btoa, TextEncoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console, Error,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {OWNER_EMAIL: 'savagewrestlingclub@gmail.com', appOrigin: () => origin(),
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name === 'vinext/server/fetch-handler') return {default: {fetch: async () => handlerResult}};
        if (name.endsWith('/stripe-fees') && file.endsWith('worker.ts')) return {recordStripeFees: async () => ({mode: 'test', checked: 0, recorded: 0, failed: 0, waiting: 0, error: null, skipped: null})};
        if (name.endsWith('/notify') && file.endsWith('worker.ts')) return {dailyReminders: async () => { if (reminderFails) throw Error('Reminder for sam@example.test failed: D1_ERROR at row 7'); return 0; }};
        if (name.endsWith('/reminder-watch') && file.endsWith('worker.ts')) return {reminderWatch: async () => 'early'};
        if (name.endsWith('/usaw-check') && file.endsWith('worker.ts')) return {purgeStaleLookups: async () => 0};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
let fetchMock = async () => { throw Error('no network in tests'); };
let handlerResult = new Response('ok'), reminderFails = false;
const sent = [];
const provider = (status = 200) => { fetchMock = async (url, init) => { sent.push({url, body: JSON.parse(init.body)}); return new Response('{}', {status}); }; };
const alerts = load(path.resolve('lib/owner-alerts.ts'));
const marker = () => { const r = sqlite.prepare("SELECT payload FROM academy_settings WHERE id='owner-alert'").get(); return r ? JSON.parse(r.payload) : null; };
const T0 = Date.parse('2026-11-09T15:00:00.000Z'), at = min => new Date(T0 + min * 60000);
let n = 0;
const error = (min, p, status = 500, message = 'D1_ERROR: no such column for pat@example.test token=abc') =>
  sqlite.prepare('INSERT INTO error_log(id,at,method,path,status,message) VALUES (?,?,?,?,?,?)').run('e' + (++n), at(min).toISOString(), 'GET', p, status, message);

// --- Email not set up: nothing is sent, nothing is stored, nothing throws ---
error(0, '/register');
assert.equal(await alerts.alertOwner(DB, at(1)), 'off');
assert.equal(await alerts.alertOwner(undefined, at(1)), 'off', 'no database is fine too');
assert.equal(sent.length, 0); assert.equal(marker(), null, 'no marker until an alert can be sent');
let st = await alerts.alertStatus(DB); assert.equal(st.emailOn, false); assert.equal(st.last, null);

// --- Email set up: one alert with counts, kinds and a link; no messages, queries or family details ---
env.EMAIL_API_KEY = 'test-key'; env.MAIL_FROM = 'SWA <academy@swa.example>';
provider();
error(2, '/register'); error(3, '/api/checkout/session', 503); error(4, '/daily-reminders');
assert.equal(await alerts.alertOwner(DB, at(5)), 'sent');
assert.equal(sent.length, 1);
let mail = sent[0].body[0];
assert.deepEqual(mail.to, ['savagewrestlingclub@gmail.com'], 'goes to the owner address in lib/account-auth.ts');
assert.match(mail.subject, /4 new problems/);
assert.match(mail.text, /https:\/\/swa\.example\/site-health/, 'link built from appOrigin()');
assert.match(mail.text, /\/register \(2\)|\/register: unexpected error \(2\)/);
assert.match(mail.text, /\/api\/checkout: timed out or unavailable \(1\)/, 'grouped by page area and kind');
assert.match(mail.text, /morning reminders[^\n]*: 1 time/i, 'scheduled job failures are named');
assert.match(mail.text, /at most one of these emails an hour/);
for (const secret of ['D1_ERROR', 'pat@example.test', 'token', 'abc', 'session']) assert.ok(!mail.text.includes(secret) && !mail.subject.includes(secret), 'no error text or details: ' + secret);
// Issue #320: the alert goes out in the Savage layout with the plain text beside it, and the HTML says no more than the text.
assert.deepEqual(Object.keys(mail).sort(), ['from', 'html', 'subject', 'text', 'to']);
assert.match(mail.html, /^<!doctype html>/); assert.match(mail.html, />Savage<\/div>/); assert.match(mail.html, /20 Railroad St, Huntington Station, NY 11746/);
assert.match(mail.html, /<h1[^>]*>Site alert: 4 new problems on the academy site<\/h1>/);
assert.match(mail.html, /owner sign-in needed\):<\/p>\n<table[^>]*><tr><td[^>]*><a href="https:\/\/swa\.example\/site-health"[^>]*>Open Site health<\/a>/, 'the Site health link is the button');
assert.match(mail.html, /Server errors, by page:<br>- \/register: unexpected error \(2\)<br>- \/api\/checkout: timed out or unavailable \(1\)/, 'the lists keep their lines');
assert.match(mail.html, /You’re getting this because you run the Savage Wrestling Academy site\./);
for (const secret of ['D1_ERROR', 'pat@example.test', 'session']) assert.ok(!mail.html.includes(secret), 'no error text or details in the HTML: ' + secret);
let m = marker(); assert.equal(m.status, 'sent'); assert.equal(m.count, 4); assert.equal(m.coveredUntil, at(4).toISOString());
st = await alerts.alertStatus(DB); assert.equal(st.emailOn, true); assert.equal(st.last.sent, true); assert.equal(st.last.count, 4); assert.equal(st.to, 'savagewrestlingclub@gmail.com');

// --- Throttle: nothing more within the hour; then one alert with only the new problems ---
error(10, '/family'); error(20, '/family');
assert.equal(await alerts.alertOwner(DB, at(30)), 'waiting');
assert.equal(await alerts.alertOwner(DB, at(64)), 'waiting', 'still inside the hour');
assert.equal(sent.length, 1, 'never more than one an hour');
assert.equal(await alerts.alertOwner(DB, at(66)), 'sent');
assert.equal(sent.length, 2); mail = sent[1].body[0];
assert.match(mail.subject, /2 new problems/); assert.match(mail.text, /\/family: unexpected error \(2\)/); assert.ok(!mail.text.includes('/register'), 'earlier problems are not repeated');
assert.equal(await alerts.alertOwner(DB, at(200)), 'none', 'nothing new, nothing sent');
assert.equal(sent.length, 2);

// --- Two errors at the same moment send one email between them ---
error(201, '/roster'); error(201.5, '/roster');
const both = await Promise.all([alerts.alertOwner(DB, at(202)), alerts.alertOwner(DB, at(202))]);
assert.deepEqual(both.sort(), ['sent', 'waiting']); assert.equal(sent.length, 3);

// --- A scheduled job alone gets its own subject ---
error(300, '/daily-reminders');
assert.equal(await alerts.alertOwner(DB, at(301)), 'sent');
assert.match(sent.at(-1).body[0].subject, /scheduled job didn't finish/);

// --- The provider refuses: recorded with a plain reason, and not retried for an hour ---
provider(403); error(400, '/payments');
assert.equal(await alerts.alertOwner(DB, at(401)), 'failed');
m = marker(); assert.equal(m.status, 'failed'); assert.equal(m.reason, 'setup');
st = await alerts.alertStatus(DB); assert.equal(st.last.sent, false); assert.match(st.last.reason, /email settings/);
error(410, '/payments'); assert.equal(await alerts.alertOwner(DB, at(411)), 'waiting', 'a failed send still counts toward the hour');

// --- Without APP_ORIGIN the alert still goes, just without a link; old errors are not dug up ---
provider(); origin = () => { throw Error('APP_ORIGIN is not set.'); };
error(500, '/waivers');
assert.equal(await alerts.alertOwner(DB, at(501)), 'sent');
assert.ok(!/https?:\/\//.test(sent.at(-1).body[0].text)); assert.match(sent.at(-1).body[0].text, /Site health page in the owner dashboard/);
assert.match(sent.at(-1).body[0].html, />Savage<\/div>/, 'still in the Savage layout'); assert.ok(!/https?:\/\/|<img/.test(sent.at(-1).body[0].html), 'no link, button or logo without a site address');
origin = () => 'https://swa.example';
sqlite.exec("DELETE FROM academy_settings WHERE id='owner-alert'");
error(-3000, '/very-old'); error(1000, '/fresh');
assert.equal(await alerts.alertOwner(DB, at(1001)), 'sent');
assert.ok(!sent.at(-1).body[0].text.includes('/very-old'), 'the first alert looks back 24 hours at most');

// --- A broken marker or database never throws ---
sqlite.exec("UPDATE academy_settings SET payload='not json' WHERE id='owner-alert'");
assert.ok(['sent', 'none'].includes(await alerts.alertOwner(DB, at(2000))));
assert.equal(await alerts.alertOwner({prepare() { throw Error('db down'); }}, at(2001)), 'failed');

// --- Pure helpers ---
assert.equal(alerts.area('/api/checkout/session'), '/api/checkout'); assert.equal(alerts.area('/register'), '/register'); assert.equal(alerts.area(''), '/');

// --- End to end through the Worker: a server error is recorded, then alerts the owner ---
sqlite.exec("DELETE FROM academy_settings WHERE id='owner-alert'"); sqlite.exec('DELETE FROM error_log');
const worker = load(path.resolve('build/worker.ts')).default;
const pending = [], ctx = {waitUntil: p => pending.push(p)};
const before = sent.length;
handlerResult = new Response('boom', {status: 500});
await worker.fetch(new Request('https://swa.example/scholarship?token=secret-invite'), {DB}, ctx); await Promise.all(pending);
assert.equal(sent.length, before + 1, 'the error emailed the owner');
assert.ok(!sent.at(-1).body[0].text.includes('secret-invite'));
assert.match(sent.at(-1).body[0].text, /\/scholarship: unexpected error \(1\)/);
// A failed scheduled run is recorded and alerted (after the hour), with no detail from the failure.
reminderFails = true; pending.length = 0;
sqlite.exec("UPDATE academy_settings SET payload=json_set(payload,'$.sentAt','2000-01-01T00:00:00.000Z') WHERE id='owner-alert'");
await worker.scheduled({cron: '41 12 * * *'}, {DB}, ctx); await Promise.all(pending);
assert.equal(sent.length, before + 2);
assert.match(sent.at(-1).body[0].text, /morning reminders/i); assert.ok(!sent.at(-1).body[0].text.includes('sam@example.test'));

// --- Email turned off again: the Worker still answers and records errors, and sends nothing ---
delete env.EMAIL_API_KEY; pending.length = 0; const count = sent.length;
await worker.fetch(new Request('https://swa.example/family'), {DB}, ctx); await Promise.all(pending);
assert.equal(sent.length, count);

// --- Site health page data includes the alert state and failed family emails ---
const siteApi = load(path.resolve('app/api/site-health/route.ts'));
const s = await (await siteApi.GET(new Request('https://swa.example/api/site-health'))).json();
assert.equal(s.alerts.emailOn, false); assert.equal(s.failedEmails, 0); assert.ok(s.alerts.last);

// --- Site health page script: the "not set up" notice and the alert line ---
const script = readFileSync('app/site-health/screen.html', 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
async function page(data) {
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {hidden: false, textContent: '', innerHTML: ''}); return nodes.get(id); };
  vm.runInNewContext(script, {document: {getElementById: el}, fetch: async () => ({ok: true, json: async () => data}), Date, String, Error, Intl});
  await new Promise(r => setImmediate(r));
  return el;
}
const base = {health: {ok: true}, last24h: 0, errors: [], failedEmails: 0};
let el = await page({...base, alerts: {emailOn: false, to: 'savagewrestlingclub@gmail.com', last: null}});
assert.equal(el('emailOff').hidden, false); assert.equal(el('alerts').innerHTML, '', 'the notice says it all'); assert.equal(el('status').textContent, '');
el = await page({...base, failedEmails: 2, alerts: {emailOn: true, to: 'savagewrestlingclub@gmail.com', last: {at: at(0).toISOString(), count: 3, sent: false, reason: 'The email service couldn\'t be reached.'}}});
assert.equal(el('emailOff').hidden, true); assert.match(el('alerts').innerHTML, /savagewrestlingclub@gmail\.com/); assert.match(el('alerts').innerHTML, /didn’t send/);
assert.match(el('emailFails').innerHTML, /2 family emails didn’t send/); assert.match(el('emailFails').innerHTML, /href="\/messages#failedEmails"/);
el = await page({...base, alerts: {emailOn: true, to: 'savagewrestlingclub@gmail.com', last: null}});
assert.match(el('alerts').innerHTML, /No alerts sent yet/); assert.match(el('emailFails').innerHTML, /No family emails failed/);

console.log('Owner alert tests passed');
