// Issue #248: families can book a walk-in, Friday Night Live or another extra practice and pay cash at the academy.
// Server rules: the amount comes from lib/quotes.ts (never the browser), every booking check still applies, one booking per
// wrestler, session and date, Cash received is recorded once as an offline payment (coach: own programs, today; owner:
// any), voiding it puts the booking back to due, and Payments, the spreadsheet and the books count it exactly once.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import {makeDb} from './fixtures/d1.mjs';

const {sqlite, DB} = makeDb();
const env = {DB, CHECKOUT_KINDS: '', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_test'};
// owner, a coach (Coach Dana, SWA Intermediate unless changed) or a family (id).
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
        if (name.endsWith('/stripe-test')) return {storedStripeKeyFor: async () => null, stripeClientFor: () => null, stripeMode: () => 'test'};
        if (name.endsWith('/usaw-check')) return {checkCard: async () => ({outcome: 'unavailable', reason: 'not in tests'})};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}

const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0), tomorrow = ny(1);
const all = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
const state = {programNamingVersion: 2,
  programs: [{id: 'Elementary', name: 'SWA Development', priceCents: 20000, walkInPriceCents: 3500}, {id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}, {id: 'Advanced', name: 'SWA Advance', priceCents: 20000, walkInPriceCents: 4000}],
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(60), weekly: all, excludedDates: [ny(4)]}, {program: 'Elementary', start: ny(-30), end: ny(60), weekly: all, excludedDates: []}],
  events: [{id: 'camp', name: 'Camp', type: 'Camp', dates: [ny(10)], price: 160}],
  extraPractices: [{id: 'fnl', name: 'Friday Night Live', dates: [today, tomorrow, ny(2)], enabled: true, start: '17:00', end: '18:00', memberCents: 1000, nonMemberCents: 2000}]};
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify(state));
const card = {usawNumber: 'TEST-1234', usawExpires: '2099-12-31'};
const families = {p1: [{id: 'w1', name: 'Jo One', grade: '8', ...card}], p2: [{id: 'w2', name: 'Kim Two', grade: '3', ...card}], p3: [{id: 'w3', name: 'Lee Three', grade: '9'}], p4: [{id: 'w4', name: 'Max Four', grade: '10', ...card}]};
for (const [u, wrestlers] of Object.entries(families))
  sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test', JSON.stringify({parentName: 'Parent ' + u, phone: '555-01' + u.slice(1), wrestlers}), 1, 'x');
