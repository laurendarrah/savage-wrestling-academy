// Findings from the Nov 13 parent test (issue #314), with walk-ins open online and memberships not yet:
// - the note under "Choose training" speaks only about the plan chosen, and says nothing while that plan can be paid online;
// - a walk-in's consent box names the refund policy for this purchase (as /booking does), a membership's names the
//   membership terms and the automatic monthly renewal shown right above it;
// - checkout stores the refund policy's own anchor for single purchases;
// - on the family page each signed document's link says which document it opens.
// Page scripts run in a fake DOM, because inline JavaScript in .html files is not typechecked.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

async function registerPage(onlineKinds) {
  const nodes = new Map();
  const el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: id === 'plan' ? 'monthly' : '', hidden: id === 'review' || id === 'previewBanner', checked: false, disabled: false, innerHTML: '', textContent: '', style: {}, dataset: {}, options: [],
    focus() {}, scrollIntoView() {}, setAttribute() {}, replaceChildren(...items) { this.options = items; this.value = items[0]?.value ?? ''; }}); return nodes.get(id); };
  const catalog = {month: today.slice(0, 7), today, now: '08:00', onlineKinds, programs: [{id: 'Intermediate', name: 'SWA Intermediate', monthlyCents: 20000, walkInCents: 4000, grades: '7–12'}],
    practices: [{id: 'Intermediate:' + today + ':23:00', program: 'Intermediate', date: today, start: '23:00', end: '23:59'}]};
  const ctx = vm.createContext({Intl, Date, JSON, URL, URLSearchParams, Promise, location: {search: ''}, ApprovalChat: {open() {}, close() {}},
    document: {getElementById: el, createElement: () => ({}), querySelectorAll: () => []},
    fetch: async (url, options) => ({ok: true, status: 200, json: async () => {
      if (options?.method === 'POST' && url === '/api/registration') {
        const plan = JSON.parse(options.body).plan;
        return {review: {wrestlerName: 'Sam Example', programName: 'SWA Intermediate', programId: 'Intermediate', plan, cents: plan === 'walkin' ? 4000 : 20000, practice: catalog.practices[0], billingStart: today,
          renewalTerms: plan === 'monthly' ? 'Sam Example’s SWA Intermediate membership includes every regular scheduled practice in SWA Intermediate. It costs $200.00 a month. It renews automatically.' : null},
          paymentsEnabled: onlineKinds.includes(plan), cashEnabled: plan === 'walkin'};
      }
      if (url.startsWith('/api/registration')) return catalog;
      if (url === '/api/program-approvals') return {approvals: []};
      if (url === '/api/orders') return {orders: []};
      return {data: {parentName: 'Pat', phone: '555-0100', wrestlers: [{id: 'w-1', name: 'Sam Example', grade: '8'}]}};
    }})});
  vm.runInContext(readFileSync('app/register/screen.html', 'utf8').match(/<script>([\s\S]*)<\/script>/)[1], ctx);
  await settle();
  return {el, ctx};
}

