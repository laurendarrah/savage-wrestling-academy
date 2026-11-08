// Issue #261: the owner shell's sidebar is drawn from one list (lib/owner-nav.ts). Issue #283 folded that list to
// four groups and about fourteen items: pages that merged into one item keep their addresses (`also`), get a switch
// under the title row (`tabs`), and a dashboard section without its own item keeps its deep link `under` the item that
// shows it. The set of pages inside the shell (OWNER_SHELL_PAGES, the View Transition opt-in) did not change.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {portalCode} from './fixtures/portal-script.mjs';

// The owner navigation and shell, as the Worker runs them.
const loaded = new Map();
function load(file) {
  if (loaded.has(file)) return loaded.get(file);
  const module = {exports: {}}; loaded.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, URL, Headers, require: name => load('lib/' + name.replace('./', '') + '.ts')});
  return module.exports;
}
const nav = load('lib/owner-nav.ts');
const OWNER_NAV = JSON.parse(JSON.stringify(nav.OWNER_NAV)), OWNER_NAV_ITEMS = JSON.parse(JSON.stringify(nav.OWNER_NAV_ITEMS)), OWNER_NAV_SHOWN = JSON.parse(JSON.stringify(nav.OWNER_NAV_SHOWN));
const {currentOwnerHref, ownerNavPlace, ownerNavTabs, OWNER_SHELL_PAGES} = nav;
const {ownerSidebar, ownerTopbar, ownerTabs, OWNER_ICONS} = load('lib/owner-shell.ts');