// Verified cards, so check-in is allowed (#210).
for (const [u, w] of [['p1', 'w1'], ['p2', 'w2'], ['p4', 'w4']]) sqlite.prepare("INSERT INTO usaw_reviews VALUES (?,?,?,?,?,?,?,?)").run(u, w, 'TEST-1234', '2099-12-31', 'valid', '', 'owner-id', 'x');
// p4 is a member, so Friday Night Live is at the member price.
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
  VALUES ('member4','p4','p4@example.test','w4','Max Four','monthly','Intermediate','Intermediate','Membership','[]',20000,0,20000,'usd','{}','{}','paid','m4',0,'x','x',?,?,?,'stripe')`).run(ny(-5) + 'T12:00:00Z', ny(-5), ny(300));

const cashApi = load('app/api/cash-bookings/route.ts'), payApi = load('app/api/payments/route.ts'), rosterApi = load('app/api/roster/route.ts'), checkoutApi = load('app/api/checkout/route.ts');
const cash = load('lib/cash-bookings.ts'), roster = load('lib/roster.ts'), financials = load('lib/financials.ts'), view = load('lib/wrestler-view.ts');
const O = 'https://swa.test';
const send = async (route, url, body) => { const r = await route.POST(new Request(O + url, {method: 'POST', headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const getJson = async (route, url) => { const r = await route.GET(new Request(O + url)); const t = await r.text(); try { return {status: r.status, body: JSON.parse(t)}; } catch { return {status: r.status, body: t}; } };
const as = a => { actor = a; };
const fam = id => as({kind: 'family', id});
const walk = (date = today, extra = {}) => ({action: 'book', source: 'membership', plan: 'walkin', wrestlerId: 'w1', program: 'Intermediate', date, practiceId: `Intermediate:${date}:18:00`, ...extra});
const row = id => sqlite.prepare('SELECT * FROM cash_bookings WHERE id=?').get(id);
const ownerScope = {role: 'owner'};
// Values made inside the VM are compared by their JSON (arrays from another realm are never deepEqual).
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const entry = async (date, prefix, name, scope = ownerScope) => (await roster.rosterFor(date, scope)).find(s => s.key.startsWith(prefix))?.entries.find(e => e.name === name);

// ---------- Booking: amount from quotes.ts, never from the browser ----------
fam('p1');
let r = await send(cashApi, '/api/cash-bookings', walk(today, {amountCents: 1, cents: 1, price: 1, baseCents: 1, teamCode: 'NOPE'}));
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.booking.amountCents, 4000, 'the walk-in price from quotes.ts, not the browser');
assert.equal(r.body.booking.label, 'Pay at the academy: $40.00 due');
const b1 = r.body.booking.id;
assert.equal(row(b1).status, 'due'); assert.equal(row(b1).amount_cents, 4000); assert.equal(row(b1).start_time, '18:00');
assert.equal(row(b1).dedupe_key, `p1|w1|walkin|Intermediate|${today}`, 'the same dedupe key online checkout uses');
assert.equal(sqlite.prepare("SELECT count(*) n FROM orders WHERE user_id='p1'").get().n, 0, 'booking is not a payment');
assert.ok(sqlite.prepare("SELECT 1 FROM notifications WHERE kind='cash_booking' AND user_id='p1' AND body LIKE '%Pay at the academy: $40.00 due%'").get(), 'the family gets a confirmation');

// ---------- No duplicates; every booking check still applies ----------
r = await send(cashApi, '/api/cash-bookings', walk());
assert.equal(r.status, 409); assert.match(r.body.error, /already booked for this to pay at the academy/);
assert.equal(sqlite.prepare("SELECT count(*) n FROM cash_bookings WHERE dedupe_key=?").get(`p1|w1|walkin|Intermediate|${today}`).n, 1);
assert.equal((await send(cashApi, '/api/cash-bookings', walk(ny(-1)))).status, 400, 'no past practice');
assert.equal((await send(cashApi, '/api/cash-bookings', walk(ny(4)))).status, 409, 'an excluded date has no practice');
assert.equal((await send(cashApi, '/api/cash-bookings', walk(tomorrow, {practiceId: `Intermediate:${tomorrow}:06:00`}))).status, 409, 'practice must exist');
r = await send(cashApi, '/api/cash-bookings', walk(tomorrow, {program: 'Advanced', practiceId: `Advanced:${tomorrow}:18:00`}));
assert.equal(r.status, 403, 'SWA Advance needs coach approval'); assert.equal(r.body.approvalRequired, true);
fam('p2');
assert.equal((await send(cashApi, '/api/cash-bookings', walk(tomorrow, {wrestlerId: 'w2'}))).status, 403, 'grade 3 is not SWA Intermediate');
fam('p3');
r = await send(cashApi, '/api/cash-bookings', walk(tomorrow, {wrestlerId: 'w3'}));
assert.equal(r.status, 403); assert.equal(r.body.usawRequired, true, 'USA Wrestling card required');
fam('p1');
assert.equal((await send(cashApi, '/api/cash-bookings', walk(tomorrow, {wrestlerId: 'w2'}))).status, 404, 'only the family’s own wrestlers');
sqlite.prepare("INSERT INTO waiver_versions(id,title,body,sha256,published_at,published_by,retired_at,kind) VALUES ('pc1','Parent Consent Form','Text','" + 'a'.repeat(64) + "','x','owner',NULL,'parent_consent')").run();
r = await send(cashApi, '/api/cash-bookings', walk(tomorrow));
assert.equal(r.status, 403); assert.match(r.body.error, /Parent Consent Form/); assert.equal(r.body.waiverRequired, true, 'the Parent Consent Form, once published');
sqlite.prepare("UPDATE waiver_versions SET retired_at='y' WHERE id='pc1'").run();
assert.equal((await send(cashApi, '/api/cash-bookings', {...walk(tomorrow), plan: 'monthly'})).status, 400, 'memberships are not paid this way');
assert.equal((await send(cashApi, '/api/cash-bookings', {action: 'book', source: 'booking', type: 'lesson', format: 'one-on-one', wrestlerId: 'w1'})).status, 400, 'lessons are not paid this way (camps are, since #273: tests/cash-events.mjs)');
assert.equal((await send(cashApi, '/api/cash-bookings', walk(tomorrow), )).status, 200, 'tomorrow is fine');
const b1t = sqlite.prepare("SELECT id FROM cash_bookings WHERE user_id='p1' AND session_date=? AND kind='walkin'").get(tomorrow).id;

// ---------- Online checkout and cash are one or the other ----------
env.CHECKOUT_KINDS = 'walkin';
r = await send(checkoutApi, '/api/checkout', {...walk(), source: 'membership', acceptTerms: true});
assert.equal(r.status, 409); assert.match(r.body.error, /already booked to pay cash at the academy/);
env.CHECKOUT_KINDS = '';
const paidOrder = (id, key, kind = 'walkin', item = `Intermediate:${ny(2)}:18:00`, date = ny(2), status = 'paid') => sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source)
  VALUES (?,'p1','p1@example.test','w1','Jo One',?,'Intermediate',?,'x',?,4000,0,4000,'usd','{}','{}',?,?,0,'x','x',?,'stripe')`).run(id, kind, item, JSON.stringify([date]), status, key, status === 'paid' ? today + 'T12:00:00Z' : null);
