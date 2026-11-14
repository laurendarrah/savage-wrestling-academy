// Issue #94: the signed-in owner workspace opens on real numbers. Issue #147: it has no sample screens at all.
// Issue #283: the dashboard is today: the date and the day's facts in the title row, four tiles, "Tonight on the mat",
// "Needs you" (with the launch checklist's open items), "Coming up" and "This month".
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {portalCode as code} from './fixtures/portal-script.mjs';

const html = readFileSync('app/portal.html', 'utf8');
const nodes = new Map(), node = s => { if (!nodes.has(s)) nodes.set(s, {value: '', style: {}, textContent: '', innerHTML: '', focus() {}, classList: {remove() {}, toggle() {}}, setAttribute() {}}); return nodes.get(s); };
const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'}), monthKey = today.slice(0, 7);
const responses = {
  '/api/roster': {sessions: [{type: 'practice', title: 'SWA Intermediate', program: 'Intermediate', date: today, start: '18:00', end: '19:30', entries: [{}, {}, {}], checkedIn: 2}, {type: 'live', title: 'Friday Night Live', program: null, date: today, start: '16:00', end: '17:00', entries: [{}], checkedIn: 0}, {type: 'practice', title: 'SWA Advance', program: 'Advanced', date: today, start: '18:00', end: '19:30', entries: [], checkedIn: 0}]},
  '/api/usaw-cards?limit=1': {cards: [{state: 'current', blocksToday: true}], totals: {all: 4, blocked: 2, blockedToday: 2, waiting: 1}},
  '/api/payments?attention=1': {graceDays: 7, attention: [{orderId: 'm1'}]},
  '/api/payments?cash=due': {count: 2, dueCents: 5000, bookings: [{wrestler: 'Sam Example', item: 'SWA Intermediate walk-in', amountCents: 4000}, {wrestler: 'Riley Two', item: 'Friday Night Live', amountCents: 1000}]},
  '/api/waivers': {current: {id: 'v'}, wrestlers: [{signed: true}, {signed: false}]},
  '/api/messages': {families: [{unread: 2}, {unread: 1}, {unread: 0}], familiesMatched: 3},
  ['/api/timesheets?month=' + monthKey]: {coaches: [{name: 'Coach Dana', totals: {open: 1, drafts: 3, submitted: 0}}, {name: 'Coach Lee', totals: {open: 1, drafts: 0, submitted: 2}}], overall: {waiting: 2, notSent: 4}, timeOff: {pending: [{coachName: 'Coach Dana'}], approved: [{coachName: 'Coach Dana', text: 'Dec 7 to Dec 8', start: '2099-12-07', end: '2099-12-08', cover: {practices: [{}, {}], lessons: []}}]}},
  ['/api/financials?month=' + monthKey]: {categories: {in: [{category: 'Private lessons', cents: 22000}, {category: 'Camps, clinics and events', cents: 14400}, {category: 'Walk-ins', cents: 8000}], out: []}},
  ['/api/practice-plans?summary=1&month=' + monthKey]: {owner: true, plans: [{program: 'Intermediate', date: today, published: true, title: 'Leg attacks and finishes'}]},
  ['/api/public-schedule?month=' + monthKey]: {liveClasses: [{id: 'fnl', name: 'Friday Night Live', date: '2099-11-13', start: '16:00', memberCents: 1000}], events: [{id: 'camp', name: 'Winter camp', type: 'Camp', dates: ['2099-11-17', '2099-11-18'], cents: 16000, full: true}]},
  '/api/site-health': {last24h: 0, health: {ok: true}},
};
let fetched = [];
const location = {hash: '', href: ''};
// The page reads the clock to mark a session "Now". Run it at 10 AM New York today, before any session, so the test
// passes at any hour (it failed during practice time on Nov 13, issue #304).
let fixedNow = Date.parse(today + 'T15:00:00Z');
class FixedDate extends Date { constructor(...a) { super(...(a.length ? a : [fixedNow])); } static now() { return fixedNow; } }
const ctx = vm.createContext({console, structuredClone, crypto, URL, Intl, Date: FixedDate, JSON, Set, FormData, Promise, location,
  document: {querySelector: node, getElementById: id => node('#' + id), addEventListener() {}}, window: {addEventListener() {}}, setTimeout() {}, confirm: () => true,
  fetch: async url => { fetched.push(url); const key = Object.keys(responses).find(k => url === k);
    if (key) return {ok: true, json: async () => responses[key]};
    if (url.startsWith('/api/coach-pay')) return {ok: true, json: async () => ({totals: {lessons: 5, owedCents: 14300}})};
    if (url.startsWith('/api/payments?from=')) return {ok: true, json: async () => ({totals: {collectedCents: url.endsWith('-01') && !url.includes('-09-01') ? 123450 : 285400, count: 7}})};
    return {ok: false, json: async () => ({})}; }});
