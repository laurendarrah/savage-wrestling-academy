// Issue #210 (decision Q10 in #197): there are no waitlists. A full camp or event is simply full. Waitlists from #73 are
// gone from families and the owner, but the rows already in waitlist_entries are kept, in the database and in backups.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync} from 'node:fs';
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
        if (name.endsWith('/access-control')) return {accountRole: async () => ({role: 'family', staff: null})};
        if (name.endsWith('/stripe-test')) return {storedStripeKeyFor: async () => null, stripeClientFor: () => null, stripeMode: () => 'test'};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}

const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2, programs: [], seasons: [],
  events: [{id: 'camp', name: 'Winter camp', type: 'Camp', dates: [ny(10), ny(11)], price: 160, slots: 1},
           {id: 'clinic', name: 'Takedown clinic', type: 'Clinic', dates: [ny(14)], price: 50, slots: 1},
           {id: 'closed', name: 'Closed clinic', type: 'Clinic', dates: [ny(15)], price: 50, slots: 0}]}));
for (const u of ['p1', 'p2', 'p3']) sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test',
  JSON.stringify({parentName: 'Parent ' + u, phone: '', wrestlers: [{id: 'w-' + u, name: 'Wrestler ' + u, grade: '8', usawNumber: 'AB1234', usawExpires: '2099-12-31'}]}), 1, 'x');

// --- The waitlist pages, APIs and library are gone ---
for (const f of ['app/api/waitlist/route.ts', 'app/api/waitlists/route.ts', 'app/waitlists/route.ts', 'app/waitlists/screen.html', 'lib/waitlist.ts'])
  assert.equal(existsSync(f), false, f + ' is removed');
for (const f of ['app/booking/screen.html', 'app/family/screen.html', 'app/calendar/screen.html', 'app/portal.html'])
  assert.doesNotMatch(readFileSync(f, 'utf8'), /\/api\/waitlist|\/waitlists|joinWaitlist|Join the waitlist|Leave the waitlist|Waitlist available|On waitlists/, f + ' offers no waitlist');
assert.doesNotMatch(readFileSync('lib/notify.ts', 'utf8'), /noticeWaitlistOffer|waitlist_offer/, 'no seat-offer notice is sent');
for (const f of ['app/help/screen.html', 'app/help/owner/screen.html'])
  assert.doesNotMatch(readFileSync(f, 'utf8'), /Join the waitlist|On <strong>Waitlists<\/strong>|waitlist seat/, f + ' no longer describes waitlists');
// The table stays: no migration drops it.
assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='waitlist_entries'").get(), 'waitlist_entries is kept');

const payments = load(path.resolve('app/api/payments/route.ts'));
const quotes = load(path.resolve('lib/quotes.ts'));
const capacity = load(path.resolve('lib/capacity.ts'));
const webhook = load(path.resolve('lib/stripe-webhook.ts'));
const backups = load(path.resolve('lib/backup-records.ts'));
const O = 'https://a.test';
const call = async (route, method, body) => { const r = await route[method](new Request(O + '/x', method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const quote = (u, id = 'camp') => quotes.quoteBooking(u, {type: 'event', wrestlerId: 'w-' + u, id});
const record = (u, eventId = 'camp') => { actor = {owner: true, id: 'owner-id'}; return call(payments, 'POST', {action: 'record', userId: u, wrestlerId: 'w-' + u, kind: 'event', eventId, method: 'cash'}); };

// --- A full event is simply full ---
assert.equal((await record('p1')).status, 200);
let q = await quote('p2');
assert.equal(q.ok, false); assert.equal(q.status, 409); assert.equal(q.error, 'This event is full.');
assert.equal(q.extra, undefined, 'no waitlist hint for the page');
q = await quote('p2', 'closed');
assert.equal(q.status, 409); assert.equal(q.error, 'This event is full.', 'an event the owner marked full is full too');
assert.equal((await record('p2')).status, 409, 'nor can the owner record a payment past the limit');

// --- Waitlist rows from before #210 are kept but no longer hold or grant seats ---
const old = (id, u, eventId, status, dates, offerHours = null) => sqlite.prepare(
  `INSERT INTO waitlist_entries(id,event_id,option,dates,user_id,wrestler_id,wrestler_name,email,status,created_at,offered_at,offer_expires_at,offer_hours,auto_next,offered_by)
   VALUES (?,?,'full',?,?,?,?,?,?,?,?,?,?,0,?)`).run(id, eventId, JSON.stringify(dates), u, 'w-' + u, 'Wrestler ' + u, u + '@example.test', status, new Date().toISOString(),
  offerHours ? new Date().toISOString() : null, offerHours ? new Date(Date.now() + offerHours * 3600000).toISOString() : null, offerHours, offerHours ? 'owner-id' : null);
old('wl-camp', 'p3', 'camp', 'offered', [ny(10), ny(11)], 48);
old('wl-clinic-offer', 'p3', 'clinic', 'offered', [ny(14)], 48);
old('wl-clinic-wait', 'p2', 'clinic', 'waiting', [ny(14)]);
q = await quote('p3');
assert.equal(q.status, 409, 'an old seat offer does not let a family into a full camp'); assert.equal(q.error, 'This event is full.');
assert.equal(await capacity.seatsLeft('clinic', [ny(14)], 1), 1, 'an old unexpired offer no longer holds the seat');
q = await quote('p2', 'clinic');
assert.equal(q.ok, true, 'anyone can book the free seat'); assert.equal(q.charge.pricing.slots, 1, 'checkout still enforces the limit');
assert.equal(q.charge.pricing.waitlistOffer, undefined); assert.equal('offerExpiresAt' in q.review, false);

// A paid event (online, late or not) and a recorded payment leave the old rows exactly as they were.
const pend = (id, u, item, dates, cents) => sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,stripe_session_id)
  VALUES (?,?,'e',?,'W','event',?,'Clinic',?,?,0,?,'usd','{"slots":1}','{}','pending',?,0,?,?,?)`).run(id, u, 'w-' + u, item, JSON.stringify(dates), cents, cents, id, new Date().toISOString(), new Date().toISOString(), 'cs_' + id);
pend('x2', 'p2', 'clinic', [ny(14)], 5000);
assert.equal(await capacity.withinCapacity('x2', 'clinic', [ny(14)], 1), true, 'the old offer to p3 does not outrank p2');
const r = await webhook.applyStripeEvent({id: 'evt_w', type: 'checkout.session.completed', data: {object: {id: 'cs_x2', client_reference_id: 'x2', payment_status: 'paid', livemode: false, amount_total: 5000, currency: 'usd'}}});
assert.equal(r.outcome, 'paid');
assert.equal(sqlite.prepare("SELECT status FROM orders WHERE id='x2'").get().status, 'paid');
assert.equal((await quote('p3', 'clinic')).error, 'This event is full.');
const rows = sqlite.prepare('SELECT id,status FROM waitlist_entries ORDER BY id').all().map(x => [x.id, x.status]);
assert.deepEqual(rows, [['wl-camp', 'offered'], ['wl-clinic-offer', 'offered'], ['wl-clinic-wait', 'waiting']], 'old rows are untouched, never deleted');

// They stay in backups and in the family's own data download.
assert.ok(backups.RECORD_TABLES.waitlist_entries, 'backups still copy waitlist_entries');
assert.match(readFileSync('lib/data-requests.ts', 'utf8'), /waitlists: await all\('SELECT [^']*FROM waitlist_entries WHERE user_id=\?'/);

console.log('Passed: no waitlists (#210): pages, APIs and notices removed; a full event is full; old waitlist rows kept, untouched and backed up, and old offers hold no seat.');