paidOrder('online-ny2', `p1|w1|walkin|Intermediate|${ny(2)}`);
r = await send(cashApi, '/api/cash-bookings', walk(ny(2)));
assert.equal(r.status, 409, 'already paid online'); assert.match(r.body.error, /already paid/);
paidOrder('pending-ny3', `p1|w1|walkin|Intermediate|${ny(3)}`, 'walkin', `Intermediate:${ny(3)}:18:00`, ny(3), 'pending');
assert.equal((await send(cashApi, '/api/cash-bookings', walk(ny(3)))).status, 409, 'an online payment was started');

// ---------- Roster: shown with the amount due; check-in is allowed before paying ----------
let e = await entry(today, 'practice:Intermediate:', 'Jo One');
assert.ok(e, 'a cash booking is on the roster');
same(e.sources, ['Pay at the academy']);
assert.equal(e.cash.status, 'due'); assert.equal(e.cash.cents, 4000); assert.equal(e.cash.bookingId, b1);
assert.equal(e.checkInBlocked, null);
as({kind: 'coach', id: 'coach-1'});
r = await send(rosterApi, '/api/roster', {action: 'checkin', date: today, sessionKey: `practice:Intermediate:${today}:18:00`, userId: 'p1', wrestlerId: 'w1'});
assert.equal(r.status, 200, 'an unpaid cash booking can be checked in');
e = r.body.sessions.find(s => s.key.startsWith('practice:Intermediate:')).entries.find(x => x.name === 'Jo One');
assert.ok(e.checkedInAt); assert.equal(e.cash.status, 'due', 'the amount due stays visible after check-in');

