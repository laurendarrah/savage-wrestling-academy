// Issue #35: emails that didn't send are recorded with a reason, shown to the owner on /messages with the family,
// when, what and why, and can be sent again. With email not set up the owner sees a clear notice instead.
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
    {module, exports: module.exports, fetch: (...a) => fetchMock(...a), crypto, btoa, TextEncoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.example',
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
let fetchMock = async () => { throw Error('no network in tests'); };
const sent = [];
const provider = status => { fetchMock = async (url, init) => { const b = JSON.parse(init.body); sent.push(...b); return new Response('{}', {status}); }; };
const emailOn = () => { env.EMAIL_API_KEY = 'test-key'; env.MAIL_FROM = 'SWA <academy@swa.example>'; };
const emailOff = () => { delete env.EMAIL_API_KEY; delete env.MAIL_FROM; };

sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2, programs: [], seasons: [], events: []}));
for (const u of ['p1', 'p2']) sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test', JSON.stringify({parentName: 'Parent ' + u.toUpperCase(), phone: '', wrestlers: [{id: 'w-' + u, name: 'Wrestler ' + u, grade: '8'}]}), 1, 'x');
sqlite.prepare("INSERT INTO staff_access VALUES ('dana@example.test','Coach Dana','[\"Intermediate\"]',1,'x')").run();

