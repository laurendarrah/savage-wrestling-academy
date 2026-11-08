// Issue #272, audit batch 1 (money and records): schedule and event edits can no longer orphan paid walk-ins and cash
// bookings (M2); coach pay nets out partial refunds (M1); a member is never charged for a covered walk-in (M3); offline
// payments and exception revocations are one transaction (R2); every settings save and scholarship offer or revocation
// is in the security log (R1); card disputes are recorded, flagged, booked and alerted (M6); the refund-timing label (R6).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeDb, loader, call} from './fixtures/d1.mjs';

const {sqlite, DB, stats} = makeDb();
const env = {DB, CHECKOUT_KINDS: 'walkin,event,live,lesson', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_test'};
const actor = {owner: true, id: 'owner-id'};
const load = loader(env, actor);
const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0);
const fullDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'});
const dayDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric'});
const all = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
const season = (program, extra = {}) => ({season: 'Fall', program, start: ny(-30), end: ny(90), weekly: all, excludedDates: [], ...extra});
const base = {kids: [], bookings: [], messages: [], offers: [], staff: [], attendance: {}, settings: {}, programNamingVersion: 2,
  programs: [{id: 'Elementary', name: 'SWA Development', description: '', priceCents: 20000, walkInPriceCents: 3500}, {id: 'Intermediate', name: 'SWA Intermediate', description: '', priceCents: 20000, walkInPriceCents: 4000}, {id: 'Advanced', name: 'SWA Advance', description: '', priceCents: 20000, walkInPriceCents: 4000}],
  seasons: [season('Intermediate'), season('Elementary'), season('Advanced')],
  events: [{id: 'camp', name: 'Winter camp', type: 'Camp', dates: [ny(10), ny(11)], price: 160, slots: 2}],
  extraPractices: [{id: 'fnl', name: 'Friday Night Live', dates: [ny(5), ny(12)], enabled: true, start: '17:00', end: '18:00', memberCents: 1000, nonMemberCents: 2000}],
  teamCodes: [{id: 'tc1', code: 'TEAM10', name: 'Team', percent: 10, active: true, programs: ['Intermediate']}]};
const clone = s => JSON.parse(JSON.stringify(s));
const saveState = s => sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x') ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").run(JSON.stringify(s));
saveState(base);
const card = {usawNumber: 'TEST-1234', usawExpires: '2099-12-31'};
const fam = (u, wrestlers) => sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload').run(u, u + '@example.test', JSON.stringify({parentName: 'Parent ' + u, phone: '555-0100', wrestlers}), 1, 'x');
fam('p1', [{id: 'w1', name: 'Jo One', grade: '8', ...card}]);
fam('p2', [{id: 'w2', name: 'Kim Two', grade: '3', ...card}]);
fam('p3', [{id: 'w3', name: 'Lee Three', grade: '9', ...card}]);
for (const [u, w] of [['p1', 'w1'], ['p2', 'w2'], ['p3', 'w3']]) sqlite.prepare('INSERT INTO usaw_reviews VALUES (?,?,?,?,?,?,?,?)').run(u, w, 'TEST-1234', '2099-12-31', 'valid', '', 'owner-id', 'x');
sqlite.prepare(`INSERT INTO staff_access VALUES ('dana@example.test','Coach Dana','["Intermediate"]',1,'x')`).run();
sqlite.prepare("INSERT INTO coach_openings(id,user_id,date,start,end,coach_email) VALUES ('op1','coach-dana',?,'16:00','17:00','dana@example.test')").run(ny(3));
sqlite.prepare("INSERT INTO academy_settings VALUES ('lessons',?,'x','o')").run(JSON.stringify({prices: {'one-on-one': 8000}, splits: {}, defaultSplit: 65}));

