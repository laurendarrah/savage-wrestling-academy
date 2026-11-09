// Issue #261: one owner shell (sidebar and header) on every owner page, from one navigation list. Each owner route
// runs here with a stand-in sign-in and goes through the Worker's decoration, as on the site: every owner page has
// exactly one shell with the current item marked, coaches and families never get it, the dashboard opens the section
// in its address, and the shell's scripts (the inline start-up and public/owner-shell.js, which the typecheck skips)
// run against a small fake page.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {portalCode} from './fixtures/portal-script.mjs';

const OWNER = 'savagewrestlingclub@gmail.com';
const users = {
  owner: {id: 'u-owner', email: OWNER, email_confirmed_at: '2026-01-01', factors: [{status: 'verified', factor_type: 'totp'}]},
  coach: {id: 'u-coach', email: 'coach@example.test', email_confirmed_at: '2026-01-01', factors: [{status: 'verified', factor_type: 'totp'}]},
  family: {id: 'u-family', email: 'family@example.test', email_confirmed_at: '2026-01-01', factors: []},
};
let as = 'owner';
const auth = {
  OWNER_EMAIL: OWNER, appOrigin: () => 'https://academy.test', sameOrigin: () => true,
  verifiedOwner: u => u?.email === OWNER,
  verifiedAccount: async () => ({user: users[as], headers: new Headers({'Cache-Control': 'private, no-store'})}),
  strongAccount: async () => ({user: users[as], strong: true, headers: new Headers({'Cache-Control': 'private, no-store'})}),
  ownerIdentity: async () => ({user: users[as], strong: true, mfaRequired: false, headers: new Headers({'Cache-Control': 'private, no-store'}),
    owner: as === 'owner' ? {userId: 'supabase:u-owner', displayName: OWNER} : null}),
};
const access = {accountRole: async () => ({role: as}), coachAccess: async () => true};
// An empty academy: every query finds nothing.
const statement = {bind() { return statement; }, all: async () => ({results: []}), first: async () => null, run: async () => ({meta: {changes: 0}}), raw: async () => []};
const DB = {prepare: () => statement, batch: async list => list.map(() => ({results: []}))};

const loaded = new Map();
function load(file) {
  if (loaded.has(file)) return loaded.get(file);
  const module = {exports: {}}; loaded.set(file, module.exports);
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js, {module, exports: module.exports, Response, Request, Headers, URL, URLSearchParams, Intl, Date, JSON, Math, console, crypto, TextEncoder, TextDecoder, atob, btoa, setTimeout,
    require(name) {
      if (name === 'cloudflare:workers') return {env: {DB, SUPABASE_URL: 'https://abcdefgh.supabase.co'}};
      if (name.endsWith('/account-auth')) return auth;
      if (name.endsWith('/access-control')) return access;
      if (name.endsWith('?raw')) return {default: readFileSync(join(dirname(file), name.replace('?raw', '')), 'utf8')};
      if (!name.startsWith('.')) throw new Error('unexpected import ' + name);
      return load(join(dirname(file), name) + '.ts');
    }});
  return module.exports;
}
const {decorateResponse, applyScriptNonce} = load('lib/page-chrome.ts');
const {OWNER_SHELL_HEADER, SHELL_BOOT, OWNER_SHELL_HEAD, VIEW_TRANSITION_OPT_IN} = load('lib/owner-shell.ts');
const {currentOwnerHref, ownerNavTabs, OWNER_NAV_ITEMS, OWNER_SHELL_PAGES} = load('lib/owner-nav.ts');

async function open(path, who = 'owner') {
  as = who;
  const url = 'https://academy.test' + path, pathname = new URL(url).pathname;
  const route = load(`app${pathname === '/' ? '' : pathname}/route.ts`);
  const request = new Request(url);
  const response = await decorateResponse(request, await route.GET(request));
  return {status: response.status, headers: response.headers, html: response.status === 200 ? await response.text() : ''};
}
const count = (s, part) => s.split(part).length - 1;

