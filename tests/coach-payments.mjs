// Issue #370 (decided by Lauren on Nov 19, 2026): every payment the academy makes to a coach is recorded, each coach
// has a balance (earned less paid), the payments are money out in the books, and the dashboard reads the totals.
// Runs the real routes against a database built from every migration, with the Supabase stand-in from tests/accounts.mjs.
import assert from 'node:assert/strict';
import {load, request, sqlite, users} from './accounts.mjs';

const P = load('lib/coach-payments.ts'), books = load('lib/financials.ts'), log = load('lib/security-log.ts');
const staff = load('app/api/staff/route.ts'), api = load('app/api/coach-payments/route.ts');
const reply = async r => ({status: r.status, body: await r.json()});
const post = (route, path, body, who) => route.POST(request(path, 'POST', body, who)).then(reply);
const get = (route, path, who) => route.GET(request(path, 'GET', null, who)).then(reply);
// Values made inside the loaded modules, and database rows, compare by content.
const plain = v => v === undefined ? null : JSON.parse(JSON.stringify(v)), deq = (a, b, why) => assert.deepEqual(plain(a), plain(b), why);
const row = (sql, ...a) => sqlite.prepare(sql).get(...a);
const DANA = 'dana.coach@example.test', LEE = 'lee.coach@example.test', TODAY = '2026-11-18', now = new Date('2026-11-18T17:00:00Z');
for (const [k, email] of [['dana', DANA], ['lee', LEE]]) users[k] = {id: k + '-uuid', email, email_confirmed_at: '2026-10-15'};
for (const [email, name] of [[DANA, 'Coach Dana'], [LEE, 'Coach Lee']]) assert.equal((await post(staff, '/api/staff', {action: 'grant', email, name, programs: ['Intermediate']}, 'owner')).status, 200);

// ---------- What has been earned ----------
// Dana: one approved shift ($60.00, frozen at approval), one shift sent and not approved (1 h 30 min as head coach,
// $60.00), one lesson taught ($60.00 paid, her share 65% = $39.00) and one paid for but dated after today.
const shift = (id, day, extra) => sqlite.prepare(`INSERT INTO coach_time_entries(id,user_id,coach_email,coach_name,work_date,session_key,session_title,session_start,session_end,duty,source,clock_in,clock_out,submitted_at,approved_at,approved_by,approved_minutes,approved_duty,approved_rate_cents,approved_cents,history,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, 'dana-uuid', DANA, 'Coach Dana', day, `practice:Intermediate:${day}:18:00`, 'SWA Intermediate', '18:00', '19:30', 'head', 'clock', day + 'T23:00:00.000Z', day.replace(/\d\d$/, d => String(Number(d) + 1).padStart(2, '0')) + 'T00:30:00.000Z',
  '2026-11-10T12:00:00.000Z', extra.approved ? '2026-11-11T12:00:00.000Z' : null, extra.approved ? 'owner-uuid' : null, extra.approved ? 90 : null, extra.approved ? 'head' : null, extra.approved ? 4000 : null, extra.approved ? 6000 : null, '[]', day + 'T23:00:00.000Z');
shift('00000000-0000-4000-8000-000000000001', '2026-10-05', {approved: true});
shift('00000000-0000-4000-8000-000000000002', '2026-11-02', {approved: false});
const lesson = (id, date, cents) => sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source)
  VALUES (?,'alice-uuid','alice@example.test','w','Sam Example','lesson',?,'Lesson',?,?,0,?,'usd',?,'{}','paid',?,0,'t','t','2026-11-01T15:00:00.000Z','offline')`)
  .run(id, 'op-' + id, JSON.stringify([date]), cents, cents, JSON.stringify({coachEmail: DANA, coachName: 'Coach Dana', formatName: 'One-on-one lesson', start: '16:00', method: 'cash'}), 'k-' + id);
lesson('L-taught', '2026-11-12', 6000); lesson('L-later', '2999-01-05', 6000);