const quotes = load('lib/quotes.ts'), offline = load('lib/offline-payments.ts'), roster = load('lib/roster.ts'), webhook = load('lib/stripe-webhook.ts');
const coachPay = load('lib/coach-pay.ts'), view = load('lib/wrestler-view.ts'), financials = load('lib/financials.ts'), cashLib = load('lib/cash-bookings.ts');
const timesheets = load('lib/coach-timesheets.ts'), exceptions = load('lib/exceptions.ts'), alerts = load('lib/owner-alerts.ts'), secLog = load('lib/security-log.ts');
const changes = load('lib/academy-changes.ts');
const academyApi = load('app/api/academy/route.ts'), scholarshipsApi = load('app/api/scholarships/route.ts'), coachPayApi = load('app/api/coach-pay/route.ts');
const count = where => sqlite.prepare(`SELECT count(*) AS n FROM ${where}`).get().n;
const events = action => sqlite.prepare('SELECT target FROM security_events WHERE action=? ORDER BY rowid').all(action).map(r => r.target);
const T = Math.floor(Date.now() / 1000) - 3600;
// Values built inside the VM belong to another realm, so they are compared as plain JSON.
const plain = v => JSON.parse(JSON.stringify(v));
const rosterNames = (sessions, prefix) => plain(sessions.filter(s => s.key.startsWith(prefix)).flatMap(s => s.entries.map(e => [e.name, e.sources.join('/'), e.cash?.status ?? null])));

// ---------- M1: coach pay nets out a partial refund before the split ----------
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,stripe_payment_intent,livemode,created_at,updated_at,paid_at,source)
  VALUES ('les1','p1','p1@example.test','w1','Jo One','lesson',NULL,'op1','One-on-one lesson with Coach Dana',?,8000,0,8000,'usd',?,'{}','paid','p1|w1|lesson|op1','pi_les1',0,'x','x',?,'stripe')`)
  .run(JSON.stringify([ny(3)]), JSON.stringify({format: 'one-on-one', formatName: 'One-on-one lesson', coachEmail: 'dana@example.test', coachName: 'Coach Dana', start: '16:00', end: '17:00', slots: 1}), new Date().toISOString());
let r = await webhook.applyStripeEvent({id: 'evt_les_r1', type: 'charge.refunded', livemode: false, created: T, data: {object: {id: 'ch_les1', payment_intent: 'pi_les1', amount: 8000, amount_refunded: 3000, refunded: false, livemode: false}}});
assert.equal(r.outcome, 'partial-refund'); assert.equal(sqlite.prepare("SELECT status FROM orders WHERE id='les1'").get().status, 'paid');
let pay = await coachPay.coachPayReport(ny(0), ny(10));
assert.equal(pay.coaches.length, 1);
let dana = pay.coaches[0];
assert.deepEqual({gross: dana.grossCents, refunded: dana.refundedCents, owed: dana.owedCents, academy: dana.academyCents, split: dana.splitPct}, {gross: 5000, refunded: 3000, owed: 3250, academy: 1750, split: 65}, 'the coach is owed 65% of the $50 the academy kept, not of the $80 paid');
assert.deepEqual({paid: dana.lines[0].paidCents, refunded: dana.lines[0].refundedCents, net: dana.lines[0].netCents}, {paid: 8000, refunded: 3000, net: 5000}, 'the pay line shows what was refunded');
assert.equal(pay.totals.refundedCents, 3000); assert.equal(pay.totals.owedCents + pay.totals.academyCents, pay.totals.grossCents);
let csv = coachPay.coachPayCsv(pay.coaches).split('\r\n');
assert.equal(csv[0], 'Coach,Coach email,Lesson date,Start,Wrestler,Lesson type,Paid via,Paid,Refunded,Kept,Coach share %,Coach owed,Academy');
assert.equal(csv[1], `Coach Dana,dana@example.test,${ny(3)},16:00,Jo One,One-on-one lesson,Online,80.00,30.00,50.00,65,32.50,17.50`);
// The same through the owner's report route and the payroll file.
let res = await coachPayApi.GET(new Request(`https://swa.test/api/coach-pay?from=${ny(0)}&to=${ny(10)}`));
assert.equal((await res.json()).coaches[0].owedCents, 3250);
let payroll = await timesheets.monthCsv(ny(3).slice(0, 7));
assert.equal(payroll.status, 200);
assert.match(payroll.csv, /Private lessons,,"1 lesson, 50\.00 kept from families \(30\.00 refunded\)",,,65% share,32\.50,From the coach pay report/, 'the payroll file pays the share of what was kept');
// A second refund takes the total to $50 back: the coach's share follows Stripe's running total, in any order.
r = await webhook.applyStripeEvent({id: 'evt_les_r2', type: 'charge.refunded', livemode: false, created: T + 60, data: {object: {id: 'ch_les1', payment_intent: 'pi_les1', amount: 8000, amount_refunded: 5000, refunded: false, livemode: false}}});
pay = await coachPay.coachPayReport(ny(0), ny(10)); dana = pay.coaches[0];
assert.deepEqual([dana.grossCents, dana.refundedCents, dana.owedCents], [3000, 5000, 1950]);
assert.ok(readFileSync('app/coach-pay/screen.html', 'utf8').includes('refunded'), 'the coach pay page shows refunded on the pay line');

