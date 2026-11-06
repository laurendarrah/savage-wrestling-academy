// Issue #74: transfer a paid membership to another program, with history and date-correct rosters.
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








const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const all = start => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start, end: start.replace(/^(\d\d)/, (h) => String(+h + 1).padStart(2, '0'))}));
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2,
  programs: [['Elementary', 'SWA Development'], ['Intermediate', 'SWA Intermediate'], ['Advanced', 'SWA Advance']].map(([id, name]) => ({id, name, priceCents: 20000, walkInPriceCents: 4000})),
  seasons: [['Elementary', '16:00'], ['Intermediate', '17:00'], ['Advanced', '18:00']].map(([program, t]) => ({program, start: ny(-30), end: ny(60), weekly: all(t), excludedDates: []})), events: []}));
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('p1', 'p1@example.test', JSON.stringify({parentName: 'Pat', phone: '', wrestlers: [{id: 'w1', name: 'Sam', grade: '8', usawNumber: 'AB1234', usawExpires: '2099-12-31'}]}), 1, 'x');

const api = load(path.resolve('app/api/transfers/route.ts'));
const payments = load(path.resolve('app/api/payments/route.ts'));
const roster = load(path.resolve('lib/roster.ts'));
const view = load(path.resolve('lib/wrestler-view.ts'));
const quotes = load(path.resolve('lib/quotes.ts'));
const O = 'https://a.test';
const call = async (method, body) => { const r = await api[method](new Request(O + '/x', method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const owner = () => { actor = {owner: true, id: 'owner-id'}; };
const programsOn = async d => (await roster.rosterFor(d, {role: 'owner'})).filter(s => s.entries.some(e => e.wrestlerId === 'w1')).map(s => s.program);

owner();
assert.equal((await payments.POST(new Request(O + '/x', {method: 'POST', headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify({action: 'record', userId: 'p1', wrestlerId: 'w1', kind: 'annual', program: 'Intermediate', method: 'cash'})}))).status, 200);
const orderId = sqlite.prepare("SELECT id FROM orders WHERE kind='annual'").get().id;
let r = await call('GET'); assert.equal(r.body.memberships.length, 1); assert.equal(r.body.memberships[0].programToday, 'Intermediate');
const move = body => call('POST', {orderId, reason: 'Moved up after evaluation', effectiveDate: ny(3), ...body});

// --- Checks ---
actor = {owner: false, id: 'p1'}; assert.equal((await move({toProgram: 'Advanced'})).status, 403, 'owner only');
owner();
assert.equal((await move({toProgram: 'Advanced', reason: ''})).status, 400, 'reason required');
assert.equal((await move({toProgram: 'Advanced', effectiveDate: ny(-1)})).status, 400, 'no back-dating');
assert.equal((await move({toProgram: 'Intermediate'})).status, 409, 'already there');
assert.match((await move({toProgram: 'Elementary'})).body.error, /grades K/, 'grade rule from the server');
assert.match((await move({toProgram: 'Advanced'})).body.error, /approv/i, 'SWA Advance needs approval');
sqlite.prepare("INSERT INTO program_approvals(id,user_id,wrestler_id,program,wrestler_name,grade,status,created_at,updated_at,decided_by) VALUES ('a1','p1','w1','Advanced','Sam','8','approved','t','t','owner')").run();

// --- Transfer from a future date: rosters before it are unchanged ---
r = await move({toProgram: 'Advanced'}); assert.equal(r.status, 200);
assert.equal(sqlite.prepare('SELECT program FROM orders WHERE id=?').get(orderId).program, 'Advanced');
assert.equal(JSON.stringify(await programsOn(ny(0))), JSON.stringify(['Intermediate']));
assert.equal(JSON.stringify(await programsOn(ny(2))), JSON.stringify(['Intermediate']));
assert.equal(JSON.stringify(await programsOn(ny(3))), JSON.stringify(['Advanced']));
const up = await view.upcomingFor('p1', 'w1', ny(0), 6);
assert.equal(JSON.stringify(up.map(u => u.title)), JSON.stringify(['SWA Intermediate', 'SWA Intermediate', 'SWA Intermediate', 'SWA Advance', 'SWA Advance', 'SWA Advance']), 'wrestler view follows the transfer');
// Still a member of Intermediate today, so it cannot be bought twice.
assert.match((await quotes.quoteMembership('p1', {wrestlerId: 'w1', program: 'Intermediate', plan: 'annual'})).error, /already has an active paid membership/);
r = await call('GET'); assert.equal(r.body.memberships[0].programToday, 'Intermediate'); assert.equal(r.body.memberships[0].program, 'Advanced');

// --- A second transfer chains; it cannot come before the first ---
assert.equal((await move({toProgram: 'Intermediate', effectiveDate: ny(2)})).status, 409);
assert.equal((await move({toProgram: 'Intermediate', effectiveDate: ny(5)})).status, 200);
assert.equal(JSON.stringify(await programsOn(ny(4))), JSON.stringify(['Advanced']));
assert.equal(JSON.stringify(await programsOn(ny(5))), JSON.stringify(['Intermediate']));
assert.equal(JSON.stringify(await programsOn(ny(1))), JSON.stringify(['Intermediate']));
r = await call('GET');
assert.equal(JSON.stringify(r.body.history.map(t => [t.from_program, t.to_program, t.effective_date])), JSON.stringify([['Advanced', 'Intermediate', ny(5)], ['Intermediate', 'Advanced', ny(3)]]));
assert.equal(r.body.history[0].wrestler, 'Sam');
assert.equal(sqlite.prepare("SELECT count(*) n FROM security_events WHERE action='membership_transferred'").get().n, 2);
assert.equal(sqlite.prepare('SELECT amount_cents FROM orders WHERE id=?').get(orderId).amount_cents, 240000, 'no money moves');

console.log('Program transfer tests passed');