let p = await P.payroll(TODAY);
const dana = () => p.coaches.find(c => c.email === DANA), lee = () => p.coaches.find(c => c.email === LEE);
deq({...dana()}, {email: DANA, name: 'Coach Dana', active: true, practiceCents: 6000, lessonCents: 3900, lessonShareSet: true, earnedCents: 9900, paidCents: 0, owedCents: 9900, aheadCents: 0, pendingCents: 6000, payments: 0, lastPaidOn: null},
  'earned is approved practice pay plus the share of lessons taught; the shift not approved and the lesson still to come are not owed yet');
deq([lee().earnedCents, lee().owedCents, lee().active], [0, 0, true], 'an active coach with nothing yet is still listed, to be paid later');
deq(plain(p.totals), {earnedCents: 9900, paidCents: 0, owedCents: 9900, aheadCents: 0, pendingCents: 6000, paidThisMonthCents: 0, paymentsThisMonth: 0, shareNotSet: 0});
deq(plain(p.payments), []); deq(p.methods.map(m => m.label), ['Check', 'Cash', 'Bank transfer', 'Zelle', 'Venmo', 'Other']);
assert.equal((await P.payroll('2999-01-05')).coaches.find(c => c.email === DANA).lessonCents, 7800, 'a lesson counts from the day it is taught');

// ---------- Recording a payment ----------
const good = {action: 'add', coach: DANA, paidOn: '2026-11-15', amountCents: 5000, method: 'check', periodFrom: '2026-11-01', periodTo: '2026-11-15', note: '  Check   1042 '};
for (const [bad, why] of [[{coach: 'nobody@example.test'}, /Choose the coach/], [{coach: ''}, /Choose the coach/], [{paidOn: '2026-11-19'}, /cannot be in the future/], [{paidOn: 'soon'}, /date you paid/],
  [{amountCents: 0}, /amount you paid/], [{amountCents: 50.5}, /amount you paid/], [{amountCents: '5000'}, /amount you paid/], [{amountCents: 100000001}, /amount you paid/], [{method: 'crypto'}, /how you paid/],
  [{periodTo: null}, /both dates/], [{periodFrom: '2026-11-16'}, /first and last day/], [{periodFrom: 'x'}, /first and last day/], [{note: 'x'.repeat(301)}, /300 characters/], [{note: 7}, /300 characters/]]) {
  const r = await P.addPayment('owner-uuid', {...good, ...bad}, now); assert.equal(r.status, 400, JSON.stringify(bad)); assert.match(r.error, why);
}
assert.equal(row('SELECT count(*) AS n FROM coach_payments').n, 0, 'nothing is saved when a field is wrong');
let r = await P.addPayment('owner-uuid', good, now);
assert.equal(r.status, 200); deq({...r.payment, id: 'x'}, {id: 'x', coachEmail: DANA, coach: 'Coach Dana', paidOn: '2026-11-15', amountCents: 5000, method: 'check', methodLabel: 'Check', periodFrom: '2026-11-01', periodTo: '2026-11-15', note: 'Check 1042'});
const firstId = r.payment.id;
deq(plain(row('SELECT coach_name,created_by FROM coach_payments WHERE id=?', firstId)), {coach_name: 'Coach Dana', created_by: 'owner-uuid'}, 'the name comes from Coaches, never from the browser');
assert.equal((await P.addPayment('owner-uuid', good, new Date(now.getTime() + 30000))).status, 409, 'the same payment sent again within two minutes is recorded once');
assert.equal((await P.addPayment('owner-uuid', {...good, amountCents: 5001}, new Date(now.getTime() + 30000))).status, 200, 'a different amount is another payment');
assert.equal((await P.deletePayment('owner-uuid', {id: row('SELECT id FROM coach_payments WHERE amount_cents=5001').id})).status, 200);
p = await P.payroll(TODAY);
deq([dana().paidCents, dana().owedCents, dana().aheadCents, dana().payments, dana().lastPaidOn], [5000, 4900, 0, 1, '2026-11-15']);
deq([p.totals.paidCents, p.totals.owedCents, p.totals.paidThisMonthCents, p.totals.paymentsThisMonth], [5000, 4900, 5000, 1]);
// Paid before the month is approved: more paid than earned so far is "paid ahead", never a negative amount owed.
r = await P.addPayment('owner-uuid', {action: 'add', coach: DANA, paidOn: '2026-11-18', amountCents: 6000, method: 'zelle'}, now);
assert.equal(r.status, 200); deq([r.payment.periodFrom, r.payment.periodTo, r.payment.note], [null, null, '']);
p = await P.payroll(TODAY);
deq([dana().paidCents, dana().owedCents, dana().aheadCents], [11000, 0, 1100]); deq([p.totals.owedCents, p.totals.aheadCents], [0, 1100]);
// One coach paid ahead never hides what another is owed.
sqlite.prepare("UPDATE coach_time_entries SET coach_email=?,coach_name='Coach Lee',user_id='lee-uuid' WHERE id='00000000-0000-4000-8000-000000000002'").run(LEE);
sqlite.prepare("UPDATE coach_time_entries SET approved_at='2026-11-17T12:00:00.000Z',approved_by='owner-uuid',approved_minutes=90,approved_duty='head',approved_rate_cents=4000,approved_cents=6000 WHERE id='00000000-0000-4000-8000-000000000002'").run();
p = await P.payroll(TODAY);
deq([lee().owedCents, dana().aheadCents, p.totals.owedCents, p.totals.aheadCents, p.totals.pendingCents], [6000, 1100, 6000, 1100, 0]);
deq(p.payments.map(x => [x.paidOn, x.amountCents, x.methodLabel]), [['2026-11-18', 6000, 'Zelle'], ['2026-11-15', 5000, 'Check']], 'newest first');
// A payment last month is not in "paid this month".
assert.equal((await P.addPayment('owner-uuid', {action: 'add', coach: LEE, paidOn: '2026-10-31', amountCents: 1000, method: 'cash'}, now)).status, 200);
p = await P.payroll(TODAY); deq([p.totals.paidCents, p.totals.paidThisMonthCents, p.totals.paymentsThisMonth, lee().owedCents], [12000, 11000, 2, 5000]);
// ---------- Deleting a payment entered by mistake ----------
assert.equal((await P.deletePayment('owner-uuid', {id: 'nope'})).status, 400);
assert.equal((await P.deletePayment('owner-uuid', {id: '00000000-0000-4000-8000-00000000ffff'})).status, 404);
assert.equal((await P.deletePayment('owner-uuid', {id: firstId})).status, 200);
assert.equal(row('SELECT count(*) AS n FROM coach_payments WHERE id=?', firstId).n, 0, 'deleted, not kept crossed out');
assert.equal((await P.deletePayment('owner-uuid', {id: firstId})).status, 404, 'a second delete finds nothing');
p = await P.payroll(TODAY); deq([dana().paidCents, dana().owedCents, dana().aheadCents], [6000, 3900, 0], 'the balance goes back');

