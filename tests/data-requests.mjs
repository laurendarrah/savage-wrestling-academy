// Issue #113: families download their own data and ask to close their account; the owner records how it was handled.
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








const fam = (u, name) => sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test', JSON.stringify({parentName: name, phone: '555', wrestlers: [{id: 'w-' + u, name: 'Wrestler ' + u, grade: '8'}]}), 1, '2026-11-01T00:00:00Z');
fam('p1', 'Pat One'); fam('p2', 'Pat Two');
const order = (id, u, session) => sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source,stripe_session_id,stripe_payment_intent)
  VALUES (?,?,'e',?,'W','walkin','Intermediate','x','Walk-in','["2026-11-10"]',4000,0,4000,'usd','{"secret":"internal"}','{}','paid',?,0,'t','t','t','stripe',?,?)`).run(id, u, 'w-' + u, id, session, 'pi_' + session);
order('o1', 'p1', 'cs_test_p1'); order('o2', 'p2', 'cs_test_p2');
sqlite.prepare("INSERT INTO wrestler_passes VALUES ('pass1','p1','w-p1','TOKENp1TOKENp1TOKENp1TOKENp1TOKE','t',NULL,NULL)").run();
sqlite.prepare("INSERT INTO family_messages(id,user_id,sender_role,body,created_at,read_at,email_status) VALUES ('m1','p1','owner','Hello Pat One','t',NULL,'skipped'),('m2','p2','owner','Hello Pat Two','t',NULL,'skipped')").run();
sqlite.prepare("INSERT INTO attendance VALUES ('a1','practice:Intermediate:2026-11-05:18:00','2026-11-05','p1','w-p1','Wrestler p1','Member','t','owner')").run();

const mine = load(path.resolve('app/api/my-data/route.ts'));
const owner = load(path.resolve('app/api/data-requests/route.ts'));
const O = 'https://a.test';
const req = (route, method, body, q = '') => route[method](new Request(O + '/x' + q, method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)}));
const as = id => { actor = id === 'owner' ? {owner: true, id: 'owner-id'} : {owner: false, id}; };

// --- Download: everything about this family, nothing about others, no secrets ---
as('p1');
let r = await req(mine, 'GET', null, '?format=download');
assert.equal(r.status, 200); assert.match(r.headers.get('content-disposition'), /attachment; filename="savage-family-data-\d{4}-\d{2}-\d{2}\.json"/);
const text = await r.text(), data = JSON.parse(text);
assert.equal(data.profile.parentName, 'Pat One'); assert.equal(data.payments.length, 1); assert.equal(data.attendance.length, 1);
assert.equal(data.messagesWithTheAcademy[0].body, 'Hello Pat One');
for (const leak of ['Pat Two', 'Hello Pat Two', 'p2@example.test', 'cs_test_p1', 'pi_cs_test', 'TOKENp1', 'internal']) assert.ok(!text.includes(leak), 'export leaks ' + leak);
as('nobody'); assert.equal((await req(mine, 'GET', null, '?format=download')).status, 404, 'no profile yet');

// --- Closure request ---
as('p1');
assert.equal((await req(mine, 'POST', {action: 'close', note: 'Moving away'}, '', )).status, 200);
assert.equal((await req(mine, 'POST', {action: 'close'})).status, 409, 'one open request at a time');
assert.equal((await req(mine, 'POST', {action: 'delete-everything'})).status, 400);
r = await (await req(mine, 'GET')).json(); assert.equal(r.requests[0].status, 'open');
assert.equal(sqlite.prepare("SELECT count(*) n FROM family_accounts WHERE user_id='p1'").get().n, 1, 'nothing deleted automatically');

// --- Owner handles it ---
as('p1'); assert.equal((await req(owner, 'GET')).status, 403, 'families cannot see requests');
as('owner'); r = await (await req(owner, 'GET')).json();
assert.equal(r.open, 1); assert.equal(r.requests[0].parentName, 'Pat One'); assert.equal(r.requests[0].note, 'Moving away');
assert.equal((await req(owner, 'POST', {action: 'resolve', id: r.requests[0].id, resolution: ''})).status, 400, 'say what was done');
assert.equal((await req(owner, 'POST', {action: 'resolve', id: r.requests[0].id, resolution: 'Profile removed; payment records kept.'})).status, 200);
assert.equal((await req(owner, 'POST', {action: 'resolve', id: r.requests[0].id, resolution: 'again'})).status, 404);
as('p1'); r = await (await req(mine, 'GET')).json(); assert.equal(r.requests[0].status, 'handled'); assert.match(r.requests[0].resolution, /payment records kept/);
assert.deepEqual(sqlite.prepare("SELECT action FROM security_events WHERE action IN ('account_closure_requested','data_request_handled') ORDER BY rowid").all().map(x => x.action), ['account_closure_requested', 'data_request_handled']);
console.log('Data request tests passed');
