// Issue #367: paying coaches from the reports. The Coach pay page has shortcuts for the periods an owner pays for and
// marks lessons that are paid for but not taught yet; Coach hours shows one total to pay per coach and overall. The
// page scripts run in a fake DOM (inline JavaScript is not typechecked).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read = f => readFileSync(f, 'utf8');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
function page(file, fetch) {
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, disabled: false, innerHTML: '', textContent: '', href: '', dataset: {}, style: {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => []}); return nodes.get(id); };
  const ctx = vm.createContext({document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, readyState: 'complete', head: {appendChild() {}}, createElement: () => ({})},
    location: {search: '', hash: ''}, fetch, confirm: () => true, print() {}, URLSearchParams, Date, Intl, JSON, Promise, Error, Object, Array, Number, String, Set, Map, Math, console, window: {}, history: {replaceState() {}}});
  for (const [, src, code] of read(file).matchAll(/<script(?: src="\/([\w-]+\.js)")?>([\s\S]*?)<\/script>/g)) vm.runInContext(src ? read('public/' + src) : code, ctx);
  return {el, ctx, run: s => vm.runInContext(s, ctx)};
}
const json = body => ({ok: true, status: 200, json: async () => body});
const plain = v => JSON.parse(JSON.stringify(v));

// ---------- Coach pay: the periods an owner pays for ----------
const line = (orderId, date, netCents, extra = {}) => ({orderId, date, start: '16:00', wrestler: 'Sam Example', format: 'One-on-one lesson', paidCents: netCents, refundedCents: 0, netCents, source: 'stripe', ...extra});
const report = {from: '2026-11-01', to: '2026-11-30', coaches: [
  {coachEmail: 'dana@example.test', coach: 'Coach Dana', lessons: 3, wrestlers: 4, grossCents: 21000, refundedCents: 0, splitPct: 65, owedCents: 13650, academyCents: 7350,
    lines: [line('a', '2020-11-02', 6000), line('b', '2999-01-05', 4500, {wrestler: 'Riley Two'}), line('c', '2999-01-05', 4500), line('d', '2999-01-06', 6000)]},
  {coachEmail: 'lee@example.test', coach: 'Coach Lee', lessons: 1, wrestlers: 1, grossCents: 6000, refundedCents: 0, splitPct: 70, owedCents: 4200, academyCents: 1800, lines: [line('e', '2020-11-03', 6000)]}],
  totals: {lessons: 4, wrestlers: 5, grossCents: 27000, refundedCents: 0, owedCents: 17850, academyCents: 9150, unsetCoaches: 0}};
const asked = [];
const pay = page('app/coach-pay/screen.html', async url => { asked.push(url); return json(report); });
await settle();
const html = read('app/coach-pay/screen.html');
assert.match(html, /<select id="preset"><option value="this">This month<\/option><option value="sofar">This month so far<\/option><option value="two">Last 14 days<\/option><option value="last">Last month<\/option><option value="custom">Custom<\/option><\/select>/);
// Each shortcut's dates, for a made-up today.
assert.deepEqual(plain(pay.run("presetRange('sofar','2026-11-18')")), ['2026-11-01', '2026-11-18'], 'this month so far: the 1st to today');
assert.deepEqual(plain(pay.run("presetRange('two','2026-11-18')")), ['2026-11-05', '2026-11-18'], 'last 14 days: today and the 13 days before it');
assert.deepEqual(plain(pay.run("presetRange('two','2026-03-05')")), ['2026-02-20', '2026-03-05'], 'the 14 days cross a month end');
assert.deepEqual(plain(pay.run("presetRange('two','2027-01-03')")), ['2026-12-21', '2027-01-03'], 'and a year end');
assert.deepEqual(plain(pay.run("presetRange('sofar','2026-11-01')")), ['2026-11-01', '2026-11-01'], 'on the 1st the month so far is one day');
// Two back-to-back 14-day periods never share a day and never skip one.
assert.deepEqual(plain(pay.run("[presetRange('two','2026-11-04'),presetRange('two','2026-11-18')]")), [['2026-10-22', '2026-11-04'], ['2026-11-05', '2026-11-18']]);
// Choosing a shortcut fills the dates and loads that period.
pay.el('preset').value = 'two'; pay.el('preset').onchange(); await settle();
const [from, to] = [pay.el('from').value, pay.el('to').value];
assert.equal((Date.parse(to) - Date.parse(from)) / 864e5, 13); assert.match(asked.at(-1), new RegExp('^/api/coach-pay\\?from=' + from + '&to=' + to + '$'));
assert.equal(pay.el('csv').href, '/api/coach-pay?format=csv&from=' + from + '&to=' + to, 'the spreadsheet link follows the period');

