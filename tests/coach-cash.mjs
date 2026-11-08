// Issue #250 (decided by Lauren on November 7): coaches receive cash at the academy, and the site shows which coach marked
// it received. Any active coach sees today's extra practices (Friday Night Live and the like) on their check-in list and
// can check those wrestlers in and tap Cash received; a removed coach can't, and no coach can record cash for another
// program's regular practice. Undo stays owner-only. "Received by <name> · <time>" on the roster, a Collected by column,
// filter and per-person totals on Payments and in its spreadsheet, Collected by in Income and expenses, the owner's
// collected history, and "Paid in cash at the academy" for the family (never which coach). The 3-year coach cleanup turns
// the collector into "Former coach". The collector's name is the coach profile display name, else the staff name, never an
// email.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import {makeDb} from './fixtures/d1.mjs';

const {sqlite, DB} = makeDb();
const env = {DB, CHECKOUT_KINDS: '', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_test'};
// owner, or a signed-in account {id, email}: a coach when their email is active on Coaches (the real lib/access-control.ts).
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
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test', OWNER_EMAIL: 'owner@example.test', verifiedOwner: u => u?.email === 'owner@example.test',
          ownerIdentity: async () => ({owner: actor.kind === 'owner' ? {userId: actor.id} : null, headers: new Headers()}),
          strongAccount: async () => ({user: {id: actor.id, email: actor.email ?? actor.id + '@example.test', email_confirmed_at: 'y', factors: []}, strong: true, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.endsWith('/stripe-test')) return {storedStripeKeyFor: async () => null, stripeClientFor: () => null, stripeMode: () => 'test'};
        if (name.endsWith('/usaw-check')) return {checkCard: async () => ({outcome: 'unavailable', reason: 'not in tests'})};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}

const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0), tomorrow = ny(1), yesterday = ny(-1);
const all = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
const state = {programNamingVersion: 2,
  programs: [{id: 'Elementary', name: 'SWA Development', priceCents: 20000, walkInPriceCents: 3500}, {id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}, {id: 'Advanced', name: 'SWA Advance', priceCents: 20000, walkInPriceCents: 4000}],
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(60), weekly: all, excludedDates: []}, {program: 'Elementary', start: ny(-30), end: ny(60), weekly: all, excludedDates: []}],
  events: [],
  extraPractices: [{id: 'fnl', name: 'Friday Night Live', dates: [today, tomorrow], enabled: true, start: '17:00', end: '18:00', memberCents: 1000, nonMemberCents: 2000}]};
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify(state));
const card = {usawNumber: 'TEST-1234', usawExpires: '2099-12-31'};
const families = {p1: [{id: 'w1', name: 'Jo One', grade: '8', ...card}], p2: [{id: 'w2', name: 'Kim Two', grade: '3', ...card}]};
for (const [u, wrestlers] of Object.entries(families)) {
  sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test', JSON.stringify({parentName: 'Parent ' + u, phone: '555-01' + u.slice(1), wrestlers}), 1, 'x');
  for (const w of wrestlers) sqlite.prepare('INSERT INTO usaw_reviews VALUES (?,?,?,?,?,?,?,?)').run(u, w.id, 'TEST-1234', '2099-12-31', 'valid', '', 'owner-id', 'x');
}
// Coaches: Dana (SWA Intermediate, profile name "Coach Dana"), Eli (SWA Development, no profile), Blank (SWA Development,
// no name on Coaches), and Gwen, who was removed (active=0).
const staff = (email, name, programs, active = 1) => sqlite.prepare('INSERT INTO staff_access VALUES (?,?,?,?,?)').run(email, name, JSON.stringify(programs), active, 'x');
staff('dana@example.test', 'Dana Smith', ['Intermediate']); staff('eli@example.test', 'Eli Jones', ['Elementary']);
staff('blank@example.test', '', ['Elementary']); staff('gwen@example.test', 'Gwen Gone', ['Intermediate', 'Elementary'], 0);
sqlite.prepare("INSERT INTO coach_profiles VALUES ('dana@example.test','Coach Dana','','[]','',NULL,'x','dana-id')").run();
const coach = name => ({kind: 'user', id: name + '-id', email: name + '@example.test'});