// ---------- The security log keeps a line for each ----------
{
  const lines = plain(sqlite.prepare("SELECT actor,action,target FROM security_events WHERE action LIKE 'coach_payment_%' ORDER BY rowid").all());
  deq(lines[0], {actor: 'owner-uuid', action: 'coach_payment_recorded', target: `${DANA} · $50.00 · 2026-11-15 · Check · for 2026-11-01 to 2026-11-15`});
  deq(lines.at(-1), {actor: 'owner-uuid', action: 'coach_payment_deleted', target: `${DANA} · $50.00 · 2026-11-15 · Check · for 2026-11-01 to 2026-11-15`});
  deq(lines.map(l => l.action.replace('coach_payment_', '')), ['recorded', 'recorded', 'deleted', 'recorded', 'recorded', 'deleted']);
  const names = {people: {}, you: [], approvals: {}, waitlist: {}, orders: {}, waivers: {}, wrestlers: {}, requests: {}, curricula: {}, coaches: {[DANA]: 'Coach Dana'}};
  const said = log.describeSecurityEvent({...lines[0], created_at: now.toISOString()}, names, now);
  deq([said.title, said.detail], ['Payment to a coach recorded', `Coach Dana (${DANA}) · $50.00 · 2026-11-15 · Check · for 2026-11-01 to 2026-11-15`]);
  assert.equal(log.describeSecurityEvent({...lines.at(-1), created_at: now.toISOString()}, names, now).title, 'Payment to a coach deleted');
}