// ---------- Coach pay: lessons paid for but not taught yet ----------
// Dana has one lesson taught and two still to come (a partner lesson with two wrestlers counts once).
assert.deepEqual(plain(pay.run('ahead(lastReport.coaches,"2026-11-18")')), {lessons: 2, cents: 2925 + 2925 + 3900});
assert.deepEqual(plain(pay.run('ahead(lastReport.coaches,"2999-01-05")')), {lessons: 1, cents: 3900}, 'a lesson dated today counts as taught');
assert.deepEqual(plain(pay.run('ahead(lastReport.coaches,"2999-12-31")')), {lessons: 0, cents: 0});
assert.equal(pay.run('aheadText({lessons:0,cents:0})'), ''); assert.equal(pay.run('aheadText({lessons:1,cents:3900})'), 'includes $39.00 for 1 lesson not taught yet');
assert.equal(pay.el('tOwed').textContent, '$178.50'); assert.equal(pay.el('tAhead').textContent, 'includes $97.50 for 2 lessons not taught yet', 'the total says how much of it is for lessons still to come');
const out = pay.el('coaches').innerHTML;
assert.match(out, /<strong>Owed \$136\.50<\/strong> <span class="ahead">\(includes \$97\.50 for 2 lessons not taught yet\)<\/span>/, 'so does the coach’s own line');
assert.equal((out.match(/<span class="pill neutral">Not taught yet<\/span>/g) || []).length, 3, 'each line dated after today is marked');
assert.match(out, /Coach Lee<\/h2><p class="muted">1 lesson · \$60\.00 kept · 70% share · <strong>Owed \$42\.00<\/strong><\/p>/, 'a coach with nothing still to come has no note');
// A coach with no pay share set: nothing is claimed about what is owed.
assert.deepEqual(plain(pay.run('ahead([{coachEmail:"x",splitPct:null,lines:[{date:"2999-01-01",start:"16:00",netCents:6000}]}],"2026-11-18")')), {lessons: 1, cents: 0});