// ---------- M2a: a practice time change keeps walk-ins, cash bookings and check-ins ----------
const d = ny(2), practiceId = `Intermediate:${d}:18:00`;
r = await offline.recordOffline({userId: 'p1', wrestlerId: 'w1', kind: 'walkin', program: 'Intermediate', date: d, practiceId, method: 'check'}, 'owner-id');
assert.equal(r.status, 200, r.error); const walkinOrder = r.orderId;
r = await cashLib.bookCash({id: 'p3', email: 'p3@example.test'}, {source: 'membership', plan: 'walkin', wrestlerId: 'w3', program: 'Intermediate', date: d, practiceId});
assert.equal(r.status, 200, r.error); const cashBooking = r.booking.id;
sqlite.prepare("INSERT INTO attendance(id,session_key,session_date,user_id,wrestler_id,wrestler_name,source,checked_in_at,checked_in_by) VALUES ('att1',?,?,'p1','w1','Jo One','Walk-in paid','x','owner-id')").run(`practice:Intermediate:${d}:18:00`, d);
let ros = await roster.rosterFor(d, {role: 'owner'});
assert.deepEqual(rosterNames(ros, 'practice:Intermediate:'), [['Jo One', 'Walk-in paid', null], ['Lee Three', 'Pay at the academy', 'due']]);
const moved = clone(base); moved.seasons[0].weekly = all.map(w => ({...w, start: '18:30'}));
saveState(moved);
ros = await roster.rosterFor(d, {role: 'owner'});
const practice = ros.find(s => s.key === `practice:Intermediate:${d}:18:30`);
assert.ok(practice, 'the practice now runs at 6:30');
assert.deepEqual(rosterNames(ros, 'practice:Intermediate:'), [['Jo One', 'Walk-in paid', null], ['Lee Three', 'Pay at the academy', 'due']], 'the paid walk-in and the cash booking stay on the roster after the time change');
assert.equal(practice.entries[1].cash.bookingId, cashBooking, 'the amount due still shows');
assert.ok(practice.entries[0].checkedInAt, 'a check-in made under the old time still shows');
assert.equal((await roster.checkIn(d, practice.key, 'p1', 'w1', {role: 'owner'}, 'owner-id')).status, 200);
assert.equal(count("attendance WHERE user_id='p1'"), 1, 'checking in again adds no second row');
assert.deepEqual(plain((await view.upcomingFor('p1', 'w1', today, 7)).filter(u => u.type === 'practice').map(u => [u.date, u.start, u.why])), [[d, '18:30', 'Walk-in']], 'the family still sees the walk-in, at the new time');
assert.deepEqual(plain((await view.upcomingFor('p3', 'w3', today, 7)).map(u => [u.date, u.start, u.why, u.dueCents])), [[d, '18:30', 'Pay at the academy', 4000]]);
assert.equal((await roster.undoCheckIn(d, practice.key, 'p1', 'w1', {role: 'owner'})).status, 200);
assert.equal(count("attendance WHERE user_id='p1'"), 0, 'undo removes the check-in made under the old time');
// A coach collects cash for today's practice after its time moved.
r = await cashLib.bookCash({id: 'p2', email: 'p2@example.test'}, {source: 'membership', plan: 'walkin', wrestlerId: 'w2', program: 'Elementary', date: today, practiceId: `Elementary:${today}:18:00`});
assert.equal(r.status, 200, r.error);
const movedToo = clone(moved); movedToo.seasons[1].weekly = all.map(w => ({...w, start: '17:30'})); saveState(movedToo);
r = await cashLib.receiveCash(r.booking.id, {id: 'coach-dana', name: 'Coach Dana', email: 'dana@example.test'}, {role: 'coach', programs: ['Elementary']});
assert.equal(r.status, 200, r.error);
saveState(moved);