// ---------- Cash received: coaches for their own programs, today ----------
as({kind: 'coach', id: 'coach-2', programs: ['Elementary']});
r = await send(rosterApi, '/api/roster', {action: 'cash', date: today, bookingId: b1});
assert.equal(r.status, 403, 'not a practice in their programs');
as({kind: 'coach', id: 'coach-1'});
assert.equal((await send(rosterApi, '/api/roster', {action: 'cash', date: tomorrow, bookingId: b1t})).status, 403, 'coaches: today only');
assert.equal((await cash.receiveCash(b1t, {id: 'coach-1', name: 'Coach Dana', email: 'dana@example.test'}, {role: 'coach', programs: ['Intermediate']})).status, 403, 'also refused in the library');
r = await send(rosterApi, '/api/roster', {action: 'cash', date: today, bookingId: b1});
assert.equal(r.status, 200, JSON.stringify(r.body));
const o1 = r.body.orderId;
let order = sqlite.prepare('SELECT * FROM orders WHERE id=?').get(o1), pricing = JSON.parse(order.pricing);
assert.equal(order.status, 'paid'); assert.equal(order.source, 'offline'); assert.equal(order.kind, 'walkin'); assert.equal(order.amount_cents, 4000);
assert.equal(order.item_id, `Intermediate:${today}:18:00`); same(JSON.parse(order.dates), [today]); assert.equal(order.dedupe_key, row(b1).dedupe_key);
assert.equal(pricing.method, 'cash'); assert.equal(pricing.collectedBy, 'Coach Dana'); assert.equal(pricing.recordedBy, 'coach-1'); assert.equal(pricing.cashBookingId, b1); assert.ok(pricing.collectedAt);
assert.equal(row(b1).status, 'paid'); assert.equal(row(b1).order_id, o1);
const ev = sqlite.prepare("SELECT * FROM security_events WHERE action='cash_received'").all();
assert.equal(ev.length, 1); assert.equal(ev[0].actor, 'coach-1'); assert.equal(ev[0].target, `${o1} walkin 4000`);
assert.ok(sqlite.prepare("SELECT 1 FROM notifications WHERE kind='payment_recorded' AND user_id='p1'").get(), 'the family gets a receipt');
e = r.body.sessions.find(s => s.key.startsWith('practice:Intermediate:')).entries.find(x => x.name === 'Jo One');
same(e.sources, ['Walk-in paid']); assert.equal(e.cash.status, 'paid'); assert.equal(e.cash.collectedBy, 'Coach Dana'); assert.ok(e.cash.collectedAt);
// Recorded once: a second tap, another device, or the owner on Payments.
assert.equal((await send(rosterApi, '/api/roster', {action: 'cash', date: today, bookingId: b1})).status, 409);
as({kind: 'owner', id: 'owner-id'});
assert.equal((await send(payApi, '/api/payments', {action: 'cash-received', bookingId: b1})).status, 409);
assert.equal((await send(payApi, '/api/payments', {action: 'record', userId: 'p1', wrestlerId: 'w1', kind: 'walkin', program: 'Intermediate', date: today, practiceId: `Intermediate:${today}:18:00`, method: 'cash'})).status, 409, 'no second offline payment');
assert.equal(sqlite.prepare("SELECT count(*) n FROM orders WHERE dedupe_key=? AND status='paid'").get(row(b1).dedupe_key).n, 1);
// A cash booking can't be made again for a session it already paid for.
fam('p1');
assert.equal((await send(cashApi, '/api/cash-bookings', walk())).status, 409);

// ---------- Counts as paid everywhere, once: Payments, its spreadsheet, the books ----------
as({kind: 'owner', id: 'owner-id'});
let list = (await getJson(payApi, '/api/payments?kind=walkin&source=offline')).body;
assert.equal(list.totals.offlineCents, 4000); assert.equal(list.totals.count, 1); assert.equal(list.payments[0].method, 'cash'); assert.equal(list.payments[0].wrestler, 'Jo One');
const csv = (await getJson(payApi, '/api/payments?format=csv&source=offline')).body;
assert.equal(csv.split('\r\n').filter(l => l.includes('Jo One') && l.includes(',cash,Coach Dana,walkin,')).length, 1, 'one spreadsheet line, with who collected it');
let ledger = (await financials.ledgerLines(ny(-1), ny(1))).filter(l => l.source === 'offline' && l.type === 'income');
assert.equal(ledger.length, 1); assert.equal(ledger[0].amountCents, 4000); assert.equal(ledger[0].category, 'Walk-ins'); assert.equal(ledger[0].method, 'Cash');

// ---------- Undo: voiding the payment (owner only) puts the booking back to due ----------
as({kind: 'coach', id: 'coach-1'});
assert.equal((await send(rosterApi, '/api/roster', {action: 'cash-undo', date: today, orderId: o1})).status, 403, 'coaches cannot undo');
as({kind: 'owner', id: 'owner-id'});
r = await send(rosterApi, '/api/roster', {action: 'cash-undo', date: today, orderId: o1, reason: 'Wrong wrestler'});
assert.equal(r.status, 200);
assert.equal(sqlite.prepare('SELECT status FROM orders WHERE id=?').get(o1).status, 'canceled');
assert.equal(row(b1).status, 'due'); assert.equal(row(b1).order_id, null);
assert.equal(r.body.sessions.find(s => s.key.startsWith('practice:Intermediate:')).entries.find(x => x.name === 'Jo One').cash.status, 'due', '$40 due again');
list = (await getJson(payApi, '/api/payments?kind=walkin&source=offline&status=paid')).body;
assert.equal(list.totals.offlineCents, 0, 'a voided cash payment is not collected');
assert.equal((await financials.ledgerLines(ny(-1), ny(1))).filter(l => l.source === 'offline').length, 0, 'nor income');
r = await send(payApi, '/api/payments', {action: 'cash-received', bookingId: b1});
assert.equal(r.status, 200, 'recorded again after the void');
const o1b = r.body.orderId;
assert.equal(JSON.parse(sqlite.prepare('SELECT pricing FROM orders WHERE id=?').get(o1b).pricing).collectedBy, 'Owner');
assert.equal((await getJson(payApi, '/api/payments?kind=walkin&source=offline&status=paid')).body.totals.offlineCents, 4000);
assert.equal((await send(payApi, '/api/payments', {action: 'void', orderId: o1b, reason: 'Again'})).status, 200, 'the Payments page void works too');
assert.equal(row(b1).status, 'due');