// Walk-ins open online, memberships not: the page opens on Monthly, and the note is about memberships only.
{
  const {el, ctx} = await registerPage(['walkin']);
  assert.equal(el('plan').value, 'monthly');
  assert.equal(el('previewBanner').hidden, false);
  assert.equal(el('previewBanner').textContent, 'Online payment for memberships isn’t open yet. Tell the academy you want one and they’ll be in touch.');
  assert.doesNotMatch(el('previewBanner').textContent, /walk-in|cash/i, 'nothing about walk-ins being cash only');
  vm.runInContext("choosePlan('walkin')", ctx);
  assert.equal(el('previewBanner').hidden, true, 'walk-ins can be paid online: no note');
  assert.equal(el('previewBanner').textContent, '');
  // A walk-in's review: the consent box names the refund policy for this purchase, and no renewal terms.
  vm.runInContext("selected=catalog.practices[0].id;selectedDate=catalog.practices[0].date", ctx);
  await el('selection').onsubmit({preventDefault() {}}); await settle();
  assert.equal(el('review').hidden, false);
  assert.equal(el('termsLabel').innerHTML, 'I have read and agree to the <a href="/membership-terms#refunds" target="_blank" rel="noopener">refund policy</a> for this purchase.');
  assert.equal(el('renewalTerms').hidden, true);
  assert.equal(el('previewBanner').hidden, true, 'still no note on the review');
  // Back to Monthly: its review names the membership terms and the renewal shown above the box.
  vm.runInContext("back();choosePlan('monthly')", ctx);
  assert.equal(el('previewBanner').hidden, false);
  await el('selection').onsubmit({preventDefault() {}}); await settle();
  assert.match(el('termsLabel').innerHTML, /^I agree to the <a href="\/membership-terms" target="_blank" rel="noopener">membership terms<\/a> and the automatic monthly renewal described above/);
  assert.equal(el('renewalTerms').hidden, false);
  assert.match(el('renewalText').textContent, /It costs \$200\.00 a month\. It renews automatically\./);
}
// Both open: no note on either plan. Neither open: a walk-in is booked to pay cash.
{
  const {el, ctx} = await registerPage(['walkin', 'monthly']);
  assert.equal(el('previewBanner').hidden, true);
  vm.runInContext("choosePlan('walkin')", ctx);
  assert.equal(el('previewBanner').hidden, true);
}
{
  const {el, ctx} = await registerPage([]);
  vm.runInContext("choosePlan('walkin')", ctx);
  assert.equal(el('previewBanner').textContent, 'Online payment for walk-ins isn’t open yet. Book now and pay cash at the academy.');
}
// The catalog says which of the page's plans are open; checkout stores the refund policy's anchor for single purchases.
assert.match(readFileSync('app/api/registration/route.ts', 'utf8'), /const onlineKinds=\[\.\.\.checkoutKinds\(\)\]\.filter\(k=>k==='walkin'\|\|k==='monthly'\);/);
assert.match(readFileSync('app/api/checkout/route.ts', 'utf8'), /quote\.charge\.kind === 'monthly' \? '\/membership-terms' : '\/membership-terms#refunds'/);
assert.match(readFileSync('app/membership-terms/screen.html', 'utf8'), /<h2>Refunds for single purchases<\/h2>/);
assert.doesNotMatch(readFileSync('app/membership-terms/screen.html', 'utf8'), /Online purchase isn’t open yet/);

// The family page: each signed document's link says which document it opens.
{
  const nodes = new Map();
  const el = id => { if (!nodes.has(id)) nodes.set(id, {value: '', hidden: false, innerHTML: '', textContent: '', style: {}, dataset: {}, classList: {add() {}, remove() {}, toggle() {}}, focus() {}, scrollIntoView() {}, addEventListener() {},
    querySelectorAll: () => [], querySelector: () => null, elements: new Proxy({}, {get: (t, k) => (t[k] ??= {value: '', checked: false})})}); return nodes.get(id); };
  const ctx = vm.createContext({Intl, Date, JSON, URLSearchParams, Promise, setTimeout: f => setImmediate(f), structuredClone, location: {search: '', href: ''}, crypto: {randomUUID: () => 'x'},
    document: {getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}), addEventListener() {}}, window: {addEventListener() {}},
    fetch: async () => ({ok: false, status: 500, json: async () => ({})})});
  vm.runInContext(readFileSync('app/family/screen.html', 'utf8').match(/<script>([\s\S]*)<\/script>/)[1], ctx);
  await settle();
  const w = {id: 'w-1', name: 'Sam Example', grade: '8'}, info = {signatures: [{id: 'sig-1', current: true, wrestlerId: 'w-1'}]};
  ctx.w = w; ctx.info = info;
  const waiver = vm.runInContext("docLine({id:'v1'},info,w,'Waiver','/waiver','Sign the waiver')", ctx);
  const consent = vm.runInContext("docLine({id:'v2'},info,w,'Parent Consent Form','/consent','Sign the form')", ctx);
  assert.match(waiver, /Waiver signed<\/span> <a href="\/waiver-copy\?id=sig-1" target="_blank" rel="noopener">View signed waiver<\/a>$/);
  assert.match(consent, /Parent Consent Form signed<\/span> <a href="\/waiver-copy\?id=sig-1" target="_blank" rel="noopener">View signed consent form<\/a>$/);
  assert.doesNotMatch(readFileSync('app/family/screen.html', 'utf8'), />View copy</, 'no unlabeled "View copy" left');
}

console.log('Passed: the register note speaks only about the chosen plan (none while it is open online); a walk-in agrees to the refund policy for this purchase, a membership to the terms and the monthly renewal above the box; checkout records #refunds for single purchases; signed waiver and consent links say which document they open.');