// ---------- M2b: a save that drops a session with paid or booked wrestlers is refused ----------
const put = (data, revision = 1) => call(academyApi, '/api/academy', {method: 'PUT', body: {revision, data}});
const rev = () => sqlite.prepare("SELECT revision FROM academy_state WHERE id='academy'").get().revision;
let before = rev();
let dayOff = clone(moved); dayOff.seasons[0].excludedDates = [d];
r = await put(dayOff, before);
assert.equal(r.status, 409);
assert.equal(r.body.error, `This change would remove sessions that families have paid for or booked: SWA Intermediate on ${dayDate(d)}, 6:30 PM has 1 paid walk-in and 1 cash booking. Move or refund those bookings first (refund in Stripe, void or cancel on Payments), or keep those dates. Changing a practice time keeps its bookings.`);
assert.deepEqual(r.body.blocked, [`SWA Intermediate on ${dayDate(d)}, 6:30 PM has 1 paid walk-in and 1 cash booking`]);
assert.equal(rev(), before, 'nothing saved'); assert.equal(events('academy_settings_saved').length, 0);
let gone = clone(moved); gone.seasons = gone.seasons.filter(s => s.program !== 'Intermediate');
assert.equal((await put(gone, before)).status, 409, 'removing the season is refused too');
let shorter = clone(moved); shorter.seasons[0].end = ny(1);
assert.equal((await put(shorter, before)).status, 409, 'ending the season before the booked date is refused');
let noWeekday = clone(moved); noWeekday.seasons[0].weekly = all.filter(w => w.day !== new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', weekday: 'long'}));
assert.equal((await put(noWeekday, before)).status, 409, 'taking the weekday out is refused');
// A time change on its own saves, and the security log says what changed.
let timeChange = clone(moved); timeChange.seasons[0].weekly = all.map(w => ({...w, start: '18:15'}));
r = await put(timeChange, before);
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(rev(), before + 1);
assert.deepEqual(events('academy_settings_saved'), [`schedule changed: SWA Intermediate ${fullDate(ny(-30))} to ${fullDate(ny(90))}`]);
assert.deepEqual(rosterNames(await roster.rosterFor(d, {role: 'owner'}), 'practice:Intermediate:').map(x => x[0]), ['Jo One', 'Lee Three']);
// A day off on a past date, or a date nobody booked, is fine.
let pastOff = clone(timeChange); pastOff.seasons[0].excludedDates = [ny(-1), ny(3)];
assert.equal((await put(pastOff, rev())).status, 200);
// Events: a paid registration keeps its dates; seats and prices can change.
r = await offline.recordOffline({userId: 'p1', wrestlerId: 'w1', kind: 'event', eventId: 'camp', option: 'full', method: 'cash'}, 'owner-id');
assert.equal(r.status, 200, r.error);
let movedCamp = clone(pastOff); movedCamp.events[0].dates = [ny(11), ny(12)];
r = await put(movedCamp, rev());
assert.equal(r.status, 409); assert.deepEqual(r.body.blocked, [`Winter camp on ${dayDate(ny(10))} has 1 paid registration`]);
let archived = clone(pastOff); archived.events[0].archived = true;
assert.equal((await put(archived, rev())).status, 409, 'archiving a camp with registrations is refused');
let fewerSeats = clone(pastOff); fewerSeats.events[0].slots = 1; fewerSeats.events[0].price = 150;
assert.equal((await put(fewerSeats, rev())).status, 200);
assert.equal(events('academy_settings_saved').at(-1), 'Winter camp: price $160.00 → $150.00, seats 2 → 1');
// Extra practices: a cash booking keeps its date.
r = await cashLib.bookCash({id: 'p3', email: 'p3@example.test'}, {source: 'booking', type: 'live', wrestlerId: 'w3', id: 'fnl', date: ny(5)});
assert.equal(r.status, 200, r.error);
let fewerNights = clone(fewerSeats); fewerNights.extraPractices[0].dates = [ny(12)];
r = await put(fewerNights, rev());
assert.equal(r.status, 409); assert.deepEqual(r.body.blocked, [`Friday Night Live on ${dayDate(ny(5))}, 5:00 PM has 1 cash booking`]);
// A booking the saved settings already dropped never blocks a later save: the owner is not stuck.
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source)
  VALUES ('orphan','p2','p2@example.test','w2','Kim Two','walkin','Elementary',?,'SWA Development walk-in',?,3500,0,3500,'usd','{}','{}','paid','orphan-key',0,'x','x','x','offline')`).run(`Elementary:${ny(100)}:18:00`, JSON.stringify([ny(100)]));
let codeChange = clone(fewerSeats); codeChange.teamCodes[0].percent = 15; codeChange.programs[1].walkInPriceCents = 4500;
r = await put(codeChange, rev());
assert.equal(r.status, 200);
assert.equal(events('academy_settings_saved').at(-1), 'SWA Intermediate walk-in $40.00 → $45.00; team code TEAM10: 10% → 15%');
assert.equal((await put(clone(codeChange), rev())).status, 200);
assert.equal(events('academy_settings_saved').at(-1), 'no change to prices, schedules, events, extra practices or team codes');
assert.equal(changes.changeSummary(null, codeChange), 'first save');
assert.ok(changes.blockedMessage(Array.from({length: 8}, (_, i) => `session ${i}`)).includes('; and 2 more sessions.'), 'long lists are cut short');
const help = readFileSync('app/help/owner/screen.html', 'utf8');
assert.match(help, /refuses a save that would remove a session families have paid for/, 'the owner guide explains the rule');
assert.match(help, /Changing a practice’s time on the same day is fine/);
saveState(codeChange);

// ---------- M3: a member is not charged for a walk-in the membership covers ----------
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
  VALUES ('mem2','p2','p2@example.test','w2','Kim Two','monthly','Elementary','Elementary','Membership','[]',20000,0,20000,'usd','{}','{}','paid','p2|w2|monthly|Elementary|x',0,'x','x',?,?,?,'stripe')`).run(new Date().toISOString(), ny(-5), ny(20));
