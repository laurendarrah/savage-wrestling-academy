// Issue #400 (Justin's decision on #246, Nov 23, 2026): the owner marks each coach's W-9 received, with the day, on
// Coaches; Coach pay shows what each coach was paid in a calendar year, for the 1099s, from the payments recorded
// (#370). The site never stores a tax ID, a Social Security number or the W-9 itself. Runs the real routes against a
// database built from every migration, and the two pages' scripts in a fake DOM (inline JavaScript is not typechecked).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {load, request, sqlite, users} from './accounts.mjs';

const P = load('lib/coach-payments.ts'), W = load('lib/coach-w9.ts'), log = load('lib/security-log.ts');
const staff = load('app/api/staff/route.ts'), api = load('app/api/coach-payments/route.ts');
const reply = async r => ({status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text(), headers: r.headers});
const post = (route, path, body, who) => route.POST(request(path, 'POST', body, who)).then(reply);
const get = (route, path, who) => route.GET(request(path, 'GET', null, who)).then(reply);
const plain = v => v === undefined ? null : JSON.parse(JSON.stringify(v)), deq = (a, b, why) => assert.deepEqual(plain(a), plain(b), why);
const DANA = 'dana.coach@example.test', LEE = 'lee.coach@example.test', RAE = 'rae.coach@example.test';
for (const [k, email] of [['dana', DANA], ['lee', LEE]]) users[k] = {id: k + '-uuid', email, email_confirmed_at: '2026-10-15'};
for (const [email, name] of [[DANA, 'Coach Dana'], [LEE, 'Coach Lee'], [RAE, 'Coach Rae']]) assert.equal((await post(staff, '/api/staff', {action: 'grant', email, name, programs: ['Intermediate']}, 'owner')).status, 200);
const coachRow = async email => (await get(staff, '/api/staff', 'owner')).body.staff.find(s => s.email === email);
const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});

// ---------- Marking a W-9 received ----------
assert.equal((await coachRow(DANA)).w9, null, 'no W-9 until the owner marks one');
let r = await post(staff, '/api/staff', {action: 'w9-received', email: DANA, receivedOn: '2026-11-02'}, 'owner');
assert.equal(r.status, 200); deq(r.body.w9, {receivedOn: '2026-11-02'});
deq((await coachRow(DANA)).w9, {receivedOn: '2026-11-02'}, 'Coaches shows it');
// Changing the day replaces it; there is one row per coach.
assert.equal((await post(staff, '/api/staff', {action: 'w9-received', email: DANA.toUpperCase(), receivedOn: '2026-11-03'}, 'owner')).status, 200);
deq((await coachRow(DANA)).w9, {receivedOn: '2026-11-03'}); assert.equal(sqlite.prepare('SELECT count(*) AS n FROM coach_w9').get().n, 1);
// Checked on the server: a real day, not in the future, not before 2020, a coach on Coaches, the owner only.
for (const receivedOn of ['2026-02-30', '11/02/2026', '', null, '2019-12-31', '2999-01-01'])
  assert.equal((await post(staff, '/api/staff', {action: 'w9-received', email: LEE, receivedOn}, 'owner')).status, 400, String(receivedOn));