// ---------- Coach pay: each coach's balance, recording a payment and deleting one (issue #370) ----------
{
  const bal = (name, more) => ({email: name.toLowerCase().replace(/\W+/g, '.') + '@example.test', name, active: true, practiceCents: 0, lessonCents: 0, lessonShareSet: true, earnedCents: 0, paidCents: 0, owedCents: 0, aheadCents: 0, pendingCents: 0, payments: 0, lastPaidOn: null, ...more});
  const payment = {id: '11111111-1111-4111-8111-111111111111', coachEmail: 'coach.dana@example.test', coach: 'Coach Dana', paidOn: '2026-11-15', amountCents: 5000, method: 'check', methodLabel: 'Check', periodFrom: '2026-11-01', periodTo: '2026-11-15', note: 'Check <1042>'};
  const state = (owed, paid, payments) => ({today: '2026-11-18', methods: [{value: 'check', label: 'Check'}, {value: 'cash', label: 'Cash'}], morePayments: false, payments,
    coaches: [bal('Coach Dana', {practiceCents: 13500, lessonCents: 3900, earnedCents: 17400, paidCents: paid, owedCents: owed, pendingCents: 6000, payments: payments.length, lastPaidOn: payments.length ? '2026-11-15' : null}),
      bal('Coach Lee', {practiceCents: 4500, earnedCents: 4500, paidCents: 6000, aheadCents: 1500, payments: 1, lastPaidOn: '2026-10-31'}), bal('Coach Sam', {active: false, lessonCents: 3250, earnedCents: 3250, owedCents: 3250}), bal('Coach New')],
    totals: {earnedCents: 25150, paidCents: paid + 6000, owedCents: owed + 3250, aheadCents: 1500, pendingCents: 6000, paidThisMonthCents: paid, paymentsThisMonth: payments.length, shareNotSet: 0}});
  const sent = []; let next = null;
  const payPage = page('app/coach-pay/screen.html', async (url, init) => {
    if (!url.startsWith('/api/coach-payments')) return json(report);
    if (!init || !init.method) return json(state(17400, 0, []));
    sent.push(JSON.parse(init.body)); return next;
  });
  await settle();
  const {el, run} = payPage;
  // The tiles and each coach's row.
  assert.deepEqual([el('pOwed').textContent, el('pOwedNote').textContent, el('pMonth').textContent, el('pMonthNote').textContent, el('pPaid').textContent, el('pPaidNote').textContent, el('pPending').textContent],
    ['$206.50', '$15.00 paid ahead to others', '$0.00', '', '$60.00', 'of $251.50 earned', '$60.00']);
  const rows = el('balances').innerHTML.split('</li>');
  assert.equal(rows[0], '<li><div class="who"><b>Coach Dana</b><small>Earned $174.00 ($135.00 practice + $39.00 lessons) · Nothing paid yet</small><small>Not approved yet: $60.00 of practice pay</small></div><div class="due"><b>$174.00</b><small>still owed</small></div><button type="button" class="sm" data-pay="coach.dana@example.test" data-owed="17400">Record a payment</button>');
  assert.match(rows[1], /<b>Coach Lee<\/b><small>Earned \$45\.00 in practice pay · Paid \$60\.00 in 1 payment, last on Oct 31, 2026<\/small><\/div><div class="due"><b>\$15\.00<\/b><small>paid ahead<\/small>/, 'paid more than earned so far reads paid ahead');
  assert.match(rows[2], /<b>Coach Sam <span class="pill neutral">No longer coaching<\/span><\/b><small>Earned \$32\.50 in lesson shares · Nothing paid yet<\/small><\/div><div class="due"><b>\$32\.50<\/b><small>still owed<\/small>/, 'a coach who left and is still owed stays on the list');
  assert.match(rows[3], /<b>Coach New<\/b><small>Earned \$0\.00 · Nothing paid yet<\/small>/);
  assert.equal(el('payments').innerHTML, '<li class="muted">No payments recorded yet.</li>');
  assert.match(el('payCoach').innerHTML, /^<option value="">Choose a coach<\/option><option value="coach\.dana@example\.test">Coach Dana<\/option>/); assert.equal(el('payMethod').innerHTML, '<option value="check">Check</option><option value="cash">Cash</option>');
  assert.deepEqual([el('payDate').value, el('payDate').max], ['2026-11-18', '2026-11-18'], 'the date starts as today and cannot be later');
  // Amounts typed the way people type them.
  assert.deepEqual(plain(run("['120','120.5','120.50','$1,200.00',' 75 ','0.01','12.345','abc','','-5','1e3','12345678'].map(toCents)")), [12000, 12050, 12050, 120000, 7500, 1, null, null, null, null, null, null]);
  // "Record a payment" on a row fills the coach and what is still owed, for the owner to check and send.
  run("startPayment('coach.dana@example.test',17400)");
  assert.deepEqual([el('payCoach').value, el('payAmount').value], ['coach.dana@example.test', '174.00']);
  run("startPayment('coach.lee@example.test',0)"); assert.equal(el('payAmount').value, '174.00', 'nothing owed: the amount is left for the owner to type'); run("startPayment('coach.dana@example.test',17400)");
  // An amount that is not money is stopped on the page; nothing is sent.
  el('payAmount').value = 'fifty'; assert.equal(await run('recordPayment()'), false); assert.equal(sent.length, 0); assert.equal(el('payNoteLine').textContent, 'Enter the amount you paid, like 120 or 120.50.');
  // A good one is sent as whole cents, and the page shows the balances the server sends back.
  el('payAmount').value = '50'; el('payMethod').value = 'check'; el('payFrom').value = '2026-11-01'; el('payTo').value = '2026-11-15'; el('payNote').value = 'Check <1042>';
  next = json({ok: true, payment, ...state(12400, 5000, [payment])});
  assert.equal(await run('recordPayment()'), true);
  assert.deepEqual(sent[0], {action: 'add', coach: 'coach.dana@example.test', paidOn: '2026-11-18', amountCents: 5000, method: 'check', periodFrom: '2026-11-01', periodTo: '2026-11-15', note: 'Check <1042>'});
  assert.equal(el('payNoteLine').textContent, 'Recorded: $50.00 to Coach Dana. It is in Income & expenses too.');
  assert.deepEqual([el('payAmount').value, el('payNote').value, el('payFrom').value, el('payTo').value, el('payCoach').value], ['', '', '', '', 'coach.dana@example.test'], 'the form is ready for the next payment');
  assert.deepEqual([el('pOwed').textContent, el('pMonth').textContent, el('pMonthNote').textContent, el('pPaid').textContent], ['$156.50', '$50.00', '1 payment', '$110.00']);
  assert.match(el('balances').innerHTML, /Paid \$50\.00 in 1 payment, last on Nov 15, 2026<\/small><small>Not approved yet: \$60\.00 of practice pay<\/small><\/div><div class="due"><b>\$124\.00<\/b><small>still owed<\/small>/);
  assert.equal(el('payments').innerHTML, '<li><div class="who"><b>Nov 15, 2026 · Coach Dana</b><small>Check · for Nov 1 to Nov 15, 2026 · Check &lt;1042&gt;</small></div><div class="due"><b>$50.00</b></div><button type="button" class="sm" data-del="11111111-1111-4111-8111-111111111111" aria-label="Delete the $50.00 payment to Coach Dana on Nov 15, 2026">Delete</button></li>', 'the note is escaped');
  // The server's refusal is shown as it is, and the form keeps what was typed.
  el('payAmount').value = '50'; next = {ok: false, status: 409, json: async () => ({error: 'That payment was just recorded. It is in the list below.'})};
  assert.equal(await run('recordPayment()'), false); assert.equal(el('payNoteLine').textContent, 'That payment was just recorded. It is in the list below.'); assert.equal(el('payAmount').value, '50'); assert.equal(el('paySend').disabled, false);
  // Deleting a payment entered by mistake.
  next = json({ok: true, ...state(17400, 0, [])});
  await run("deletePaymentById('11111111-1111-4111-8111-111111111111')");
  assert.deepEqual(sent.at(-1), {action: 'delete', id: '11111111-1111-4111-8111-111111111111'}); assert.equal(el('payNoteLine').textContent, 'Payment deleted.'); assert.equal(el('pOwed').textContent, '$206.50');
  assert.match(html, /confirm\('Delete this payment\? Use this only for a payment entered by mistake\. The coach’s balance goes back up\.'\)/);
  assert.match(html, /Record every payment you make to a coach here; it goes into <a href="\/financials">Income &amp; expenses<\/a> as money out by itself, so don’t add it there as well\./);
}

