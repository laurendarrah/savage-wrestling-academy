// Issue #76: a wrestler page with the entry pass and the sessions the wrestler is booked into.
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
  programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}, {id: 'Advanced', name: 'SWA Advance', priceCents: 20000, walkInPriceCents: 4000}],
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(60), weekly: all, excludedDates: []}, {program: 'Advanced', start: ny(-30), end: ny(60), weekly: all.map(x => ({...x, start: '19:30', end: '21:00'})), excludedDates: []}],
  events: [{id: 'camp', name: 'Winter camp', type: 'Camp', dates: [ny(5), ny(6)], price: 160}],
  extraPractices: [{id: 'fnl', name: 'Friday Night Live', dates: [ny(2), ny(9)], enabled: true, start: '16:00', end: '17:00', memberCents: 1000, nonMemberCents: 2000}]}));
const fam = (u, wrestlers) => sqlite.prepare('INSERT OR REPLACE INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test', JSON.stringify({parentName: 'Parent ' + u, phone: '', wrestlers}), 1, 'x');
fam('p1', [{id: 'w1', name: 'Sam', grade: '8', usawNumber: 'AB1234', usawExpires: '2099-12-31'}, {id: 'w2', name: 'Riley', grade: 'K'}]);
fam('p2', [{id: 'w3', name: 'Jo', grade: '8', usawNumber: 'AB1236', usawExpires: '2099-12-31'}]);

const api = load(path.resolve('app/api/wrestler/route.ts'));
const passesApi = load(path.resolve('app/api/passes/route.ts'));
const payments = load(path.resolve('app/api/payments/route.ts'));
const rosterApi = load(path.resolve('app/api/roster/route.ts'));
const waiversApi = load(path.resolve('app/api/waivers/route.ts'));
const roster = load(path.resolve('lib/roster.ts'));
const O = 'https://a.test';
const call = async (route, method, body, q = '') => { const r = await route[method](new Request(O + '/x' + q, method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const as = id => { actor = id === 'owner' ? {owner: true, id: 'owner-id'} : {owner: false, id}; };
const view = (id, who = 'p1') => { as(who); return call(api, 'GET', null, '?id=' + id); };
const pay = body => { as('owner'); return call(payments, 'POST', {action: 'record', userId: 'p1', wrestlerId: 'w1', method: 'cash', ...body}); };

// Nothing booked yet.
let r = await view('w1');
assert.equal(r.status, 200); assert.equal(r.body.name, 'Sam'); assert.equal(r.body.upcoming.length, 0); assert.equal(r.body.card.state, 'current'); assert.equal(r.body.waiverNeeded, false);
assert.equal((await view('w3')).status, 404, 'another family\'s wrestler');
assert.equal((await view('w3', 'p2')).status, 200);
assert.equal((await view('../x')).status, 404);

// Membership, a paid extra practice, a camp and a lesson all show up; nothing else does.
assert.equal((await pay({kind: 'annual', program: 'Intermediate'})).status, 200);
assert.equal((await pay({kind: 'live', liveId: 'fnl', date: ny(2)})).status, 200);
assert.equal((await pay({kind: 'event', eventId: 'camp'})).status, 200);
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source)
  VALUES ('L1','p1','p1@x','w1','Sam','lesson','op1','Lesson',?,6000,0,6000,'usd',?,'{}','paid','kl',0,'t','t','t','stripe')`).run(JSON.stringify([ny(3)]), JSON.stringify({formatName: 'One-on-one lesson', coachName: 'Coach Dana', start: '15:00', end: '16:00'}));
r = await view('w1');
const up = r.body.upcoming;
assert.equal(up.filter(u => u.type === 'practice').length, 21, 'every practice in the next three weeks');
assert.ok(up.every(u => u.type !== 'practice' || u.title === 'SWA Intermediate'), 'not the Advance practices');
assert.equal(JSON.stringify(up.filter(u => u.type === 'live').map(u => u.date)), JSON.stringify([ny(2)]), 'only the paid extra practice, not ' + ny(9));
assert.equal(JSON.stringify(up.filter(u => u.type === 'event').map(u => u.date)), JSON.stringify([ny(5), ny(6)]));
const lesson = up.find(u => u.type === 'lesson'); assert.equal(lesson.title, 'One-on-one lesson with Coach Dana'); assert.equal(lesson.date, ny(3));
assert.ok(up.every((u, i) => i === 0 || up[i - 1].date < u.date || (up[i - 1].date === u.date && (up[i - 1].start ?? '99') <= (u.start ?? '99'))), 'in time order');
assert.equal(up.filter(u => u.date === ny(2))[0].type, 'live', '4 PM extra practice before the 6 PM practice');

// The list agrees with the real roster, day by day.
for (let k = 0; k < 7; k++) {
  const d = ny(k), onRoster = (await roster.rosterFor(d, {role: 'owner'})).filter(s => s.entries.some(e => e.wrestlerId === 'w1')).map(s => s.title).sort();
  assert.equal(JSON.stringify(up.filter(u => u.date === d && u.type !== 'lesson').map(u => u.title).sort()), JSON.stringify(onRoster), 'roster agreement on ' + d);
}

// The pass is the family's pass; check-ins this month are counted.
as('p1'); const code = (await call(passesApi, 'GET')).body.passes[0].code;
assert.equal(r.body.pass, code); assert.equal(r.body.checkInsThisMonth, 0);
as('owner'); assert.equal((await call(rosterApi, 'POST', {action: 'scan', date: today, code})).status, 200);
assert.equal((await view('w1')).body.checkInsThisMonth, 1);

// Problems that block new bookings are shown to the parent.
r = await view('w2'); assert.equal(r.body.card.state, 'missing'); assert.equal(r.body.upcoming.length, 0);
as('owner'); assert.equal((await call(waiversApi, 'POST', {action: 'publish', title: 'Participation waiver', body: 'Wrestling is a contact sport. '.repeat(10)})).status, 200);
assert.equal((await view('w1')).body.waiverNeeded, true);

// Page helpers (inline JavaScript is not typechecked).
{
  const html = readFileSync('app/wrestler/screen.html', 'utf8'), script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const ctx = {Date, String, Intl, URLSearchParams, document: {}, window: {addEventListener() {}}, location: {search: ''}};
  vm.runInNewContext(script.replace("window.addEventListener('DOMContentLoaded',load);", '') + ';this.clock=clock;this.dayName=dayName;', ctx);
  assert.equal(ctx.clock('18:00'), '6:00 PM'); assert.equal(ctx.clock(null), 'All day');
  assert.equal(ctx.dayName(today), 'Today'); assert.equal(ctx.dayName(ny(1)), 'Tomorrow'); assert.match(ctx.dayName(ny(5)), /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d+$/);
}
console.log('Wrestler view tests passed');