const covered = {wrestlerId: 'w2', program: 'Elementary', plan: 'walkin', date: ny(4), practiceId: `Elementary:${ny(4)}:18:00`};
let q = await quotes.quoteMembership('p2', covered, {checkoutKinds: new Set(['walkin'])});
assert.equal(q.ok, false); assert.equal(q.status, 409);
assert.equal(q.error, `Kim Two's membership already covers SWA Development practices on ${dayDate(ny(4))}, so there is nothing to pay for this walk-in. Just come to practice.`);
r = await offline.recordOffline({userId: 'p2', wrestlerId: 'w2', kind: 'walkin', program: 'Elementary', date: ny(4), practiceId: covered.practiceId, method: 'cash'}, 'owner-id');
assert.equal(r.status, 409, 'the owner cannot record a walk-in payment for a member either');
assert.equal((await cashLib.bookCash({id: 'p2', email: 'p2@example.test'}, {source: 'membership', ...covered})).status, 409);
q = await quotes.quoteMembership('p2', {...covered, date: ny(25), practiceId: `Elementary:${ny(25)}:18:00`}, {checkoutKinds: new Set(['walkin'])});
assert.equal(q.ok, true, 'after the paid-through date a walk-in is sold again');
q = await quotes.quoteMembership('p2', {...covered, program: 'Intermediate', practiceId: `Intermediate:${ny(4)}:18:15`}, {checkoutKinds: new Set(['walkin'])});
assert.equal(q.status, 403, 'another program is judged on its own rules (grade here), not on the membership');
assert.equal(count("orders WHERE user_id='p2' AND kind='walkin' AND status='paid'"), 2, 'only the orphan test row and the cash walk-in collected above');