// ---------- Every owner route: one shell, the current item marked ----------
// Issue #283 folded the sidebar: a page that merged into another item marks that item (the waiver pages mark Cards &
// documents, scholarships and transfers mark Approvals & scholarships, the coach pages mark Coaches & lessons, coach pay
// marks Money, curricula and the plan editor mark Calendar & plans) and gets the item's switch under its title row.
const ownerRoutes = {
  '/': '/', '/roster': '/roster', '/payments': '/payments', '/messages': '/messages', '/cards': '/cards',
  '/accounts': '/accounts', '/account-setup': '/accounts', '/approvals': '/approvals', '/scholarships': '/approvals', '/waivers': '/cards',
  '/consent-forms': '/cards', '/transfers': '/approvals', '/practice-plans?date=2026-11-09&program=Elementary': '/#practice-calendar',
  '/curricula': '/#practice-calendar', '/website': '/website', '/staff': '/staff', '/coach-openings?email=coach%40example.test': '/staff',
  '/coach-profile?email=coach%40example.test': '/staff', '/contracts': '/cards', '/lesson-settings': '/staff', '/timesheets': '/staff',
  '/financials': '/financials', '/coach-pay': '/financials', '/payment-setup': '/payment-setup', '/backups': '/backups', '/site-health': '/site-health',
  '/data-requests': '/data-requests', '/security-log': '/security-log', '/help/owner': '/help/owner', '/security': null,
};
// The pages that share an item get its switch, with this page marked (the plan editor counts as the calendar, a
// coach's pages as Coaches); pages without sisters get none.
const tabsOf = pathname => JSON.parse(JSON.stringify(ownerNavTabs(pathname).map(t => t.href)));
const markedTab = {'/practice-plans': '/#practice-calendar', '/coach-openings': '/staff', '/coach-profile': '/staff'};
assert.deepEqual(tabsOf('/waivers'), ['/cards', '/waivers', '/consent-forms', '/contracts']); assert.deepEqual(tabsOf('/payments'), []);
// Every destination in the navigation that is an owner page is covered (Coach view is the coach home, not an owner page).
for (const i of OWNER_NAV_ITEMS) if (!i.section && !i.leaves) assert.ok(Object.keys(ownerRoutes).some(r => r.split('?')[0] === i.href), i.href + ' is checked');
// The pages the browser treats as inside the shell (View Transitions) are exactly the routes that draw it.
assert.deepEqual([...OWNER_SHELL_PAGES].sort(), [...new Set(Object.keys(ownerRoutes).map(r => r.split('?')[0]))].sort());
for (const [path, current] of Object.entries(ownerRoutes)) {
  const {status, headers, html} = await open(path);
  assert.equal(status, 200, path);
  assert.equal(headers.get(OWNER_SHELL_HEADER), null, path + ': the shell mark never leaves the Worker');
  assert.equal(count(html, '<nav class="os-nav"'), 1, path + ': one sidebar');
  assert.equal(count(html, '<header class="os-top"'), 1, path + ': one header');
  assert.equal(count(html, 'class="swa-bar"'), 0, path + ': no top bar of its own');
  assert.match(html, /<body [^>]*data-swa-shell="owner"/, path);
  // Pages with a nonce script policy (issue #274) carry the response's nonce on the shell's scripts and prefetch rules.
  const nonce = headers.get('Content-Security-Policy')?.match(/'nonce-([0-9a-f]+)'/)?.[1] ?? null;
  assert.ok(html.includes(nonce ? applyScriptNonce(OWNER_SHELL_HEAD, nonce) : OWNER_SHELL_HEAD), path + ': the shell stylesheet, script and prefetch rules');
  assert.equal(count(html, '<main'), 1, path + ': one main area');
  const mainId = html.match(/<main\b[^>]*\bid="([^"]+)"/)[1];
  assert.match(html, new RegExp(`<a class="os-skip" href="#${mainId}">Skip to main content</a>`), path + ': the skip link reaches the main area');
  const nav = html.match(/<nav class="os-nav"[\s\S]*?<\/nav>/)[0];
  const marked = [...nav.matchAll(/<a href="([^"]+)" aria-current="page">/g)].map(m => m[1]);
  assert.deepEqual(marked, current ? [current] : [], path + ': the current item');
  assert.equal(currentOwnerHref(path.split('?')[0]), current, path);
  if (!current) assert.match(html, /<a class="os-item" href="\/security" aria-current="page">Account security<\/a>/, 'Account security is marked in the Account menu');
  // The page's own heading opens the main area, with no back link to the dashboard.
  assert.doesNotMatch(html, /← Owner dashboard|← Owner workspace/, path);
  assert.equal(count(html.match(/<header class="os-top"[\s\S]*?<\/header>/)[0], 'syncStatus'), 0, path + ': the header never holds the save status (the dashboard draws it in its title row, issue #283)');
  // The switch between sister pages sits under the title row, with this page marked; pages without sisters have none.
  const pathname = path.split('?')[0], tabs = html.match(/<nav class="os-tabs" aria-label="Pages in this section">([\s\S]*?)<\/nav>/);
  if (tabsOf(pathname).length) {
    assert.ok(tabs, path + ': has the switch');
    assert.deepEqual([...tabs[1].matchAll(/href="([^"]+)"/g)].map(m => m[1]), tabsOf(pathname), path);
    assert.match(tabs[1], new RegExp(`<a href="${(markedTab[pathname] || pathname).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" aria-current="page">`), path + ': marked in the switch');
    assert.equal((tabs[1].match(/aria-current/g) || []).length, 1, path + ': one page marked');
    assert.ok(html.indexOf('<div class="swa-title">') < html.indexOf('<nav class="os-tabs"'), path + ': the switch follows the title row');
  } else if (pathname !== '/') assert.equal(tabs, null, path + ': no switch');
  assert.ok(html.indexOf('<nav class="os-nav"') < html.indexOf('<header class="os-top"') && html.indexOf('<header class="os-top"') < html.indexOf('<main'), path + ': sidebar, header, then the page');
  assert.equal(count(html, `<script${nonce ? ` nonce="${nonce}"` : ''}>${SHELL_BOOT}</script>`), 1, path + ': the start-up script runs before the page is drawn');
}
// The dashboard keeps its own styles: the shell, but not savage.css, and none of its old sidebar markup.
{
  const {html} = await open('/');
  assert.doesNotMatch(html, /href="\/savage\.css"/); assert.match(html, /href="\/owner-shell\.css"/);
  assert.doesNotMatch(html, /class="shell"|<aside|id="navToggle"/);
  assert.match(html, /<button type="button" class="os-item" onclick="closeOwnerTools\(\);reloadAcademy\(\)">Refresh saved data<\/button>/);
}
// A tool page opens with the title row inside the shell: the heading, the intro's first sentence, and the rest behind
// "How this works" (issue #280). No owner page carries the black band.
{
  const {html} = await open('/payments');
  // The page's one red button, Record a payment, opens the page beside the title (issue #283); the rest of the intro folds away.
  assert.match(html, /<main id="swa-main"><div class="swa-title"><div class="swa-title__text"><h1>Payments<\/h1><p class="muted">Every payment, online and offline\.<\/p><\/div><div class="swa-title__actions"><a href="#record" class="button primary" id="openRecord">Record a payment<\/a><\/div><\/div><details class="how"><summary>How this works<\/summary><p>Offline payments count/);
  for (const path of Object.keys(ownerRoutes)) assert.doesNotMatch((await open(path)).html, /class="swa-head"/, path + ' has no band');
  assert.match(html, /href="\/savage\.css"><style>@media \(prefers-reduced-motion:no-preference\)\{@view-transition\{navigation:auto\}\}<\/style><link rel="stylesheet" href="\/owner-shell\.css">/, 'the shell styles load after savage.css, with the View Transition opt-in ahead of them');
}