assert.equal((await post(staff, '/api/staff', {action: 'w9-received', email: LEE, receivedOn: today}, 'owner')).status, 200, 'today is fine');
assert.equal((await post(staff, '/api/staff', {action: 'w9-received', email: 'nobody@example.test', receivedOn: '2026-11-02'}, 'owner')).status, 404);
for (const who of ['dana', 'alice', null]) assert.equal((await post(staff, '/api/staff', {action: 'w9-received', email: RAE, receivedOn: '2026-11-02'}, who)).status, 403, String(who));
assert.equal((await staff.POST(request('/api/staff', 'POST', {action: 'w9-clear', email: DANA}, 'owner', 'https://evil.test'))).status, 403, 'same origin only');
// Taking it off.
assert.equal((await post(staff, '/api/staff', {action: 'w9-clear', email: LEE}, 'owner')).status, 200);
assert.equal((await coachRow(LEE)).w9, null);
assert.equal((await post(staff, '/api/staff', {action: 'w9-clear', email: LEE}, 'owner')).status, 404, 'nothing to take off');
// The security log has a line for each, in words.
deq(sqlite.prepare("SELECT action,target FROM security_events WHERE action LIKE 'coach_w9%' ORDER BY rowid").all().map(x => ({...x})), [
  {action: 'coach_w9_received', target: DANA + ' 2026-11-02'}, {action: 'coach_w9_received', target: DANA + ' 2026-11-03'},
  {action: 'coach_w9_received', target: LEE + ' ' + today}, {action: 'coach_w9_cleared', target: LEE + ' ' + today}]);
const names = {coaches: {[DANA]: 'Coach Dana'}, wrestlers: {}, orders: {}, you: ['owner-uuid'], people: {}};
const entry = log.describeSecurityEvent({actor: 'owner-uuid', action: 'coach_w9_received', target: DANA + ' 2026-11-03', created_at: new Date().toISOString()}, names);
deq([entry.title, entry.detail], ['Coach W-9 marked received', `Coach Dana (${DANA}) · W-9 dated 2026-11-03`]);
assert.equal(log.describeSecurityEvent({actor: 'owner-uuid', action: 'coach_w9_cleared', target: LEE + ' 2026-11-01', created_at: new Date().toISOString()}, names).title, 'Coach W-9 mark taken off');

// ---------- No tax ID, anywhere ----------
// Extra fields are ignored and never stored; the table holds only who, the day and who recorded it.
const SSN = '123-45-6789';
assert.equal((await post(staff, '/api/staff', {action: 'w9-received', email: RAE, receivedOn: '2026-11-04', tin: SSN, ssn: SSN, file: 'data:application/pdf;base64,AAAA'}, 'owner')).status, 200);
deq(sqlite.prepare("SELECT name FROM pragma_table_info('coach_w9') ORDER BY cid").all().map(c => c.name), ['email', 'received_on', 'recorded_at', 'recorded_by']);
const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(t => t.name);
for (const t of tables) {
  for (const c of sqlite.prepare(`SELECT name FROM pragma_table_info('${t}')`).all()) assert.doesNotMatch(c.name, /ssn|tin\b|tax_?id|social/i, `${t}.${c.name}`);
  for (const row of sqlite.prepare(`SELECT * FROM ${t}`).all()) assert.ok(!JSON.stringify(row).includes(SSN), `no tax ID stored in ${t}`);
}
for (const f of ['lib/coach-w9.ts', 'app/staff/screen.html', 'app/coach-pay/screen.html']) assert.doesNotMatch(readFileSync(f, 'utf8'), /type="file"|name="(tin|ssn)"|Social Security number"|placeholder="\d{3}-\d{2}/, f + ' asks for no tax ID or file');

// ---------- What each coach was paid in a year ----------
const pay = (id, email, name, paidOn, cents) => sqlite.prepare("INSERT INTO coach_payments(id,coach_email,coach_name,paid_on,amount_cents,method,note,created_at,created_by) VALUES (?,?,?,?,?,'check','',?,'owner-uuid')").run(id, email, name, paidOn, cents, paidOn + 'T15:00:00.000Z');
pay('p1', DANA, 'Coach Dana', '2025-12-31', 50000); pay('p2', DANA, 'Coach Dana', '2026-01-01', 12000); pay('p3', DANA, 'Coach Dana', '2026-11-16', 8050);
pay('p4', LEE, 'Coach Lee', '2026-06-30', 30000); pay('p5', 'gone.coach@example.test', 'Coach Gone', '2026-03-01', 1000);
let y = await P.yearTotals('2026', '2026-11-24');
deq(y, {year: 2026, years: [2026, 2025], totalCents: 51050, noW9: 2, coaches: [
  {email: DANA, name: 'Coach Dana', paidCents: 20050, payments: 2, w9: {receivedOn: '2026-11-03'}},
  {email: 'gone.coach@example.test', name: 'Coach Gone', paidCents: 1000, payments: 1, w9: null},
  {email: LEE, name: 'Coach Lee', paidCents: 30000, payments: 1, w9: null}]}, 'by the day paid, Jan 1 to Dec 31; a coach no longer on Coaches keeps the name on their payments');
