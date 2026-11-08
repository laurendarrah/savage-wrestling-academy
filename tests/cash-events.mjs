// #273: camps, clinics and events can be paid cash at the academy, like walk-ins and extra practices. Server rules: the
// price comes from lib/quotes.ts (member price for camps, never the browser), an unpaid booking holds a seat on every day
// it covers and puts the wrestler on each day's roster, Cash received is the owner's (camps are not a coach's session) and
// writes one paid order with every day, the owner's Cash due list has the booking, and a family that cancels is told in
// their Messages, as is a family whose booking the owner cancels.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import {makeDb} from './fixtures/d1.mjs';

const {sqlite, DB} = makeDb();
const env = {DB, CHECKOUT_KINDS: '', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_test', STRIPE_CONFIG_ENCRYPTION_KEY: '9a'.repeat(32)};
let actor = {kind: 'owner', id: 'owner-id'};
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array, Intl, Date, URL, URLSearchParams, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, Promise, console, setTimeout,
      fetch: async () => { throw Error('no network in tests'); },
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test', OWNER_EMAIL: 'owner@example.test',
          ownerIdentity: async () => ({owner: actor.kind === 'owner' ? {userId: actor.id} : null, headers: new Headers()}),
          strongAccount: async () => ({user: {id: actor.id, email: actor.id + '@example.test', email_confirmed_at: 'y', factors: []}, strong: true, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/access-control')) return {accountRole: async () => actor.kind === 'coach'
          ? {role: 'coach', staff: {email: 'dana@example.test', name: 'Coach Dana', programs: actor.programs ?? ['Intermediate']}} : {role: actor.kind === 'owner' ? 'owner' : 'family', staff: null}};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.endsWith('/stripe-test')) return {storedStripeKeyFor: async () => 'sk_test_x', stripeClientFor: () => ({checkout: {sessions: {create: async () => { throw Error('stripe is not reached'); }, expire: async () => ({})}}}), stripeMode: () => 'test'};
        if (name.endsWith('/usaw-check')) return {checkCard: async () => ({outcome: 'unavailable', reason: 'not in tests'})};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}

const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0), d1 = ny(10), d2 = ny(11), d3 = ny(12), d4 = ny(13);
const state = {programNamingVersion: 2,
  programs: [{id: 'Elementary', name: 'SWA Development', priceCents: 20000, walkInPriceCents: 3500}, {id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}],
  seasons: [],
  // A two-day camp with two seats and a time on its first day, a one-seat clinic, and a camp with single days and no limit.
  events: [{id: 'camp', name: 'Winter camp', type: 'Camp', dates: [d1, d2], schedule: [{date: d1, start: '09:00', end: '12:00'}], price: 160, day: 90, slots: 2},
    {id: 'clinic', name: 'Spring clinic', type: 'Clinic', dates: [d3], price: 60, slots: 1},
    {id: 'open', name: 'Open camp', type: 'Camp', dates: [d4, ny(14)], price: 100, day: 55}],
  extraPractices: []};
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify(state));
const card = {usawNumber: 'TEST-1234', usawExpires: '2099-12-31'};
const families = {p1: [{id: 'w1', name: 'Jo One', grade: '8', ...card}], p2: [{id: 'w2', name: 'Kim Two', grade: '3', ...card}], p3: [{id: 'w3', name: 'Lee Three', grade: '9'}], p4: [{id: 'w4', name: 'Max Four', grade: '10', ...card}]};
for (const [u, wrestlers] of Object.entries(families))
  sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test', JSON.stringify({parentName: 'Parent ' + u, phone: '555-01' + u.slice(1), wrestlers}), 1, 'x');