vm.runInContext(code, ctx);

// Live dashboard: the date in the title row, two quiet actions, the four tiles, and no tools card (the sidebar is the map).
const page = vm.runInContext("page='Dashboard';dashboard()", ctx);
assert.match(page, /^<div class="swa-title"><div class="swa-title__text"><h1>[A-Z][a-z]+day, [A-Z][a-z]{2} \d{1,2}<\/h1><p class="muted"><span id="todayFacts"><span class="swa-sr">Loading today…<\/span><span class="skeleton facts" aria-hidden="true"><\/span><\/span><\/p><p class="sync" id="syncStatus" role="status" aria-live="polite">/, 'the shared title row: the date, the facts and the save status');
assert.match(page, /<div class="swa-title__actions"><a class="button" href="\/payments#record">Record a payment<\/a><a class="button" href="\/messages#announce">Send a message<\/a><\/div>/);
// Issue #341: while the numbers load, every block is a skeleton with one line for screen readers; the word "Loading" is never on screen.
assert.equal((page.match(/<div class="tile wait" aria-hidden="true">/g) || []).length, 4, 'four tile skeletons');
for (const id of ['tonightBody', 'comingBody', 'monthBody']) assert.match(page, new RegExp(`id="${id}"><span class="swa-sr">Loading [^<]*…</span>(?:<span class="skeleton" aria-hidden="true"></span>){3}</div>`), id);
assert.match(page, /<ul class="todo" id="needsNow"><li class="wait"><span class="swa-sr">Loading what needs you…<\/span>/);
assert.equal(page.replace(/<span class="swa-sr">[^<]*<\/span>/g, '').includes('Loading'), false, 'no visible "Loading"');
assert.match(page, /<p class="empty-line" id="needsNone" hidden>Nothing needs you right now\.<\/p>/, 'an empty "Needs you" says so');
assert.match(page, /id="todayTiles"/); assert.match(page, /id="tonightBody"/); assert.match(page, /id="launch"[\s\S]*id="needsNow"[\s\S]*id="launchBody"/); assert.match(page, /id="comingBody"/); assert.match(page, /id="monthBody"/);
assert.ok(!page.includes('Sample active members') && !page.includes('Run the academy'), 'no sample stats, no tools card');
assert.equal((page.match(/class="button primary"|class="primary"/g) || []).length, 0, 'the one red button comes with tonight’s sessions');
await vm.runInContext('loadToday()', ctx);
assert.equal(node('#todayFacts').innerHTML, '3 sessions tonight · 2 coaches clocked in · 2 cash bookings due');
const tiles = node('#todayTiles').innerHTML;
assert.deepEqual([...tiles.matchAll(/<a class="tile( hot)?" href="([^"]+)"><span class="l">([^<]+)<\/span><span class="v">([^<]+)<\/span><span class="d">([^<]+)<\/span><\/a>/g)].map(m => [m[2], m[3], m[4], m[5], !!m[1]]), [
  ['/roster', 'Checked in today', '2 / 4', '2 wrestlers still to arrive', false],
  ['/payments#cash', 'Cash due at the door', '$50.00', 'Sam Example · SWA Intermediate walk-in and 1 more', true],
  ['/payments', 'Collected in ' + new Date(monthKey + '-01T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'long'}), '$1,234.50', '7 payments · $2,854.00 this season', false],
  ['/accounts', 'Families', '3', '4 wrestlers · 2 cards blocked', false],
], 'four tiles, each a link, cash due in red');
assert.ok(fetched.some(u => /^\/api\/payments\?from=\d{4}-\d{2}-01$/.test(u)) && fetched.some(u => /^\/api\/payments\?from=\d{4}-09-01$/.test(u)), 'this month and the season');
assert.ok(!tiles.includes('waitlist') && !fetched.includes('/api/waitlists'), 'no waitlist tile (#210)');
// Tonight on the mat: sessions by time, each the academy's practice box (the group, its time larger under it, the plan
// state), the count, and Open check-in as the one red button. At 10 AM the first session is next up: it gets the red bar.
const tonight = node('#tonightBody').innerHTML;
assert.equal(tonight, '<ul class="tl"><li class="next"><div class="w"><b>Friday Night Live</b><span class="t">4:00–5:00 PM</span><small>Extra practice</small></div><div class="r"><b>0</b> / 1<small>checked in</small></div></li>'
  + '<li><div class="w"><b>SWA Intermediate</b><span class="t">6:00–7:30 PM</span><small>Plan shared · Leg attacks and finishes</small></div><div class="r"><b>2</b> / 3<small>checked in</small></div></li>'
  + '<li><div class="w"><b>SWA Advance</b><span class="t">6:00–7:30 PM</span><small>No plan yet · Nobody registered yet</small></div><div class="r"></div></li></ul><a class="button primary" href="/roster">Open check-in</a>');
// At 6:30 PM the two 6:00 practices are on the mat: each says so in one red line and gets the red bar; the 4:00 one is over.
{
  const morning = fixedNow;
  fixedNow = [22, 23].map(h => Date.parse(`${today}T${h}:30:00Z`)).find(t => new Date(t).toLocaleTimeString('en-GB', {timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit'}) === '18:30');
  await vm.runInContext('loadToday()', ctx);
  const evening = node('#tonightBody').innerHTML;
  assert.match(evening, /^<ul class="tl"><li><div class="w"><b>Friday Night Live<\/b>/, 'a finished session has the quiet bar');
  assert.equal((evening.match(/<li class="now"><div class="w"><span class="on">On the mat now<\/span><b>SWA (Intermediate|Advance)<\/b><span class="t">6:00–7:30 PM<\/span>/g) || []).length, 2);
  assert.doesNotMatch(evening, /class="next"/, 'nothing is "next" while a session is on');
  fixedNow = morning; await vm.runInContext('loadToday()', ctx);
}
// Needs you: failed payments, cards that stop a check-in, coach hours, documents, messages. Each row is one line and one action.
const needs = node('#needsNow').innerHTML;
assert.deepEqual([...needs.matchAll(/data-need="([^"]+)"/g)].map(m => m[1]), ['attention', 'cards', 'hours', 'unsent', 'timeoff', 'waiver', 'messages']);
assert.match(needs, /<li data-need="attention"><span class="dot " role="img" aria-label="To do" title="To do"><\/span><div class="txt"><b>1 payment needs attention<\/b><span class="d" title="Monthly payments that failed at Stripe">Monthly payments that failed at Stripe<\/span><\/div><a class="button sm" href="\/payments#attention">Open<\/a><\/li>/, 'a quiet dot, the line about it (whole on hover), one small button');
assert.match(needs, /<b>2 can’t check in today<\/b>[\s\S]*?href="\/cards\?show=waiting"/);
assert.match(needs, /<b>2 coach shifts waiting for approval<\/b>[\s\S]*?href="\/timesheets">Review<\/a>/); assert.match(needs, /<span class="dot amber"[^>]*><\/span><div class="txt"><b>4 coach shifts not sent<\/b>/);
assert.match(needs, /<b>1 time-off request<\/b><span class="d" title="Coach Dana">Coach Dana<\/span>/); assert.match(needs, /<b>1 waiver not signed<\/b>/); assert.match(needs, /<b>3 unread family messages<\/b>/);
assert.ok(!needs.includes('site error') && !needs.includes('data request'), 'nothing wrong with the site, no data requests: no rows for them');
// Coming up: the next extra practice, the camp with its seats, and time off that needs cover.
const coming = node('#comingBody').innerHTML;
assert.match(coming, /<li><div>Fri, Nov 13 · Friday Night Live<small>4:00 PM · \$10\.00 members<\/small><\/div><span class="amt"><\/span><\/li>/);
assert.match(coming, /<li><div>Nov 17–18 · Winter camp<small>Full · Camp<\/small><\/div><span class="amt">\$160\.00<\/span><\/li>/);
assert.match(coming, /<li><div>Dec 7 to Dec 8 · Coach Dana off<small>2 practices need cover<\/small><\/div><a class="button sm" href="\/timesheets">Cover<\/a><\/li>/);
// This month by category, with what is owed to coaches last.
assert.equal(node('#monthBody').innerHTML, '<ul class="rows"><li><div>Private lessons</div><span class="amt">$220.00</span></li><li><div>Camps, clinics and events</div><span class="amt">$144.00</span></li><li><div>Walk-ins</div><span class="amt">$80.00</span></li><li><div><b>Owed to coaches</b><small>Lesson shares · 5 lessons</small></div><span class="amt">$143.00</span></li></ul>', 'money reads $40.00 everywhere');
// Something wrong with the site, or a data request, joins "Needs you"; a document that is not in force stays out.
responses['/api/waivers'] = {current: null, wrestlers: []}; delete responses['/api/messages']; responses['/api/site-health'] = {last24h: 3, health: {ok: true}}; responses['/api/data-requests'] = {open: 1};
await vm.runInContext('loadToday()', ctx);
assert.deepEqual([...node('#needsNow').innerHTML.matchAll(/data-need="([^"]+)"/g)].map(m => m[1]), ['attention', 'cards', 'hours', 'unsent', 'timeoff', 'requests', 'site']);
assert.match(node('#needsNow').innerHTML, /<b>3 site errors in the last 24 hours<\/b>[\s\S]*?href="\/site-health"/);
assert.match(node('#todayTiles').innerHTML, /<span class="l">Families<\/span><span class="v">—<\/span>/, 'a figure that could not be loaded is a dash, never a wrong number');

// Owner destinations with their own page open it (the names in lib/owner-nav.ts, issue #261).
for (const [p, href] of [['Families', '/accounts'], ['Roster & check-in', '/roster'], ['Cards & documents', '/cards'], ['Messages', '/messages'], ['Approvals & scholarships', '/approvals'], ['Coaches & lessons', '/staff'], ['Money', '/financials']]) {
  location.href = ''; vm.runInContext(`go(${JSON.stringify(p)})`, ctx); assert.equal(location.href, href, p);
}

// Issue #147: the launch checklist's open items live in "Needs you" and publish the programs from the dashboard itself;
// other items open their page. The ready items fold away under the progress line.
responses['/api/launch-checklist'] = {ready: 1, total: 3, items: [
  {key: 'programs', label: 'Programs on the welcome page and calendar', status: 'todo', action: 'publish-programs', detail: 'Families see no programs yet.'},
  {key: 'waiver', label: 'Waiver', status: 'todo', href: '/waivers', detail: 'Publish the approved waiver.'},
  {key: 'health', label: 'Site health', status: 'done', href: '/site-health', detail: 'No server errors'}]};
await vm.runInContext('loadLaunch()', ctx);
const launch = node('#launchBody').innerHTML;
assert.match(launch, /^<ul class="todo" id="launchItems"><li data-launch="programs" data-status="todo"><span class="dot " role="img" aria-label="To do" title="To do"><\/span><div class="txt"><b>Programs on the welcome page and calendar<\/b><span class="d" title="Families see no programs yet\.">Families see no programs yet\.<\/span><\/div><button type="button" class="sm" onclick="publishPrograms\(\)">Publish the programs<\/button><\/li>/, 'publishing is a plain button: the one red button on the dashboard is Open check-in');
assert.match(launch, /data-launch="waiver"[\s\S]*?href="\/waivers">Open/);
assert.match(launch, /<div class="prog"><span>Launch<\/span><span class="bar" role="progressbar" aria-label="Launch checklist progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="33"><i style="width:33%"><\/i><\/span><span id="launchCount">1 of 3 ready<\/span><\/div><details class="ready"><summary>Show 1 ready<\/summary><ul class="todo"><li data-launch="health" data-status="done">/, 'a thin progress line, then the ready items folded away');
assert.doesNotMatch(launch.split('data-launch="health"')[1], /<a class="button|<button/, 'a ready item has no button');
assert.match(launch.split('data-launch="health"')[1], /^ data-status="done"><span class="dot ok" role="img" aria-label="Ready" title="Ready">✓<\/span>/, 'and a green check');
assert.match(launch, /data-launch="waiver"[\s\S]*?<a class="button sm" href="\/waivers">Open<\/a>/, 'the academy’s own pages open in the same tab');
// Issue #252: email waits on its setup, not a decision; the Launch board in GitHub opens in a new tab; a section opens on the dashboard.
responses['/api/launch-checklist'] = {ready: 0, total: 1, items: [
  {key: 'email', label: 'Email notices', status: 'waiting', detail: 'Set up Resend on your account'},
  {key: 'events', label: 'Camps and events', status: 'info', section: 'Camps & events', detail: '1 camp coming up'},
  {key: 'decisions', label: 'Decisions and attorney review', status: 'info', href: 'https://github.com/laurendarrah/savage-wrestling-academy/issues/246', detail: 'See the Launch board in GitHub'},
  {key: 'website', label: 'Public website', status: 'todo', href: '/website', detail: 'Write your public website'}]};
await vm.runInContext('loadLaunch()', ctx);
{
  const l = node('#launchBody').innerHTML;
  assert.match(l, /data-launch="email" data-status="waiting"><span class="dot amber" role="img" aria-label="Waiting on setup"/); assert.ok(!l.includes('Waiting on a decision'));
  assert.match(l, /data-launch="decisions"[\s\S]*?<a class="button sm" href="https:\/\/github\.com\/laurendarrah\/savage-wrestling-academy\/issues\/246" target="_blank" rel="noopener">Open<\/a>/);
  assert.match(l, /data-launch="website"[\s\S]*?<a class="button sm" href="\/website">Open<\/a>/);
  assert.match(l, /data-launch="events"[\s\S]*?<button type="button" class="sm" onclick="go\('Camps &amp; events'\)">Open<\/button>/);
  assert.ok(l.indexOf('data-launch="website"') < l.indexOf('data-launch="email"'), 'to-dos come before waiting items');
  assert.match(l, /<span id="launchCount">0 of 1 ready<\/span>/);
  // For-your-information items fold away with the ready ones; the open list holds only to-dos and what waits on setup.
  assert.match(l, /<details class="ready"><summary>Show 2 for your information<\/summary><ul class="todo"><li data-launch="events"/, 'information items are folded');
  assert.doesNotMatch(l.match(/<ul class="todo" id="launchItems">([\s\S]*?)<\/ul>/)[1], /data-launch="(events|decisions)"/, 'and not in the open list');
}
// Everything set up: the line turns green and says so.
responses['/api/launch-checklist'] = {ready: 2, total: 2, items: [{key: 'waiver', label: 'Waiver', status: 'done', href: '/waivers', detail: 'Published'}, {key: 'health', label: 'Site health', status: 'done', href: '/site-health', detail: 'No errors'}]};
await vm.runInContext('loadLaunch()', ctx);
assert.match(node('#launchBody').innerHTML, /<ul class="todo" id="launchItems"><\/ul><div class="prog done">[\s\S]*<span id="launchCount">Everything is set up ✓<\/span>/);

// No preview modes: the owner shell's header (issue #261) links to what families really see.
assert.match(readFileSync('lib/owner-shell.ts', 'utf8'), /const FAMILY_LINKS = '<a href="\/welcome">Welcome page<\/a> <a href="\/team">Team page<\/a> <a href="\/calendar">Calendar<\/a>';/);
for (const gone of ['previewMenu', 'Preview what families see', 'Parent view', 'Wrestler view', 'setMode', 'liveWorkspace', 'sampleDashboard', 'admin-demo', 'attendance-demo', 'qr-preview.js'])
  assert.ok(!html.includes(gone), `portal still has ${gone}`);
assert.ok(!html.includes('OWNER WORKSPACE'), 'the dashboard has no sample-preview banner (issue #133)');
console.log('Live owner dashboard tests passed');