// ---------- The books: each payment is money out under Coach pay, on the day paid, without being typed again ----------
{
  const nov = await books.ledgerLines('2026-11-01', '2026-11-30'), pay = nov.filter(l => l.source === 'payroll');
  deq(pay.map(l => [l.date, l.type, l.category, l.description, l.method, l.amountCents, l.entryId]), [['2026-11-18', 'expense', 'Coach pay', 'Paid to Coach Dana', 'Zelle', 6000, null]]);
  assert.equal(books.totals(nov).expensesCents, 6000); assert.ok(books.categories(nov).out.some(c => c.category === 'Coach pay' && c.cents === 6000));
  deq((await books.ledgerLines('2026-10-01', '2026-10-31')).filter(l => l.source === 'payroll').map(l => [l.date, l.description, l.method, l.amountCents]), [['2026-10-31', 'Paid to Coach Lee', 'Cash', 1000]]);
  assert.equal((await P.addPayment('owner-uuid', {action: 'add', coach: LEE, paidOn: '2026-11-16', amountCents: 2500, method: 'bank', periodFrom: '2026-11-01', periodTo: '2026-11-15', note: 'First half'}, now)).status, 200);
  const again = await books.ledgerLines('2026-11-01', '2026-11-30');
  assert.ok(again.some(l => l.description === 'Paid to Coach Lee for 2026-11-01 to 2026-11-15 · First half' && l.method === 'Bank transfer' && l.amountCents === 2500));
  const csv = books.ledgerCsv(again);
  assert.match(csv, /^2026-11-16,Expense,Payment to a coach,Coach pay,Paid to Coach Lee for 2026-11-01 to 2026-11-15 · First half,Bank transfer,,25\.00,,\r?$/m, 'in the spreadsheet as money out');
  assert.ok(!books.SUGGESTIONS.expense.includes('Coach pay'), 'Coach pay is no longer offered as an expense to type in, so a payment is not entered twice');
}

// ---------- The owner's page data: owner only, same origin, and the reply carries the balances as they now stand ----------
for (const who of ['', 'alice', 'dana']) {
  assert.equal((await get(api, '/api/coach-payments', who)).status, 403, 'owner only: ' + (who || 'signed out'));
  assert.equal((await post(api, '/api/coach-payments', {action: 'add', coach: DANA, paidOn: '2026-11-01', amountCents: 100, method: 'cash'}, who)).status, 403);
}
assert.equal((await api.POST(request('/api/coach-payments', 'POST', {action: 'delete', id: firstId}, 'owner', 'https://evil.test'))).status, 403, 'same origin only');
assert.equal((await post(api, '/api/coach-payments', {action: 'pay-everyone'}, 'owner')).status, 400);
r = await get(api, '/api/coach-payments', 'owner');
assert.equal(r.status, 200); deq(Object.keys(r.body).sort(), ['coaches', 'methods', 'morePayments', 'payments', 'today', 'totals', 'year']);
assert.equal(r.body.coaches.find(c => c.email === DANA).paidCents, 6000);
{
  const today = r.body.today, before = r.body.totals.paidCents;
  r = await post(api, '/api/coach-payments', {action: 'add', coach: DANA, paidOn: today, amountCents: 1234, method: 'venmo', note: 'Lesson shares'}, 'owner');
  deq([r.status, r.body.ok, r.body.payment.amountCents, r.body.payment.methodLabel, r.body.totals.paidCents], [200, true, 1234, 'Venmo', before + 1234]);
  assert.equal((await post(api, '/api/coach-payments', {action: 'add', coach: DANA, paidOn: today, amountCents: 1234, method: 'venmo'}, 'owner')).status, 409);
  r = await post(api, '/api/coach-payments', {action: 'delete', id: r.body.payment.id}, 'owner');
  deq([r.status, r.body.ok, r.body.totals.paidCents, r.body.payment], [200, true, before, undefined]);
  assert.equal((await post(api, '/api/coach-payments', {action: 'add', coach: 'x@example.test', paidOn: today, amountCents: 100, method: 'cash'}, 'owner')).body.error, 'Choose the coach you paid.');
}
console.log('Passed: payments to coaches are recorded by the owner only, checked on the server and recorded once; a coach’s balance is approved practice pay plus lesson shares for lessons taught, less what was paid, with paid ahead never hiding what another coach is owed; a deleted payment is gone and the balance goes back; each payment is money out in the books under Coach pay and has its line in the security log.');