// ---------- Coach hours: one total to pay per coach, and overall ----------
const shift = (id, status, amountCents, paidMinutes = 90) => ({id, revision: 1, status, date: '2026-10-19', session: {title: 'SWA Intermediate', start: '19:30', end: '21:00'}, dutyLabel: 'Head coach', duty: 'head', inTime: '19:25', outTime: '21:05', clockIn: 'x', workedMinutes: 100,
  paidMinutes, amountCents, rateCents: 4000, flags: [], history: [], source: 'clock', ownerSet: null, voidReason: null});
const totals = (shifts, more = {}) => ({shifts: shifts.length, minutes: 0, amountCents: shifts.reduce((n, s) => n + s.amountCents, 0), drafts: 0, open: 0, submitted: 0, approved: 0, flagged: 0, breakdown: [], ...more});
// A whole month, as the dashboard's link opens it (issue #399): its totals read the same; approving waits for a pay period.
const month = (coaches, overall) => ({period: null, month: '2026-10', label: 'October 2026', from: '2026-10-01', to: '2026-10-31', today: '2026-11-18', previous: '2026-09', next: '2026-11', rates: [{label: 'Head coach', centsPerHour: 4000}], coach: null, coaches, choices: [],
  overall: {minutes: 0, practiceCents: 0, approvedCents: 0, lessonCents: 0, waiting: 0, notSent: 0, flagged: 0, ...overall}, timeOff: {pending: [], approved: []}});