y = await P.yearTotals(2025, '2026-11-24');
deq([y.year, y.totalCents, y.coaches.map(c => [c.name, c.paidCents])], [2025, 50000, [['Coach Dana', 50000]]], 'Dec 31 is the year before');
for (const bad of ['2027', '2019', 'x', null, '2026.5']) assert.equal((await P.yearTotals(bad, '2026-11-24')).year, 2026, 'anything else is this year: ' + bad);
// The totals match the payments recorded.
const sum = sqlite.prepare("SELECT sum(amount_cents) AS c FROM coach_payments WHERE paid_on BETWEEN '2026-01-01' AND '2026-12-31'").get().c;
assert.equal((await P.yearTotals('2026', '2026-11-24')).totalCents, sum);
// The spreadsheet: one line per coach and a total; formula-looking text is made safe.
const csv = P.yearCsv(await P.yearTotals('2026', '2026-11-24'));
assert.equal(csv, ['Coach,Coach email,Year,Paid in the year,Payments,W-9 received', `Coach Dana,${DANA},2026,200.50,2,2026-11-03`, 'Coach Gone,gone.coach@example.test,2026,10.00,1,Not on file',
  `Coach Lee,${LEE},2026,300.00,1,Not on file`, 'Total,,2026,510.50,4,', ''].join('\r\n'));
assert.match(P.yearCsv({year: 2026, totalCents: 1, coaches: [{name: '=HYPERLINK("x")', email: 'a@example.test', paidCents: 1, payments: 1, w9: null}]}), /^.*\r\n"'=HYPERLINK\(""x""\)",/);
// The route: the owner only; ?year= and format=csv.
r = await get(api, '/api/coach-payments?year=2025', 'owner');
assert.equal(r.status, 200); assert.equal(r.body.year.year, 2025); assert.ok(r.body.coaches && r.body.totals, 'the balances come with it');
r = await get(api, '/api/coach-payments?year=2025&format=csv', 'owner');
assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/csv/); assert.match(r.headers.get('content-disposition'), /savage-coach-payments-2025\.csv/);
assert.match(r.body, /Coach Dana,dana\.coach@example\.test,2025,500\.00,1,2026-11-03/);
for (const who of ['dana', 'alice', null]) assert.equal((await get(api, '/api/coach-payments?year=2026&format=csv', who)).status, 403, String(who));

