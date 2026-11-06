// Issue #71: per-wrestler QR passes checked in by scanning, under the same rules as manual check-in.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
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
const today = ny(0);
const all = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2,
  programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}],
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(60), weekly: all, excludedDates: []}], events: [],
  extraPractices: [{id: 'fnl', name: 'Friday Night Live', dates: [today], enabled: true, start: '16:00', end: '17:00', memberCents: 1000, nonMemberCents: 2000}]}));
const fam = (u, wrestlers) => sqlite.prepare('INSERT OR REPLACE INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test', JSON.stringify({parentName: 'Parent ' + u, phone: '', wrestlers}), 1, 'x');
fam('p1', [{id: 'w1', name: 'Sam', grade: '8', usawNumber: 'AB1234', usawExpires: '2099-12-31'}, {id: 'w2', name: 'Riley', grade: '8', usawNumber: 'AB1235', usawExpires: '2099-12-31'}]);
fam('p2', [{id: 'w3', name: 'Jo', grade: '8', usawNumber: 'AB1236', usawExpires: '2099-12-31'}]);

const passesApi = load(path.resolve('app/api/passes/route.ts'));
const rosterApi = load(path.resolve('app/api/roster/route.ts'));
const payments = load(path.resolve('app/api/payments/route.ts'));
const passes = load(path.resolve('lib/passes.ts'));
const O = 'https://a.test';
const call = async (route, method, body, origin = O) => { const r = await route[method](new Request(O + '/x', method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const as = id => { actor = id === 'owner' ? {owner: true, id: 'owner-id'} : id.startsWith('coach') ? {owner: false, id, coach: id + '@example.test', programs: id === 'coach-other' ? ['Advanced'] : ['Intermediate']} : {owner: false, id}; };
const scan = (code, extra = {}) => call(rosterApi, 'POST', {action: 'scan', date: today, code, ...extra});

// --- Families get one stable pass per wrestler ---
as('p1');
let r = await call(passesApi, 'GET');
assert.deepEqual(r.body.passes.map(p => p.name), ['Sam', 'Riley']);
const sam = r.body.passes[0].code, riley = r.body.passes[1].code;
assert.match(sam, /^SWA1:[A-Za-z0-9_-]{32}$/); assert.notEqual(sam, riley);
assert.equal((await call(passesApi, 'GET')).body.passes[0].code, sam, 'stable across visits');
as('p2'); const jo = (await call(passesApi, 'GET')).body.passes[0].code;
assert.equal((await call(passesApi, 'POST', {action: 'replace', wrestlerId: 'w1'})).status, 404, 'cannot touch another family\'s pass');

// --- Scanning follows the roster: only registered, paid wrestlers ---
as('owner');
assert.equal((await call(payments, 'POST', {action: 'record', userId: 'p1', wrestlerId: 'w1', kind: 'walkin', program: 'Intermediate', date: today, practiceId: `Intermediate:${today}:18:00`, method: 'cash'})).status, 200);
assert.equal((await scan('SWA1:' + 'x'.repeat(32))).status, 404, 'unknown pass');
assert.equal((await scan('not a pass')).status, 404);
r = await scan(riley); assert.equal(r.status, 409); assert.match(r.body.error, /not registered or paid/);
r = await scan(sam);
assert.equal(r.status, 200); assert.equal(r.body.scan.already, false); assert.equal(r.body.scan.name, 'Sam'); assert.match(r.body.scan.session, /Intermediate/);
assert.equal(sqlite.prepare("SELECT count(*) n FROM attendance WHERE wrestler_id='w1'").get().n, 1);
r = await scan(sam); assert.equal(r.body.scan.already, true, 'a second scan does not check in twice');
assert.equal(sqlite.prepare("SELECT count(*) n FROM attendance WHERE wrestler_id='w1'").get().n, 1);

// --- Coaches scan only their own programs, today only ---
as('coach-other'); assert.equal((await scan(sam)).status, 409, 'not on this coach\'s roster');
as('coach-dana'); assert.equal((await call(rosterApi, 'POST', {action: 'scan', date: ny(1), code: sam})).status, 403);
as('p1'); assert.equal((await scan(sam)).status, 403, 'families cannot scan');

// --- Two sessions the same day: the nearest one, or the one staff choose ---
as('owner');
assert.equal((await call(payments, 'POST', {action: 'record', userId: 'p2', wrestlerId: 'w3', kind: 'walkin', program: 'Intermediate', date: today, practiceId: `Intermediate:${today}:18:00`, method: 'cash'})).status, 200);
assert.equal((await call(payments, 'POST', {action: 'record', userId: 'p2', wrestlerId: 'w3', kind: 'live', liveId: 'fnl', date: today, method: 'cash'})).status, 200);
const scope = {role: 'owner'};
r = await passes.scanCheckIn(today, jo, scope, 'owner-id', 16 * 60 + 30);
assert.equal(r.session, 'Friday Night Live', 'during Friday Night Live'); assert.equal(r.others.length, 1);
r = await passes.scanCheckIn(today, jo, scope, 'owner-id', 18 * 60);
assert.match(r.session, /Intermediate/, 'later that evening: the practice');
r = await passes.scanCheckIn(today, jo, scope, 'owner-id', 18 * 60);
assert.equal(r.already, true, 'both done');

// --- Replacing or revoking a pass stops the old code at once ---
as('p1'); r = await call(passesApi, 'POST', {action: 'replace', wrestlerId: 'w1'});
const sam2 = r.body.passes[0].code; assert.notEqual(sam2, sam);
as('owner'); assert.equal((await scan(sam)).status, 404, 'old code refused'); assert.equal((await scan(sam2)).status, 200);
assert.equal((await call(passesApi, 'POST', {action: 'revoke', userId: 'p1', wrestlerId: 'w1'})).status, 200);
assert.equal((await scan(sam2)).status, 404, 'revoked by the owner');
as('p1'); assert.notEqual((await call(passesApi, 'GET')).body.passes[0].code, sam2, 'family gets a fresh pass');
assert.deepEqual(sqlite.prepare("SELECT action FROM security_events WHERE action='pass_revoked'").all().length, 2);

// --- The QR code the family sees decodes back to the pass (bundled generator and scanner) ---
{
  const win = {}; vm.runInNewContext(readFileSync('public/qr-preview.js', 'utf8'), {window: win});
  const svg = win.qrSvg(sam2, 'Entry pass for <Sam>');
  assert.match(svg, /aria-label="Entry pass for Sam"/); assert.ok(!svg.includes('Sample'));
  const size = +svg.match(/viewBox="0 0 (\d+)/)[1], scale = 6, w = size * scale, px = new Uint8ClampedArray(w * w * 4).fill(255);
  for (const [, x, y] of svg.matchAll(/M(\d+),(\d+)h1v1h-1z/g)) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const i = ((+y * scale + dy) * w + (+x * scale + dx)) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
  const jsWin = {}; vm.runInNewContext(readFileSync('public/jsqr-1.4.0.js', 'utf8'), {window: jsWin, self: jsWin, Uint8ClampedArray, Math, Array, Object, Number, String, Error, Infinity});
  const jsQR = jsWin.jsQR ?? jsWin.default;
  assert.equal(jsQR(px, w, w).data, sam2);
}

console.log('QR pass tests passed');