const coachRow = (name, state, shifts, lessons, more = {}) => ({email: name.toLowerCase().replace(/\W+/g, '.') + '@example.test', name, active: true, programs: ['Intermediate'], shifts, totals: totals(shifts, more), state, timeOff: [], lessons});
const view = month([
  coachRow('Coach Dana', 'approved', [shift('a', 'approved', 6000), shift('b', 'approved', 7500)], {lessons: 1, grossCents: 6000, refundedCents: 0, splitPct: 65, owedCents: 3900}, {approved: 2, shifts: 2}),
  coachRow('Coach Lee', 'submitted', [shift('c', 'submitted', 4500)], null, {submitted: 1}),
  coachRow('Coach Sam', 'empty', [], {lessons: 1, grossCents: 5000, refundedCents: 0, splitPct: 65, owedCents: 3250}),
  coachRow('Coach New', 'not-submitted', [shift('d', 'draft', 6000)], {lessons: 2, grossCents: 12000, refundedCents: 0, splitPct: null, owedCents: null}, {drafts: 1})],
  {practiceCents: 24000, approvedCents: 13500, lessonCents: 7150, waiting: 1, notSent: 1});
const hours = page('app/timesheets/screen.html', async () => json(view));
await settle(); await settle();
const cards = hours.el('coaches').innerHTML;
assert.match(cards, /<p class="pay-total"><b>Total to pay for October 2026: \$174\.00<\/b> <span class="muted">\$135\.00 practice \+ \$39\.00 lesson share<\/span><\/p>/, 'an approved month: practice plus lesson share, as on the spreadsheet’s Total line');
assert.match(cards, /<p class="pay-total"><b>Total so far: \$45\.00<\/b> <span class="muted">\$45\.00 practice \(not approved yet\)<\/span><\/p>/, 'a month waiting for approval is the amount so far');
assert.match(cards, /<p class="pay-total"><b>Total to pay for October 2026: \$32\.50<\/b> <span class="muted">\$32\.50 lesson share<\/span><\/p>/, 'a coach with lessons and no shifts has nothing to approve');
assert.match(cards, /<p class="pay-total"><b>Total so far: \$60\.00<\/b> <span class="muted">\$60\.00 practice \(not approved yet\) \+ lesson share not set<\/span><\/p>/, 'a lesson share that is not set is said, never counted as $0');
assert.equal((cards.match(/class="pay-total"/g) || []).length, 4);
assert.equal(hours.el('tTotal').textContent, '$311.50', 'overall: practice plus lesson shares'); assert.equal(hours.el('tTotalNote').textContent, '$105.00 of practice pay is not approved yet');
const done = page('app/timesheets/screen.html', async () => json(month([view.coaches[0]], {practiceCents: 13500, approvedCents: 13500, lessonCents: 3900})));
await settle(); await settle();
assert.equal(done.el('tTotal').textContent, '$174.00'); assert.equal(done.el('tTotalNote').textContent, 'Practice and lesson shares');
assert.match(read('app/timesheets/screen.html'), /Nothing is canceled\./); assert.doesNotMatch(read('app/timesheets/screen.html'), /cancelled/);
console.log('Passed: Coach pay shows each coach’s balance (earned, paid, still owed or paid ahead, not approved yet), records a payment in whole cents and deletes one; it has shortcuts for this month so far and the last 14 days, and marks lessons paid for but not taught yet with their share; Coach hours shows one total to pay per coach (final once approved, else so far) and overall.');