const email = load(path.resolve('lib/email.ts'));
const messages = load(path.resolve('lib/messages.ts'));
const notify = load(path.resolve('lib/notify.ts'));
const route = load(path.resolve('app/api/messages/route.ts'));
const O = 'https://a.test';
const call = async (method, body) => { const r = await route[method](new Request(O + '/api/messages', method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };

// --- Reasons in plain words ---
assert.equal(email.failureReason(401), 'setup'); assert.equal(email.failureReason(403), 'setup');
assert.equal(email.failureReason(422), 'refused'); assert.equal(email.failureReason(400), 'refused');
assert.equal(email.failureReason(429), 'busy'); assert.equal(email.failureReason(500), 'unreachable'); assert.equal(email.failureReason(null), 'unreachable');
for (const r of ['setup', 'refused', 'busy', 'unreachable', null, 'junk']) assert.ok(!/\b(4\d\d|5\d\d|API|HTTP)\b/.test(email.failureWords(r)), 'no technical codes: ' + email.failureWords(r));

// --- Email not set up: messages are skipped, not failed, and the owner sees the notice ---
let r = await messages.sendAnnouncement('owner-id', {audience: {type: 'all'}, subject: 'Practice moved', body: 'Practice starts at 6:30 tonight.'});
assert.equal(r.status, 200);
assert.deepEqual(sqlite.prepare('SELECT email_status s, email_error e FROM announcement_recipients').all().map(x => [x.s, x.e]), [['skipped', null], ['skipped', null]]);
let g = await call('GET'); assert.equal(g.body.emailOn, false); assert.deepEqual(g.body.failedEmails, [], 'skipped is not a failure');

// --- Failures record why ---
emailOn();
provider(422); await messages.sendAnnouncement('owner-id', {audience: {type: 'all'}, subject: 'Camp packing list', body: 'Bring two water bottles.'});
assert.deepEqual(sqlite.prepare("SELECT DISTINCT email_status s, email_error e FROM announcement_recipients WHERE email_status!='skipped'").all().map(x => [x.s, x.e]), [['failed', 'refused']]);
fetchMock = async () => { throw Error('network down'); };
await messages.postMessage('p1', 'owner', 'Private note about weight class.');
assert.equal(sqlite.prepare("SELECT email_error e FROM family_messages WHERE sender_role='owner'").get().e, 'unreachable');
await messages.postMessage('p1', 'family', 'Thanks!');
provider(401);
await notify.notify([{userId: 'p2', email: 'p2@example.test', kind: 'payment_recorded', subject: 'Payment received: Winter camp', body: 'The academy recorded your payment.', dedupeKey: 'pay-1', link: '/family#purchaseHistory'},
  {userId: null, email: 'dana@example.test', kind: 'lesson_booked_coach', subject: 'New lesson: Wrestler p2', body: 'Wrestler p2 booked a lesson.', dedupeKey: 'coach-1', link: '/coach'}]);
assert.deepEqual(sqlite.prepare('SELECT email_status s, email_error e FROM notifications ORDER BY dedupe_key').all().map(x => [x.s, x.e]), [['failed', 'setup'], ['failed', 'setup']]);
provider(200);
await notify.notify([{userId: 'p1', email: 'p1@example.test', kind: 'transfer', subject: 'Moved', body: 'b', dedupeKey: 'ok-1'}]);
assert.equal(sqlite.prepare("SELECT email_error e FROM notifications WHERE dedupe_key='ok-1'").get().e, null, 'a sent email has no reason');
// An old failure (over 30 days) is not listed.
sqlite.prepare("INSERT INTO notifications(id,user_id,email,kind,subject,body,dedupe_key,created_at,read_at,email_status,email_error) VALUES ('old','p1','p1@example.test','x','Old notice','b','old','2020-01-01T00:00:00Z',NULL,'failed','busy')").run();

// --- The owner's list: who, what, when, why ---
actor = {owner: false, id: 'p1'}; assert.equal((await call('GET')).status, 403); assert.equal((await call('POST', {action: 'retry', items: []})).status, 403);
actor = {owner: true, id: 'owner-id'};
g = await call('GET'); let list = g.body.failedEmails;
assert.equal(g.body.emailOn, true);
assert.equal(list.length, 5, '2 announcement emails, 1 message notice, 2 notices; not the family reply or the old one: ' + JSON.stringify(list.map(f => f.what)));
const ann = list.filter(f => f.kind === 'announcement');
assert.deepEqual(ann.map(f => f.to.name).sort(), ['Parent P1', 'Parent P2']);
assert.equal(ann[0].what, 'Announcement: Camp packing list'); assert.match(ann[0].reason, /refused the message/);
const msg = list.find(f => f.kind === 'message');
assert.equal(msg.to.name, 'Parent P1'); assert.equal(msg.to.email, 'p1@example.test'); assert.match(msg.what, /private message/); assert.ok(!JSON.stringify(msg).includes('weight class'), 'the private message itself is not shown here');
assert.match(msg.reason, /couldn’t be reached/);
const coach = list.find(f => f.to.coach); assert.equal(coach.to.name, 'Coach Dana'); assert.match(coach.reason, /email settings/);
assert.ok(list.every(f => f.at && f.id));
assert.ok(!list.some(f => f.what === 'Old notice'));
assert.equal(g.body.sent[0].failed, 2, 'sent announcements show how many emails failed');
assert.equal(await load(path.resolve('lib/email-failures.ts')).failedEmailCount(), 5);

// --- Retry: validation, email off, success, still failing, already sent, double click ---
assert.equal((await call('POST', {action: 'retry', items: 'all'})).status, 400);
assert.equal((await call('POST', {action: 'retry', items: Array(101).fill({kind: 'notice', id: 'x'})})).status, 400);
assert.equal((await call('POST', {action: 'retry', items: [{kind: 'notice', id: 'nope'}]})).status, 409);
emailOff();
r = await call('POST', {action: 'retry', items: [msg]});
assert.equal(r.status, 409); assert.match(r.body.error, /Email isn't set up yet/);
assert.equal(sqlite.prepare("SELECT email_status s FROM family_messages WHERE id=?").get(msg.id).s, 'failed', 'unchanged');
emailOn();
sent.length = 0; provider(200);
r = await call('POST', {action: 'retry', items: [msg, ann[0]]});
assert.equal(r.status, 200); assert.equal(r.body.sent, 2); assert.equal(r.body.failed, 0); assert.equal(r.body.failedEmails.length, 3);
assert.equal(sent.length, 2);
const notice = sent.find(m => m.to[0] === 'p1@example.test' && /New message/.test(m.subject));
assert.ok(notice && !notice.text.includes('weight class') && notice.text.includes('https://swa.example/inbox'), 'the message notice again, with the inbox link');
const again = sent.find(m => m.subject === 'Camp packing list'); assert.match(again.text, /Bring two water bottles\.[\s\S]*https:\/\/swa\.example\/inbox/);
assert.deepEqual(Object.values(sqlite.prepare("SELECT email_status s, email_error e FROM family_messages WHERE id=?").get(msg.id)), ['sent', null]);
assert.equal(sqlite.prepare("SELECT count(*) n FROM security_events WHERE action='emails_resent' AND target='2 of 2 sent'").get().n, 1, 'recorded in the security log');
r = await call('POST', {action: 'retry', items: [msg]}); assert.equal(r.status, 409, 'already sent');
// Still failing: stays listed with the new reason.
provider(429); sent.length = 0;
r = await call('POST', {action: 'retry', items: [coach]});
assert.equal(r.body.sent, 0); assert.equal(r.body.failed, 1); assert.match(r.body.failedEmails.find(f => f.id === coach.id).reason, /Too many emails/);
assert.equal(sent[0].to[0], 'dana@example.test'); assert.match(sent[0].text, /https:\/\/swa\.example\/coach/, 'a coach notice links to the coach page');
// Double click: two retries at once send once.
provider(200); sent.length = 0;
const pnotice = list.find(f => f.kind === 'notice' && !f.to.coach);
const both = await Promise.all([call('POST', {action: 'retry', items: [pnotice]}), call('POST', {action: 'retry', items: [pnotice]})]);
assert.equal(sent.length, 1, 'sent once'); assert.deepEqual(both.map(x => x.status).sort(), [200, 409]);
// "Try all again" sends the rest.
g = await call('GET'); r = await call('POST', {action: 'retry', items: g.body.failedEmails});
assert.equal(r.status, 200); assert.equal(r.body.failedEmails.length, 0);

// --- Messages page script: the failed list, the notice when email is off, and retry ---
const script = readFileSync('app/messages/screen.html', 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
async function page(data, onPost) {
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {hidden: false, textContent: '', innerHTML: '', value: '', disabled: false, dataset: {}}); return nodes.get(id); };
  const buttons = () => [...el('failedList').innerHTML.matchAll(/data-retry="(\d+)"/g)].map(m => { const b = {dataset: {retry: m[1]}, disabled: false}; return b; });
  let current = [];
  const ctx = {document: {getElementById: el, querySelectorAll: s => s === '[data-retry]' ? (current = buttons()) : []}, confirm: () => true, Date, String, Error, Intl, JSON,
    fetch: async (url, init) => ({ok: true, json: async () => init?.method === 'POST' ? onPost(JSON.parse(init.body)) : structuredClone(data)})};
  vm.runInNewContext(script, ctx);
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  return {el, buttons: () => current};
}
const base = {sent: [], families: [], events: [], programs: [], emailOn: true};
const item = {kind: 'notice', id: 'n1', userId: 'p1', at: '2026-11-09T15:00:00.000Z', what: 'Payment received: <b>Camp</b>', to: {name: 'Parent P1', email: 'p1@example.test', coach: false}, reason: "The email service couldn't be reached. Trying again usually works."};
let posted = null;
let ui = await page({...base, failedEmails: [item, {...item, id: 'n2', to: {name: 'Coach Dana', email: 'dana@example.test', coach: true}}]}, b => { posted = b; return {sent: 1, failed: 0, failedEmails: [b.items[0].id === 'n1' ? {...item, id: 'n2'} : item]}; });
assert.equal(ui.el('failedEmails').hidden, false); assert.equal(ui.el('emailNote').hidden, true); assert.equal(ui.el('retryAll').hidden, false);
assert.match(ui.el('failedList').innerHTML, /Parent P1[\s\S]*p1@example\.test[\s\S]*couldn&#39;t be reached/, 'escaped reason');
assert.match(ui.el('failedList').innerHTML, /&lt;b&gt;Camp/, 'escaped'); assert.match(ui.el('failedList').innerHTML, /coachTag/);
assert.match(ui.el('failedIntro').textContent, /2 emails from the last 30 days didn’t go out/);
await ui.buttons()[0].onclick(); await new Promise(r => setImmediate(r));
assert.deepEqual(posted, {action: 'retry', items: [{kind: 'notice', id: 'n1', userId: 'p1'}]});
assert.equal(ui.el('status').textContent, 'Sent.'); assert.equal(ui.el('retryAll').hidden, true, 'one left: no Try all');
ui = await page({...base, emailOn: false, failedEmails: [item]}, () => ({}));
assert.equal(ui.el('emailNote').hidden, false, 'the notice shows when email is off');
assert.match(readFileSync('app/messages/screen.html', 'utf8'), /Email isn’t set up yet, so families aren’t getting emails\./);
assert.doesNotMatch(ui.el('failedList').innerHTML, /data-retry/, 'no retry buttons until email is set up');
assert.match(ui.el('failedIntro').textContent, /Once email is set up/);
ui = await page({...base, failedEmails: []}, () => ({}));
assert.equal(ui.el('failedEmails').hidden, true, 'nothing to show when every email went out');
assert.equal(ui.el('emailNote').hidden, true);

console.log('Failed email tests passed');
