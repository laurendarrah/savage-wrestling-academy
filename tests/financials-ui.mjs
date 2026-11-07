// Issue #194: the books page. Its inline JavaScript is not typechecked, so this runs the page script with a fake DOM:
// dollars become whole cents without rounding errors, the charts and tables draw from the report, and adding, editing
// and deleting send exactly what the server expects.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('app/financials/screen.html', 'utf8');
const nodes = new Map();
const el = id => {
  if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, disabled: false, innerHTML: '', textContent: '', href: '', max: '', style: {}, dataset: {},
    reset() { for (const f of ['date', 'amount', 'category', 'note', 'receipt']) el(f).value = ''; }, focus() {}, scrollIntoView() {}, querySelectorAll: () => [], replaceChildren() {}, append() {}});
  return nodes.get(id);
};
const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'}), month = today.slice(0, 7);
const zero = m => ({month: m, incomeCents: 0, refundsCents: 0, expensesCents: 0, netCents: 0});
const report = (m = month) => {
  const months = Array.from({length: 12}, (_, i) => zero(`${m.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`));
  const t = {incomeCents: 309000, refundsCents: 240000, expensesCents: 185100, netCents: -116100};
  months[Number(m.slice(5)) - 1] = {month: m, ...t};
  months[0] = m.endsWith('-01') ? months[0] : {month: m.slice(0, 4) + '-01', incomeCents: 120000, refundsCents: 0, expensesCents: 50000, netCents: 70000};
  return {month: m, year: m.slice(0, 4), today, stripeMode: 'test', totals: t, yearTotals: {incomeCents: 429000, refundsCents: 240000, expensesCents: 235100, netCents: -46100}, months,
    categories: {in: [{category: 'Memberships, paid in full', cents: 240000}, {category: 'Private <lessons>', cents: 69000}], out: [{category: 'Refunds', cents: 240000}, {category: 'Rent', cents: 185000}]},
    lines: [
      {id: 'payment:p1', date: m + '-03', type: 'income', source: 'online', category: 'Walk-ins', description: 'Walk-in practice · Sam <b>', method: 'Card online', amountCents: 4000, note: '', receipt: '', entryId: null, revision: null},
      {id: 'refund:p2', date: m + '-02', type: 'refund', source: 'online', category: 'Refunds', description: 'Refund: Membership · Sam', method: 'Card online', amountCents: 240000, note: '', receipt: '', entryId: null, revision: null},
      {id: 'entry:e1', date: m + '-01', type: 'expense', source: 'owner', category: 'Rent', description: 'November rent', method: '', amountCents: 185000, note: 'November rent', receipt: 'Check 1042', entryId: 'e1', revision: 2}],
    suggestions: {expense: ['Rent', 'Equipment', 'Insurance'], income: ['Sponsorship']}};
};
const calls = [];
let reply = () => report(), postReply = () => ({ok: true, id: 'new', revision: 1});
const fetch = async (url, opts) => { calls.push({url, body: opts?.body ? JSON.parse(opts.body) : null}); const b = opts?.body ? postReply(JSON.parse(opts.body)) : reply(url); return {ok: true, status: 200, json: async () => b}; };
let kind = 'expense';
const ctx = vm.createContext({Intl, Date, JSON, Math, Number, String, Array, Object, URLSearchParams, Promise, setTimeout, clearTimeout, console, fetch, confirm: () => true,
  location: {search: ''}, history: {replaceState() {}}, window: {addEventListener() {}},
  document: {getElementById: el, querySelectorAll: () => [], querySelector: sel => sel.includes(':checked') ? {value: kind} : null}});
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
vm.runInContext(script, ctx);
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
await settle();
const run = code => vm.runInContext(code, ctx);

// Dollars to whole cents, as people type them.
for (const [typed, cents] of [['1,250', 125000], ['$80.5', 8050], ['0.10', 10], ['0.01', 1], [' 19.99 ', 1999], ['1000000', 100000000], ['999999.99', 99999999]])
  assert.equal(run(`toCents(${JSON.stringify(typed)})`), cents, typed);
