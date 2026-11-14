// Issue #72: announcements to families and private threads, in-app and by email once a provider is set.
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
        if (name.endsWith('/account-auth')) return {
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, headers: new Headers()}),
          strongAccount: async () => ({user: {id: actor.id, email: actor.id + '@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}),
          appOrigin: () => 'https://swa.example', sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.endsWith('/access-control')) return {accountRole: async () => actor.coach ? {role: 'coach', staff: {email: actor.coach, name: 'Coach Dana', programs: actor.programs ?? ['Intermediate']}} : {role: 'family', staff: null}};
        if (name.endsWith('/stripe-test')) return {storedStripeKeyFor: async () => null, stripeClientFor: () => null, stripeMode: () => 'test'};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}









let fetchMock = async () => { throw Error('no network in tests'); };
const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2, programs: [], seasons: [], events: [{id: 'camp', name: 'Winter camp', type: 'Camp', dates: [ny(9)], price: 100}]}));
for (const u of ['p1', 'p2', 'p3']) sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test', JSON.stringify({parentName: 'Parent ' + u, phone: '', wrestlers: [{id: 'w-' + u, name: 'Wrestler ' + u, grade: '8'}]}), 1, 'x');
const order = (id, u, kind, program, item) => sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
  VALUES (?,?,'e',?,'W',?,?,?,'x','[]',1,0,1,'usd','{}','{}','paid',?,0,'t','t','t',?,?,'offline')`).run(id, u, 'w-' + u, kind, program, item, id, kind === 'annual' ? ny(-10) : null, kind === 'annual' ? ny(300) : null);
order('o1', 'p1', 'annual', 'Intermediate', 'Intermediate');
order('o2', 'p2', 'event', null, 'camp');
sqlite.prepare("INSERT INTO scholarship_awards(id,token_hash,recipient_email,wrestler_name,program,reference_cents,terms_text,terms_ready,revision,status,user_id,wrestler_id,signer,accepted_at,signature_record,ended_at,expires_at,created_at,created_by) VALUES ('s1','h','p3@example.test','W','Intermediate',0,'t',1,1,'active','p3','w-p3','P','2026-01-01T00:00:00Z',NULL,NULL,'2099-01-01','t','o')").run();

const owner = load(path.resolve('app/api/messages/route.ts'));
const inbox = load(path.resolve('app/api/inbox/route.ts'));
const O = 'https://a.test';
const call = async (route, method, body, q = '') => { const r = await route[method](new Request(O + '/x' + q, method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const as = id => { actor = id === 'owner' ? {owner: true, id: 'owner-id'} : {owner: false, id}; };
const announce = (audience, extra = {}) => { as('owner'); return call(owner, 'POST', {action: 'announce', audience, subject: 'Practice moved', body: 'Practice starts at 6:30 tonight.', ...extra}); };
const box = async u => { as(u); return (await call(inbox, 'GET')).body; };

// --- Audiences ---
as('owner');
const preview = async a => (await call(owner, 'POST', {action: 'preview', audience: a})).body;
assert.equal((await preview({type: 'all'})).count, 3);
let pv = await preview({type: 'program', program: 'Intermediate'}); assert.equal(pv.count, 2, 'member and scholarship'); assert.equal(pv.label, 'SWA Intermediate members');
assert.equal((await preview({type: 'program', program: 'Advanced'})).count, 0);
pv = await preview({type: 'event', eventId: 'camp'}); assert.equal(pv.count, 1); assert.equal(pv.label, 'Registered for Winter camp');
assert.equal((await call(owner, 'POST', {action: 'preview', audience: {type: 'nobody'}})).status, 400);

// --- Access and validation ---
as('p1'); assert.equal((await call(owner, 'GET')).status, 403); assert.equal((await call(owner, 'POST', {action: 'announce', audience: {type: 'all'}, subject: 'x', body: 'y'})).status, 403);
assert.equal((await announce({type: 'all'}, {subject: ''})).status, 400);
assert.equal((await announce({type: 'program', program: 'Advanced'})).status, 409, 'nobody to send to');

// --- In-app delivery, without email configured ---
let r = await announce({type: 'program', program: 'Intermediate'});
assert.equal(r.status, 200); assert.equal(r.body.recipients, 2); assert.equal(r.body.emailed, 0);
assert.deepEqual(sqlite.prepare('SELECT email_status s FROM announcement_recipients').all().map(x => x.s), ['skipped', 'skipped']);
let b = await box('p1'); assert.equal(b.announcements.length, 1); assert.equal(b.announcements[0].subject, 'Practice moved'); assert.equal(b.unread, 1);
assert.equal((await box('p2')).announcements.length, 0, 'not in the program');
as('p1'); b = (await call(inbox, 'POST', {action: 'read', announcementId: b.announcements[0].id})).body; assert.equal(b.unread, 0);
as('owner'); r = await call(owner, 'GET'); assert.equal(r.body.sent[0].opened, 1); assert.equal(r.body.sent[0].recipients, 2); assert.equal(r.body.emailOn, false);

// --- Email once a provider key is set ---
env.EMAIL_API_KEY = 'test-key'; env.MAIL_FROM = 'SWA <academy@swa.example>';
let sentRequest = null;
fetchMock = async (url, init) => { sentRequest = {url, init}; return new Response('{}', {status: 200}); };
r = await announce({type: 'event', eventId: 'camp'}, {subject: 'Camp packing list'});
assert.equal(r.body.emailed, 1);
assert.equal(sentRequest.url, 'https://api.resend.com/emails/batch');
assert.equal(sentRequest.init.headers.Authorization, 'Bearer test-key');
const mail = JSON.parse(sentRequest.init.body);
assert.equal(mail.length, 1); assert.equal(mail[0].from, 'SWA <academy@swa.example>'); assert.deepEqual(mail[0].to, ['p2@example.test']);
assert.match(mail[0].text, /Practice starts at 6:30 tonight\.[\s\S]*https:\/\/swa\.example\/inbox/, 'body plus a link built from appOrigin');
// Issue #320: the same message in the Savage layout, with the plain text kept exactly as written.
assert.equal(mail[0].text, 'Practice starts at 6:30 tonight.\n\n—\nSavage Wrestling Academy\nRead and reply in your family account: https://swa.example/inbox');
assert.deepEqual(Object.keys(mail[0]).sort(), ['from', 'html', 'subject', 'text', 'to']); assert.equal(mail[0].subject, 'Camp packing list');
assert.match(mail[0].html, /^<!doctype html>/); assert.match(mail[0].html, />Savage<\/div>/); assert.match(mail[0].html, /20 Railroad St, Huntington Station, NY 11746/);
assert.match(mail[0].html, /<h1[^>]*>Camp packing list<\/h1>\n<p[^>]*>Practice starts at 6:30 tonight\.<\/p>/);
assert.match(mail[0].html, /<a href="https:\/\/swa\.example\/inbox" style="[^"]*">Read your messages<\/a>/, 'the inbox link is the button');
// What the owner types is escaped in the email.
r = await announce({type: 'event', eventId: 'camp'}, {subject: 'Bring <b>two</b> & "more"', body: 'Hi <script>alert(1)</script>\nSee https://example.test/list?a=1&b=2 today.'});
const typed = JSON.parse(sentRequest.init.body)[0];
assert.equal(typed.subject, 'Bring <b>two</b> & "more"'); assert.ok(typed.text.startsWith('Hi <script>alert(1)</script>\nSee https://example.test/list?a=1&b=2 today.'));
assert.doesNotMatch(typed.html, /<script|<b>/); assert.match(typed.html, /<h1[^>]*>Bring &lt;b&gt;two&lt;\/b&gt; &amp; &quot;more&quot;<\/h1>/);
assert.match(typed.html, /Hi &lt;script&gt;alert\(1\)&lt;\/script&gt;<br>See <a href="https:\/\/example\.test\/list\?a=1&amp;b=2" class="swa-link"/);
sqlite.prepare("DELETE FROM announcement_recipients WHERE announcement_id IN (SELECT id FROM announcements WHERE subject LIKE 'Bring %')").run();
sqlite.prepare("DELETE FROM announcements WHERE subject LIKE 'Bring %'").run();
fetchMock = async () => new Response('nope', {status: 500});
r = await announce({type: 'event', eventId: 'camp'}, {subject: 'Again'}); assert.equal(r.status, 200, 'saved even if email fails'); assert.equal(r.body.emailed, 0);
assert.equal(sqlite.prepare("SELECT count(*) n FROM announcement_recipients WHERE email_status='failed'").get().n, 1);

// --- Private thread ---
fetchMock = async (url, init) => { sentRequest = {url, init}; return new Response('{}', {status: 200}); };
as('owner'); r = await call(owner, 'POST', {action: 'message', userId: 'p1', body: 'Sam did great today. Private note about weight class.'});
assert.equal(r.status, 200); assert.equal(r.body.thread.length, 1);
const notice = JSON.parse(sentRequest.init.body)[0];
assert.ok(!notice.text.includes('weight class'), 'the email is a notice; the message stays in the account');
assert.ok(!notice.html.includes('weight class'), 'in the Savage layout too (issue #320)'); assert.match(notice.html, />Savage<\/div>/);
assert.match(notice.html, /<h1[^>]*>New message from Savage Wrestling Academy<\/h1>\n<p[^>]*>You have a new message from the academy\.<\/p>\n<table[^>]*><tr><td[^>]*><a href="https:\/\/swa\.example\/inbox"[^>]*>Read your messages<\/a>/);
b = await box('p1'); assert.equal(b.thread[0].from, 'academy'); assert.equal(b.unread, 1);
assert.equal((await box('p2')).thread.length, 0, 'threads are private');
as('p1'); await call(inbox, 'POST', {action: 'read', thread: true}); assert.equal((await box('p1')).unread, 0);
as('p1'); r = await call(inbox, 'POST', {action: 'reply', body: 'Thank you!'}); assert.equal(r.body.thread.length, 2); assert.equal(r.body.thread[1].from, 'you');
assert.equal((await call(inbox, 'POST', {action: 'reply', body: '   '})).status, 400);
as('owner'); r = await call(owner, 'GET'); assert.equal(r.body.families.find(f => f.userId === 'p1').unread, 1, 'owner sees the reply');
r = await call(owner, 'GET', null, '?family=p1'); assert.equal(r.body.thread.length, 2); assert.equal(r.body.thread[0].read, true);
assert.equal((await call(owner, 'GET')).body.families.find(f => f.userId === 'p1').unread, 0, 'opening the thread marks it read');
assert.equal((await call(owner, 'POST', {action: 'message', userId: 'nobody', body: 'x'})).status, 404);

// --- Mark all as read (issue #132): one family's notices, announcements and replies, nobody else's ---
const notify = (id, u) => sqlite.prepare("INSERT INTO notifications(id,user_id,email,kind,subject,body,dedupe_key,created_at,read_at,email_status) VALUES (?,?,'e','test','Notice','b',?,'2026-11-06T12:00:00Z',NULL,'skipped')").run(id, u, id);
notify('n-p1', 'p1'); notify('n-p2', 'p2');
await announce({type: 'all'}, {subject: 'Gym closed Monday'});
as('owner'); await call(owner, 'POST', {action: 'message', userId: 'p1', body: 'See you Monday.'});
b = await box('p1'); assert.ok(b.unread >= 3, 'notice, announcement and reply are unread: ' + b.unread);
const p2Before = (await box('p2')).unread; assert.ok(p2Before >= 2);
as('p1'); r = await call(inbox, 'POST', {action: 'read', all: true});
assert.equal(r.status, 200); assert.equal(r.body.unread, 0, 'everything is read');
assert.ok(r.body.notices.every(n => n.read) && r.body.announcements.every(a => a.read));
assert.equal((await box('p2')).unread, p2Before, 'another family keeps its unread messages');
as('p1'); assert.equal((await call(inbox, 'POST', {action: 'read', all: 'yes'})).status, 200, 'only all: true marks everything');

console.log('Messaging tests passed');
