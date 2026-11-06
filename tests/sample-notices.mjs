// Issue #23: sample-driven owner workspace screens say so, and point to the real record. Real screens are not labeled.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('app/portal.html', 'utf8');
let code = html.match(/<script>([\s\S]*)<\/script>/)[1];
code = code.slice(0, code.indexOf("if(location.hash==='#policy')"));
const nodes = new Map(), node = s => { if (!nodes.has(s)) nodes.set(s, {value: '', style: {}, textContent: '', innerHTML: '', focus() {}}); return nodes.get(s); };
const ctx = vm.createContext({console, structuredClone, crypto, URL, Intl, Date, JSON, Set, FormData, location: {hash: ''}, document: {querySelector: node, addEventListener() {}}, window: {addEventListener() {}}, setTimeout() {}, confirm: () => true});
vm.runInContext(code, ctx);
// The fictional admin demo keeps every sample screen and notice; the live owner dashboard shows real numbers (issue #101).
assert.equal(vm.runInContext(`liveWorkspace=true;mode='admin';page='Dashboard';sampleNotice()`, ctx), '', 'live dashboard has no sample notice');
vm.runInContext('liveWorkspace=false', ctx);
const notice = (mode, page) => vm.runInContext(`mode=${JSON.stringify(mode)};page=${JSON.stringify(page)};sampleNotice()`, ctx);

const expectations = {
  Dashboard: /href="\/roster"/, Families: /href="\/accounts"/, Attendance: /href="\/roster"/, 'Events & waitlists': /publish to the public calendar/,
  'Private lessons': /no money moves.*href="\/coach-pay"/, Messages: /not delivered.*href="\/messages"/, 'Staff & settings': /href="\/staff"/
};
for (const [page, pattern] of Object.entries(expectations)) {
  const text = notice('admin', page);
  assert.match(text, /Sample data\./, `${page} is labeled`);
  assert.match(text, pattern, `${page} points to the real record`);
}
for (const page of ['Schedules', 'Programs & pricing', 'Calendar']) assert.equal(notice('admin', page), '', `${page} publishes real settings and is not labeled`);
for (const [mode, page] of [['family', 'Overview'], ['family', 'Camps & clinics'], ['child', 'My QR code']]) assert.match(notice(mode, page), /preview of what families see/);
assert.equal(notice('public', 'Calendar'), '');

// The notice is rendered at the top of the page.
vm.runInContext(`hydratePrograms();mode='admin';page='Attendance';render()`, ctx);
assert.ok(node('#main').innerHTML.startsWith('<div class="sample-notice"'), 'notice is the first thing on the page');

// The dashboard links every real owner tool, and the real settings screens.
const dash = vm.runInContext(`mode='admin';page='Dashboard';dashboard()`, ctx);
for (const href of ['/roster', '/payments', '/accounts', '/approvals', '/scholarships', '/staff', '/practice-plans', '/curricula', '/payment-setup', '/backups', '/security-log'])
  assert.ok(dash.includes(`href="${href}"`), `dashboard links ${href}`);
for (const pg of ['Schedules', 'Programs & pricing', 'Events & waitlists']) assert.ok(dash.includes(`go('${pg}')`), `dashboard opens ${pg}`);

console.log('Passed: every sample-driven owner screen and the family and wrestler previews carry a sample-data notice linking to the real record; real settings screens are not labeled; the dashboard links every real owner tool.');
