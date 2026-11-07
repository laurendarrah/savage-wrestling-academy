// Issue #143: the owner dashboard's tools are grouped: four daily tiles, short labeled lists, settings folded away.
// Issue #261: the tools card and the owner shell's sidebar are both drawn from one list (lib/owner-nav.ts), so they
// name the same destinations in the same groups and cannot drift apart.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {portalCode} from './fixtures/portal-script.mjs';

const html = readFileSync('app/portal.html', 'utf8');
const ctx = vm.createContext({console, structuredClone, crypto, Intl, Date, JSON, Set, location: {hash: '', href: ''},
  document: {querySelector: () => ({}), getElementById: () => null, addEventListener() {}}, window: {addEventListener() {}}, setTimeout() {}});
vm.runInContext(portalCode, ctx);
const out = vm.runInContext('realTools()', ctx);

// The owner navigation and shell, as the Worker runs them.
const loaded = new Map();
function load(file) {
  if (loaded.has(file)) return loaded.get(file);
  const module = {exports: {}}; loaded.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, URL, Headers, require: name => load('lib/' + name.replace('./', '') + '.ts')});
  return module.exports;
}
// Plain copies, so they compare with this file's arrays.
const nav = load('lib/owner-nav.ts'), OWNER_NAV = JSON.parse(JSON.stringify(nav.OWNER_NAV)), OWNER_NAV_ITEMS = JSON.parse(JSON.stringify(nav.OWNER_NAV_ITEMS));
const {ownerSidebar, ownerTopbar, OWNER_ICONS} = load('lib/owner-shell.ts');

const daily = out.match(/<div class="daily">([\s\S]*?)<\/div><div class="toolgroups">/)[1];
assert.deepEqual([...daily.matchAll(/href="([^"]+)"/g)].map(m => m[1]), ['/roster', '/payments', '/messages', '/cards'], 'the daily four come first as tiles');
assert.match(daily, /<b>Roster & check-in<\/b><span class="muted">Who has paid for each session\. Check wrestlers in at the door\.<\/span>/);

const groups = [...out.matchAll(/<h3>([^<]+)<\/h3>/g)].map(m => m[1]);
assert.deepEqual(groups, ['Families', 'Schedule & programs', 'Coaches & lessons', 'Money']);
// Issue #194: the books sit with coach pay in the money group.
const money = out.match(/<h3>Money<\/h3><ul>([\s\S]*?)<\/ul>/)[1];
assert.deepEqual([...money.matchAll(/href="([^"]+)"/g)].map(m => m[1]), ['/financials', '/coach-pay']);

const more = out.match(/<details class="toolmore"><summary>Settings & records<\/summary>([\s\S]*?)<\/details>/);
assert(more, 'settings fold away');
assert.doesNotMatch(more[0], /<details[^>]* open/, 'folded by default');

// Every page that had a tile is still reachable, exactly once. The owner's "Practice plans" link only ever sent them to
// the practice calendar, so the calendar section now stands in its place (issue #261).
const pages = ['/roster', '/payments', '/cards', '/waivers', '/messages', '/transfers', '/lesson-settings', '/coach-pay', '/timesheets', '/accounts', '/approvals',
  '/scholarships', '/staff', '/coach', '/curricula', '/payment-setup', '/backups', '/site-health', '/data-requests', '/help/owner', '/security-log', '/financials'];
for (const p of pages) assert.equal(out.split(`href="${p}"`).length - 1, 1, p);
for (const g of ['Calendar', 'Schedules', 'Programs & pricing', 'Camps & events']) assert.equal(out.split(`go('${g}')`).length - 1, 1, g);
// Issue #190 added Coach view (the owner as a coach).
// Issue #194 added the books (Income & expenses); issue #193 added Coach hours.
// Issue #196 added the public website editor, and #195 the Parent Consent Form and Coach contracts.
// Issue #210 removed Waitlists.
for (const p of ['/consent-forms', '/contracts']) assert.equal(out.split(`href="${p}"`).length - 1, 1, p);
assert.equal(out.split('href="/website"').length - 1, 1, '/website');
assert.equal((out.match(/href="|onclick="go\(/g) || []).length, 29, 'no tool added or lost');

// ---------- One list for the card and the sidebar (issue #261) ----------
// The card is the navigation without the Dashboard item itself: the same destinations, names and groups.
const cardItems = [...out.matchAll(/(?:href="([^"]+)"|onclick="go\('([^']+)'\)")[^>]*>(?:<b>)?([^<]+)</g)].map(m => [m[1] || m[2], m[3]]);
const navItems = OWNER_NAV_ITEMS.filter(i => i.href !== '/').map(i => [i.section || i.href, i.label]);
assert.deepEqual(cardItems, navItems, 'the tools card lists the owner navigation in order');
assert.deepEqual(OWNER_NAV.map(g => g.label), ['', 'Every day', 'Families', 'Schedule & programs', 'Coaches & lessons', 'Money', 'Settings & records']);
assert.equal(OWNER_NAV_ITEMS.length, 30);
assert.equal(new Set(OWNER_NAV_ITEMS.map(i => i.href)).size, 30, 'each destination once');
// Every destination is a real page or a dashboard section the page knows.
for (const i of OWNER_NAV_ITEMS) {
  if (i.section) assert.match(i.href, /^\/(#[a-z-]+)?$/, i.label);
  else assert.ok(readFileSync(`app${i.href}/route.ts`, 'utf8'), i.href);
  for (const a of i.also || []) assert.ok(readFileSync(`app${a}/route.ts`, 'utf8'), a);
  assert.match(OWNER_ICONS[i.href] || '', /^<(path|rect|circle|ellipse)/, i.label + ' has an icon');
}
assert.equal(new Set(Object.values(OWNER_ICONS)).size, Object.keys(OWNER_ICONS).length, 'every destination has its own icon');

// The sidebar has exactly the navigation's links, in order, each once; the header adds only what families see and
// Account security, so across the shell no page is linked twice.
const side = ownerSidebar('/payments');
const sideNav = side.match(/<nav class="os-nav"[\s\S]*?<\/nav>/)[0];
assert.deepEqual([...sideNav.matchAll(/href="([^"]+)"/g)].map(m => m[1]), OWNER_NAV_ITEMS.map(i => i.href));
assert.deepEqual([...sideNav.matchAll(/<span>([^<]+)<\/span><\/a>/g)].map(m => m[1].replace('&amp;', '&')), OWNER_NAV_ITEMS.map(i => i.label));
assert.deepEqual([...sideNav.matchAll(/<p class="os-group" id="[^"]+">([^<]+)<\/p>/g)].map(m => m[1].replace('&amp;', '&')), ['Every day', 'Families', 'Schedule & programs', 'Coaches & lessons', 'Money']);
assert.match(sideNav, /<details class="os-fold"><summary>Settings &amp; records<\/summary>/, 'settings stay folded away');
const top = ownerTopbar('/payments', '/payments');
const topLinks = [...top.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
assert.deepEqual(topLinks, ['/', '/welcome', '/team', '/calendar', '/security'], 'the header: the logo home (phones), what families see and Account security');
for (const h of topLinks.slice(1)) assert.ok(!sideNav.includes(`href="${h}"`), h + ' is not also in the sidebar');
// The dashboard no longer draws a sidebar or header of its own.
assert.doesNotMatch(html, /<aside|<header|id="nav"|id="navToggle"|toggleMobileNav|navIcons|class="shell"/);
console.log('owner-tools ok');