for (const [u, w] of [['p1', 'w1'], ['p2', 'w2'], ['p4', 'w4']]) sqlite.prepare("INSERT INTO usaw_reviews VALUES (?,?,?,?,?,?,?,?)").run(u, w, 'TEST-1234', '2099-12-31', 'valid', '', 'owner-id', 'x');
// p4 is a member, so camps are 10% off.
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
  VALUES ('member4','p4','p4@example.test','w4','Max Four','monthly','Intermediate','Intermediate','Membership','[]',20000,0,20000,'usd','{}','{}','paid','m4',0,'x','x',?,?,?,'stripe')`).run(ny(-5) + 'T12:00:00Z', ny(-5), ny(300));

const cashApi = load('app/api/cash-bookings/route.ts'), payApi = load('app/api/payments/route.ts'), reviewApi = load('app/api/booking-review/route.ts'), checkoutApi = load('app/api/checkout/route.ts');
const cash = load('lib/cash-bookings.ts'), roster = load('lib/roster.ts'), messages = load('lib/messages.ts'), view = load('lib/wrestler-view.ts'), capacity = load('lib/capacity.ts');
const O = 'https://swa.test';
const send = async (route, url, body) => { const r = await route.POST(new Request(O + url, {method: 'POST', headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const as = a => { actor = a; };
const fam = id => as({kind: 'family', id});
const book = (wrestlerId, id, option, extra = {}) => ({action: 'book', source: 'booking', type: 'event', id, wrestlerId, ...(option ? {option} : {}), ...extra});
const row = id => sqlite.prepare('SELECT * FROM cash_bookings WHERE id=?').get(id);
const notices = (u, kind) => sqlite.prepare('SELECT * FROM notifications WHERE user_id=? AND kind=? ORDER BY created_at').all(u, kind);
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const ownerScope = {role: 'owner'};
const entries = async (date, key, scope = ownerScope) => (await roster.rosterFor(date, scope)).find(s => s.key === key)?.entries ?? [];

assert.ok(cash.CASH_KINDS.includes('event'), 'events are a cash kind');

// ---------- The full camp: every day, the first day's time, the full price for a non-member ----------
fam('p1');
let r = await send(reviewApi, '/api/booking-review', {type: 'event', id: 'camp', wrestlerId: 'w1'});
assert.equal(r.status, 200); assert.equal(r.body.cashEnabled, true, 'the review offers cash for an event'); assert.equal(r.body.paymentsEnabled, false);
assert.match(r.body.review.message, /You can book now and pay cash at the academy/); assert.doesNotMatch(r.body.review.message, /pay the academy; your spot is confirmed once/);
assert.equal(r.body.review.seatsLeft, 2);
r = await send(cashApi, '/api/cash-bookings', book('w1', 'camp', undefined, {amountCents: 1}));
assert.equal(r.status, 200, JSON.stringify(r.body));
const b1 = r.body.booking;
assert.equal(b1.kind, 'event'); assert.equal(b1.amountCents, 16000, 'the full price, from quotes.ts'); assert.equal(b1.label, 'Pay at the academy: $160.00 due');
same(b1.dates, [d1, d2], 'a full camp covers both days'); assert.equal(b1.date, d1); assert.equal(b1.start, '09:00'); assert.equal(b1.end, '12:00');
assert.equal(b1.cancellable, true); assert.equal(b1.cancelBlocked, null);
assert.equal(row(b1.id).item_label, 'Winter camp'); same(JSON.parse(row(b1.id).dates), [d1, d2]); assert.equal(row(b1.id).dedupe_key, 'p1|w1|event|camp|full', 'the same dedupe key online checkout uses');
assert.equal(sqlite.prepare("SELECT count(*) n FROM orders WHERE user_id='p1'").get().n, 0, 'a booking is not a payment');
assert.match(notices('p1', 'cash_booking')[0].body, /Winter camp[\s\S]*\$160\.00 due, in cash at the academy on the first day/, 'the confirmation says where to pay');
assert.equal((await send(cashApi, '/api/cash-bookings', book('w1', 'camp'))).status, 409, 'one open booking per wrestler and camp');

// ---------- A member pays the member price; the seat limit counts unpaid cash bookings ----------
fam('p4');
r = await send(cashApi, '/api/cash-bookings', book('w4', 'camp'));
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.booking.amountCents, 14400, '10% member discount on a camp'); assert.equal(row(r.body.booking.id).discount_cents, 1600); assert.equal(row(r.body.booking.id).base_cents, 16000);
const b4 = r.body.booking.id;
same([...(await capacity.seatHolders('camp', [d1, d2])).get(d1)], [b1.id, b4], 'both unpaid bookings hold a seat, oldest first');
fam('p2');
r = await send(reviewApi, '/api/booking-review', {type: 'event', id: 'camp', wrestlerId: 'w2'});
assert.equal(r.status, 409); assert.equal(r.body.error, 'This event is full.', 'two unpaid cash bookings fill a two-seat camp');
assert.equal((await send(cashApi, '/api/cash-bookings', book('w2', 'camp'))).status, 409, 'and refuse a third cash booking');
assert.equal((await send(cashApi, '/api/cash-bookings', book('w2', 'camp', d2))).status, 409, 'a single day of the full camp is taken too');
// Online checkout for a seat held by cash is refused as well.
env.CHECKOUT_KINDS = 'event';
fam('p1');
r = await send(checkoutApi, '/api/checkout', {source: 'booking', type: 'event', id: 'camp', wrestlerId: 'w1', acceptTerms: true});
assert.equal(r.status, 409); assert.match(r.body.error, /This event is full|already booked to pay cash at the academy/, 'no online payment beside a cash booking');
env.CHECKOUT_KINDS = '';

// ---------- Rosters: on every camp day, as "Pay at the academy", with the amount due ----------
let e = (await entries(d1, `event:camp:${d1}`)).find(x => x.name === 'Jo One');
assert.ok(e, 'the first camp day lists the cash booking'); same(e.sources, ['Pay at the academy']); assert.equal(e.cash.status, 'due'); assert.equal(e.cash.cents, 16000); assert.equal(e.cash.bookingId, b1.id);
e = (await entries(d2, `event:camp:${d2}`)).find(x => x.name === 'Max Four');
assert.ok(e, 'the second camp day lists it too'); assert.equal(e.cash.cents, 14400);
assert.equal((await entries(d1, `event:camp:${d1}`, {role: 'coach', programs: ['Intermediate']})).length, 0, 'camps stay with the owner');
// The wrestler view shows what is due on each day.
const up = await view.upcomingFor('p1', 'w1', today);
same(up.filter(x => x.type === 'event').map(x => [x.date, x.why, x.dueCents]), [[d1, 'Pay at the academy', 16000], [d2, 'Pay at the academy', 16000]]);
// The wrestler view page reads the same way, in its own batch (#277), so a due booking never breaks the page.
const page = await view.wrestlerView('p1', 'w1');
assert.ok(page, 'the wrestler view loads with a cash booking due');
same(page.upcoming.filter(x => x.type === 'event').map(x => [x.date, x.dueCents]), [[d1, 16000], [d2, 16000]]);

// ---------- The family cancels before it starts: told in Messages; the seat frees up ----------
r = await send(cashApi, '/api/cash-bookings', {action: 'cancel', id: b1.id});
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(row(b1.id).status, 'canceled'); assert.equal(row(b1.id).cancel_reason, 'Canceled by the family');
const canceled = notices('p1', 'cash_booking_canceled');
assert.equal(canceled.length, 1, 'the family gets a "Booking canceled" notice when they cancel');
assert.equal(canceled[0].subject, 'Booking canceled: Winter camp'); assert.match(canceled[0].body, /You canceled Jo One's booking[\s\S]*Nothing was charged and nothing is owed/);
assert.ok((await messages.familyInbox('p1')).notices.some(n => n.subject === 'Booking canceled: Winter camp'), 'and it is in the family inbox');
fam('p2');
r = await send(cashApi, '/api/cash-bookings', book('w2', 'camp'));
assert.equal(r.status, 200, 'the freed seat can be booked: ' + JSON.stringify(r.body));
const b2 = r.body.booking.id;

// ---------- A single camp day; an event without a seat limit ----------
fam('p1');
r = await send(cashApi, '/api/cash-bookings', book('w1', 'open', d4));
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.booking.amountCents, 5500); same(r.body.booking.dates, [d4]); assert.match(r.body.booking.item, /^Open camp on /); assert.equal(r.body.booking.start, null, 'no time set yet');
assert.equal((await send(cashApi, '/api/cash-bookings', book('w1', 'open', ny(-1)))).status, 400, 'not a camp day');
assert.equal((await send(cashApi, '/api/cash-bookings', book('w1', 'nope'))).status, 409, 'unknown event');
fam('p3');
r = await send(cashApi, '/api/cash-bookings', book('w3', 'clinic'));
assert.equal(r.status, 403); assert.equal(r.body.usawRequired, true, 'the card rule applies to cash camps too');

// ---------- Cash received: the owner's; one paid order with every camp day; the seat stays taken ----------
as({kind: 'coach', id: 'coach-1'});
r = await send(load('app/api/roster/route.ts'), '/api/roster', {action: 'cash', date: d1, bookingId: b4});
assert.equal(r.status, 403, 'a coach cannot take camp cash');
as({kind: 'owner', id: 'owner-id'});
const due = await (await payApi.GET(new Request(O + '/api/payments?cash=due'))).json();
assert.equal(due.count, 3); assert.equal(due.dueCents, 14400 + 16000 + 5500);
assert.ok(due.bookings.some(b => b.id === b4 && b.item === 'Winter camp' && b.amountCents === 14400 && b.parent === 'Parent p4'), 'the owner’s Cash due list has the camp: ' + JSON.stringify(due.bookings));
r = await send(payApi, '/api/payments', {action: 'cash-received', bookingId: b4});
assert.equal(r.status, 200, JSON.stringify(r.body));
const order = sqlite.prepare("SELECT * FROM orders WHERE user_id='p4' AND kind='event'").get();
assert.ok(order); assert.equal(order.status, 'paid'); assert.equal(order.source, 'offline'); assert.equal(order.amount_cents, 14400); assert.equal(order.discount_cents, 1600);
same(JSON.parse(order.dates), [d1, d2], 'the paid order covers every camp day'); assert.equal(order.item_id, 'camp'); assert.equal(order.dedupe_key, 'p4|w4|event|camp|full');
assert.equal(JSON.parse(order.pricing).method, 'cash'); assert.equal(row(b4).status, 'paid'); assert.equal(row(b4).order_id, order.id);
same([...(await capacity.seatHolders('camp', [d1])).get(d1)].sort(), [order.id, b2].sort(), 'the paid order holds the seat now, the other cash booking still holds its own');
e = (await entries(d2, `event:camp:${d2}`)).find(x => x.name === 'Max Four');
same(e.sources, ['Registered']); assert.equal(e.cash.status, 'paid');
assert.equal((await send(payApi, '/api/payments', {action: 'cash-received', bookingId: b4})).status, 409, 'recorded once');
assert.ok(notices('p4', 'payment_recorded').length, 'the family gets a receipt');
fam('p1');
r = await send(reviewApi, '/api/booking-review', {type: 'event', id: 'camp', wrestlerId: 'w1'});
assert.equal(r.status, 409, 'the camp is still full: one paid, one due');

// ---------- The owner cancels an unpaid booking: the family is told ----------
as({kind: 'owner', id: 'owner-id'});
r = await send(payApi, '/api/payments', {action: 'cash-cancel', bookingId: b2, reason: 'The camp day moved'});
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(row(b2).status, 'canceled');
const told = notices('p2', 'cash_booking_canceled');
assert.equal(told.length, 1); assert.match(told[0].body, /The academy canceled Kim Two's booking for Winter camp[\s\S]*Note from the academy: The camp day moved/);
assert.ok((await messages.familyInbox('p2')).notices.some(n => n.subject === 'Booking canceled: Winter camp'));
fam('p1');
assert.equal((await send(reviewApi, '/api/booking-review', {type: 'event', id: 'camp', wrestlerId: 'w1'})).body.review.seatsLeft, 1, 'the canceled booking’s seat is free');

// ---------- Once it has started, a booking says why it can no longer be canceled ----------
const started = cash.cashView({...row(b2), status: 'due', session_date: today, start_time: '06:00', dates: JSON.stringify([today])}, today, 9 * 60);
assert.equal(started.cancellable, false); assert.equal(started.cancelBlocked, 'The camp or event has started, so this can no longer be canceled. Ask the academy if you need to change it.');
const walkin = cash.cashView({...row(b2), status: 'due', kind: 'walkin', session_date: today, start_time: '06:00', dates: '[]'}, today, 9 * 60);
assert.equal(walkin.cancelBlocked, 'The practice has started, so this can no longer be canceled. Ask the academy if you need to change it.'); same(walkin.dates, [today], 'an older row without dates reads its session date');
const ahead = cash.cashView({...row(b2), status: 'due', session_date: today, start_time: '18:00', dates: JSON.stringify([today])}, today, 9 * 60);
assert.equal(ahead.cancellable, true); assert.equal(ahead.cancelBlocked, null);
r = await send(cashApi, '/api/cash-bookings', {action: 'cancel', id: b2});
assert.equal(r.status, 404, 'another family’s booking cannot be canceled');

// ---------- A full event is full for cash bookings too, even when two families race for the last seat ----------
fam('p2');
r = await send(cashApi, '/api/cash-bookings', book('w2', 'clinic'));
assert.equal(r.status, 200, JSON.stringify(r.body));
fam('p4');
r = await send(cashApi, '/api/cash-bookings', book('w4', 'clinic'));
assert.equal(r.status, 409); assert.equal(r.body.error, 'This event is full.');
// The rank check after writing: a booking written when the quote still saw a seat is removed, not kept.
const late = await cash.bookCash({id: 'p4', email: 'p4@example.test'}, book('w4', 'clinic'));
assert.equal(late.status, 409);
assert.equal(sqlite.prepare("SELECT count(*) n FROM cash_bookings WHERE item_id='clinic' AND status='due'").get().n, 1, 'one booking for the one-seat clinic');

console.log('Passed: camps, clinics and events can be booked to pay cash at the academy at the server’s price (member price for camps), an unpaid booking holds its seats and shows on each day’s roster, Cash received is the owner’s and writes one paid order with every day, the Cash due list has it, and a canceled booking tells the family in Messages.');
