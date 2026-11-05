// Issue #92: a roster's database work does not grow with the number of wrestlers.
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
        if (name.endsWith('/account-auth')) return {
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
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(60), weekly: all, excludedDates: []}], events: []}));
sqlite.prepare("INSERT INTO waiver_versions VALUES ('wv','Waiver','text','h',?, 'o', NULL)").run(new Date().toISOString());
const N = 80;
for (let i = 0; i < N; i++) {
  const u = 'u' + i, w = 'w' + i;
  sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@x.test', JSON.stringify({parentName: 'P' + i, phone: '', wrestlers: [{id: w, name: 'Wrestler ' + String(i).padStart(2, '0'), grade: '8', ...(i % 4 ? {usawNumber: 'AB' + (1000 + i), usawExpires: i % 4 === 1 ? ny(-1) : '2099-12-31'} : {})}]}), 1, 'x');
  sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
    VALUES (?,?,'e',?,'W','annual','Intermediate','Intermediate','M','[]',1,0,1,'usd','{}','{}','paid',?,0,'t','t','t',?,?,'offline')`).run('o' + i, u, w, 'k' + i, ny(-5), ny(300));
  if (i % 2) sqlite.prepare("INSERT INTO waiver_signatures VALUES (?,?,?,?,?,?,?,?,?)").run('s' + i, 'wv', u, w, 'W', 'P', 'e', '{}', 't');
}
sqlite.prepare("INSERT INTO usaw_reviews VALUES ('u2','w2','AB1002','2099-12-31','invalid','Not found','o','t')").run();
sqlite.prepare("INSERT INTO booking_exceptions VALUES ('x1','u0','w0','usaw',?,?,'Renewal pending','o','t',NULL,NULL)").run(ny(-1), ny(10));

const roster = load(path.resolve('lib/roster.ts'));
let queries = 0; const prepare = DB.prepare.bind(DB); DB.prepare = sql => { queries++; return prepare(sql); };
const started = Date.now();
const [session] = await roster.rosterFor(today, {role: 'owner'});
assert.equal(session.entries.length, N);
assert.ok(queries <= 15, `roster used ${queries} queries for ${N} wrestlers`);
const by = n => session.entries.find(e => e.name === 'Wrestler ' + String(n).padStart(2, '0'));
assert.equal(by(0).card, 'missing'); assert.equal(JSON.stringify(by(0).exceptions), JSON.stringify(['usaw']));
assert.equal(by(1).card, 'expired'); assert.equal(by(1).waiverSigned, true);
assert.equal(by(2).card, 'invalid'); assert.equal(by(2).cardNote, 'Not found'); assert.equal(by(2).waiverSigned, false);
assert.equal(by(3).card, 'current'); assert.equal(JSON.stringify(by(3).exceptions), '[]');
console.log(`Roster scale test passed: ${N} wrestlers, ${queries} queries, ${Date.now() - started} ms`);
