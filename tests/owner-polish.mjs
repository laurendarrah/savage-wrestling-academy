// Issue #232: design polish for the owner pages. The page scripts are inline JavaScript, which the typecheck skips, so
// the functions changed here run in a sandbox: the dashboard's calendar cards, the shared month picker, and the site
// health table. The rest checks the markup every owner page now shares: no back link inside the owner shell (issue
// #261), the same download label, the shared tokens instead of copied colors, and labelled controls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = f => readFileSync(f, 'utf8');
const portal = read('app/portal.html');
const savage = read('public/savage.css');
const shellCss = read('public/owner-shell.css');
const loaded = new Map();
function load(file) {
  if (loaded.has(file)) return loaded.get(file);
  const module = {exports: {}}; loaded.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(read(file), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, URL, Headers, require: name => load('lib/' + name.replace('./', '') + '.ts')});
  return module.exports;
}
const {ownerTopbar, ownerSidebar} = load('lib/owner-shell.ts');

// ---------- Owner dashboard ----------
// Only self-hosted fonts: the Inter label font was never loaded (it fell back to Arial at 9px).
assert.doesNotMatch(portal + shellCss, /fonts\.googleapis|\bInter\b/, 'no Inter and no Google Fonts request');
assert.match(shellCss, /\.os-brand small\{display:block;margin-top:8px;font:700 12px\/1\.2 var\(--os-body\);/, 'the brand label is Barlow at a readable size');
assert.match(shellCss, /--os-body:Barlow,/);

// The dashboard gets the owner shell but not savage.css, so it carries the savage.css tokens under the same names.
const tokens = css => Object.fromEntries([...css.matchAll(/--(swa-(?:prog|warn)-[a-z-]+):\s*(#[0-9A-Fa-f]{3,6})/g)].map(m => [m[1], m[2].toUpperCase()]));
const shared = tokens(savage), mirrored = tokens(portal);
assert.ok(Object.keys(shared).length >= 12, 'savage.css has the program and warning tokens');
assert.deepEqual(mirrored, shared, 'the dashboard uses the same program and warning colors as savage.css');
assert.match(portal, /\.notice\{[^}]*background:var\(--swa-warn-bg\);border:1px solid var\(--swa-warn-line\);[^}]*color:var\(--swa-warn-ink\)/, 'amber notes use the warning tokens');
assert.match(read('public/responsive.css'), /\.event\.cal-advanced,[^{]*\{background:var\(--swa-prog-advance,#000\);color:var\(--swa-prog-advance-ink,#fff\)/, 'calendar cards use the program tokens');

// Calendar cards are read, not pressed: they keep the body font, so "6:00 PM–7:30 PM" no longer breaks over four lines.
assert.match(portal, /main button:not\(\.toollink\):not\(\.tool\):not\(\.event\):not\(\.mobile-practice\),main a\.button\{font-family:'Barlow Condensed'/);
assert.match(portal, /\.dayname\{[^}]*font-size:12px;[^}]*color:var\(--gray\)\}/, 'day names are dark enough to read');

// Run the dashboard's own helpers.
const grab = name => portal.match(new RegExp(`(?:const|function) ${name}\\b[\\s\\S]*?\\n(?=function |const |let |//)`))[0];
const ctx = vm.createContext({});
vm.runInContext('const ' + portal.match(/esc=s=>String\(s\?\?''\)\.replace\(.*?\}\[c\]\)\)/)[0], ctx);
vm.runInContext(grab('eventTime'), ctx);
assert.equal(vm.runInContext("eventTime('6:00 PM–7:30 PM')", ctx), '<span class="event-time">6:00 PM–7:30 PM</span>', 'a time wraps after the dash, never inside "7:30 PM"');
assert.equal(vm.runInContext("eventTime('<b>')", ctx), '<span class="event-time">&lt;b&gt;</span>');
// Each destination's icon is tested with the owner navigation (tests/owner-tools.mjs).

// Account: a styled menu of account actions (the owner shell's, on every owner page; issue #261). Refresh saved data
// is the dashboard's own and appears only there.
const menuOf = html => html.match(/<details class="os-account" id="swa-os-account"><summary>Account<\/summary><div class="os-panel">([\s\S]*?)<\/div><\/details>/);
const dashMenu = menuOf(ownerTopbar('/', '/')), toolMenu = menuOf(ownerTopbar('/payments', '/payments'));
assert.ok(dashMenu && toolMenu, 'the menu');
const items = m => [...m[1].matchAll(/<(a|button)\b([^>]*)>([^<]*)</g)];
assert.deepEqual(items(dashMenu).map(m => m[3]), ['Refresh saved data', 'Account security', 'Sign out']);
assert.deepEqual(items(toolMenu).map(m => m[3]), ['Account security', 'Sign out']);
for (const m of items(dashMenu)) assert.match(m[2], /class="os-item"/, m[3] + ' is styled as a menu item, not a default link');
assert.match(dashMenu[1], /onclick="closeOwnerTools\(\);reloadAcademy\(\)"/); assert.match(portal, /function closeOwnerTools\(\)/); assert.match(portal, /function reloadAcademy\(\)/);
assert.match(shellCss, /html body \.os-panel\{position:absolute;/, 'it opens as a panel');
assert.match(read('public/owner-shell.js'), /e\.key === 'Escape'\) \{ if \(!closeAccount\(true\)\)/, 'Escape closes it');
// Every public page families see is one tap away, once: the welcome page, the team page (issue #215) and the calendar.
const familyLinks = ownerTopbar('/', '/').match(/<nav class="os-family os-family-top"[\s\S]*?<\/nav>/)[0];
assert.deepEqual([...familyLinks.matchAll(/href="([^"]+)"/g)].map(m => m[1]), ['/welcome', '/team', '/calendar']);
for (const href of ['/welcome', '/team', '/calendar']) assert.ok(!ownerSidebar('/').match(/<nav class="os-nav"[\s\S]*?<\/nav>/)[0].includes(`href="${href}"`), href);

// Phones: the header keeps the logo, a 44px Menu button and Account on one line; the breadcrumb and family links move
// out of the way (the family links into the drawer).
const phone = shellCss.match(/@media \(max-width:900px\)\{([\s\S]*?)\n\}/)[1];
assert.match(phone, /html body \.os-menu\{display:inline-flex;align-items:center;gap:8px;min-height:44px;/);
assert.match(phone, /html body \.os-crumbs,html body \.os-family-top\{display:none\}/); assert.match(phone, /html body \.os-family-drawer\{display:block;/);
assert.match(portal, /\.toollink\{display:flex;align-items:center;min-height:44px;/, 'tool links are full-size targets');

// ---------- No back link inside the owner shell (issue #261; one back link each before, issue #232) ----------
const ownerPages = ['app/financials/screen.html', 'app/site-health/screen.html', 'app/messages/screen.html', 'app/cards/screen.html', 'app/payments/screen.html',
  'app/coach-pay/screen.html', 'app/timesheets/screen.html', 'app/website/screen.html', 'app/approvals/screen.html', 'app/scholarships/screen.html',
  'app/waivers/screen.html', 'app/transfers/screen.html', 'app/lesson-settings/screen.html', 'app/data-requests/screen.html', 'app/payment-setup/screen.html', 'app/accounts/route.ts',
  'app/staff/screen.html', 'app/backups/screen.html', 'app/security-log/route.ts', 'app/account-setup/route.ts'];
for (const f of ownerPages) {
  const html = read(f);
  assert.doesNotMatch(html, /← Owner dashboard|← Owner workspace|← Account security/, f + ' has no back link: the sidebar is there');
  assert.match(html, /<main[^>]*>\s*<h1/, f + ': the heading opens the page');
}
// Pages shared with coaches keep Coach home for coaches and hide it for the owner, who has the sidebar.
const roster = read('app/roster/screen.html');
assert.match(roster, /<a id="home" class="swa-back" href="\/">/); assert.match(roster, /\$\('home'\)\.hidden=data\.role==='owner';\$\('home'\)\.href='\/coach';\$\('home'\)\.textContent='← Coach home';/);
const plans = read('app/practice-plans/screen.html');
assert.match(plans, /\$\('home'\)\.hidden=!!d\.owner;\$\('home'\)\.href='\/coach';\$\('home'\)\.textContent='← Coach home';/);
assert.match(plans, /\$\('backCalendar'\)\.hidden=!d\.owner\|\|libraryMode;/, 'the plan editor keeps its "← Practice calendar" link; /curricula shows none');
assert.match(plans, /<a id="backCalendar" class="swa-back" href="\/#practice-calendar" hidden>← Practice calendar<\/a>/);
assert.match(shellCss, /html body \.os-work #home\.swa-back\{display:none\}/, 'hidden before the page script runs, so it never flashes');
for (const f of [...ownerPages.filter(f => !f.includes('account-setup')), 'app/roster/screen.html', 'app/practice-plans/screen.html', 'app/portal.html']) assert.doesNotMatch(read(f), /Owner workspace|Owner dashboard'/, f);

// ---------- Wording ----------
const spreadsheetPages = ['app/financials/screen.html', 'app/payments/screen.html', 'app/coach-pay/screen.html', 'app/timesheets/screen.html', 'app/help/owner/screen.html'];
for (const f of spreadsheetPages) {
  const html = read(f);
  assert.match(html, /Download spreadsheet/, f);
  assert.doesNotMatch(html, /\(CSV\)|Download CSV|Export spreadsheet|Download hours/, f);
}
assert.doesNotMatch(plans, /Customers|Ready to edit this practice/);
assert.match(plans, /Families and other programs’ coaches cannot see the plan\./);
const planCtx = vm.createContext({});
vm.runInContext(plans.match(/function planState\(plan\)\{[^\n]*\}/)[0], planCtx);
assert.equal(vm.runInContext('planState(undefined)', planCtx), 'No plan for this practice yet.');
assert.equal(vm.runInContext('planState({published:true})', planCtx), 'Plan shared with this program’s coaches.');
assert.match(vm.runInContext('planState({published:false})', planCtx), /^Draft saved/);
assert.doesNotMatch(read('app/account-setup/route.ts'), /customer/i, 'families, not customers');
const health = read('app/site-health/screen.html');
assert.doesNotMatch(health.replace(/<script>[\s\S]*?<\/script>/, m => m.replace(/\/\/.*$/gm, '')), /server error/i, 'site errors, in plain words');
assert.match(read('lib/launch-checklist.ts'), /site error\$\{errors === 1/);

// Amber notes use the shared warning tokens, not copied colors (the copied value stays only as a fallback).
for (const f of ['app/site-health/screen.html', 'app/messages/screen.html', 'app/coach-pay/screen.html', 'app/timesheets/screen.html', 'app/coach-time/screen.html', 'app/financials/screen.html', 'app/portal.html']) {
  const css = read(f).replace(/var\(--swa-[a-z-]+,#[0-9A-Fa-f]+\)|--swa-[a-z-]+:#[0-9A-Fa-f]+/g, '');
  assert.doesNotMatch(css, /#fff7e6|#f0d49c|#fff4e3|#f0dfc3|#fff1dd|#5c3b00|#865b20/i, f);
}

// ---------- Labelled controls and readable tables on phones ----------
const payments = read('app/payments/screen.html');
assert.match(payments, /<select id="family" aria-label="Family">/, 'the family list has a name');
assert.match(payments, /<a class="button" id="csv"/);
// On phones the payments and cards tables stack into cards instead (.stack, public/responsive.css, issue #271).
for (const [f, label, cls] of [['app/payments/screen.html', 'All payments', 'table stack'], ['app/cards/screen.html', 'Wrestlers and their cards', 'table stack'], ['app/site-health/screen.html', 'Site errors in the last 7 days', 'table'], ['app/coach-pay/screen.html', '${esc(c.coach)}: paid lessons', 'table']])
  assert.ok(read(f).includes(`<div class="${cls}" role="region" aria-label="${label}" tabindex="0">`), f + ': a wide table scrolls with the keyboard and says what it is');
const messages = read('app/messages/screen.html');
assert.match(messages, /html body button\.fam\{font-family:var\(--swa-body\);[^}]*text-transform:none/, 'family names in the body font');
assert.match(messages, /@media\(max-width:640px\)\{#sentTable thead\{[^}]*\}#sentTable,#sentTable tbody,#sentTable tr,#sentTable td\{display:block\}/, 'sent announcements stack on a phone');
for (const l of ['Sent', 'Subject', 'To', 'Read', 'Emailed']) assert.ok(messages.includes(`<td data-label="${l}">`), l);
assert.match(read('app/roster/screen.html'), /@media\(max-width:640px\)\{a\[href\^="tel:"\]\{display:inline-flex;align-items:center;min-height:44px/, 'phone numbers are 44px tap targets');
const cards = read('app/cards/screen.html');
assert.match(cards, /<details class="howto"><summary>How checking works<\/summary><p>When a family adds or changes a card number/);
assert.match(cards, /<h1>USA Wrestling cards<\/h1><p class="muted">A wrestler cannot book [^<]*Missing cards block the same as expired ones\.<\/p><details/, 'a short intro, the rest folded');

// ---------- Site health: an intro, and no empty table ----------
assert.match(health, /<h1>Site health<\/h1><p>Whether the site is up/);
const healthScript = health.match(/<script>([\s\S]*)<\/script>/)[1];
async function healthPage(errors) {
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {hidden: true, textContent: '', innerHTML: ''}); return nodes.get(id); };
  const data = {health: {ok: true}, last24h: errors.length, errors, failedEmails: 0, alerts: {emailOn: true, to: 'owner@example.test', last: null}};
  vm.runInNewContext(healthScript, {document: {getElementById: el}, fetch: async () => ({ok: true, json: async () => data}), Date, String, Error, Intl});
  await new Promise(r => setImmediate(r));
  return el;
}
let el = await healthPage([]);
assert.equal(el('errorList').hidden, true, 'no table when there is nothing in it'); assert.equal(el('noErrors').hidden, false);
assert.match(el('now').innerHTML, /0 site errors in the last 24 hours/);
el = await healthPage([{at: '2026-11-07T12:00:00Z', method: 'GET', path: '/x', status: 500, message: '<oops>'}]);
assert.equal(el('errorList').hidden, false); assert.equal(el('noErrors').hidden, true);
assert.match(el('rows').innerHTML, /<code>GET \/x<\/code><\/td><td>500<\/td><td>&lt;oops&gt;<\/td>/);
assert.match(el('now').innerHTML, /1 site error in the last 24 hours/);

// ---------- One month picker on /financials, /timesheets and /coach-time ----------
const mp = vm.createContext({Intl, Date, String, Array, Number});
vm.runInContext(read('public/month-picker.js'), mp);
const M = mp.MonthPicker;
assert.equal(M.shift('2026-01', -1), '2025-12'); assert.equal(M.shift('2025-12', 1), '2026-01'); assert.equal(M.label('2026-11'), 'November 2026');
let opts = M.options('2026-11', '2020-01', '2026-11');
assert.equal((opts.match(/<option/g) || []).length, 13, 'a year back, nothing after the last month allowed');
assert.match(opts, /<option value="2026-11" selected>November 2026<\/option>$/); assert.match(opts, /^<option value="2025-11">November 2025<\/option>/);
assert.equal(M.options('2026-13'), '', 'not a month');
const node = () => ({innerHTML: '', value: '', disabled: false, onclick: null, onchange: null});
const picker = {select: node(), prev: node(), next: node()};
M.set(picker, '2026-11', {min: '2020-01', max: '2026-11'});
assert.equal(picker.select.value, '2026-11'); assert.equal(picker.next.disabled, true); assert.equal(picker.prev.disabled, false);
M.set(picker, '2020-01', {min: '2020-01', max: '2026-11'}); assert.equal(picker.prev.disabled, true); assert.equal(picker.next.disabled, false);
const went = []; M.wire(picker, m => went.push(m));
picker.select.value = '2026-03'; picker.prev.onclick(); picker.next.onclick(); picker.select.onchange();
assert.deepEqual(went, ['2026-02', '2026-04', '2026-03']);
picker.select.value = ''; picker.prev.onclick(); assert.equal(went.length, 3, 'nothing to move from');
for (const [f, prev, next] of [['app/financials/screen.html', 'prevMonth', 'nextMonth'], ['app/timesheets/screen.html', 'prev', 'next'], ['app/coach-time/screen.html', 'prev', 'next']]) {
  const html = read(f);
  assert.ok(html.includes(`<div class="month-picker"><button type="button" class="month-step" id="${prev}" aria-label="Previous month">←</button><label class="month-pick"><span>Month</span><select id="month"></select></label><button type="button" class="month-step" id="${next}" aria-label="Next month">→</button></div>`), f + ' uses the shared markup');
  assert.match(html, /<script src="\/month-picker\.js"><\/script>\n?<script>/, f + ' loads the picker before its own script');
  assert.match(html, /MonthPicker\.set\(picker,d\.month,\{/); assert.match(html, /MonthPicker\.wire\(picker,load\);/);
  assert.doesNotMatch(html, /function namedMonthOptions|month-nav/, f + ' has no month picker of its own');
}

// ---------- The walkthrough's phone check for /financials measures against the 390px screen ----------
const journey = read('scripts/e2e/journey.mjs');
assert.match(journey, /const phone = await as\('owner', \{width: 390, height: 844\}\);\n  await phone\.goto\(BASE \+ '\/financials'\);[\s\S]{0,300}document\.documentElement\.scrollWidth - 390\)/);

console.log('Owner polish tests passed: dashboard fonts, tokens, Account menu and phone header; calendar cards; no back link inside the owner shell; download and plain wording; warning tokens; labelled controls and phone tables; site health without an empty table; one month picker; the /financials phone check.');