for (const typed of ['', '0', '0.00', '1.005', 'abc', '-5', '1e3', '12.3.4', '1000000.01', '1234567.89', '99999999'])
  assert.equal(run(`toCents(${JSON.stringify(typed)})`), null, typed);
// 0.1 + 0.2 style errors never reach the server: every two-decimal amount converts exactly.
for (let c = 1; c < 5000; c += 7) assert.equal(run(`toCents('${(c / 100).toFixed(2)}')`), c);

// The first load reads the current month and draws everything.
assert.equal(calls[0].url, '/api/financials?month=' + month);
assert.equal(el('status').textContent, '');
assert.equal(el('testMode').hidden, false, 'test mode is called out');
assert.equal(el('feesNote').hidden, true, 'no fee notice when every card fee is in');
assert.equal(el('tIn').textContent, '$3,090.00'); assert.equal(el('tRefunds').textContent, '−$2,400.00'); assert.equal(el('tExpenses').textContent, '−$1,851.00', 'the minus sign stays with the amount'); assert.equal(el('tNet').textContent, '-$1,161.00');
assert.match(el('tNetNote').textContent, /so far: -\$461\.00$/);
assert.equal(el('csvMonth').href, '/api/financials?format=csv&month=' + month); assert.equal(el('csvYear').href, '/api/financials?format=csv&year=' + month.slice(0, 4));
assert.equal(el('nextMonth').disabled, true, 'no months after this one');
assert.match(el('month').innerHTML, new RegExp(`<option value="${month}" selected>`));
assert.ok([...el('month').innerHTML.matchAll(/value="(\d{4}-\d{2})"/g)].every(m => m[1] <= month), 'months after this one are not offered');
assert.equal((el('monthsBody').innerHTML.match(/<tr>/g) || []).length, 12);
assert.match(el('monthsBody').innerHTML, new RegExp(`data-month="${month}" aria-current="true"`));
assert.match(el('yearFoot').innerHTML, /total<\/td><td class="right">\$4,290\.00<\/td><td class="right wide">−\$2,400\.00<\/td><td class="right wide">−\$2,351\.00<\/td><td class="right narrow">−\$4,751\.00<\/td><td class="right neg">-\$461\.00/, 'refunds and expenses, or money out on a phone');
assert.match(el('catIn').innerHTML, /Private &lt;lessons&gt;<\/span><b>\$690\.00<\/b><span class="bar" aria-hidden="true"><span style="width:29%">/, 'escaped, ranked, scaled to the largest');
assert.match(el('catOut').innerHTML, /Refunds[\s\S]*Rent/);
const rows = el('lines').innerHTML;
assert.match(rows, /Walk-in practice · Sam &lt;b&gt;<br><span class="muted small">Card online<\/span><span class="narrow muted small">Walk-ins · Card payment<\/span>/, 'payment details are escaped; phones get category and source under it');
assert.match(rows, /<td class="wide">Refund<\/td><td class="right neg">−\$2,400\.00/);
assert.match(rows, /November rent<br><span class="muted small">Receipt: Check 1042<\/span><span class="narrow muted small">Rent · Entered by you<\/span><\/td><td class="wide">Rent<\/td><td class="wide">Entered by you<\/td>/);
assert.match(rows, new RegExp('<tr><td>' + new Date(month + '-03T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric'}) + '</td>'), 'short dates; the heading has the month and year');
assert.equal((rows.match(/data-edit=/g) || []).length, 1, 'only the owner\'s own entries can be changed here');
assert.match(el('categoryList').innerHTML, /<option value="Rent"><\/option><option value="Equipment">/);
assert.equal(el('date').value, today, 'new entries default to today in the current month');