// ---------- Friday Night Live: member or non-member price from quotes.ts ----------
fam('p1');
const fnl = (date, w = 'w1') => ({action: 'book', source: 'booking', type: 'live', id: 'fnl', date, wrestlerId: w, cents: 0});
r = await send(cashApi, '/api/cash-bookings', fnl(tomorrow));
assert.equal(r.status, 200); assert.equal(r.body.booking.amountCents, 2000, 'non-member price'); assert.equal(r.body.booking.label, 'Pay at the academy: $20.00 due');
const bLive = r.body.booking.id;
assert.equal(row(bLive).kind, 'live'); assert.equal(row(bLive).item_id, 'fnl'); assert.equal(row(bLive).dedupe_key, `p1|w1|live|fnl|${tomorrow}`);
assert.equal((await send(cashApi, '/api/cash-bookings', fnl(tomorrow))).status, 409, 'no duplicate');
assert.equal((await send(cashApi, '/api/cash-bookings', {...fnl(tomorrow), id: 'nope'})).status, 409);
fam('p4');
r = await send(cashApi, '/api/cash-bookings', fnl(tomorrow, 'w4'));
assert.equal(r.status, 200); assert.equal(r.body.booking.amountCents, 1000, 'member price');
assert.equal(row(r.body.booking.id).base_cents, 2000); assert.equal(row(r.body.booking.id).discount_cents, 1000);
const bLive4 = r.body.booking.id;
const review = await send(load('app/api/booking-review/route.ts'), '/api/booking-review', {type: 'live', id: 'fnl', date: ny(2), wrestlerId: 'w4'});
assert.equal(review.body.cashEnabled, true); assert.equal(review.body.paymentsEnabled, false); assert.match(review.body.review.message, /pay cash at the academy/);
fam('p1');
const reg = await send(load('app/api/registration/route.ts'), '/api/registration', {wrestlerId: 'w1', program: 'Intermediate', plan: 'walkin', date: ny(5), practiceId: `Intermediate:${ny(5)}:18:00`});
assert.equal(reg.body.cashEnabled, true, 'walk-ins offer cash');
assert.equal((await send(load('app/api/registration/route.ts'), '/api/registration', {wrestlerId: 'w1', program: 'Intermediate', plan: 'monthly'})).body.cashEnabled, false, 'memberships do not');
// The roster for that evening (the owner; coaches see program practices only).
e = await entry(tomorrow, 'live:fnl:', 'Jo One');
assert.equal(e.cash.status, 'due'); assert.equal(e.cash.cents, 2000); same(e.sources, ['Pay at the academy']);
assert.equal((await cash.receiveCash(bLive, {id: 'coach-1', name: 'Coach Dana', email: 'dana@example.test'}, {role: 'coach', programs: ['Intermediate']})).status, 403, 'coaches: extra practices on the day only (issue #250)');
as({kind: 'owner', id: 'owner-id'});
r = await send(rosterApi, '/api/roster', {action: 'cash', date: tomorrow, bookingId: bLive4});
assert.equal(r.status, 200, 'the owner records Friday Night Live cash at check-in');
assert.equal(sqlite.prepare('SELECT amount_cents FROM orders WHERE id=?').get(r.body.orderId).amount_cents, 1000);
assert.equal((await entry(tomorrow, 'live:fnl:', 'Max Four')).sources.join(), 'Paid');
assert.equal((await financials.ledgerLines(ny(-1), ny(2))).find(l => l.source === 'offline').category, 'Friday Night Live');

