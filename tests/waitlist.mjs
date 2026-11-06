// Issue #73: waitlists for full camps and events, with owner offers that hold a seat until they expire.
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
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2, programs: [], seasons: [],
  events: [{id: 'camp', name: 'Winter camp', type: 'Camp', dates: [ny(10), ny(11)], price: 160, slots: 1},
           {id: 'open', name: 'Open clinic', type: 'Clinic', dates: [ny(12)], price: 50},
           {id: 'clinic', name: 'Takedown clinic', type: 'Clinic', dates: [ny(14)], price: 50, slots: 1},
           {id: 'closed', name: 'Closed clinic', type: 'Clinic', dates: [ny(15)], price: 50, slots: 0}]}));
for (const u of ['p1', 'p2', 'p3']) sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test',
  JSON.stringify({parentName: 'Parent ' + u, phone: '', wrestlers: [{id: 'w-' + u, name: 'Wrestler ' + u, grade: '8', usawNumber: 'AB1234', usawExpires: '2099-12-31'}]}), 1, 'x');

const familyApi = load(path.resolve('app/api/waitlist/route.ts'));
const ownerApi = load(path.resolve('app/api/waitlists/route.ts'));
const payments = load(path.resolve('app/api/payments/route.ts'));
const quotes = load(path.resolve('lib/quotes.ts'));
const capacity = load(path.resolve('lib/capacity.ts'));
const webhook = load(path.resolve('lib/stripe-webhook.ts'));
const O = 'https://a.test';
const call = async (route, method, body) => { const r = await route[method](new Request(O + '/x', method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const as = id => { actor = id === 'owner' ? {owner: true, id: 'owner-id'} : {owner: false, id}; };
const quote = (u, id = 'camp') => quotes.quoteBooking(u, {type: 'event', wrestlerId: 'w-' + u, id});
const join = (u, eventId = 'camp') => { as(u); return call(familyApi, 'POST', {action: 'join', eventId, wrestlerId: 'w-' + u}); };
const record = (u, eventId = 'camp') => { as('owner'); return call(payments, 'POST', {action: 'record', userId: u, wrestlerId: 'w-' + u, kind: 'event', eventId, method: 'cash'}); };
const entries = async u => { as(u); return (await call(familyApi, 'GET')).body.entries; };
const ownerView = async () => { as('owner'); return (await call(ownerApi, 'GET')).body.events; };
const entryId = async (u, eventId = 'camp') => (await entries(u)).find(x => x.eventId === eventId && ['waiting', 'offered'].includes(x.status)).id;
const offer = async (u, eventId = 'camp', hours = 24, autoNext = false) => { const id = await entryId(u, eventId); as('owner'); return call(ownerApi, 'POST', {action: 'offer', id, hours, autoNext}); };

// --- Full events point families to the waitlist ---
assert.equal((await record('p1')).status, 200);
let q = await quote('p2'); assert.equal(q.status, 409); assert.equal(q.extra.waitlist, true); assert.match(q.error, /Join the waitlist/);
assert.equal((await join('p2', 'open')).status, 409, 'cannot join when seats are left');
assert.equal((await join('p2')).status, 200);
assert.equal((await join('p2')).status, 409, 'once per wrestler');
assert.equal((await join('p3')).status, 200);
assert.equal((await join('p3', 'closed')).status, 200, 'an event marked full also takes a waitlist');
assert.deepEqual((await entries('p3')).filter(x => x.eventId === 'camp').map(x => x.position), [2]);
let ev = (await ownerView()).find(e => e.eventId === 'camp');
assert.equal(JSON.stringify(ev.entries.map(x => [x.wrestler, x.position])), JSON.stringify([['Wrestler p2', 1], ['Wrestler p3', 2]]));
as('p2'); assert.equal((await call(ownerApi, 'GET')).status, 403, 'families cannot see the owner list');

// --- An offered seat is held for that family only ---
assert.equal((await offer('p2', 'camp', 0)).status, 400, 'hold hours are checked');
assert.equal((await offer('p2')).status, 200);
const p1Order = sqlite.prepare("SELECT id FROM orders WHERE user_id='p1' AND item_id='camp'").get().id;
as('owner'); assert.equal((await call(payments, 'POST', {action: 'void', orderId: p1Order, reason: 'refund'})).status, 200);
assert.match((await quote('p3')).error, /Join the waitlist/, 'the freed seat is held for p2');
assert.equal((await record('p3')).status, 409, 'nor can the owner record it for someone else');
q = await quote('p2'); assert.equal(q.ok, true); assert.equal(q.charge.pricing.slots, null); assert.ok(q.review.offerExpiresAt);
assert.equal((await entries('p2')).find(x => x.eventId === 'camp').status, 'offered');
// Checkout ranking: another family's pending order does not get the held seat, the offered family's does.
const pend = (id, u) => sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,stripe_session_id)
  VALUES (?,?,'e',?,'W','event','camp','Camp',?,16000,0,16000,'usd','{}','{}','pending',?,0,?,?,?)`).run(id, u, 'w-' + u, JSON.stringify([ny(10), ny(11)]), id, new Date().toISOString(), new Date().toISOString(), 'cs_' + id);
pend('x3', 'p3'); assert.equal(await capacity.withinCapacity('x3', 'camp', [ny(10), ny(11)], 1), false);
sqlite.prepare("DELETE FROM orders WHERE id='x3'").run();
pend('x2', 'p2'); assert.equal(await capacity.withinCapacity('x2', 'camp', [ny(10), ny(11)], 1), true);
// Paying closes the offer.
let r = await webhook.applyStripeEvent({id: 'evt_w', type: 'checkout.session.completed', data: {object: {id: 'cs_x2', client_reference_id: 'x2', payment_status: 'paid', livemode: false, amount_total: 16000, currency: 'usd'}}});
assert.equal(r.outcome, 'paid');
assert.equal((await entries('p2')).find(x => x.eventId === 'camp').status, 'accepted');
assert.match((await quote('p3')).error, /Join the waitlist/, 'camp full again');

// --- An expired offer passes on when the owner asked, and not otherwise ---
assert.equal((await record('p1', 'clinic')).status, 200);
assert.equal((await join('p2', 'clinic')).status, 200); assert.equal((await join('p3', 'clinic')).status, 200);
assert.equal((await offer('p2', 'clinic', 4, true)).status, 200);
const clinicOrder = sqlite.prepare("SELECT id FROM orders WHERE user_id='p1' AND item_id='clinic' AND status='paid'").get().id;
as('owner'); await call(payments, 'POST', {action: 'void', orderId: clinicOrder, reason: 'x'});
sqlite.prepare("UPDATE waitlist_entries SET offer_expires_at=? WHERE event_id='clinic' AND status='offered'").run(new Date(Date.now() - 1000).toISOString());
q = await quote('p3', 'clinic');
assert.equal(q.ok, true, 'p3 now holds the offer');
assert.equal((await entries('p2')).find(x => x.eventId === 'clinic').status, 'expired');
assert.equal((await entries('p3')).find(x => x.eventId === 'clinic').status, 'offered');
assert.match((await quote('p2', 'clinic')).error, /Join the waitlist/);
// Without pass-on the seat simply opens up again.
assert.equal((await record('p1', 'clinic')).status, 409, 'still held for p3');
sqlite.prepare("UPDATE waitlist_entries SET auto_next=0,offer_expires_at=? WHERE event_id='clinic' AND status='offered'").run(new Date(Date.now() - 1000).toISOString());
assert.equal((await record('p1', 'clinic')).status, 200, 'expired with no pass-on: open to anyone');

// --- Event marked full by the owner: an offer lets that family in ---
assert.match((await quote('p3', 'closed')).error, /Join the waitlist/);
assert.equal((await offer('p3', 'closed')).status, 200);
assert.equal((await quote('p3', 'closed')).ok, true);

// --- Leaving and removing ---
assert.equal((await join('p1')).status, 200);
const p1camp = await entryId('p1');
as('p1'); assert.equal((await call(familyApi, 'POST', {action: 'withdraw', id: p1camp})).status, 200);
const p3camp = await entryId('p3', 'camp');
as('p2'); assert.equal((await call(familyApi, 'POST', {action: 'withdraw', id: p3camp})).status, 404, 'cannot withdraw another family');
as('owner'); assert.equal((await call(ownerApi, 'POST', {action: 'remove', id: p3camp})).status, 200);
assert.equal((await entries('p3')).find(x => x.eventId === 'camp').status, 'removed');

console.log('Waitlist tests passed');