// ---------- R2 (engineering): recordOffline is one transaction ----------
r = await cashLib.bookCash({id: 'p3', email: 'p3@example.test'}, {source: 'membership', plan: 'walkin', wrestlerId: 'w3', program: 'Intermediate', date: ny(6), practiceId: `Intermediate:${ny(6)}:18:15`});
assert.equal(r.status, 200, r.error); const due = r.booking.id;
sqlite.exec("CREATE TRIGGER boom BEFORE UPDATE ON cash_bookings BEGIN SELECT RAISE(ABORT,'boom'); END");
const ordersBefore = count('orders'), eventsBefore = count('security_events');
r = await offline.recordOffline({userId: 'p3', wrestlerId: 'w3', kind: 'walkin', program: 'Intermediate', date: ny(6), practiceId: `Intermediate:${ny(6)}:18:15`, method: 'cash'}, 'owner-id');
assert.equal(r.status, 409);
assert.equal(count('orders'), ordersBefore, 'when linking the cash booking fails, no payment is written either');
assert.equal(count('security_events'), eventsBefore);
assert.equal(sqlite.prepare('SELECT status FROM cash_bookings WHERE id=?').get(due).status, 'due');
sqlite.exec('DROP TRIGGER boom');
const q0 = stats.queries;
r = await offline.recordOffline({userId: 'p3', wrestlerId: 'w3', kind: 'walkin', program: 'Intermediate', date: ny(6), practiceId: `Intermediate:${ny(6)}:18:15`, method: 'cash'}, 'owner-id');
assert.equal(r.status, 200, r.error);
assert.deepEqual({...sqlite.prepare('SELECT status,order_id FROM cash_bookings WHERE id=?').get(due)}, {status: 'paid', order_id: r.orderId}, 'the booking is paid and linked in the same transaction');
assert.deepEqual(events('offline_payment_recorded').filter(t => t.startsWith(r.orderId)), [`${r.orderId} walkin 4500`]);
r = await offline.recordOffline({userId: 'p3', wrestlerId: 'w3', kind: 'walkin', program: 'Intermediate', date: ny(6), practiceId: `Intermediate:${ny(6)}:18:15`, method: 'cash'}, 'owner-id');
assert.equal(r.status, 409, 'a second payment for the same item is refused whole');
assert.equal(count('security_events'), eventsBefore + 1);
// An event that fills up between the quote and the write is voided, and the void is logged.
sqlite.prepare("UPDATE orders SET status='canceled' WHERE kind='event' AND user_id='p1'").run();
saveState({...codeChange, events: [{...codeChange.events[0], slots: 1}]});
r = await offline.recordOffline({userId: 'p1', wrestlerId: 'w1', kind: 'event', eventId: 'camp', option: 'full', method: 'cash'}, 'owner-id');
assert.equal(r.status, 200, r.error);
r = await offline.recordOffline({userId: 'p3', wrestlerId: 'w3', kind: 'event', eventId: 'camp', option: 'full', method: 'cash'}, 'owner-id');
assert.equal(r.status, 409, 'full');
saveState(codeChange);
// revokeException: the revocation and its log line are one transaction, and two clicks log once.
r = await exceptions.grantException('owner-id', {userId: 'p1', wrestlerId: 'w1', rule: 'waiver', endsOn: ny(10), reason: 'paper copy on file'});
assert.equal(r.status, 200);
assert.equal((await exceptions.revokeException('owner-id', r.id)).status, 200);
assert.equal((await exceptions.revokeException('owner-id', r.id)).status, 404);
assert.deepEqual(events('booking_exception_removed'), [r.id]);
assert.equal((await exceptions.revokeException('owner-id', 'nope')).status, 404);