// ---------- The owner's list of unpaid bookings; cancelling frees the booking and tells the family ----------
r = await getJson(payApi, '/api/payments?cash=due');
assert.equal(r.status, 200);
same(r.body.bookings.map(b => [b.wrestler, b.date, b.amountCents]), [['Jo One', today, 4000], ['Jo One', tomorrow, 2000], ['Jo One', tomorrow, 4000]]);
assert.equal(r.body.count, 3); assert.equal(r.body.dueCents, 10000); assert.equal(r.body.bookings[0].parent, 'Parent p1'); assert.equal(r.body.bookings[0].phone, '555-011');
fam('p1');
assert.equal((await getJson(payApi, '/api/payments?cash=due')).status, 403, 'owner only');
assert.equal((await send(payApi, '/api/payments', {action: 'cash-cancel', bookingId: b1t})).status, 403);
as({kind: 'owner', id: 'owner-id'});
r = await send(payApi, '/api/payments', {action: 'cash-cancel', bookingId: b1t, reason: 'Practice moved'});
assert.equal(r.status, 200);
assert.equal(row(b1t).status, 'canceled'); assert.equal(row(b1t).canceled_by, 'owner-id'); assert.equal(row(b1t).cancel_reason, 'Practice moved');
const notice = sqlite.prepare("SELECT * FROM notifications WHERE kind='cash_booking_canceled' AND user_id='p1'").get();
assert.match(notice.body, /Nothing was charged and nothing is owed\. Note from the academy: Practice moved/);
assert.ok(sqlite.prepare("SELECT 1 FROM security_events WHERE action='cash_booking_canceled' AND target=?").get(b1t));
assert.equal(await entry(tomorrow, 'practice:Intermediate:', 'Jo One'), undefined, 'off the roster');
assert.equal(sqlite.prepare("SELECT count(*) n FROM orders WHERE user_id='p1' AND status='paid' AND source='offline'").get().n, 0, 'nothing charged');
assert.equal((await send(payApi, '/api/payments', {action: 'cash-cancel', bookingId: b1t})).status, 409, 'already canceled');

// ---------- Family cancels before the practice ----------
assert.equal(cash.beforeStart({session_date: tomorrow, start_time: '18:00'}, today, 23 * 60), true);
assert.equal(cash.beforeStart({session_date: today, start_time: '18:00'}, today, 17 * 60 + 59), true);
assert.equal(cash.beforeStart({session_date: today, start_time: '18:00'}, today, 18 * 60), false, 'not once it starts');
assert.equal(cash.beforeStart({session_date: ny(-1), start_time: '18:00'}, today, 0), false);
fam('p1');
r = await getJson(cashApi, '/api/cash-bookings');
assert.equal(r.body.bookings.find(b => b.id === bLive).cancellable, true);
fam('p4');
assert.equal((await send(cashApi, '/api/cash-bookings', {action: 'cancel', id: bLive})).status, 404, 'another family’s booking');
assert.equal((await send(cashApi, '/api/cash-bookings', {action: 'cancel', id: bLive4})).status, 409, 'already paid');
fam('p1');
r = await send(cashApi, '/api/cash-bookings', {action: 'cancel', id: bLive});
assert.equal(r.status, 200); assert.equal(row(bLive).status, 'canceled'); assert.equal(row(bLive).canceled_by, 'p1');
assert.ok(!r.body.bookings.some(b => b.id === bLive));
assert.equal((await send(cashApi, '/api/cash-bookings', fnl(tomorrow))).status, 200, 'can book again after cancelling');
// A booking for a practice that already started can't be cancelled by the family.
sqlite.prepare("UPDATE cash_bookings SET start_time='00:00' WHERE id=?").run(b1);
assert.equal((await send(cashApi, '/api/cash-bookings', {action: 'cancel', id: b1})).status, 409);
sqlite.prepare("UPDATE cash_bookings SET start_time='18:00' WHERE id=?").run(b1);

// ---------- The family sees it at home: purchases and Next up ----------
r = await getJson(load('app/api/orders/route.ts'), '/api/orders');
same(r.body.cashBookings.map(b => b.label), ['Pay at the academy: $40.00 due', 'Pay at the academy: $20.00 due']);
const up = await view.upcomingFor('p1', 'w1', today, 3);
same(up.filter(u => u.why === 'Pay at the academy').map(u => [u.date, u.type, u.dueCents]), [[today, 'practice', 4000], [tomorrow, 'live', 2000]]);
const data = await load('lib/data-requests.ts').familyExport('p1');
assert.ok(data.cashBookings.length >= 4, 'in the family data export');
assert.ok(data.cashBookings.every(b => !('dedupe_key' in b)));

