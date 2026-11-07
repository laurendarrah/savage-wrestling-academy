// Issue #94: the signed-in owner workspace opens on real numbers. Issue #147: it has no sample screens at all.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {portalCode as code} from './fixtures/portal-script.mjs';

const html = readFileSync('app/portal.html', 'utf8');
const nodes = new Map(), node = s => { if (!nodes.has(s)) nodes.set(s, {value: '', style: {}, textContent: '', innerHTML: '', focus() {}, classList: {remove() {}, toggle() {}}, setAttribute() {}}); return nodes.get(s); };
const responses = {
  '/api/roster': {sessions: [{entries: [{}, {}, {}], checkedIn: 2}, {entries: [{}], checkedIn: 0}]},
  '/api/usaw-cards': {cards: [{state: 'current'}, {state: 'expired'}, {state: 'missing'}, {state: 'verified'}]},
  '/api/waivers': {current: {id: 'v'}, wrestlers: [{signed: true}, {signed: false}]},
  '/api/messages': {families: [{unread: 2}, {unread: 1}, {unread: 0}]},
};
let fetched = [];
const location = {hash: '', href: ''};
const ctx = vm.createContext({console, structuredClone, crypto, URL, Intl, Date, JSON, Set, FormData, Promise, location,
  document: {querySelector: node, getElementById: id => node('#' + id), addEventListener() {}}, window: {addEventListener() {}}, setTimeout() {}, confirm: () => true,
  fetch: async url => { fetched.push(url); const key = Object.keys(responses).find(k => url === k); if (url.startsWith('/api/payments')) return {ok: true, json: async () => ({totals: {collectedCents: 123450, count: 7}})}; return key ? {ok: true, json: async () => responses[key]} : {ok: false, json: async () => ({})}; }});
vm.runInContext(code, ctx);

// Live dashboard: real tiles, every real tool, none of the sample counts.
const page = vm.runInContext("page='Dashboard';dashboard()", ctx);
assert.match(page, /id="todayTiles"/); assert.match(page, /href="\/cards"/); assert.ok(!page.includes('Sample active members'), 'no sample stats');
await vm.runInContext('loadToday()', ctx);
const tiles = node('#todayTiles').innerHTML;
assert.match(tiles, /Sessions today<\/span><b[^>]*>2<\/b>.*2 of 4 wrestlers checked in/s);
assert.match(tiles, /Blocked by USA Wrestling card<\/span><b[^>]*color:#b12c38[^>]*>2<\/b>/s);
assert.match(tiles, /Waiver not signed<\/span><b[^>]*>1</s);
assert.match(tiles, /Unread family messages<\/span><b[^>]*>3</s);
assert.ok(!tiles.includes('waitlist') && !fetched.includes('/api/waitlists'), 'no waitlist tile (#210)');
assert.match(tiles, /Collected this month<\/span><b[^>]*>\$1,234\.50<\/b>.*7 payments/s);
assert.ok(fetched.some(u => /^\/api\/payments\?from=\d{4}-\d{2}-01$/.test(u)));
// A tile is left out when its data is unavailable (for example no waiver in force).
responses['/api/waivers'] = {current: null, wrestlers: []}; delete responses['/api/messages'];
await vm.runInContext('loadToday()', ctx);
assert.ok(!node('#todayTiles').innerHTML.includes('Waiver not signed')); assert.ok(!node('#todayTiles').innerHTML.includes('Unread family messages'));

// Sidebar items with their own page open it.
for (const [p, href] of [['Families', '/accounts'], ['Roster & check-in', '/roster'], ['Private lessons', '/lesson-settings'], ['Messages', '/messages'], ['Scholarships', '/scholarships'], ['Coaches', '/staff']]) {
  location.href = ''; vm.runInContext(`go(${JSON.stringify(p)})`, ctx); assert.equal(location.href, href, p);
}

// Issue #147: the launch checklist publishes the programs from the dashboard itself; other items open their page.
responses['/api/launch-checklist'] = {ready: 1, total: 3, items: [
  {key: 'programs', label: 'Programs on the welcome page and calendar', status: 'todo', action: 'publish-programs', detail: 'Families see no programs yet.'},
  {key: 'waiver', label: 'Waiver', status: 'todo', href: '/waivers', detail: 'Publish the approved waiver.'},
  {key: 'health', label: 'Site health', status: 'done', href: '/site-health', detail: 'No server errors'}]};
await vm.runInContext('loadLaunch()', ctx);
const launch = node('#launch').innerHTML;
assert.match(launch, /data-launch="programs" data-status="todo"[\s\S]*?<button type="button" class="primary" onclick="publishPrograms\(\)">Publish the programs<\/button>/);
assert.match(launch, /data-launch="waiver"[\s\S]*?href="\/waivers">Open/);
assert.doesNotMatch(launch.split('data-launch="health"')[1], /<a class="button"|<button/, 'a ready item has no button');
assert.match(launch, /data-launch="waiver"[\s\S]*?<a class="button" href="\/waivers">Open<\/a>/, 'the academy’s own pages open in the same tab');
// Issue #252: email waits on its setup, not a decision; the Launch board in GitHub opens in a new tab; a section opens on the dashboard.
responses['/api/launch-checklist'] = {ready: 0, total: 1, items: [
  {key: 'email', label: 'Email notices', status: 'waiting', detail: 'Set up Resend on your account'},
  {key: 'events', label: 'Camps and events', status: 'info', section: 'Camps & events', detail: '1 camp coming up'},
  {key: 'decisions', label: 'Decisions and attorney review', status: 'info', href: 'https://github.com/laurendarrah/savage-wrestling-academy/issues/246', detail: 'See the Launch board in GitHub'},
  {key: 'website', label: 'Public website', status: 'todo', href: '/website', detail: 'Write your public website'}]};
await vm.runInContext('loadLaunch()', ctx);
{
  const l = node('#launch').innerHTML;
  assert.match(l, /data-launch="email" data-status="waiting"><span aria-label="Waiting on setup"/); assert.ok(!l.includes('Waiting on a decision'));
  assert.match(l, /data-launch="decisions"[\s\S]*?<a class="button" href="https:\/\/github\.com\/laurendarrah\/savage-wrestling-academy\/issues\/246" target="_blank" rel="noopener">Open<\/a>/);
  assert.match(l, /data-launch="website"[\s\S]*?<a class="button" href="\/website">Open<\/a>/);
  assert.match(l, /data-launch="events"[\s\S]*?<button type="button" onclick="go\('Camps &amp; events'\)">Open<\/button>/);
  assert.ok(l.indexOf('data-launch="website"') < l.indexOf('data-launch="email"'), 'to-dos come before waiting items');
  assert.match(l, /0 of 1 ready/);
}

// No preview modes: the header links to what families really see.
assert.match(html, /<nav class="family-links" aria-label="What families see">[^]*?<a href="\/welcome">Welcome page<\/a> <a href="\/team">Team page<\/a> <a href="\/calendar">Calendar<\/a><\/nav>/);
for (const gone of ['previewMenu', 'Preview what families see', 'Parent view', 'Wrestler view', 'setMode', 'liveWorkspace', 'sampleDashboard', 'admin-demo', 'attendance-demo', 'qr-preview.js'])
  assert.ok(!html.includes(gone), `portal still has ${gone}`);
assert.ok(!html.includes('OWNER WORKSPACE'), 'the dashboard has no sample-preview banner (issue #133)');
console.log('Live owner dashboard tests passed');
