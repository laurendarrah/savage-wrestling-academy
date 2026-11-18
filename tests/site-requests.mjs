// Issue #361: the owner writes what should change on the site itself; it is saved and emailed to whoever maintains it.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {
  prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }, async run() { return {meta: sqlite.prepare(sql).run(...a)}; }}; }
};
const env = {DB, SITE_REQUESTS_TO: 'maintainer@example.test'};
let actor = {owner: true}, emailOn = true, outcome = 'sent', limited = false;
const sent = [];
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {OWNER_EMAIL: 'owner@example.test', appOrigin: () => 'https://swa.test',
          ownerIdentity: async () => ({owner: actor.owner ? {userId: 'supabase:owner-id'} : null, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => limited};
        if (name.endsWith('/email')) return {emailConfigured: () => emailOn,
          sendEmailsDetailed: async list => { if (outcome === 'throw') throw Error('down'); if (!emailOn) return list.map(() => ({status: 'skipped', reason: null})); sent.push(...list); return list.map(() => ({status: outcome, reason: outcome === 'failed' ? 'busy' : null})); }};
        if (name.endsWith('/api')) return {withApi: f => f};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
const lib = load(path.resolve('lib/site-requests.ts')), route = load(path.resolve('app/api/site-requests/route.ts'));
const O = 'https://a.test', plain = v => JSON.parse(JSON.stringify(v));
const get = async () => { const r = await route.GET(new Request(O + '/api/site-requests')); return {status: r.status, body: await r.json()}; };
const post = async (body, headers = {'content-type': 'application/json', origin: O}) => { const r = await route.POST(new Request(O + '/api/site-requests', {method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const stored = () => { const row = sqlite.prepare("SELECT payload,updated_by FROM academy_settings WHERE id='site-requests'").get(); return row ? {...JSON.parse(row.payload), by: row.updated_by} : null; };

// ---------- Where requests go: one plain address from the Worker setting, nothing else ----------
assert.equal(lib.requestAddress('  maintainer@example.test '), 'maintainer@example.test');
for (const bad of [null, '', 'not an address', 'a@b', 'a@b.test, c@d.test', 'Name <a@b.test>', 'a@b.test;c@d.test', 'x'.repeat(250) + '@b.test']) assert.equal(lib.requestAddress(bad), null, String(bad));
assert.equal(lib.requestAddress(), 'maintainer@example.test', 'read from SITE_REQUESTS_TO');

// ---------- Owner only ----------
actor = {owner: false};
assert.equal((await get()).status, 403); assert.equal((await post({action: 'add', words: 'Let me in'})).status, 403);
assert.equal(stored(), null, 'nothing saved for anyone but the owner');
actor = {owner: true};
assert.deepEqual((await get()).body, {requests: [], emailReady: true});
assert.equal((await post({action: 'add', words: 'x'}, {'content-type': 'application/json', origin: 'https://evil.test'})).status, 403, 'another site cannot post for the owner');
assert.equal((await post({action: 'add', words: 'x'}, {'content-type': 'text/plain', origin: O})).status, 415);
assert.equal((await post('{not json')).status, 400); assert.equal((await post({action: 'other'})).status, 400);
assert.equal((await post({action: 'add', words: 'y'.repeat(21000)})).status, 413);
limited = true; assert.equal((await post({action: 'add', words: 'x'})).status, 429); limited = false;

// ---------- A request is saved, then emailed to the maintainer ----------
for (const [words, error] of [[undefined, /Write what you would like changed/], ['   ', /Write what you would like changed/], [5, /Write what you would like changed/], ['z'.repeat(4001), /under 4,000 characters/]]) {
  const r = await post({action: 'add', words}); assert.equal(r.status, 400); assert.match(r.body.error, error);
}
assert.match((await post({action: 'add', words: 'ok', where: 'w'.repeat(201)})).body.error, /under 200 characters/);
assert.equal(stored(), null); assert.equal(sent.length, 0);

let r = await post({action: 'add', words: '  On the welcome page, change “Join the academy” to “Register”.\r\nAlso make the logo bigger.\u0007  ', where: ' Welcome page\n'});
assert.equal(r.status, 200);
const first = r.body.request;
assert.match(first.id, /^[0-9a-f-]{36}$/); assert.equal(first.status, 'open'); assert.equal(first.email, 'sent'); assert.equal(first.doneAt, null);
assert.equal(first.words, 'On the welcome page, change “Join the academy” to “Register”.\nAlso make the logo bigger.', 'line breaks kept, control characters and outer space removed');
assert.equal(first.where, 'Welcome page');
assert.deepEqual(r.body.requests, [first]); assert.equal(r.body.emailReady, true);
assert.equal(sent.length, 1);
assert.equal(sent[0].to, 'maintainer@example.test'); assert.equal(sent[0].audience, 'maintainer');
assert.equal(sent[0].subject, 'Site change request: On the welcome page, change “Join the academy” to “Register”.');
assert.match(sent[0].text, /^The academy’s owner asked for a change to the site\.\n\nSent: \w{3}, \w{3} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M \(New York time\)\nWhere: Welcome page\n\nWhat they asked for:\nOn the welcome page, change “Join the academy” to “Register”\.\nAlso make the logo bigger\.\n\nReply to the owner at owner@example\.test\./);
assert.deepEqual(stored().requests, [first]); assert.equal(stored().by, 'supabase:owner-id');
assert.doesNotMatch(JSON.stringify(r.body) + JSON.stringify((await get()).body), /maintainer@example\.test/, 'the address never reaches the browser');
// A long first line is shortened in the subject; a request without "where" has no Where line.
r = await post({action: 'add', words: 'A'.repeat(90) + '\nsecond line'});
assert.equal(sent[1].subject, 'Site change request: ' + 'A'.repeat(67) + '…'); assert.doesNotMatch(sent[1].text, /\nWhere:/);
assert.deepEqual(r.body.requests.map(x => x.id), [r.body.request.id, first.id], 'newest first');

// The same words again straight away are refused, not sent twice.
r = await post({action: 'add', words: 'A'.repeat(90) + '\nsecond line'});
assert.equal(r.status, 409); assert.match(r.body.error, /just sent/); assert.equal(sent.length, 2);

// ---------- When the email cannot go out, the request is still saved and says so ----------
outcome = 'failed';
r = await post({action: 'add', words: 'Fix the typo on the calendar.'});
assert.equal(r.status, 200); assert.equal(r.body.request.email, 'failed'); assert.equal(stored().requests[0].email, 'failed');
const failed = r.body.request.id;
r = await post({action: 'resend', id: failed});
assert.equal(r.status, 502); assert.match(r.body.error, /could not be sent\. The request is still saved here/); assert.equal(r.body.requests[0].email, 'failed');
outcome = 'sent';
r = await post({action: 'resend', id: failed});
assert.equal(r.status, 200); assert.equal(r.body.requests[0].email, 'sent'); assert.equal(sent.at(-1).subject, 'Site change request: Fix the typo on the calendar.');
assert.match((await post({action: 'resend', id: failed})).body.error, /already emailed/);
assert.equal((await post({action: 'resend', id: 'nope'})).status, 404);
// The provider throwing counts as failed, never as a lost request.
outcome = 'throw';
r = await post({action: 'add', words: 'The pass page is slow.'}); assert.equal(r.status, 200); assert.equal(r.body.request.email, 'failed');
outcome = 'sent';
// No address set, or email not set up: saved, marked not emailed, and the page is told.
delete env.SITE_REQUESTS_TO;
r = await post({action: 'add', words: 'Add a photo to the team page.'});
assert.equal(r.status, 200); assert.equal(r.body.request.email, 'off'); assert.equal(r.body.emailReady, false);
assert.equal((await get()).body.emailReady, false);
r = await post({action: 'resend', id: r.body.request.id}); assert.equal(r.status, 409); assert.match(r.body.error, /no address to send requests to yet/);
env.SITE_REQUESTS_TO = 'maintainer@example.test'; emailOn = false;
r = await post({action: 'add', words: 'Make the buttons bigger on phones.'});
assert.equal(r.body.request.email, 'off'); assert.equal(r.body.emailReady, false);
emailOn = true;

// ---------- Done and reopened by the owner ----------
r = await post({action: 'mark', id: first.id, done: true});
assert.equal(r.status, 200);
let marked = r.body.requests.find(x => x.id === first.id);
assert.equal(marked.status, 'done'); assert.match(marked.doneAt, /^\d{4}-\d\d-\d\dT/); assert.equal(marked.words, first.words);
r = await post({action: 'mark', id: first.id, done: false});
marked = r.body.requests.find(x => x.id === first.id); assert.equal(marked.status, 'open'); assert.equal(marked.doneAt, null);
assert.equal((await post({action: 'mark', id: 'nope', done: true})).status, 404);
assert.equal((await post({action: 'mark', id: first.id, done: 'yes'})).status, 400);

// ---------- Limits: 20 a day, and the newest 200 kept ----------
const before = sent.length, day = new Date('2027-03-01T15:00:00Z');
sqlite.prepare("DELETE FROM academy_settings WHERE id='site-requests'").run();
for (let i = 0; i < 20; i++) assert.equal((await lib.addRequest('supabase:owner-id', {words: 'Change number ' + i}, new Date(day.getTime() + i * 1000))).status, 200);
r = await lib.addRequest('supabase:owner-id', {words: 'One too many'}, new Date(day.getTime() + 60000));
assert.equal(r.status, 429); assert.match(r.error, /20 requests in a day/); assert.equal(sent.length, before + 20);
assert.equal((await lib.addRequest('supabase:owner-id', {words: 'The next day'}, new Date(day.getTime() + 86400000 + 30000))).status, 200);
const many = Array.from({length: 230}, (_, i) => ({id: 'old-' + i, at: '2026-01-01T00:00:00.000Z', words: 'w' + i, where: '', email: 'sent', status: 'open', doneAt: null}));
sqlite.prepare("UPDATE academy_settings SET payload=? WHERE id='site-requests'").run(JSON.stringify({requests: many}));
assert.equal((await lib.addRequest('supabase:owner-id', {words: 'Newest'}, new Date('2027-06-01T12:00:00Z'))).status, 200);
assert.equal(stored().requests.length, 200); assert.equal(stored().requests[0].words, 'Newest'); assert.equal(stored().requests[199].id, 'old-198');
// A damaged row reads as empty instead of breaking the page; entries that are not requests are dropped.
sqlite.prepare("UPDATE academy_settings SET payload='{oops' WHERE id='site-requests'").run();
assert.deepEqual(plain(await lib.listRequests()), []);
sqlite.prepare("UPDATE academy_settings SET payload=? WHERE id='site-requests'").run(JSON.stringify({requests: [{id: 1}, many[0], 'x']}));
assert.deepEqual(plain(await lib.listRequests()), [many[0]]);

// ---------- The page and where it sits ----------
const page = readFileSync('app/site-requests/screen.html', 'utf8');
assert.match(page, /<h1>Request a site change<\/h1>/); assert.match(page, /<textarea id="words" name="words" maxlength="4000" required/); assert.match(page, /<input id="where" name="where" maxlength="200"/);
assert.match(page, /<p id="formNote" role="status" aria-live="polite">/, 'the result shows beside the button');
assert.match(page, /<p id="notReady" class="note" hidden>/); assert.match(page, /No requests yet\./);
assert.doesNotMatch(page, /\son[a-z]+\s*=\s*["']/i, 'no inline handlers, so the page keeps the nonce script policy');
assert.doesNotMatch(page, /innerHTML=[^;]*\$\{r\.(words|where)\}/, 'what the owner typed is always escaped');
assert.match(page, /\$\{esc\(r\.words\)\}/); assert.match(page, /esc\(r\.where\)/);
assert.match(readFileSync('app/site-requests/route.ts', 'utf8'), /ownerPage\(request, html\)/);
assert.match(readFileSync('lib/owner-nav.ts', 'utf8'), /\{href: '\/site-requests', label: 'Request a site change'\}/);
assert.match(readFileSync('lib/owner-shell.ts', 'utf8'), /'\/site-requests': '<path /);
assert.match(readFileSync('lib/email-brand.ts', 'utf8'), /maintainer: 'You’re getting this because the Savage Wrestling Academy site sends the owner’s change requests to this address\.'/);
// The address is a setting, never in the repository.
assert.match(readFileSync('.env.example', 'utf8'), /^# SITE_REQUESTS_TO=$/m);
console.log('Passed: the owner’s site change requests are owner-only, saved before they are emailed, emailed to the one address in SITE_REQUESTS_TO (never sent to the browser), marked not emailed and resendable when the email fails or no address is set, refused when repeated or past 20 a day, kept to the newest 200, and marked done or reopened by the owner.');