// ---------- Coaches and families never get the shell; the owner checks are unchanged ----------
for (const path of ['/roster', '/practice-plans', '/coach-profile', '/security', '/coach', '/coach-time']) {
  const {status, html} = await open(path, 'coach');
  assert.equal(status, 200, path);
  // The shell's own markup and files: a page's stylesheet may name the shell attribute to style itself inside and
  // outside the shell (the roster, issue #286), which is not the shell.
  assert.doesNotMatch(html, /class="os-(nav|top|side)"|data-swa-shell="|owner-shell\.(css|js)/, path + ' (coach) has no owner shell');
  assert.match(html, /class="swa-bar"/, path + ' (coach) keeps the site top bar');
}
for (const path of ['/family', '/security', '/register']) {
  const {status, html} = await open(path, 'family');
  assert.equal(status, 200, path);
  assert.doesNotMatch(html, /os-nav|data-swa-shell/, path + ' (family) has no owner shell');
}
for (const path of ['/payments', '/accounts', '/staff', '/security-log', '/approvals']) {
  for (const who of ['coach', 'family']) {
    const {status, headers, html} = await open(path, who);
    assert.notEqual(status, 200, `${path} still refuses a ${who}`);
    assert.equal(headers.get(OWNER_SHELL_HEADER), null); assert.equal(html, '');
  }
}
{ // A redirect the owner gets (the practice plans list goes to the calendar) carries no shell mark either.
  const {status, headers} = await open('/practice-plans');
  assert.equal(status, 303); assert.equal(headers.get('Location'), '/#practice-calendar'); assert.equal(headers.get(OWNER_SHELL_HEADER), null);
}
console.log('Owner shell: every owner route has one sidebar and header with the current item marked; coaches and families never do');

// ---------- The start-up script: the dashboard's #section is marked before the page is drawn ----------
function fakeShell(hash, pathname = '/') {
  const els = {};
  const el = (tag, attrs = {}, parent = null) => {
    const e = {tag, attrs: {...attrs}, parent, children: [], textContent: attrs.text || '', scrollTop: 0, clientHeight: 400, offsetTop: attrs.top || 0, offsetHeight: 38, open: false,
      getAttribute: n => e.attrs[n] ?? null, setAttribute: (n, v) => { e.attrs[n] = String(v); }, removeAttribute: n => { delete e.attrs[n]; }, hasAttribute: n => n in e.attrs,
      closest(sel) { for (let p = e; p; p = p.parent) if (p.tag === sel) return p; return null; }};
    if (parent) parent.children.push(e);
    if (attrs.id) els[attrs.id] = e;
    return e;
  };
  const side = el('div', {id: 'swa-os-side', 'data-os-pages': OWNER_SHELL_PAGES.join(' ')}), nav = el('nav', {id: 'swa-os-nav'}, side);
  const links = [];
  const list = (label, items) => {
    const ul = el('ul', label ? {'aria-labelledby': 'g-' + label} : {}, nav);
    if (label) el('p', {id: 'g-' + label, text: label}, nav);
    for (const [href, text, top, sections] of items) links.push(el('a', {href, text, top, ...(sections ? {'data-os-sections': sections} : {})}, el('li', {}, ul)));
  };
  list('Today', [['/', 'Dashboard', 0]]);
  list('Academy', [['/#practice-calendar', 'Calendar & plans', 300], ['/#programs', 'Programs, schedules & events', 900, '#schedules #events']]);
  links[0].setAttribute('aria-current', 'page');
  el('span', {id: 'swa-os-crumb', text: 'Dashboard'});
  nav.querySelector = sel => { let m = sel.match(/^a\[href="([^"]+)"\]$/); if (m) return links.find(a => a.attrs.href === m[1]) || null;
    m = sel.match(/^a\[data-os-sections~="([^"]+)"\]$/); if (m) return links.find(a => (a.attrs['data-os-sections'] || '').split(' ').includes(m[1])) || null;
    return sel === '[aria-current="page"]' ? links.find(a => a.attrs['aria-current']) || null : null; };
  const store = new Map();
  const on = {};
  const ctx = {document: {getElementById: id => els[id] || null}, location: {pathname, hash}, sessionStorage: {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)}, Number, Math, URL,
    addEventListener: (t, f) => { on[t] = f; }};
  return {ctx, els, links, store, side, on};
}
{
  const page = fakeShell('#programs');
  vm.runInNewContext(SHELL_BOOT, page.ctx);
  assert.deepEqual(page.links.map(a => a.attrs['aria-current'] || ''), ['', '', 'page'], '/#programs marks Programs, schedules & events');
  assert.equal(page.els['swa-os-crumb'].textContent, 'Academy / Programs, schedules & events');
  assert.equal(page.side.scrollTop, 900 - 200, 'the current item is scrolled into view');
}
for (const hash of ['#schedules', '#events?x=1']) { // A section without its own item marks the item it sits under (issue #283).
  const page = fakeShell(hash);
  vm.runInNewContext(SHELL_BOOT, page.ctx);
  assert.deepEqual(page.links.map(a => a.attrs['aria-current'] || ''), ['', '', 'page'], hash + ' marks Programs, schedules & events');
  assert.equal(page.els['swa-os-crumb'].textContent, 'Academy / Programs, schedules & events');
}
{
  const page = fakeShell('#practice-calendar?month=2027-02');
  vm.runInNewContext(SHELL_BOOT, page.ctx);
  assert.deepEqual(page.links.map(a => a.attrs['aria-current'] || ''), ['', 'page', '']);
}
for (const hash of ['', '#', '#nothing', '#"]x']) {
  const page = fakeShell(hash);
  vm.runInNewContext(SHELL_BOOT, page.ctx);
  assert.deepEqual(page.links.map(a => a.attrs['aria-current'] || ''), ['page', '', ''], JSON.stringify(hash) + ' stays on Dashboard');
}
{ // Another page keeps what the server marked, and the sidebar opens where it was left.
  const page = fakeShell('#programs', '/payments');
  page.links[0].removeAttribute('aria-current'); page.links[1].setAttribute('aria-current', 'page');
  page.store.set('swa-os-scroll', '120');
  vm.runInNewContext(SHELL_BOOT, page.ctx);
  assert.deepEqual(page.links.map(a => a.attrs['aria-current'] || ''), ['', 'page', '']);
  assert.equal(page.side.scrollTop, 120, 'the current item is already in view');
  // A current item scrolled out of view is brought back, never past the top.
  page.store.set('swa-os-scroll', '600'); vm.runInNewContext(SHELL_BOOT, page.ctx); assert.equal(page.side.scrollTop, 100);
  page.links[1].offsetTop = 40; page.store.set('swa-os-scroll', '600'); vm.runInNewContext(SHELL_BOOT, page.ctx); assert.equal(page.side.scrollTop, 0);
}
{ // View Transitions: kept between owner pages, skipped for a page outside the shell, and an aborted one is let go quietly.
  const page = fakeShell('', '/payments');
  vm.runInNewContext(SHELL_BOOT, page.ctx);
  const transition = () => { const t = {skipped: false, caught: 0, skipTransition() { t.skipped = true; }}; for (const k of ['ready', 'finished', 'updateCallbackDone']) t[k] = {catch: () => { t.caught++; }}; return t; };
  const swap = url => { const t = transition(); page.on.pageswap({viewTransition: t, activation: {entry: {url: 'https://academy.test' + url}}}); return t; };
  for (const url of ['/financials', '/', '/#programs', '/accounts?q=Pat', '/coach-openings?email=x', '/security']) { const t = swap(url); assert.equal(t.skipped, false, url); assert.equal(t.caught, 3, url); }
  for (const url of ['/coach', '/welcome', '/calendar', '/family']) assert.equal(swap(url).skipped, true, url + ' is outside the shell');
  const t = transition(); page.on.pagereveal({viewTransition: t}); assert.equal(t.caught, 3, 'the new page lets an aborted transition go quietly');
  page.on.pagereveal({viewTransition: null}); page.on.pageswap({viewTransition: null, activation: null});
}
console.log('Owner shell start-up: deep links mark their section and breadcrumb; the sidebar keeps its place; transitions only inside the shell');

