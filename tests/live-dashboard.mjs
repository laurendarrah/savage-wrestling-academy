// Issue #94: the signed-in owner workspace opens on real numbers and sends sample-only screens to their real pages.
// The fictional-data admin demo keeps its sample screens.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('app/portal.html', 'utf8');
let code = html.match(/<script>([\s\S]*)<\/script>/)[1];
code = code.slice(0, code.indexOf("if(location.hash==='#policy')"));
const nodes = new Map(), node = s => { if (!nodes.has(s)) nodes.set(s, {value: '', style: {}, textContent: '', innerHTML: '', focus() {}, classList: {remove() {}, toggle() {}}, setAttribute() {}}); return nodes.get(s); };
const responses = {
  '/api/roster': {sessions: [{entries: [{}, {}, {}], checkedIn: 2}, {entries: [{}], checkedIn: 0}]},
  '/api/usaw-cards': {cards: [{state: 'current'}, {state: 'expired'}, {state: 'missing'}, {state: 'verified'}]},
  '/api/waivers': {current: {id: 'v'}, wrestlers: [{signed: true}, {signed: false}]},
  '/api/messages': {families: [{unread: 2}, {unread: 1}, {unread: 0}]},
  '/api/waitlists': {events: [{entries: [{status: 'waiting'}, {status: 'offered'}, {status: 'accepted'}]}]},
};
let fetched = [];
const location = {hash: '', href: ''};
const ctx = vm.createContext({console, structuredClone, crypto, URL, Intl, Date, JSON, Set, FormData, Promise, location,
  document: {querySelector: node, getElementById: id => node('#' + id), addEventListener() {}}, window: {addEventListener() {}}, setTimeout() {}, confirm: () => true,
  fetch: async url => { fetched.push(url); const key = Object.keys(responses).find(k => url === k); if (url.startsWith('/api/payments')) return {ok: true, json: async () => ({totals: {collectedCents: 123450, count: 7}})}; return key ? {ok: true, json: async () => responses[key]} : {ok: false, json: async () => ({})}; }});
vm.runInContext(code, ctx);

// Live dashboard: real tiles, every real tool, none of the sample counts.
const page = vm.runInContext("mode='admin';page='Dashboard';dashboard()", ctx);
assert.match(page, /id="todayTiles"/); assert.match(page, /href="\/cards"/); assert.ok(!page.includes('Sample active members'), 'no sample stats');
await vm.runInContext('loadToday()', ctx);
const tiles = node('#todayTiles').innerHTML;
assert.match(tiles, /Sessions today<\/span><b[^>]*>2<\/b>.*2 of 4 wrestlers checked in/s);
assert.match(tiles, /Blocked by USA Wrestling card<\/span><b[^>]*color:#b12c38[^>]*>2<\/b>/s);
assert.match(tiles, /Waiver not signed<\/span><b[^>]*>1</s);
assert.match(tiles, /Unread family messages<\/span><b[^>]*>3</s);
assert.match(tiles, /On waitlists<\/span><b[^>]*>1<\/b>.*1 seat offered/s);
assert.match(tiles, /Collected this month<\/span><b[^>]*>\$1,234\.50<\/b>.*7 payments/s);
assert.ok(fetched.some(u => /^\/api\/payments\?from=\d{4}-\d{2}-01$/.test(u)));
// A tile is left out when its data is unavailable (for example no waiver in force).
responses['/api/waivers'] = {current: null, wrestlers: []}; delete responses['/api/messages'];
await vm.runInContext('loadToday()', ctx);
assert.ok(!node('#todayTiles').innerHTML.includes('Waiver not signed')); assert.ok(!node('#todayTiles').innerHTML.includes('Unread family messages'));

// Sample-only screens open their real pages.
for (const [p, href] of [['Families', '/accounts'], ['Attendance', '/roster'], ['Private lessons', '/lesson-settings'], ['Messages', '/messages'], ['Staff & settings', '/staff']]) {
  location.href = ''; vm.runInContext(`mode='admin';go(${JSON.stringify(p)})`, ctx); assert.equal(location.href, href, p);
}

// The admin demo keeps the sample dashboard and screens.
vm.runInContext('liveWorkspace=false', ctx);
assert.match(vm.runInContext("mode='admin';page='Dashboard';dashboard()", ctx), /Sample active members/);
location.href = ''; try { vm.runInContext("go('Families')", ctx); } catch {} assert.equal(location.href, '', 'demo stays on the sample screen');
assert.match(readFileSync('app/admin-demo/demo.js', 'utf8'), /function startAdminDemo\(\)\{\n liveWorkspace=false;/);

// Issue #32: the demo may load its web fonts, and still cannot call any API.
const route = readFileSync('app/admin-demo/route.ts', 'utf8');
assert.match(route, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com;/); assert.match(route, /font-src https:\/\/fonts\.gstatic\.com;/); assert.match(route, /connect-src 'none'/);
assert.ok(html.includes('<strong>OWNER WORKSPACE</strong> · Online saving · The family and wrestler views here are previews with sample families'), 'banner the demo rewrites');
console.log('Live owner dashboard tests passed');
