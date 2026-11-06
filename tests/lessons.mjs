// Issue #70: private lessons booked against real coach openings at owner prices, never double-booked.
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




// --- The migration that allows lesson orders keeps every existing order ---
{
  const old = new DatabaseSync(':memory:'), files = readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort();
  for (const f of files.filter(f => f < '0019')) old.exec(readFileSync('drizzle/' + f, 'utf8'));
  old.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source)
    VALUES ('o-old','u','u@x','w','W','annual','Intermediate','Intermediate','Membership','[]',240000,0,240000,'usd','{}','{}','paid','k',0,'t','t','t','offline')`).run();
  assert.throws(() => old.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at) VALUES ('x','u','e','w','W','lesson','i','l','[]',1,0,1,'usd','{}','{}','paid','k2',0,'t','t')`).run(), /CHECK/);
  for (const f of files.filter(f => f >= '0019')) old.exec(readFileSync('drizzle/' + f, 'utf8'));
  const row = old.prepare("SELECT * FROM orders WHERE id='o-old'").get();
  assert.equal(row.amount_cents, 240000); assert.equal(row.source, 'offline'); assert.equal(row.status, 'paid');
  old.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at) VALUES ('x','u','e','w','W','lesson','i','l','[]',1,0,1,'usd','{}','{}','paid','k2',0,'t','t')`).run();
  assert.throws(() => old.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at) VALUES ('y','u','e','w','W','lesson','i','l','[]',1,0,1,'usd','{}','{}','paid','k2',0,'t','t')`).run(), /UNIQUE/, 'dedupe index survives');
}

const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0), tomorrow = ny(1);
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2, programs: [], seasons: [], events: []}));
const card = {usawNumber: 'AB1234', usawExpires: '2099-12-31'};
for (const u of ['p1', 'p2']) sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test',
  JSON.stringify({parentName: 'Parent ' + u, phone: '555-01' + u.slice(1), wrestlers: [{id: 'w-' + u, name: 'Wrestler ' + u, grade: '8', ...card}]}), 1, 'x');
sqlite.prepare("INSERT INTO staff_access VALUES ('dana@example.test','Coach Dana','[\"Intermediate\"]',1,'x'),('gone@example.test','Coach Gone','[]',0,'x')").run();
const opening = (id, date, start, email, user = 'coach-dana') => sqlite.prepare('INSERT INTO coach_openings(id,user_id,date,start,end,coach_email) VALUES (?,?,?,?,?,?)')
  .run(id, user, date, start, String(+start.slice(0, 2) + 1).padStart(2, '0') + start.slice(2), email);
opening('o1', tomorrow, '16:00', 'dana@example.test');
opening('o2', tomorrow, '18:00', null);                       // made before coach emails were stored
opening('o3', tomorrow, '17:00', 'gone@example.test', 'coach-gone');
opening('o4', ny(-1), '16:00', 'dana@example.test');
opening('o5', ny(2), '16:00', 'dana@example.test');