// ---------- The dashboard opens the section named in its address ----------
{
  const node = () => ({innerHTML: '', textContent: '', value: '', style: {}, classList: {remove() {}, toggle() {}}, setAttribute() {}});
  const nodes = new Map(), get = s => { if (!nodes.has(s)) nodes.set(s, node()); return nodes.get(s); };
  const location = {hash: '', href: '', pathname: '/'}, listeners = {}, calls = [];
  const window = {addEventListener: (t, f) => { listeners[t] = f; }, scrollTo: () => calls.push('scroll'),
    SwaOwnerShell: {mark: () => calls.push('mark'), focusMain: () => calls.push('focus'), closeDrawer: () => calls.push('close'), closeAccount: () => { calls.push('account'); return true; }}};
  const ctx = vm.createContext({console, structuredClone, crypto, Intl, Date, JSON, Set, FormData, location, window,
    history: {pushState: (s, t, url) => { location.hash = ''; calls.push('push ' + url); }},
    document: {querySelector: get, getElementById: () => null, addEventListener() {}}, setTimeout() {}, confirm: () => true, fetch: async () => ({ok: false, json: async () => ({})})});
  vm.runInContext(portalCode, ctx);
  const run = s => vm.runInContext(s, ctx);
  run('render=(r=>()=>{globalThis.renders=(globalThis.renders||0)+1;return r()})(render)');
  for (const [hash, section] of [['', 'Dashboard'], ['#programs', 'Programs & pricing'], ['#events', 'Camps & events'], ['#schedules', 'Schedules'], ['#practice-calendar', 'Calendar'], ['#unknown', 'Dashboard'], ['#programs?x=1', 'Programs & pricing']]) {
    location.hash = hash;
    assert.equal(run('sectionFromAddress()'), section, hash);
  }
  location.hash = '#practice-calendar?month=2027-02';
  assert.equal(run('sectionFromAddress()'), 'Calendar'); assert.equal(run('calendarMonthKey()'), '2027-02', 'the calendar opens on the month in the address');
  // Following the sidebar's links on the dashboard: the hash changes, the section draws, the shell marks it and focus moves.
  run("page='Dashboard'"); location.hash = '#programs'; calls.length = 0;
  listeners.hashchange();
  assert.equal(run('page'), 'Programs & pricing'); assert.match(get('#main').innerHTML, /PROGRAMS &amp; PRICING|PROGRAMS & PRICING/);
  assert.deepEqual(calls, ['scroll', 'mark', 'focus']);
  calls.length = 0; listeners.hashchange(); assert.deepEqual(calls, [], 'the same address draws nothing again');
  // Back to the dashboard without loading the page again (the shell's Dashboard link).
  run("go('Dashboard')");
  assert.equal(run('page'), 'Dashboard'); assert.ok(calls.includes('push /'), 'the address becomes / again'); assert.ok(calls.includes('mark') && calls.includes('focus'));
  // A launch checklist item names its section; a page name opens the page.
  calls.length = 0; run("go('Camps & events')"); assert.equal(location.hash, '#events'); assert.equal(run('page'), 'Camps & events');
  run("go('Money')"); assert.equal(location.href, '/financials');
  assert.equal(run('closeOwnerTools()'), true, 'Refresh saved data closes the shell’s Account menu');
}
console.log('Dashboard deep links: /#programs, /#events, /#schedules and /#practice-calendar?month= open their section, on load and on change');