// ---------- An owner-recorded offline payment for a due booking settles it ----------
as({kind: 'owner', id: 'owner-id'});
r = await send(payApi, '/api/payments', {action: 'record', userId: 'p1', wrestlerId: 'w1', kind: 'walkin', program: 'Intermediate', date: today, practiceId: `Intermediate:${today}:18:00`, method: 'venmo'});
assert.equal(r.status, 200);
assert.equal(row(b1).status, 'paid'); assert.equal(row(b1).order_id, r.body.orderId, 'linked, so it cannot be collected again');
assert.equal((await send(payApi, '/api/payments', {action: 'cash-received', bookingId: b1})).status, 409);

// ---------- A late online payment for an older checkout clears a due booking ----------
{
  const hook = load('lib/stripe-webhook.ts');
  fam('p1');
  const bx = (await send(cashApi, '/api/cash-bookings', walk(ny(5)))).body.booking.id;
  paidOrder('late-online', `p1|w1|walkin|Intermediate|${ny(5)}`, 'walkin', `Intermediate:${ny(5)}:18:00`, ny(5), 'expired');
  const out = await hook.applyStripeEvent({id: 'evt_late', type: 'checkout.session.completed', livemode: false, data: {object: {id: 'cs_late', client_reference_id: 'late-online', payment_status: 'paid', amount_total: 4000, currency: 'usd', payment_intent: 'pi_late'}}});
  assert.equal(out.outcome, 'paid');
  assert.equal(row(bx).status, 'canceled'); assert.equal(row(bx).cancel_reason, 'Paid online');
}

// ---------- Security log: who collected it, for what ----------
{
  const log = load('lib/security-log.ts');
  const {entries} = await log.securityLogPage(['owner-id']);
  const received = entries.filter(x => x.title === 'Cash received at the academy');
  assert.ok(received.some(x => x.who === 'Coach Dana (dana@example.test)' && /Jo One · SWA Intermediate walk-in · \$40\.00/.test(x.detail)), JSON.stringify(received));
  assert.ok(entries.some(x => x.title === 'Pay-at-the-academy booking canceled' && /Jo One · SWA Intermediate walk-in/.test(x.detail)));
}

// ---------- 3-year coach cleanup: the payment stays, the collector becomes "Former coach" ----------
{
  const retention = load('lib/coach-retention.ts');
  sqlite.prepare("INSERT INTO removed_coaches(id,email_hash,email,name,removed_on,cleaned_at) VALUES ('gone',?,'dana@example.test','Coach Dana','2020-01-01',NULL)").run(await retention.emailHash('dana@example.test'));
  await retention.cleanupRemovedCoaches({today: '2030-01-01'});
  const kept = sqlite.prepare('SELECT status,amount_cents,pricing,terms_accepted FROM orders WHERE id=?').get(o1);
  const p = JSON.parse(kept.pricing);
  assert.equal(kept.amount_cents, 4000, 'the payment is kept as it was');
  assert.equal(p.collectedBy, 'Former coach'); assert.equal(p.collectedByEmail, 'former-coach-gone'); assert.equal(p.recordedBy, 'former-coach-gone');
  assert.equal(JSON.parse(kept.terms_accepted).recordedBy, 'former-coach-gone');
  assert.equal(sqlite.prepare("SELECT actor FROM security_events WHERE action='cash_received' AND target LIKE ?").get(o1 + '%').actor, 'former-coach-gone');
  assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM orders WHERE source='offline'").all()).includes('dana@example.test'));
}

console.log('Passed: pay cash at the academy for walk-ins and Friday Night Live: price from quotes.ts only; duplicates, eligibility, approval, card, consent form, past and excluded practices refused; checkout and cash exclusive; on the roster with the amount due and check-in allowed; Cash received once (coach own programs today, owner any) as an offline cash payment with who and when, audited; Payments, spreadsheet and books count it once; void (owner only) puts it back to due; owner list and cancel with a notice; family cancel before start; family home, export, late online payment, security log and coach cleanup.');