// ---------- R1: scholarship offers and revocations are logged ----------
r = await call(scholarshipsApi, '/api/scholarships', {method: 'POST', body: {action: 'create', email: 'new@example.test', wrestlerName: 'Sky New', program: 'Elementary'}});
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.deepEqual(events('scholarship_offered'), [`${r.body.award.id} Elementary 20000`]);
r = await call(scholarshipsApi, '/api/scholarships', {method: 'POST', body: {action: 'revoke', id: r.body.award.id, revision: r.body.award.revision}});
assert.equal(r.status, 200); assert.equal(r.body.award.status, 'revoked');
assert.deepEqual(events('scholarship_revoked'), [`${r.body.award.id} Elementary 20000`]);
const names = {people: {}, you: ['owner-id'], approvals: {}, waitlist: {}, orders: {les1: {wrestler: 'Jo One', item: 'One-on-one lesson with Coach Dana'}}, waivers: {}, wrestlers: {}, requests: {}, curricula: {}, coaches: {}, scholarships: {[r.body.award.id]: 'Sky New'}};
let entry = secLog.describeSecurityEvent({actor: 'owner-id', action: 'scholarship_offered', target: `${r.body.award.id} Elementary 20000`, created_at: new Date().toISOString()}, names);
assert.equal(entry.title, 'Scholarship offered'); assert.equal(entry.detail, 'Sky New · SWA Development · $200.00 a month'); assert.equal(entry.who, 'You');
entry = secLog.describeSecurityEvent({actor: 'owner-id', action: 'academy_settings_saved', target: 'Winter camp: seats 2 → 1', created_at: new Date().toISOString()}, names);
assert.equal(entry.title, 'Academy settings saved'); assert.equal(entry.detail, 'Winter camp: seats 2 → 1');
const page = await secLog.securityLogPage(['owner-id']);
assert.ok(page.entries.some(e => e.title === 'Scholarship offered' && e.detail.startsWith('Sky New')), 'the security log page names the wrestler');

// ---------- M6: card disputes ----------
const dispute = (id, type, extra = {}) => webhook.applyStripeEvent({id, type, livemode: false, created: T + 120, data: {object: {id: 'dp_1', object: 'dispute', charge: 'ch_les1', payment_intent: 'pi_les1', amount: 3000, currency: 'usd', reason: 'fraudulent', status: 'needs_response', livemode: false, ...extra}}});
r = await dispute('evt_dp_created', 'charge.dispute.created');
assert.deepEqual(plain(r), {outcome: 'disputed', orderId: 'les1', duplicate: false});
assert.deepEqual({...sqlite.prepare('SELECT dispute_id,order_id,payment_intent,charge_id,kind,amount_cents,reason,status,livemode FROM payment_disputes WHERE id=?').get('evt_dp_created')},
  {dispute_id: 'dp_1', order_id: 'les1', payment_intent: 'pi_les1', charge_id: 'ch_les1', kind: 'created', amount_cents: 3000, reason: 'fraudulent', status: 'needs_response', livemode: 0});