// ---------- public/owner-shell.js: drawer, Account menu, focus ----------
function fakeDom({pathname = '/payments', hash = '', flag = null} = {}) {
  const listeners = {doc: {}, win: {}, el: new Map()};
  const all = [];
  const make = (id, tag = 'div', extra = {}) => {
    const e = {id, tag, attrs: {}, classSet: new Set(), hidden: false, open: false, inert: false, disabled: false, textContent: '', scrollTop: 0, children: [], parent: null, rects: 1, ...extra,
      getAttribute(n) { return this.attrs[n] ?? null; }, setAttribute(n, v) { this.attrs[n] = String(v); }, removeAttribute(n) { delete this.attrs[n]; }, hasAttribute(n) { return n in this.attrs; },
      addEventListener(t, f) { listeners.el.set(id + ':' + t, f); }, focus() { doc.activeElement = this; }, getClientRects() { return {length: this.rects}; },
      contains(o) { for (let p = o; p; p = p.parent) if (p === this) return true; return false; },
      closest(sel) { for (let p = this; p; p = p.parent) if (p.matches(sel)) return p; return null; },
      matches(sel) { return sel.split(',').some(s => { s = s.trim(); return s === tag || s === '#' + id || (s.startsWith('.') && this.classSet.has(s.slice(1))) || (s === 'a[href]' && tag === 'a') || (s === '[data-os-signout]' && 'data-os-signout' in this.attrs) || (s === '.os-side, .os-top'); }); },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) { const out = []; const walk = n => { for (const c of n.children) { if (sel === '[aria-current="page"]' ? c.attrs['aria-current'] === 'page' : sel.startsWith('a[href="') ? c.tag === 'a' && c.attrs.href === sel.slice(8, -2) : c.matches(sel) || (sel.includes('a[href]') && c.tag === 'a') || (sel.includes('button') && c.tag === 'button') || (sel.includes('summary') && c.tag === 'summary')) out.push(c); walk(c); } }; walk(this); return out; }};
    e.classList = {add: c => e.classSet.add(c), remove: c => e.classSet.delete(c), contains: c => e.classSet.has(c)};
    all.push(e); return e;
  };
  const add = (parent, child) => { child.parent = parent; parent.children.push(child); return child; };
  const body = make('body', 'body'), side = add(body, make('swa-os-side')), work = add(body, make('work')); work.classSet.add('os-work');
  side.classSet.add('os-side');
  const close = add(side, make('swa-os-close', 'button')), nav = add(side, make('swa-os-nav', 'nav'));
  const ul = add(nav, make('ul1', 'ul')); ul.attrs['aria-labelledby'] = 'g1';
  const dash = add(ul, make('a-dash', 'a', {pathname: '/', search: '', hash: '', origin: 'https://academy.test'})); dash.attrs.href = '/'; dash.textContent = 'Dashboard';
  const prog = add(ul, make('a-prog', 'a', {pathname: '/', search: '', hash: '#programs', origin: 'https://academy.test'})); prog.attrs.href = '/#programs'; prog.textContent = 'Programs & pricing';
  const pay = add(ul, make('a-pay', 'a', {pathname: '/payments', search: '', hash: '', origin: 'https://academy.test'})); pay.attrs.href = '/payments'; pay.textContent = 'Payments';
  pay.attrs['aria-current'] = 'page';
  const group = add(side, make('g1', 'p')); group.textContent = 'Schedule & programs';
  const top = add(work, make('swa-os-top', 'header')); top.classSet.add('os-top');
  const menu = add(top, make('swa-os-menu', 'button')), crumb = add(top, make('swa-os-crumb', 'span'));
  const account = add(top, make('swa-os-account', 'details')), summary = add(account, make('summary', 'summary'));
  const signout = add(account, make('signout', 'button')); signout.attrs['data-os-signout'] = '';
  const scrim = add(body, make('swa-os-scrim'));
  const main = add(work, make('main', 'main')), h1 = add(main, make('h1', 'h1'));
  const skip = add(body, make('skip', 'a')); skip.classSet.add('os-skip');
  const byId = Object.fromEntries(all.map(e => [e.id, e]));
  const doc = {body, activeElement: body, getElementById: id => byId[id] || null,
    querySelector: sel => sel === '.os-work' ? work : sel === 'main' ? main : sel === '.os-skip' ? skip : null,
    querySelectorAll: sel => sel === 'main h1' ? [h1] : [], addEventListener: (t, f) => { listeners.doc[t] = f; }};
  const store = new Map(flag ? [['swa-os-focus', flag]] : []);
  const fetched = [];
  const win = {location: {pathname, hash, search: '', origin: 'https://academy.test', href: ''}, sessionStorage: {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k)},
    addEventListener: (t, f) => { listeners.win[t] = f; }, matchMedia: () => ({addEventListener: (t, f) => { listeners.wide = f; }}),
    fetch: async (url, opts) => { fetched.push([url, opts]); return {ok: true}; }};
  vm.runInNewContext(readFileSync('public/owner-shell.js', 'utf8'), {document: doc, window: win, setTimeout, Array, String, JSON});
  const key = (k, extra = {}) => { const e = {key: k, preventDefault() { this.prevented = true; }, ...extra}; listeners.doc.keydown(e); return e; };
  const click = (target, extra = {}) => listeners.doc.click({target, defaultPrevented: false, ...extra});
  return {doc, win, byId, listeners, store, fetched, key, click, side, work, menu, close, scrim, account, summary, signout, h1, dash, prog, pay, crumb};
}
{
  const p = fakeDom();
  const tap = id => p.listeners.el.get(id + ':click')();
  // Open: the drawer is a modal dialog over the page, focus moves into it.
  tap('swa-os-menu');
  assert.ok(p.doc.body.classList.contains('os-open')); assert.equal(p.menu.attrs['aria-expanded'], 'true'); assert.equal(p.scrim.hidden, false);
  assert.equal(p.side.attrs.role, 'dialog'); assert.equal(p.side.attrs['aria-modal'], 'true'); assert.equal(p.work.inert, true, 'the page behind cannot be reached');
  assert.equal(p.doc.activeElement, p.close, 'focus moves to Close menu');
  // Tab and Shift+Tab wrap inside the drawer.
  p.doc.activeElement = p.pay; let e = p.key('Tab'); assert.ok(e.prevented); assert.equal(p.doc.activeElement, p.close, 'Tab from the last item goes to the first');
  e = p.key('Tab', {shiftKey: true}); assert.ok(e.prevented); assert.equal(p.doc.activeElement, p.pay, 'Shift+Tab from the first goes to the last');
  p.doc.activeElement = p.dash; e = p.key('Tab'); assert.ok(!e.prevented, 'Tab moves normally in between');
  // Escape closes it and focus returns to Menu.
  p.key('Escape');
  assert.ok(!p.doc.body.classList.contains('os-open')); assert.equal(p.menu.attrs['aria-expanded'], 'false'); assert.equal(p.scrim.hidden, true);
  assert.equal(p.side.attrs.role, undefined); assert.equal(p.work.inert, false); assert.equal(p.doc.activeElement, p.menu);
  // The scrim and the Close button close it too; a wider window closes it.
  tap('swa-os-menu'); tap('swa-os-scrim'); assert.ok(!p.doc.body.classList.contains('os-open'));
  tap('swa-os-menu'); tap('swa-os-close'); assert.ok(!p.doc.body.classList.contains('os-open'));
  tap('swa-os-menu'); p.listeners.wide({matches: true}); assert.ok(!p.doc.body.classList.contains('os-open'));
  // Choosing a page in the drawer closes it and asks the next page to focus its heading.
  tap('swa-os-menu'); p.click(p.dash);
  assert.ok(!p.doc.body.classList.contains('os-open')); assert.equal(p.store.get('swa-os-focus'), '1');
  // A link to a section of the page that is open does not (the dashboard moves focus itself); nor does a new-tab click.
  p.store.clear(); p.win.location.pathname = '/'; p.click(p.prog); assert.equal(p.store.get('swa-os-focus'), undefined);
  p.click(p.pay, {metaKey: true}); assert.equal(p.store.get('swa-os-focus'), undefined);
  p.click(p.pay, {defaultPrevented: true}); assert.equal(p.store.get('swa-os-focus'), undefined);
  // The Account menu closes on Escape (focus back on it) and on a click elsewhere.
  p.account.open = true; p.key('Escape'); assert.equal(p.account.open, false); assert.equal(p.doc.activeElement, p.summary);
  p.account.open = true; p.click(p.h1); assert.equal(p.account.open, false);
  // Sign out posts to /api/auth and goes to sign-in.
  p.click(p.signout); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(p.fetched.filter(([u]) => u === '/api/auth').map(([u, o]) => [u, o.method, o.body]), [['/api/auth', 'POST', '{"action":"logout"}']]); assert.equal(p.win.location.href, '/login');
  // The count badges (issue #283): payments needing attention and cards waiting, asked for once a minute per tab.
  assert.deepEqual(p.fetched.filter(([u]) => u !== '/api/auth').map(([u]) => u), ['/api/payments?attention=1', '/api/usaw-cards?show=waiting&limit=1']);
  // Leaving the page remembers where the sidebar was scrolled.
  p.side.scrollTop = 240; p.listeners.win.pagehide(); assert.equal(p.store.get('swa-os-scroll'), '240');
}
{ // Arriving from a shell link: the main heading takes focus once.
  const p = fakeDom({flag: '1'});
  assert.equal(p.doc.activeElement, p.h1); assert.equal(p.h1.attrs.tabindex, '-1'); assert.equal(p.store.get('swa-os-focus'), undefined, 'only once');
  const q = fakeDom();
  assert.notEqual(q.doc.activeElement, q.h1, 'an ordinary load leaves focus alone');
}
{ // The badges are filled from the answers, kept for a minute, and removed again when a count drops to zero.
  const answers = {'/api/payments?attention=1': {attention: [{}, {}]}, '/api/usaw-cards?show=waiting&limit=1': {totals: {waiting: 3}}};
  const p = fakeDom();
  p.win.fetch = async url => ({ok: true, json: async () => answers[url]});
  p.pay.appendChild = el => { p.pay.children.push(el); el.parent = p.pay; };
  const span = {tag: 'span', textContent: '', attrs: {}, setAttribute(n, v) { this.attrs[n] = v; }, className: '', children: [], matches: () => false};
  p.doc.createElement = () => span;
  vm.runInNewContext(readFileSync('public/owner-shell.js', 'utf8'), {document: p.doc, window: p.win, setTimeout, Array, String, JSON, Promise, Date, Number});
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  assert.equal(span.textContent, '2', 'the Payments badge says 2'); assert.equal(span.attrs['aria-label'], '2 waiting'); assert.equal(span.className, 'os-badge');
  const kept = JSON.parse(p.store.get('swa-os-badges')); assert.equal(kept.payments, 2); assert.equal(kept.cards, 3);
}
{ // On the dashboard, the current item and breadcrumb follow the #section.
  const p = fakeDom({pathname: '/', hash: '#programs'});
  p.listeners.win.hashchange();
  assert.equal(p.prog.attrs['aria-current'], 'page'); assert.equal(p.pay.attrs['aria-current'], undefined);
  assert.equal(p.crumb.textContent, 'Schedule & programs / Programs & pricing');
  p.win.location.hash = ''; p.listeners.win.popstate();
  assert.equal(p.dash.attrs['aria-current'], 'page'); assert.equal(p.prog.attrs['aria-current'], undefined);
  assert.equal(typeof p.win.SwaOwnerShell.focusMain, 'function');
}
console.log('Owner shell script: drawer with focus trap and Escape, Account menu, sign-out, focus after a move, current section');