const cashApi = load('app/api/cash-bookings/route.ts'), payApi = load('app/api/payments/route.ts'), rosterApi = load('app/api/roster/route.ts'), ordersApi = load('app/api/orders/route.ts');
const cash = load('lib/cash-bookings.ts'), roster = load('lib/roster.ts'), financials = load('lib/financials.ts'), collectors = load('lib/collectors.ts');
const O = 'https://swa.test';
const send = async (route, url, body) => { const r = await route.POST(new Request(O + url, {method: 'POST', headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const getJson = async (route, url) => { const r = await route.GET(new Request(O + url)); const t = await r.text(); try { return {status: r.status, body: JSON.parse(t)}; } catch { return {status: r.status, body: t}; } };
const as = a => { actor = a; };
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const pricing = orderId => JSON.parse(sqlite.prepare('SELECT pricing FROM orders WHERE id=?').get(orderId).pricing);
const book = async (user, body) => { as({kind: 'user', id: user, email: user + '@example.test'}); const r = await send(cashApi, '/api/cash-bookings', {action: 'book', ...body}); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.booking.id; };
const fnl = (w, date = today) => ({source: 'booking', type: 'live', id: 'fnl', date, wrestlerId: w});
const walk = (w, program, date = today) => ({source: 'membership', plan: 'walkin', wrestlerId: w, program, date, practiceId: `${program}:${date}:18:00`});

// Today: Jo (grade 8) books an SWA Intermediate walk-in and Friday Night Live; Kim (grade 3) books an SWA Development
// walk-in and Friday Night Live. All to pay cash at the academy.
const joWalk = await book('p1', walk('w1', 'Intermediate')), joFnl = await book('p1', fnl('w1'));
const kimWalk = await book('p2', walk('w2', 'Elementary')), kimFnl = await book('p2', fnl('w2'));
const joFnlTomorrow = await book('p1', fnl('w1', tomorrow));

// ---------- Any active coach sees today's extra practices on their check-in list ----------
as(coach('eli'));
let r = await getJson(rosterApi, '/api/roster');
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.role, 'coach');
same(r.body.sessions.map(s => s.key.split(':').slice(0, 2).join(':')).sort(), ['live:fnl', 'practice:Elementary'], 'own program and the extra practice, not SWA Intermediate');
const live = r.body.sessions.find(s => s.type === 'live');
same(live.entries.map(e => [e.name, e.cash.status, e.cash.cents]), [['Jo One', 'due', 2000], ['Kim Two', 'due', 2000]]);
assert.ok(live.entries.every(e => e.email === null), 'no family email for coaches');
// ...and checks those wrestlers in.
r = await send(rosterApi, '/api/roster', {action: 'checkin', date: today, sessionKey: live.key, userId: 'p1', wrestlerId: 'w1'});
assert.equal(r.status, 200, 'a coach checks in at an extra practice');

// ---------- Permissions for Cash received ----------
r = await send(rosterApi, '/api/roster', {action: 'cash', date: today, bookingId: joWalk});
assert.equal(r.status, 403, 'not for another program’s regular practice'); assert.match(r.body.error, /own programs and today’s extra practices/);
assert.equal(sqlite.prepare("SELECT status FROM cash_bookings WHERE id=?").get(joWalk).status, 'due');
assert.equal((await send(rosterApi, '/api/roster', {action: 'cash', date: tomorrow, bookingId: joFnlTomorrow})).status, 403, 'an extra practice on another day: no');
assert.equal((await cash.receiveCash(joFnlTomorrow, {id: 'eli-id', name: 'Eli Jones', email: 'eli@example.test'}, {role: 'coach', programs: ['Elementary']})).status, 403, 'also refused in the library');
// The removed coach can do nothing.
as(coach('gwen'));
assert.equal((await getJson(rosterApi, '/api/roster')).status, 403, 'a removed coach has no roster');
r = await send(rosterApi, '/api/roster', {action: 'cash', date: today, bookingId: joFnl});
assert.equal(r.status, 403, 'a removed coach can’t record cash'); assert.equal(sqlite.prepare("SELECT status FROM cash_bookings WHERE id=?").get(joFnl).status, 'due');
// An active coach of another program records Friday Night Live cash.
as(coach('eli'));
r = await send(rosterApi, '/api/roster', {action: 'cash', date: today, bookingId: joFnl});
assert.equal(r.status, 200, JSON.stringify(r.body));
const eliOrder = r.body.orderId;
let p = pricing(eliOrder);
assert.equal(p.collectedBy, 'Eli Jones', 'the name on Coaches when there is no profile'); assert.equal(p.collectedByEmail, 'eli@example.test'); assert.equal(p.recordedBy, 'eli-id'); assert.ok(p.collectedAt);
let e = r.body.sessions.find(s => s.type === 'live').entries.find(x => x.name === 'Jo One');
assert.equal(e.cash.status, 'paid'); assert.equal(e.cash.collectedBy, 'Eli Jones'); assert.ok(e.cash.collectedAt);
assert.equal((await send(rosterApi, '/api/roster', {action: 'cash-undo', date: today, orderId: eliOrder})).status, 403, 'undo stays with the owner');
assert.equal(sqlite.prepare('SELECT status FROM orders WHERE id=?').get(eliOrder).status, 'paid');
// Dana: profile display name; her own program's walk-in and the extra practice.
as(coach('dana'));
const danaFnl = (await send(rosterApi, '/api/roster', {action: 'cash', date: today, bookingId: kimFnl})).body.orderId;
const danaWalk = (await send(rosterApi, '/api/roster', {action: 'cash', date: today, bookingId: joWalk})).body.orderId;
assert.equal(pricing(danaFnl).collectedBy, 'Coach Dana', 'the coach profile display name (#207)'); assert.equal(pricing(danaWalk).collectedBy, 'Coach Dana');
assert.equal((await send(rosterApi, '/api/roster', {action: 'cash', date: today, bookingId: kimWalk})).status, 403, 'Dana does not coach SWA Development');
// A coach with no profile and no name on Coaches is "Coach", never their email.
as(coach('blank'));
const blankWalk = (await send(rosterApi, '/api/roster', {action: 'cash', date: today, bookingId: kimWalk})).body.orderId;
assert.equal(pricing(blankWalk).collectedBy, 'Coach');
assert.ok(!JSON.stringify(sqlite.prepare("SELECT json_extract(pricing,'$.collectedBy') AS n FROM orders WHERE source='offline'").all()).includes('@'), 'never an email as the name');
// The owner records one on Payments, and a Venmo payment for tomorrow's Friday Night Live.
as({kind: 'owner', id: 'owner-id'});
const ownerCash = (await send(payApi, '/api/payments', {action: 'cash-received', bookingId: joFnlTomorrow})).body.orderId;
assert.equal(pricing(ownerCash).collectedBy, 'Owner');
// Cash Dana collected yesterday (an older payment), to check the dates.
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source)
  VALUES ('older-cash','p1','p1@example.test','w1','Jo One','walkin','Intermediate',?,'SWA Intermediate walk-in',?,4000,0,4000,'usd',?,'{}','paid','dy',0,'x','x',?,'offline')`)
  .run(`Intermediate:${yesterday}:18:00`, JSON.stringify([yesterday]), JSON.stringify({method: 'cash', recordedBy: 'dana-id', collectedBy: 'Coach Dana', collectedByEmail: 'dana@example.test', collectedAt: yesterday + 'T23:00:00.000Z'}), yesterday + 'T23:00:00.000Z');

// ---------- Received by <name> · <time> on the roster ----------
const entryOf = async (prefix, name, date = today) => (await roster.rosterFor(date, {role: 'owner'})).find(s => s.key.startsWith(prefix)).entries.find(x => x.name === name);
assert.equal((await entryOf('live:fnl:', 'Jo One')).cash.collectedBy, 'Eli Jones');
assert.equal((await entryOf('live:fnl:', 'Kim Two')).cash.collectedBy, 'Coach Dana');
assert.equal((await entryOf('practice:Elementary:', 'Kim Two')).cash.collectedBy, 'Coach');
assert.equal((await entryOf('live:fnl:', 'Jo One', tomorrow)).cash.collectedBy, 'Owner');
// A name saved as an email before this change (#249 fell back to it) is looked up again and never shown.
sqlite.prepare("UPDATE orders SET pricing=json_set(pricing,'$.collectedBy','eli@example.test') WHERE id=?").run(eliOrder);
assert.equal((await entryOf('live:fnl:', 'Jo One')).cash.collectedBy, 'Eli Jones', 'an email is replaced by the coach’s name');
sqlite.prepare("INSERT INTO coach_profiles VALUES ('eli@example.test','Coach Eli','','[]','',NULL,'x','eli-id')").run();
assert.equal((await entryOf('live:fnl:', 'Jo One')).cash.collectedBy, 'Coach Eli', 'the profile name first');
sqlite.prepare("DELETE FROM coach_profiles WHERE email='eli@example.test'").run();
sqlite.prepare("UPDATE orders SET pricing=json_set(pricing,'$.collectedBy','Eli Jones') WHERE id=?").run(eliOrder);

// ---------- Payments: Collected by column, filter and per-person totals ----------
r = await getJson(payApi, `/api/payments?from=${today}&to=${tomorrow}`);
assert.equal(r.status, 200);
const byId = id => r.body.payments.find(x => x.id === id);
assert.equal(byId(eliOrder).collectedBy, 'Eli Jones'); assert.ok(byId(eliOrder).collectedAt); assert.equal(byId(eliOrder).collectorKey, 'eli-id');
assert.equal(byId(danaWalk).collectedBy, 'Coach Dana'); assert.equal(byId(ownerCash).collectedBy, 'Owner');
same(r.body.collectors.map(c => [c.name, c.key]), [['Coach', 'blank-id'], ['Coach Dana', 'dana-id'], ['Eli Jones', 'eli-id'], ['Owner', 'owner-id']], 'everyone who collected, for the filter');
same(r.body.byCollector.map(c => [c.name, c.count, c.cents, c.cashCents]), [['Coach Dana', 2, 6000, 6000], ['Coach', 1, 3500, 3500], ['Eli Jones', 1, 2000, 2000], ['Owner', 1, 2000, 2000]], 'per-person totals for the dates chosen');
// Justin reconciles Eli's cash for tonight.
r = await getJson(payApi, `/api/payments?from=${today}&to=${today}&collector=eli-id`);
same(r.body.payments.map(x => x.id), [eliOrder], 'only what Eli collected');
assert.equal(r.body.totals.offlineCents, 2000); assert.equal(r.body.totals.count, 1); assert.equal(r.body.matched, 1);
assert.equal(r.body.byCollector.length, 4, 'the per-person totals ignore the person chosen, so every coach is listed');
// The day matters: yesterday only Dana's older cash.
r = await getJson(payApi, `/api/payments?from=${yesterday}&to=${yesterday}`);
same(r.body.byCollector.map(c => [c.name, c.cents]), [['Coach Dana', 4000]]);
r = await getJson(payApi, `/api/payments?collector=dana-id`);
assert.equal(r.body.totals.offlineCents, 10000, 'Dana in all: two tonight and one yesterday');
assert.equal((await getJson(payApi, '/api/payments?collector=' + 'x'.repeat(201))).body.matched >= 6, true, 'an unusable filter is ignored');
// Days are New York days: cash taken at 11:30 PM counts that evening, though it is already the next day in UTC.
const dt = load('lib/datetime.ts');
same([dt.academyDayStart('2026-07-04'), dt.academyDayStart('2026-11-07'), dt.academyDayStart('2026-11-01'), dt.academyDayStart('2026-03-08')],
  ['2026-07-04T04:00:00.000Z', '2026-11-07T05:00:00.000Z', '2026-11-01T04:00:00.000Z', '2026-03-08T05:00:00.000Z']);
const lateAt = new Date(Date.parse(dt.academyDayStart(today)) + 23.5 * 3600000).toISOString();
assert.notEqual(lateAt.slice(0, 10), today, 'the UTC date is the next day');
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source)
  VALUES ('late-cash','p2','p2@example.test','w2','Kim Two','walkin','Elementary','late','SWA Development walk-in','[]',3500,0,3500,'usd',?,'{}','paid','late',0,'x','x',?,'offline')`)
  .run(JSON.stringify({method: 'cash', recordedBy: 'dana-id', collectedBy: 'Coach Dana', collectedByEmail: 'dana@example.test', collectedAt: lateAt}), lateAt);
r = await getJson(payApi, `/api/payments?from=${today}&to=${today}&collector=dana-id`);
assert.ok(r.body.payments.some(x => x.id === 'late-cash' && x.paidOn === today), 'in tonight’s list, dated tonight');
assert.ok(!(await getJson(payApi, `/api/payments?from=${tomorrow}&to=${tomorrow}`)).body.payments.some(x => x.id === 'late-cash'), 'not tomorrow’s');
sqlite.prepare("DELETE FROM orders WHERE id='late-cash'").run();
// A Venmo payment the owner recorded: collected by the owner, not cash.
await send(payApi, '/api/payments', {action: 'record', userId: 'p2', wrestlerId: 'w2', kind: 'live', liveId: 'fnl', date: tomorrow, method: 'venmo'});
r = await getJson(payApi, `/api/payments?from=${today}&to=${today}`);
same(r.body.byCollector.find(c => c.key === 'owner-id'), {key: 'owner-id', name: 'Owner', count: 2, cents: 4000, cashCents: 2000}, 'cash shown apart from Venmo');
// The spreadsheet: a Collected by column, and the filter applies.
let csv = (await getJson(payApi, `/api/payments?format=csv&collector=eli-id`)).body;
let lines = csv.trim().split('\r\n');
assert.match(lines[0], /^Paid on,Status,Paid via,Method,Collected by,Type,/);
assert.equal(lines.length, 2); assert.match(lines[1], /,Offline,cash,Eli Jones,live,"Friday Night Live/);
csv = (await getJson(payApi, `/api/payments?format=csv&from=${today}&to=${today}`)).body;
assert.ok(csv.includes(',cash,Coach Dana,walkin,') && csv.includes(',cash,Coach,walkin,') && csv.includes(',venmo,Owner,live,'));
assert.ok(!/(dana|eli|blank)@example\.test/.test(csv), 'no coach email in the spreadsheet');
// Only the owner.
as(coach('dana'));
assert.equal((await getJson(payApi, '/api/payments?collector=dana-id')).status, 403);
as({kind: 'owner', id: 'owner-id'});

// ---------- Income and expenses: who collected each offline payment ----------
let ledger = await financials.ledgerLines(yesterday, tomorrow);
assert.equal(ledger.find(l => l.id === 'payment:' + eliOrder).collectedBy, 'Eli Jones');
assert.equal(ledger.find(l => l.id === 'payment:' + danaFnl).collectedBy, 'Coach Dana');
assert.ok(ledger.filter(l => l.source !== 'offline').every(l => l.collectedBy === ''));
const ledgerCsv = financials.ledgerCsv(ledger).split('\r\n');
assert.match(ledgerCsv[0], /,Receipt reference,Collected by$/);
assert.ok(ledgerCsv.some(l => /Friday Night Live.*,Cash,20\.00,,,Eli Jones$/.test(l)));

// ---------- The owner's cash list: recently collected, with who and when ----------
r = await getJson(payApi, '/api/payments?cash=due');
same(r.body.collected.map(b => [b.wrestler, b.item.includes('Friday') ? 'fnl' : 'walk', b.collectedBy]).sort(),
  [['Jo One', 'fnl', 'Eli Jones'], ['Jo One', 'fnl', 'Owner'], ['Jo One', 'walk', 'Coach Dana'], ['Kim Two', 'fnl', 'Coach Dana'], ['Kim Two', 'walk', 'Coach']]);
assert.ok(r.body.collected.every(b => b.collectedAt && b.status === 'paid'));
assert.equal(r.body.count, 0, 'nothing is due now');

// ---------- The family: "Paid in cash at the academy", never who took it ----------
as({kind: 'user', id: 'p1', email: 'p1@example.test'});
r = await getJson(ordersApi, '/api/orders');
const paidCash = r.body.orders.filter(o => o.paid_in_cash === 1);
assert.equal(paidCash.length, 4, 'each cash payment says it was paid in cash');
assert.ok(!/Eli|Dana|Owner|collected|recordedBy/i.test(JSON.stringify(r.body)), 'the family is not told which coach');
as({kind: 'user', id: 'p2', email: 'p2@example.test'});
r = await getJson(ordersApi, '/api/orders');
assert.equal(r.body.orders.find(o => o.kind === 'live' && o.paid_in_cash === 0)?.status, 'paid', 'a Venmo payment is not "in cash"');
as({kind: 'owner', id: 'owner-id'});

// ---------- 3-year coach cleanup: the collector becomes "Former coach" ----------
{
  const retention = load('lib/coach-retention.ts');
  sqlite.prepare("DELETE FROM staff_access WHERE email='eli@example.test'").run();
  sqlite.prepare("INSERT INTO removed_coaches(id,email_hash,email,name,removed_on,cleaned_at) VALUES ('eli-gone',?,'eli@example.test','Eli Jones','2020-01-01',NULL)").run(await retention.emailHash('eli@example.test'));
  await retention.cleanupRemovedCoaches({today: '2030-01-01'});
  p = pricing(eliOrder);
  assert.equal(p.collectedBy, 'Former coach'); assert.equal(p.recordedBy, 'former-coach-eli-gone'); assert.equal(p.collectedByEmail, 'former-coach-eli-gone');
  assert.equal(sqlite.prepare('SELECT amount_cents,status FROM orders WHERE id=?').get(eliOrder).amount_cents, 2000, 'the payment stays as paid');
  assert.equal((await entryOf('live:fnl:', 'Jo One')).cash.collectedBy, 'Former coach', 'on the roster');
  r = await getJson(payApi, `/api/payments?from=${today}&to=${today}`);
  assert.equal(r.body.payments.find(x => x.id === eliOrder).collectedBy, 'Former coach');
  assert.ok(r.body.collectors.some(c => c.key === 'former-coach-eli-gone' && c.name === 'Former coach'));
  assert.ok(r.body.byCollector.some(c => c.name === 'Former coach' && c.cents === 2000));
  assert.ok(!/eli@|Eli Jones|eli-id/.test(JSON.stringify(r.body)), 'nothing left that names the coach');
  same((await getJson(payApi, '/api/payments?collector=former-coach-eli-gone')).body.payments.map(x => x.id), [eliOrder], 'still filterable');
  assert.equal((await financials.ledgerLines(today, today)).find(l => l.id === 'payment:' + eliOrder).collectedBy, 'Former coach');
  assert.equal((await getJson(payApi, '/api/payments?cash=due')).body.collected.find(b => b.orderId === eliOrder).collectedBy, 'Former coach');
  // Dana is still on Coaches: untouched.
  assert.equal(pricing(danaFnl).collectedBy, 'Coach Dana');
}

// ---------- The SQL name never shows an email, whatever was saved ----------
assert.equal(collectors.OWNER_COLLECTOR, 'Owner');
assert.equal((await collectors.coachCollector('x', {email: 'Who@Example.test', name: 'who@example.test'})).name, 'Coach', 'an email-like staff name is not used');
assert.equal((await collectors.coachCollector('x', {email: 'dana@example.test', name: 'Dana Smith'})).name, 'Coach Dana');

// ---------- Pages: roster, Payments and the family home (inline JavaScript is not typechecked) ----------
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(res => setImmediate(res)); };
const json = body => ({ok: true, status: 200, json: async () => body});
function page(file, fetch, hidden = []) {
  const nodes = new Map();
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, {id, value: '', min: '', max: '', hidden: hidden.includes(id), checked: false, disabled: false, innerHTML: '', textContent: '', className: '', href: '', style: {}, dataset: {}, options: [],
      elements: {parentName: {value: '', focus() {}}, phone: {value: ''}}, replaceChildren() {}, focus() {}, scrollIntoView() {}, setAttribute() {}, removeAttribute() {}, querySelector() { return null; }, classList: {add() {}, remove() {}, toggle() {}}});
    return nodes.get(id);
  };
  const calls = [];
  const ctx = vm.createContext({Intl, Date, JSON, URLSearchParams, Promise, setTimeout: f => setImmediate(f), clearTimeout() {}, structuredClone, console, crypto: {randomUUID: () => 'new-id'},
    location: {search: '', href: '', assign() {}}, confirm: () => true, prompt: () => 'Tapped by mistake', window: {addEventListener() {}}, navigator: {},
    document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({getContext: () => null})},
    fetch: async (url, options) => { calls.push({url, body: options?.body ? JSON.parse(options.body) : null}); return fetch(url, options); }});
  const html = readFileSync(file, 'utf8');
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(code, ctx);
  return {el, ctx, calls, html};
}
const day = '2026-11-13';
// Roster, as a coach: the Friday Night Live entry has Cash received; a paid one says who received it.
{
  const entry = (name, c) => ({userId: 'p-' + name, wrestlerId: 'w-' + name, name, grade: '8', parentName: 'Pat', phone: '555', email: null, sources: c.status === 'due' ? ['Pay at the academy'] : ['Paid'],
    checkedInAt: null, checkedInBy: null, card: 'verified', cardExpires: '2099-08-31', cardNote: '', waiverSigned: null, exceptions: [], checkInBlocked: null, cash: c, allergies: 'None'});
  const data = {date: day, today: day, role: 'coach', sessions: [{key: `live:fnl:${day}`, type: 'live', title: 'Friday Night Live', program: null, date: day, start: '17:00', end: '18:00', checkedIn: 0, entries: [
    entry('Ana Due', {bookingId: 'cb-a', status: 'due', cents: 2000, orderId: null, collectedAt: null, collectedBy: null}),
    entry('Ben Paid', {bookingId: 'cb-b', status: 'paid', cents: 2000, orderId: 'ord-b', collectedAt: '2026-11-13T22:05:00Z', collectedBy: 'Coach Eli'})]}]};
  const {el} = page('app/roster/screen.html', async () => json(data));
  await settle();
  const out = el('sessions').innerHTML;
  assert.match(out, /Friday Night Live[\s\S]*Separate purchase · 1 to pay at the academy \(\$20\.00 due\)/);
  assert.match(out, /Ana Due[\s\S]*data-cash="0:0">Cash received<\/button>/, 'a coach taps Cash received at an extra practice');
  assert.match(out, /Ben Paid[\s\S]*<span class="received">Received by Coach Eli · 5:05 PM<\/span>[\s\S]*Only the owner can undo cash/);
  assert.doesNotMatch(out, /data-cash-undo/);
}
// Payments: Collected by column and filter, per-person totals, the collected history.
{
  const list = {payments: [
    {id: 'o1', paidOn: day, status: 'paid', source: 'offline', kind: 'live', item: 'Friday Night Live', dates: [day], wrestler: 'Ana', parent: 'Pat', email: 'pat@example.test', amountCents: 2000, listCents: 2000, discountCents: 0, method: 'cash', note: 'Paid at the academy', voidReason: '', collectedBy: 'Coach Eli', collectorKey: 'eli-id', collectedAt: '2026-11-13T22:05:00Z', refundedCents: 0, cardPayments: 0, feeCents: null},
    {id: 'o2', paidOn: day, status: 'paid', source: 'stripe', kind: 'walkin', item: 'Walk-in', dates: [day], wrestler: 'Bo', parent: '', email: 'bo@example.test', amountCents: 4000, listCents: 4000, discountCents: 0, method: 'stripe', note: '', voidReason: '', collectedBy: '', collectorKey: '', collectedAt: null, refundedCents: 0, cardPayments: 1, feeCents: 146}],
    next: null, matched: 2, totals: {collectedCents: 6000, onlineCents: 4000, offlineCents: 2000, refundedCents: 0, feesCents: 146, count: 2},
    collectors: [{key: 'dana-id', name: 'Coach Dana'}, {key: 'eli-id', name: 'Coach Eli'}],
    byCollector: [{key: 'eli-id', name: 'Coach Eli', count: 1, cents: 2000, cashCents: 2000}, {key: 'owner-id', name: 'Owner', count: 2, cents: 6000, cashCents: 2000}]};
  const due = {more: false, count: 0, dueCents: 0, bookings: [], collected: [{id: 'cb-b', kind: 'live', item: 'Friday Night Live', date: day, start: '17:00', wrestler: 'Ben', amountCents: 2000, status: 'paid', method: 'cash', collectedBy: 'Coach Eli', collectedAt: '2026-11-13T22:05:00Z'}]};
  const {el, ctx} = page('app/payments/screen.html', async (url, o) => {
    if (url === '/api/payments?cash=due') return json(due);
    if (url.startsWith('/api/payments?families=1')) return json({families: [], more: false});
    if (url.startsWith('/api/public-schedule')) return json({programs: [], practices: [], events: [], liveClasses: []});
    if (o?.body) return json({ok: true});
    return json(list);
  });
  await settle(60);
  const rows = el('rows').innerHTML;
  assert.match(rows, /Cash<br><span class="muted">Paid at the academy<\/span><\/td><td data-label="Collected by">Coach Eli<br><span class="muted">Nov 13, 5:05 PM<\/span><\/td>/, 'Collected by with the time');
  assert.match(rows, /Online<\/td><td data-label="Collected by"><span class="muted">–<\/span><\/td>/, 'online payments have no collector');
  assert.match(el('fCollector').innerHTML, /<option value="">Anyone<\/option><option value="dana-id">Coach Dana<\/option><option value="eli-id">Coach Eli<\/option>/);
  const by = el('byCollector').innerHTML;
  assert.match(by, /data-collector="eli-id" aria-pressed="false"><b>Coach Eli<\/b>\$20\.00 cash · 1 payment<\/button>/);
  assert.match(by, /<b>Owner<\/b>\$20\.00 cash · \$60\.00 in all · 2 payments/);
  assert.match(el('collectedRows').innerHTML, /Ben[\s\S]*Friday Night Live[\s\S]*\$20\.00[\s\S]*Coach Eli<br><span class="muted">Nov 13, 5:05 PM/);
  el('fCollector').value = 'eli-id'; el('from').value = day; el('to').value = day;
  assert.equal(vm.runInContext('query().toString()', ctx), `from=${day}&to=${day}&collector=eli-id`, 'the filter is sent, and goes into the spreadsheet link');
  await vm.runInContext('loadPayments()', ctx);
  assert.match(el('csv').href, /collector=eli-id/);
}
// Family home: "Paid in cash at the academy on …", nothing about who.
{
  const profile = {parentName: 'Pat Example', phone: '555-0100', address: '1 Main St', emergencyContactName: 'Sam', emergencyContactPhone: '555-0101',
    wrestlers: [{id: 'w-1', name: 'Jo Example', grade: '8', birthDate: '2012-01-01', allergies: 'None', usawNumber: 'X', usawExpires: '2099-08-31'}]};
  const order = (id, cashPaid) => ({id, kind: 'live', item_label: 'Friday Night Live', wrestler_id: 'w-1', wrestler_name: 'Jo Example', dates: [day], amount_cents: 2000, discount_cents: 0, status: 'paid', created_at: day + 'T12:00:00Z', paid_at: day + 'T22:05:00Z', paid_in_cash: cashPaid});
  const {el} = page('app/family/screen.html', async url => {
    if (url === '/api/family') return json({email: 'pat@example.test', data: structuredClone(profile), revision: 1, updatedAt: '2026-11-01T12:00:00Z', cards: {}});
    if (url === '/api/orders') return json({orders: [order('a', 1), order('b', 0)], checkoutOpen: false, cashBookings: []});
    return json({});
  }, ['summary']);
  await settle(60);
  const list = el('purchaseList').innerHTML;
  assert.match(list, /Paid in cash at the academy on Nov 13, 2026/);
  assert.match(list, /<p class="muted">Paid Nov 13, 2026<\/p>/, 'other payments read as before');
  assert.doesNotMatch(list, /Coach|Received by|Collected by/);
}

// ---------- Help pages ----------
const coachHelp = readFileSync('app/help/coach/screen.html', 'utf8'), ownerHelp = readFileSync('app/help/owner/screen.html', 'utf8');
assert.match(coachHelp, /extra practice[\s\S]*Cash received[\s\S]*Received by[\s\S]*only the owner can undo/i);
assert.match(ownerHelp, /Collected by[\s\S]*Today[\s\S]*Former coach/);

console.log('Passed: coach cash (#250): any active coach sees today’s extra practices, checks them in and records their cash; a removed coach and another program’s regular practice are refused; undo is owner-only; Received by on the roster, Collected by on Payments (column, filter, per-person totals, spreadsheet), in Income and expenses and the owner’s collected history; the family sees Paid in cash at the academy only; names never an email; the coach cleanup shows Former coach.');