assert.deepEqual(events('payment_disputed'), ['les1 3000 fraudulent']);
assert.deepEqual(sqlite.prepare('SELECT method,path,status FROM error_log').all().map(e => ({...e})), [{method: 'STRIPE', path: '/stripe-dispute', status: 409}], 'the owner alert path has one line, with no family details');
assert.equal(sqlite.prepare("SELECT status FROM orders WHERE id='les1'").get().status, 'paid', 'the payment itself stays as it was');
r = await dispute('evt_dp_created', 'charge.dispute.created');
assert.equal(r.duplicate, true); assert.equal(count('payment_disputes'), 1); assert.equal(count('error_log'), 1, 'a replay changes nothing');
// The alert email names the dispute plainly.
let mail = alerts.alertEmail(sqlite.prepare('SELECT at,path,status FROM error_log').all().map(e => ({...e})), 'https://swa.test');
assert.equal(mail.subject, 'Site alert: a family disputed a card payment');
assert.match(mail.text, /Needs your attention:\n- A family disputed a card payment with their bank\. Open Payments \(the payment says Disputed\), then answer the dispute in Stripe before its deadline\n/);
mail = alerts.alertEmail([{at: 'x', path: '/stripe-dispute', status: 409}, {at: 'y', path: '/api/roster', status: 500}], null);
assert.equal(mail.subject, 'Site alert: 2 new problems on the academy site'); assert.match(mail.text, /Server errors, by page:/);
// Payments flags the payment; its spreadsheet has a Dispute column.
let list = await offline.listPayments({});
let les = list.payments.find(p => p.id === 'les1');
assert.deepEqual(plain(les.dispute), {status: 'open', amountCents: 3000, at: new Date((T + 120) * 1000).toISOString()});
assert.equal(list.payments.find(p => p.id === walkinOrder).dispute, null);
let pcsv = offline.paymentsCsv(list.payments).split('\r\n');
assert.match(pcsv[0], /,Void reason,Dispute,Refunded,Refunded on,Card payments,Stripe fee,Net after Stripe fee$/);
assert.ok(pcsv.some(l => l.includes('One-on-one lesson with Coach Dana') && l.includes(',Open,')), 'the lesson row says Open');
// The bank takes the money: money out in the books on that day, as a refund-like line; the payment still stands.
r = await dispute('evt_dp_withdrawn', 'charge.dispute.funds_withdrawn', {status: 'under_review'});
assert.equal(r.outcome, 'dispute-funds-withdrawn');
let lines = await financials.ledgerLines(ny(-1), ny(1));
let out = lines.find(l => l.id === 'dispute:evt_dp_withdrawn');
assert.deepEqual({type: out.type, category: out.category, amount: out.amountCents, description: out.description, source: out.source}, {type: 'refund', category: 'Disputed payments', amount: 3000, description: 'Disputed payment taken back by the bank: One-on-one lesson with Coach Dana · Jo One', source: 'online'});
assert.equal(financials.totals(lines).refundsCents, 3000 + 5000, 'the dispute and the refunds are money out');
// The academy wins: the money comes back in, and Payments says so.
r = await dispute('evt_dp_won', 'charge.dispute.funds_reinstated', {status: 'won'});
assert.equal(r.outcome, 'dispute-funds-reinstated');
r = await dispute('evt_dp_closed', 'charge.dispute.closed', {status: 'won'});
assert.equal(r.outcome, 'dispute-closed');
lines = await financials.ledgerLines(ny(-1), ny(1));
const back = lines.find(l => l.id === 'dispute:evt_dp_won');
assert.deepEqual([back.type, back.category, back.amountCents], ['income', 'Disputes won', 3000]);
list = await offline.listPayments({}); les = list.payments.find(p => p.id === 'les1');
assert.equal(les.dispute.status, 'won');
assert.deepEqual(events('dispute_closed'), ['les1 3000 won']);
assert.deepEqual(plain(offline.disputeStates([{id: 'a', order_id: 'o', kind: 'created', amount_cents: 100, status: 'needs_response', occurred_at: '2'}, {id: 'b', order_id: 'o', kind: 'closed', amount_cents: 100, status: 'lost', occurred_at: '3'}]).get('o')), {status: 'lost', amountCents: 100, at: '3'});
// A dispute for an unknown payment, or one from the other Stripe mode, is recorded and ignored or refused.
r = await webhook.applyStripeEvent({id: 'evt_dp_unknown', type: 'charge.dispute.created', livemode: false, created: T, data: {object: {id: 'dp_2', payment_intent: 'pi_nobody', amount: 100, livemode: false}}});
assert.equal(r.outcome, 'ignored:unknown-payment');
r = await webhook.applyStripeEvent({id: 'evt_dp_live', type: 'charge.dispute.created', livemode: true, created: T, data: {object: {id: 'dp_3', payment_intent: 'pi_les1', amount: 100, livemode: true}}});
assert.equal(r.outcome, 'rejected:mode-mismatch');
assert.equal(count('payment_disputes'), 4);
entry = secLog.describeSecurityEvent({actor: 'stripe', action: 'payment_disputed', target: 'les1 3000 fraudulent', created_at: new Date().toISOString()}, names);
assert.equal(entry.title, 'Card payment disputed by the family’s bank'); assert.equal(entry.who, 'Stripe');
assert.equal(entry.detail, 'Jo One · One-on-one lesson with Coach Dana · $30.00 · the family says they did not make it · Answer it in Stripe before its deadline.');
assert.match(readFileSync('app/payments/screen.html', 'utf8'), /Dispute won/);
for (const doc of ['docs/GO_LIVE.md', 'docs/RUNBOOK.md']) assert.match(readFileSync(doc, 'utf8'), /charge\.dispute\.created/, doc + ' lists the dispute events');

// ---------- R6: the two pages say how they time refunds ----------
assert.match(readFileSync('app/payments/screen.html', 'utf8'), /A refund is taken off the payment it belongs to here, on the payment’s own date/);
assert.match(readFileSync('app/financials/screen.html', 'utf8'), /Payments<\/a> instead takes a refund off the payment it belongs to/);

console.log('Audit batch 1 (money and records) tests passed');
