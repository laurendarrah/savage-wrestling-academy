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

// ---------- Coach hours: one total to pay per coach, and overall ----------
const shift = (id, status, amountCents, paidMinutes = 90) => ({id, revision: 1, status, date: '2026-10-19', session: {title: 'SWA Intermediate', start: '19:30', end: '21:00'}, dutyLabel: 'Head coach', duty: 'head', inTime: '19:25', outTime: '21:05', clockIn: 'x', workedMinutes: 100,
  paidMinutes, amountCents, rateCents: 4000, flags: [], history: [], source: 'clock', ownerSet: null, voidReason: null});
const totals = (shifts, more = {}) => ({shifts: shifts.length, minutes: 0, amountCents: shifts.reduce((n, s) => n + s.amountCents, 0), drafts: 0, open: 0, submitted: 0, approved: 0, flagged: 0, breakdown: [], ...more});
const month = (coaches, overall) => ({month: '2026-10', monthLabel: 'October 2026', today: '2026-11-18', previous: '2026-09', next: '2026-11', rates: [{label: 'Head coach', centsPerHour: 4000}], coach: null, coaches, choices: [],
  overall: {minutes: 0, practiceCents: 0, approvedCents: 0, lessonCents: 0, waiting: 0, notSent: 0, flagged: 0, ...overall}, timeOff: {pending: [], approved: []}});
const coachRow = (name, state, shifts, lessons, more = {}) => ({email: name.toLowerCase().replace(/\W+/g, '.') + '@example.test', name, active: true, programs: ['Intermediate'], shifts, totals: totals(shifts, more), state, timeOff: [], lessons});
const view = month([
  coachRow('Coach Dana', 'approved', [shift('a', 'approved', 6000), shift('b', 'approved', 7500), shift('v', 'voided', 0)], {lessons: 1, grossCents: 6000, refundedCents: 0, splitPct: 65, owedCents: 3900}, {approved: 2, shifts: 2}),
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
console.log('Passed: Coach pay has shortcuts for this month so far and the last 14 days, and marks lessons paid for but not taught yet with their share; Coach hours shows one total to pay per coach (final once approved, else so far) and overall.');
