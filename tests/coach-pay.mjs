// Issue #75: coach pay report from paid lessons at the owner's split.
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
    {module, exports: module.exports, crypto, TextEncoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test',
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, headers: new Headers()}),
          strongAccount: async () => ({user: {id: actor.id, email: actor.id + '@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.endsWith('/access-control')) return {accountRole: async () => actor.coach ? {role: 'coach', staff: {email: actor.coach, name: 'Coach Dana', programs: ['Intermediate']}} : {role: 'family', staff: null}};
        if (name.endsWith('/stripe-test')) return {storedStripeKeyFor: async () => null, stripeClientFor: () => null, stripeMode: () => 'test'};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}





sqlite.prepare("INSERT INTO staff_access VALUES ('dana@example.test','Coach Dana','[]',1,'x'),('lee@example.test','Coach Lee','[]',1,'x')").run();
let n = 0;
const lesson = (coachEmail, date, cents, status = 'paid', source = 'stripe', wrestler = 'Sam') => sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source)
  VALUES (?,?,?,?,?,'lesson',?,?,?,?,0,?,'usd',?,'{}',?,?,0,'t','t','2026-01-01T12:00:00Z',?)`).run('L' + ++n, 'u', 'u@x', 'w', wrestler, 'op' + n, 'Lesson', JSON.stringify([date]), cents, cents,
  JSON.stringify({coachEmail, coachName: 'Name from order', formatName: 'One-on-one lesson', start: '16:00', slots: 1}), status, 'k' + n, source);
lesson('dana@example.test', '2026-10-05', 3333);
lesson('dana@example.test', '2026-10-06', 3333);
lesson('dana@example.test', '2026-10-07', 3333, 'paid', 'offline', '=HYPERLINK("x")');
lesson('dana@example.test', '2026-10-08', 6000, 'refunded');
lesson('dana@example.test', '2026-10-09', 6000, 'canceled', 'offline');
lesson('lee@example.test', '2026-10-20', 8000);
lesson('lee@example.test', '2026-11-02', 8000);                 // outside October
lesson('old@example.test', '2026-10-21', 5000);                 // coach no longer on staff
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at)
  VALUES ('E1','u','u@x','w','Sam','event','camp','Camp','["2026-10-10"]',9000,0,9000,'usd','{}','{}','paid','ke',0,'t','t')`).run();

const api = load(path.resolve('app/api/coach-pay/route.ts'));
const settings = load(path.resolve('app/api/lesson-settings/route.ts'));
const O = 'https://a.test';
const get = async q => { const r = await api.GET(new Request(O + '/api/coach-pay' + q)); return {status: r.status, type: r.headers.get('content-type'), text: await r.text()}; };
const save = body => settings.POST(new Request(O + '/x', {method: 'POST', headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)}));

actor = {owner: false, id: 'u'}; assert.equal((await get('?from=2026-10-01&to=2026-10-31')).status, 403, 'owner only');
actor = {owner: true, id: 'owner-id'};
assert.equal((await get('?from=2026-10-31&to=2026-10-01')).status, 400);
assert.equal((await get('?from=nope&to=2026-10-01')).status, 400);

// No pay shares set: lessons and totals are shown, amounts owed are blank.
let r = JSON.parse((await get('?from=2026-10-01&to=2026-10-31')).text);
assert.deepEqual(r.coaches.map(c => [c.coach, c.lessons, c.grossCents, c.owedCents]), [['Coach Dana', 3, 9999, null], ['Coach Lee', 1, 8000, null], ['Name from order', 1, 5000, null]]);
assert.equal(r.totals.unsetCoaches, 3); assert.equal(r.totals.grossCents, 22999, 'refunded, voided, other kinds and other months excluded');

// Default share and a per-coach share.
assert.equal((await save({defaultSplit: 60, splits: {'dana@example.test': 70}})).status, 200);
r = JSON.parse((await get('?from=2026-10-01&to=2026-10-31')).text);
const dana = r.coaches.find(c => c.coach === 'Coach Dana'), lee = r.coaches.find(c => c.coach === 'Coach Lee');
assert.equal(dana.splitPct, 70); assert.equal(dana.owedCents, 3 * 2333, 'each lesson rounded to the cent'); assert.equal(dana.academyCents, 9999 - 6999);
assert.equal(lee.splitPct, 60); assert.equal(lee.owedCents, 4800);
assert.equal(r.totals.owedCents, 6999 + 4800 + 3000); assert.equal(r.totals.owedCents + r.totals.academyCents, r.totals.grossCents);
assert.equal(dana.lines[2].source, 'offline');

// CSV matches the report and is safe to open in a spreadsheet.
const csv = await get('?from=2026-10-01&to=2026-10-31&format=csv');
assert.match(csv.type, /text\/csv/);
const rows = csv.text.trim().split('\r\n');
assert.equal(rows.length, 1 + 5);
assert.ok(rows.some(l => l.includes(`"'=HYPERLINK(""x"")"`)), 'formula cells are neutralized');
const owedCol = rows.slice(1).map(l => l.match(/,([\d.]*),([\d.]*)$/)).reduce((s, m) => s + Math.round(Number(m[1]) * 100), 0);
assert.equal(owedCol, r.totals.owedCents, 'CSV and report agree to the cent');

console.log('Coach pay report tests passed');