// Charts: 12 months, two thin columns per month on one baseline, clean axis steps, and readable labels on phones.
const svg = run(`chartSvg(report.months,report.month,720)`);
assert.equal((svg.match(/class="band/g) || []).length, 12);
assert.equal((svg.match(/<path /g) || []).length, month.endsWith('-01') ? 2 : 4, 'a bar only where there is money');
assert.match(svg, /<text x="\d+" y="[\d.]+" text-anchor="end">\$0<\/text>/);
assert.ok([...svg.matchAll(/H([\d.]+) Q([\d.]+)/g)].length >= 1);
for (const m of svg.matchAll(/M(\d+),\d+ V[\d.]+ Q[\d.]+,[\d.]+ ([\d.]+),[\d.]+ H([\d.]+)/g)) assert.ok(Number(m[3]) - Number(m[1]) + 4 <= 24 + 0.01, 'bars are 24px or thinner');
assert.match(svg, /class="selected">/);
assert.match(run(`chartSvg(report.months,report.month,360)`), />J<\/text>/, 'initials on a phone');
assert.match(svg, />Jan<\/text>/);
assert.equal(run('niceStep(309000)'), 100000); assert.equal(run('niceStep(18000)'), 5000); assert.equal(run('niceStep(0)'), 10000);
assert.equal(run('axisMoney(1500000)'), '$15K'); assert.equal(run('axisMoney(500000)'), '$5,000');
assert.doesNotMatch(run(`chartSvg(Array.from({length:12},(_, i)=>({month:'2026-'+String(i+1).padStart(2,'0'),incomeCents:0,refundsCents:0,expensesCents:0,netCents:0})),'2026-01',720)`), /NaN|Infinity/, 'an empty year draws');

// Adding an expense sends whole cents and trimmed text, then shows the entry's month.
el('date').value = month + '-05'; el('amount').value = '1,234.56'; el('category').value = '  Insurance '; el('note').value = ' Liability policy '; el('receipt').value = 'INV-77';
calls.length = 0;
await run(`submitEntry({preventDefault(){}})`); await settle();
assert.deepEqual(calls[0].body, {action: 'add', kind: 'expense', date: month + '-05', amountCents: 123456, category: 'Insurance', note: 'Liability policy', receipt: 'INV-77'});
assert.equal(calls[1].url, '/api/financials?month=' + month);
assert.equal(el('status').textContent, 'Entry added.');
assert.equal(el('amount').value, '', 'the form clears');

// Problems are explained before anything is sent.
calls.length = 0;
for (const [amount, category, msg] of [['12.345', 'Rent', /amount in dollars/], ['0', 'Rent', /amount in dollars/], ['50', ' ', /category/]]) {
  el('date').value = today; el('amount').value = amount; el('category').value = category;
  await run(`submitEntry({preventDefault(){}})`);
  assert.match(el('formError').textContent, msg);
}
assert.equal(calls.length, 0);

// Other income uses its own suggestions and kind.
kind = 'income'; el('date').value = today; el('amount').value = '250'; el('category').value = 'Sponsorship'; el('note').value = ''; el('receipt').value = '';
await run(`submitEntry({preventDefault(){}})`); await settle();
assert.deepEqual(calls[0].body, {action: 'add', kind: 'income', date: today, amountCents: 25000, category: 'Sponsorship', note: '', receipt: ''});
assert.match(run('suggestionOptions()'), /Sponsorship/);
kind = 'expense';

// Editing fills the form from the entry and sends the revision the owner saw.
calls.length = 0;
run(`startEdit('e1')`);
assert.equal(el('amount').value, '1850.00'); assert.equal(el('category').value, 'Rent'); assert.equal(el('receipt').value, 'Check 1042'); assert.equal(el('date').value, month + '-01');
assert.equal(el('saveEntry').textContent, 'Save changes'); assert.equal(el('stopEditing').hidden, false); assert.equal(el('formHeading').textContent, 'Edit entry');
el('amount').value = '1900';
await run(`submitEntry({preventDefault(){}})`); await settle();
assert.deepEqual(calls[0].body, {action: 'edit', id: 'e1', revision: 2, kind: 'expense', date: month + '-01', amountCents: 190000, category: 'Rent', note: 'November rent', receipt: 'Check 1042'});
assert.equal(el('saveEntry').textContent, 'Add entry'); assert.equal(el('stopEditing').hidden, true); assert.equal(el('status').textContent, 'Entry saved.');
// Cancelling an edit leaves the form ready for a new entry.
run(`startEdit('e1')`); run('endEdit()'); assert.equal(el('amount').value, ''); assert.equal(el('formHeading').textContent, 'Add an expense or other income');

// Deleting names the revision too.
calls.length = 0;
await run(`removeEntry('e1')`); await settle();
assert.deepEqual(calls[0].body, {action: 'delete', id: 'e1', revision: 2});
assert.equal(el('status').textContent, 'Entry deleted.');

// Month controls: the previous month loads; a live site hides the test-mode note; an empty month says so.
const prior = run(`shiftMonth('${month}',-1)`);
assert.equal(run(`shiftMonth('2026-01',-1)`), '2025-12'); assert.equal(run(`shiftMonth('2025-12',1)`), '2026-01');
reply = () => ({...report(prior), stripeMode: 'live', lines: [], categories: {in: [], out: []}});
calls.length = 0;
await run('load(shiftMonth(report.month,-1))'); await settle();
assert.equal(calls[0].url, '/api/financials?month=' + prior);
assert.equal(el('testMode').hidden, true);
assert.equal(el('nextMonth').disabled, false);
assert.match(el('lines').innerHTML, /Nothing recorded for/);
assert.match(el('catIn').innerHTML, /No money in for/);
assert.equal(el('date').value, prior + '-01', 'entries for a past month start on its first day');

// Card fees (issue #42): payments still waiting for Stripe's fee are called out, and the owner can fetch them now.
reply = () => ({...report(), feesWaiting: 3});
await run('load(report.month)'); await settle();
assert.equal(el('feesNote').hidden, false);
assert.match(el('feesText').textContent, /^3 card payments are still waiting for Stripe's fee/);
calls.length = 0; postReply = () => ({ok: true, mode: 'test', checked: 3, recorded: 2, failed: 1, waiting: 1, error: null});
reply = () => ({...report(), feesWaiting: 1});
await el('feesNow').onclick(); await settle();
assert.deepEqual(calls[0].body, {action: 'fees'}, 'the button only asks the server to read fees; nothing else is sent');
assert.equal(calls[1].url, '/api/financials?month=' + month, 'the month reloads with the new fees');
assert.equal(el('status').textContent, 'Card fees added for 2 payments.');
assert.match(el('feesText').textContent, /^1 card payment is still waiting/);
postReply = () => ({ok: false, recorded: 0, failed: 2, error: 'Stripe would not share card fees with the saved restricted key.'});
await el('feesNow').onclick(); await settle();
assert.match(el('status').textContent, /Stripe would not share card fees/, 'a key without permission is explained');
postReply = () => ({ok: true, recorded: 0, failed: 0, error: null});
await el('feesNow').onclick(); await settle();
assert.match(el('status').textContent, /No new card fees yet/);
reply = () => report(); postReply = () => ({ok: true, id: 'new', revision: 1});

// The page itself: owner-only route, sentence-case wording, no sample data, an accessible table beside the chart.
assert.match(readFileSync('app/financials/route.ts', 'utf8'), /ownerPage\(request, html\)/);
assert.match(html, /<div id="chart" aria-hidden="true">/); assert.match(html, /<caption class="sr" id="yearCaption">/);
assert.match(html, /not an accounting system/); assert.match(html, /Stripe's card fees are an expense of their own \(Card processing fees\)/);
assert.doesNotMatch(html, /sample|demo|lorem/i);
assert.doesNotMatch(html, /\son[a-z]+="/, 'no inline handlers');
console.log('Books page tests passed');