// ---------- The fold ----------
assert.deepEqual(OWNER_NAV.map(g => g.label), ['Today', 'Families', 'Academy', 'Settings & records']);
assert.deepEqual(OWNER_NAV.map(g => g.items.filter(i => !i.under).map(i => i.label)), [
  ['Dashboard', 'Roster & check-in', 'Payments', 'Messages'],
  ['Families', 'Cards & documents', 'Approvals & scholarships'],
  ['Calendar & plans', 'Programs, schedules & events', 'Coaches & lessons', 'Money', 'Public website'],
  ['Coach view', 'Online payment setup', 'Backups', 'Site health', 'Data requests', 'Security activity', 'Owner guide'],
]);
assert.equal(OWNER_NAV_SHOWN.filter(i => !OWNER_NAV.find(g => g.folded).items.includes(i) && !OWNER_NAV.find(g => g.folded).items.some(x => x.href === i.href)).length, 12, 'twelve items before the fold');
assert.ok(OWNER_NAV.find(g => g.folded).label === 'Settings & records', 'settings stay folded');
assert.equal(new Set(OWNER_NAV_ITEMS.map(i => i.href)).size, OWNER_NAV_ITEMS.length, 'each destination once');
// Every destination is a real page or a dashboard section the page knows, and every page named in `also` or `tabs` exists.
for (const i of OWNER_NAV_ITEMS) {
  if (i.section) assert.match(i.href, /^\/(#[a-z-]+)?$/, i.label);
  else assert.ok(readFileSync(`app${i.href}/route.ts`, 'utf8'), i.href);
  for (const a of i.also || []) assert.ok(readFileSync(`app${a}/route.ts`, 'utf8'), a);
  for (const t of i.tabs || []) if (!t.href.startsWith('/#')) assert.ok(readFileSync(`app${t.href}/route.ts`, 'utf8'), t.href);
  if (!i.under) assert.match(OWNER_ICONS[i.href] || '', /^<(path|rect|circle|ellipse)/, i.label + ' has an icon');
  if (i.under) assert.ok(OWNER_NAV_ITEMS.some(p => p.href === i.under && !p.under), i.label + ' sits under a shown item');
}
assert.equal(new Set(Object.values(OWNER_ICONS)).size, Object.keys(OWNER_ICONS).length, 'every destination has its own icon');

// The pages inside the shell are exactly what they were before the fold (issue #261's list).
assert.deepEqual([...OWNER_SHELL_PAGES].sort(), ['/', '/account-setup', '/accounts', '/approvals', '/backups', '/cards', '/coach-openings', '/coach-pay', '/coach-profile', '/consent-forms', '/contracts',
  '/curricula', '/data-requests', '/financials', '/help/owner', '/lesson-settings', '/messages', '/payment-setup', '/payments', '/practice-plans', '/roster', '/scholarships', '/security', '/security-log',
  '/site-health', '/staff', '/timesheets', '/transfers', '/waivers', '/website']);

// ---------- Aliases: a merged page marks the item it lives under, and gets that item's switch ----------
const marks = {'/waivers': '/cards', '/consent-forms': '/cards', '/contracts': '/cards', '/scholarships': '/approvals', '/transfers': '/approvals', '/account-setup': '/accounts',
  '/lesson-settings': '/staff', '/timesheets': '/staff', '/coach-openings': '/staff', '/coach-profile': '/staff', '/coach-pay': '/financials', '/curricula': '/#practice-calendar', '/practice-plans': '/#practice-calendar',
  '/payments': '/payments', '/security': null, '/nowhere': null};
for (const [path, current] of Object.entries(marks)) assert.equal(currentOwnerHref(path), current, path);
assert.equal(currentOwnerHref('/', '#schedules'), '/#programs', 'the Schedules section marks Programs, schedules & events');
assert.equal(currentOwnerHref('/', '#events'), '/#programs');
assert.equal(currentOwnerHref('/', '#programs'), '/#programs');
assert.equal(currentOwnerHref('/', '#practice-calendar?month=2027-01'), '/#practice-calendar');
assert.equal(currentOwnerHref('/', ''), '/');
const plain = v => JSON.parse(JSON.stringify(v));   // values from the shell's realm, as plain objects
assert.deepEqual(plain(ownerNavPlace('/')), {group: '', label: 'Dashboard'}, 'the dashboard stands alone in the breadcrumb');
assert.deepEqual(plain(ownerNavPlace('/cards')), {group: 'Families', label: 'Cards & documents'});
assert.deepEqual(plain(ownerNavTabs('/consent-forms').map(t => t.href)), ['/cards', '/waivers', '/consent-forms', '/contracts'], 'the documents switch');
assert.deepEqual(plain(ownerNavTabs('/transfers').map(t => t.label)), ['SWA Advance approvals', 'Scholarships', 'Program transfers']);
assert.deepEqual(plain(ownerNavTabs('/timesheets').map(t => t.href)), ['/staff', '/lesson-settings', '/timesheets', '/coach']);
assert.deepEqual(plain(ownerNavTabs('/coach-pay').map(t => t.href)), ['/financials', '/coach-pay']);
assert.deepEqual(plain(ownerNavTabs('/', '#events').map(t => t.href)), ['/#programs', '/#schedules', '/#events'], 'the academy sections switch between themselves');
assert.deepEqual(plain(ownerNavTabs('/', '#practice-calendar').map(t => t.href)), ['/#practice-calendar', '/curricula']);
assert.deepEqual(plain(ownerNavTabs('/payments')), [], 'a page with no sisters has no switch');
// The switch markup: the current page is marked, the practice plan editor counts as the calendar, a coach's pages as Coaches.
assert.equal(ownerTabs('/waivers'), '<nav class="os-tabs" aria-label="Pages in this section"><a href="/cards">USA Wrestling cards</a><a href="/waivers" aria-current="page">Waiver</a><a href="/consent-forms">Parent Consent Form</a><a href="/contracts">Coach contract</a></nav>');
assert.match(ownerTabs('/practice-plans'), /<a href="\/#practice-calendar" aria-current="page">Practice calendar<\/a>/);
assert.match(ownerTabs('/coach-openings'), /<a href="\/staff" aria-current="page">Coaches<\/a>/);
assert.equal(ownerTabs('/payments'), '');

// ---------- The sidebar ----------
const side = ownerSidebar('/payments', {'/payments': 1, '/cards': 2, '/messages': 0});
const sideNav = side.match(/<nav class="os-nav"[\s\S]*?<\/nav>/)[0];
assert.deepEqual([...sideNav.matchAll(/href="([^"]+)"/g)].map(m => m[1]), OWNER_NAV_SHOWN.map(i => i.href), 'the sidebar has exactly the shown items, in order');
assert.deepEqual([...sideNav.matchAll(/<span>([^<]+)<\/span>/g)].map(m => m[1].replace(/&amp;/g, '&')), OWNER_NAV_SHOWN.map(i => i.label));
assert.deepEqual([...sideNav.matchAll(/<p class="os-group" id="[^"]+">([^<]+)<\/p>/g)].map(m => m[1].replace('&amp;', '&')), ['Today', 'Families', 'Academy']);
assert.match(sideNav, /<details class="os-fold"><summary>Settings &amp; records<\/summary>/, 'settings stay folded away');
assert.match(sideNav, /<a href="\/#programs" data-os-sections="#schedules #events">/, 'the hidden sections are named on their parent');
assert.doesNotMatch(sideNav, /href="\/#schedules"|href="\/#events"/, 'and are not drawn');
assert.match(sideNav, /href="\/payments" aria-current="page">[\s\S]*?<span class="os-badge" data-os-badge="\/payments" aria-label="1 waiting">1<\/span>/, 'a count badge on Payments');
assert.match(sideNav, /href="\/cards">[\s\S]*?<span class="os-badge" data-os-badge="\/cards" aria-label="2 waiting">2<\/span>/, 'a count badge on Cards & documents');
assert.doesNotMatch(sideNav, /data-os-badge="\/messages"/, 'zero shows nothing');
const top = ownerTopbar('/payments', '/payments');
const topLinks = [...top.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
assert.deepEqual(topLinks, ['/', '/welcome', '/team', '/calendar', '/security'], 'the header: the logo home (phones), what families see and Account security');
for (const h of topLinks.slice(1)) assert.ok(!sideNav.includes(`href="${h}"`), h + ' is not also in the sidebar');
assert.match(ownerTopbar('/', '/'), /<span id="swa-os-crumb">Dashboard<\/span>/);
assert.match(ownerTopbar('/waivers', '/cards'), /<span id="swa-os-crumb">Families \/ Cards &amp; documents<\/span>/);
assert.doesNotMatch(ownerTopbar('/', '/'), /syncStatus/, 'the save status moved to the dashboard’s title row, so the header is one height everywhere');

// ---------- The dashboard: the sidebar is the map, and the sections share the same switch ----------
const html = readFileSync('app/portal.html', 'utf8');
assert.doesNotMatch(html, /Run the academy|realTools|toolgroups|class="toolmore"/, 'the tools card is gone');
assert.doesNotMatch(html, /<aside|<header|id="nav"|id="navToggle"|toggleMobileNav|navIcons|class="shell"/, 'no sidebar or header of its own');
const ctx = vm.createContext({console, structuredClone, crypto, Intl, Date, JSON, Set, location: {hash: '', href: ''},
  document: {querySelector: () => ({}), getElementById: () => null, addEventListener() {}}, window: {addEventListener() {}}, setTimeout() {}});
vm.runInContext(portalCode, ctx);
const run = s => vm.runInContext(s, ctx);
run("hydratePrograms();page='Programs & pricing'");
assert.match(run('ownerPrograms()'), /<nav class="os-tabs" aria-label="Pages in this section"><a href="\/#programs" aria-current="page">Programs &amp; pricing<\/a><a href="\/#schedules">Schedules<\/a><a href="\/#events">Camps &amp; events<\/a><\/nav>/, 'the academy sections switch');
run("page='Camps & events'");
assert.match(run('events()'), /<a href="\/#events" aria-current="page">Camps &amp; events<\/a>/);
run("page='Calendar'");
assert.match(run('calendar()'), /<a href="\/#practice-calendar" aria-current="page">Practice calendar<\/a><a href="\/curricula">Curricula<\/a>/);
run("page='Dashboard'");
assert.doesNotMatch(run('dashboard()'), /os-tabs/, 'the dashboard itself has no switch');
console.log('owner-nav fold: four groups, aliases mark their item and share its switch, hidden sections keep their deep links, the shell pages are unchanged');