// ---------- The pages ----------
const read = f => readFileSync(f, 'utf8');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(res => setImmediate(res)); };
function page(file, fetch) {
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, disabled: false, innerHTML: '', textContent: '', href: '', dataset: {}, style: {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => []}); return nodes.get(id); };
  const ctx = vm.createContext({document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, readyState: 'complete', head: {appendChild() {}}, createElement: () => ({})},
    location: {search: '', hash: ''}, fetch, confirm: () => true, print() {}, URLSearchParams, Date, Intl, JSON, Promise, Error, Object, Array, Number, String, Set, Map, Math, console, window: {}, history: {replaceState() {}}, encodeURIComponent});
  for (const [, src, code] of read(file).matchAll(/<script(?: src="\/([\w-]+\.js)")?>([\s\S]*?)<\/script>/g)) vm.runInContext(src ? read('public/' + src) : code, ctx);
  return {el, ctx, run: s => vm.runInContext(s, ctx)};
}
const json = body => ({ok: true, status: 200, json: async () => body});
{
  // Coaches: each card says W-9 on file with the day, or No W-9 yet with a way to mark it; a note names those without.
  const data = (await get(staff, '/api/staff', 'owner')).body;
  const s = page('app/staff/screen.html', async () => json(data)); await settle();
  const cards = s.el('staff').innerHTML;
  assert.match(cards, /<span class="state">W-9 on file<\/span> <span class="muted">Received November 3, 2026<\/span>/);
  assert.match(cards, /<span class="state expired">No W-9 yet<\/span>[\s\S]*?it isn’t uploaded here[\s\S]*?<button type="button" data-w9-save>Mark W-9 received<\/button>/);
  assert.match(cards, /data-w9-clear>Take off W-9 received<\/button>/);
  assert.equal(s.el('w9Note').hidden, false); assert.equal(s.el('w9Note').textContent, 'Coach Lee has no W-9 on file yet: mark it below when you have it.');
  assert.equal(s.run("w9Note([{displayName:'Coach Lee'},{displayName:'Coach Kim'}])"), '2 coaches have no W-9 on file yet: Coach Lee, Coach Kim. Mark each one below when you have it.');
  // Values go through esc().
  assert.match(s.run("w9Html({w9:{receivedOn:'\"><b>'}},'2026-11-24')"), /value="&quot;&gt;&lt;b&gt;"/);
}
{
  // Coach pay: the year's totals per coach with W-9 status, the year picker, and the spreadsheet link.
  const data = (await get(api, '/api/coach-payments?year=2026', 'owner')).body, asked = [];
  const report = {from: '2026-11-01', to: '2026-11-30', coaches: [], totals: {lessons: 0, wrestlers: 0, grossCents: 0, refundedCents: 0, owedCents: 0, academyCents: 0, unsetCoaches: 0}};
  const c = page('app/coach-pay/screen.html', async url => { asked.push(String(url)); return json(String(url).startsWith('/api/coach-payments') ? data : report); }); await settle();
  assert.match(c.el('year').innerHTML, /<option value="2026" selected>2026<\/option><option value="2025">2025<\/option>/);
  assert.equal(c.el('yearCsv').href, '/api/coach-payments?format=csv&year=2026');
  assert.match(c.el('yearRows').innerHTML, /<b>Coach Dana<\/b><small>2 payments in 2026 · W-9 received Nov 3, 2026<\/small><\/div><div class="due"><b>\$200\.50<\/b><small>paid in 2026<\/small>/);
  assert.match(c.el('yearRows').innerHTML, /<b>Coach Lee<\/b><small>1 payment in 2026 · No W-9 on file<\/small>/);
  assert.equal(c.el('yearTotal').textContent, 'Total paid to coaches in 2026: $510.50');
  assert.equal(c.el('yearW9').textContent, '2 coaches paid in 2026 have no W-9 on file. Mark it on Coaches when you have it.');
  // Choosing another year asks for it.
  c.el('year').value = '2025'; c.el('year').onchange(); await settle();
  assert.ok(asked.includes('/api/coach-payments?year=2025'));
  c.run("renderYear({year:2024,years:[2026,2025,2024],coaches:[],totalCents:0,noW9:0})");
  assert.equal(c.el('yearRows').innerHTML, '<li class="muted">No payments to coaches recorded in 2024.</li>'); assert.equal(c.el('yearW9').hidden, true);
  assert.match(read('app/coach-pay/screen.html'), /the site never asks for a tax ID/);
}

console.log('Passed: the owner marks a coach’s W-9 received with the day, changes it or takes it off, owner only and checked on the server, each in the security log; no tax ID, SSN or file is accepted or stored anywhere; Coach pay shows what each coach was paid in a calendar year from the payments recorded, with W-9 status and a spreadsheet, and the totals match the payments.');