const quotes = load(path.resolve('lib/quotes.ts'));
const lessons = load(path.resolve('lib/lessons.ts'));
const capacity = load(path.resolve('lib/capacity.ts'));
const webhook = load(path.resolve('lib/stripe-webhook.ts'));
const lessonsApi = load(path.resolve('app/api/lessons/route.ts'));
const settingsApi = load(path.resolve('app/api/lesson-settings/route.ts'));
const coachApi = load(path.resolve('app/api/coach/route.ts'));
const payments = load(path.resolve('app/api/payments/route.ts'));
const O = 'https://a.test';
const call = async (route, method, body, origin = O) => { const r = await route[method](new Request(O + '/x', method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const as = id => { actor = id === 'owner' ? {owner: true, id: 'owner-id'} : id === 'coach' ? {owner: false, id: 'coach-dana', coach: 'dana@example.test'} : {owner: false, id}; };
const book = (u, openingId, format = 'one-on-one', extra = {}) => quotes.quoteBooking(u, {type: 'lesson', wrestlerId: 'w-' + u, format, openingId, ...extra});

// --- Owner prices ---
as('p1'); assert.equal((await call(settingsApi, 'POST', {prices: {'one-on-one': 6000}})).status, 403);
as('owner');
assert.equal((await call(settingsApi, 'POST', {prices: {'one-on-one': 6000}}, 'https://evil.test')).status, 403);
assert.equal((await call(settingsApi, 'POST', {prices: {'one-on-one': 10}})).status, 400, 'minimum Stripe charge');
assert.equal((await call(settingsApi, 'POST', {prices: {'one-on-one': 60.5}})).status, 400, 'whole cents');
assert.equal((await call(settingsApi, 'POST', {prices: {'one-on-one': 6000, partner: null}})).status, 200);
let r = await call(settingsApi, 'GET'); assert.equal(r.body.settings.prices['one-on-one'], 6000); assert.equal(r.body.coaches.length, 2);

// --- What families see ---
as('p1'); r = await call(lessonsApi, 'GET');
assert.deepEqual(r.body.openings.map(o => o.id), ['o1', 'o5'], 'only future openings of active coaches with a known email');
assert.equal(r.body.openings[0].coach, 'Coach Dana');
assert.equal(r.body.formats.find(f => f.id === 'one-on-one').cents, 6000); assert.equal(r.body.formats.find(f => f.id === 'partner').cents, null);
assert.equal(r.body.paymentsOpen, false, 'lesson checkout is closed until CHECKOUT_KINDS lists it');

// --- Quotes ---
let q = await quotes.quoteBooking('p1', {type: 'lesson', wrestlerId: 'w-p1', format: 'one-on-one'});
assert.equal(q.ok, true); assert.equal(q.charge, null, 'no time chosen: still an inquiry');
for (const id of ['o2', 'o3', 'o4', 'nope']) assert.match((await book('p1', id)).error, /no longer available/, id);
assert.match((await book('p1', 'o1', 'partner')).error, /not open for online booking/);
q = await book('p1', 'o1', 'one-on-one', {partners: 'x'.repeat(300)});
assert.equal(q.ok, true); assert.equal(q.charge.kind, 'lesson'); assert.equal(q.charge.amountCents, 6000); assert.equal(q.charge.itemId, 'o1');
assert.equal(JSON.stringify(q.charge.dates), JSON.stringify([tomorrow])); assert.equal(q.charge.pricing.slots, 1); assert.equal(q.charge.pricing.partners.length, 200);
assert.match(q.charge.itemLabel, /One-on-one lesson with Coach Dana, .* at 16:00/);
assert.equal(q.charge.dedupeKey, `p1|w-p1|lesson|o1`, 'per family, so one family cannot cancel another family\'s checkout');
// The card must cover the lesson date, not just today.
sqlite.prepare("UPDATE family_accounts SET payload=json_set(payload,'$.wrestlers[0].usawExpires',?) WHERE user_id='p1'").run(today);
assert.match((await book('p1', 'o1')).error, /USA Wrestling card expires .* before this session|expired on/);
sqlite.prepare("UPDATE family_accounts SET payload=json_set(payload,'$.wrestlers[0].usawExpires','2099-12-31') WHERE user_id='p1'").run();

// --- A checkout in progress holds the time; the first order wins a race ---
const pending = (id, u, at = new Date().toISOString()) => sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,stripe_session_id)
  VALUES (?,?,?,?,?,'lesson','o5','Lesson',?,6000,0,6000,'usd','{"slots":1}','{}','pending',?,0,?,?,?)`).run(id, u, u + '@x', 'w-' + u, 'W', JSON.stringify([ny(2)]), `${u}|w-${u}|lesson|o5`, at, at, 'cs_' + id);
pending('a', 'p2');
assert.match((await book('p1', 'o5')).error, /Another family just booked/);
as('p1'); assert.deepEqual((await call(lessonsApi, 'GET')).body.openings.map(o => o.id), ['o1'], 'held time is hidden');
pending('b', 'p1');
assert.equal(await capacity.withinCapacity('a', 'o5', [ny(2)], 1, 'lesson'), true);
assert.equal(await capacity.withinCapacity('b', 'o5', [ny(2)], 1, 'lesson'), false, 'the later checkout loses');
// If the later one is paid anyway (after its hold lapsed), the payment stands and the owner is warned.
sqlite.prepare("UPDATE orders SET status='paid',paid_at='t' WHERE id='a'").run();
r = await webhook.applyStripeEvent({id: 'evt_1', type: 'checkout.session.completed', data: {object: {id: 'cs_b', client_reference_id: 'b', payment_status: 'paid', livemode: false, amount_total: 6000, currency: 'usd'}}});
assert.equal(r.outcome, 'paid-over-capacity');
assert.equal(sqlite.prepare("SELECT count(*) n FROM security_events WHERE action='lesson_double_booked'").get().n, 1);
// A stale hold (older than the hold window) does not block.
sqlite.prepare("DELETE FROM orders WHERE item_id='o5'").run();
pending('c', 'p2', new Date(Date.now() - 40 * 60000).toISOString());
assert.equal((await book('p1', 'o5')).ok, true, 'stale hold released');

// --- Offline lesson payment takes the opening ---
as('owner');
r = await call(payments, 'POST', {action: 'preview', userId: 'p1', wrestlerId: 'w-p1', kind: 'lesson', format: 'one-on-one', openingId: 'o1'});
assert.equal(r.status, 200); assert.equal(r.body.listCents, 6000);
r = await call(payments, 'POST', {action: 'record', userId: 'p1', wrestlerId: 'w-p1', kind: 'lesson', format: 'one-on-one', openingId: 'o1', method: 'cash', note: 'paid at the door'});
assert.equal(r.status, 200); const lessonOrder = r.body.orderId;
assert.match((await book('p2', 'o1')).error, /Another family just booked/);
assert.equal((await call(payments, 'POST', {action: 'record', userId: 'p2', wrestlerId: 'w-p2', kind: 'lesson', format: 'one-on-one', openingId: 'o1', method: 'cash'})).status, 409);
assert.equal((await call(payments, 'GET')).body.payments.length, 1, 'lesson payments appear on the payments page');

// --- The coach sees the booking and cannot remove a booked time ---
as('coach');
r = await call(coachApi, 'GET');
const o1 = r.body.openings.find(o => o.id === 'o1');
assert.equal(o1.booking.wrestler, 'Wrestler p1'); assert.equal(o1.booking.format, 'One-on-one lesson'); assert.equal(o1.booking.parent, 'Parent p1'); assert.equal(o1.booking.phone, '555-011');
assert.equal(r.body.openings.find(o => o.id === 'o5').booking, null);
assert.equal((await call(coachApi, 'POST', {action: 'remove', id: 'o1'})).status, 409);
// Reading the page links openings saved before coach emails were stored.
assert.equal(sqlite.prepare("SELECT coach_email FROM coach_openings WHERE id='o2'").get().coach_email, 'dana@example.test');
r = await call(coachApi, 'POST', {action: 'add', date: ny(3), start: '10:00', end: '11:00'}); assert.equal(r.status, 200);
assert.equal(sqlite.prepare('SELECT coach_email FROM coach_openings WHERE date=?').get(ny(3)).coach_email, 'dana@example.test');

// --- Voiding frees the time ---
as('owner');
assert.equal((await call(payments, 'POST', {action: 'void', orderId: lessonOrder, reason: 'rescheduled'})).status, 200);
as('p1'); assert.ok((await call(lessonsApi, 'GET')).body.openings.some(o => o.id === 'o1'));
as('coach'); assert.equal((await call(coachApi, 'POST', {action: 'remove', id: 'o1'})).status, 200);

// --- Coach pay settings validation (used by the pay report) ---
as('owner');
assert.equal((await call(settingsApi, 'POST', {splits: {'dana@example.test': 101}})).status, 400);
assert.equal((await call(settingsApi, 'POST', {splits: {'Dana@Example.test': 70}, defaultSplit: 60})).status, 200);
r = await call(settingsApi, 'GET'); assert.equal(r.body.settings.splits['dana@example.test'], 70); assert.equal(r.body.settings.defaultSplit, 60); assert.equal(r.body.settings.prices['one-on-one'], 6000, 'prices kept');

console.log('Lesson booking tests passed');