// ---------- Seamless moves: View Transitions, prefetching, motion and the CSP ----------
const css = readFileSync('public/owner-shell.css', 'utf8');
// The opt-in is inline in the head, ahead of the stylesheet, so a page whose stylesheet is still loading has already
// opted in and Chromium does not abort the transition into it (issue #296). The stylesheet only times the cross-fade.
assert.equal(VIEW_TRANSITION_OPT_IN, '<style>@media (prefers-reduced-motion:no-preference){@view-transition{navigation:auto}}</style>', 'cross-document View Transitions, unless less motion is asked for');
assert.ok(OWNER_SHELL_HEAD.startsWith(VIEW_TRANSITION_OPT_IN + '<link rel="stylesheet" href="/owner-shell.css">'), 'the opt-in comes before the shell stylesheet');
assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /@view-transition/, 'the stylesheet does not decide the opt-in');
assert.match(css, /@media \(prefers-reduced-motion:no-preference\)\{\s*::view-transition-old\(root\),::view-transition-new\(root\)\{animation-duration:\.18s\}/);
assert.match(css, /html body \.os-side\{view-transition-name:swa-owner-side\}/); assert.match(css, /html body \.os-top\{view-transition-name:swa-owner-top\}/);
assert.match(css, /prefers-reduced-motion:reduce\)\{html body \.os-side,html body\.os-open \.os-side\{transition:none\}/, 'the drawer does not slide for less motion');
assert.match(css, /@media \(max-width:900px\)\{/, 'the drawer from 900px down');
const rules = JSON.parse(OWNER_SHELL_HEAD.match(/<script type="speculationrules">(.*?)<\/script>/)[1]);
assert.deepEqual(rules.prefetch.map(r => [r.eagerness, r.where.selector_matches]), [['moderate', '.os-nav a, .os-top a, .os-family a']], 'prefetch on hover, shell links only');
assert.ok(!('prerender' in rules), 'prefetch only: nothing runs before the click');
// The base policy from lib/account-auth.ts is unchanged; the Worker adds a nonce script-src per response (issue #274,
// tests/csp-nonce.mjs), and the start-up script and prefetch rules carry that nonce.
const csp = readFileSync('lib/account-auth.ts', 'utf8').match(/'Content-Security-Policy':"([^"]+)"/)[1];
assert.equal(csp, "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'");
console.log('Seamless moves: View Transitions with named sidebar and header, reduced motion respected, hover prefetch allowed by the CSP');
