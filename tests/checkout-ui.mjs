// Issue #18: the booking screen's pay step. Runs the page script with a fake DOM and fetch.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const lib = {exports: {}};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/friday-live.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {module: lib, exports: lib.exports});
const practice = {id: 'fnl', name: 'Friday Night Live', gradeRange: 'K–6', description: 'Live wrestling', dates: ['2026-12-18'], start: '18:00', end: '19:00', memberCents: 1000, nonMemberCents: 2000, enabled: true};
const sessions = lib.exports.fridayLiveSchedule({extraPractices: [practice], fridayLive: {semesters: [{enabled: true}]}}, '2026-12', '2026-12-05');
const catalog = {month: '2026-12', today: '2026-12-05', programs: [], practices: [], events: [], privateFormats: [], liveClasses: sessions};

async function openScreen({paymentsEnabled, checkout = {ok: true, body: {url: 'https://checkout.stripe.test/1', orderId: 'o1'}}}) {
  const nodes = new Map();
  const el = id => { if (!nodes.has(id)) nodes.set(id, {value: '', hidden: false, checked: false, disabled: false, innerHTML: '', textContent: '', replaceChildren(...i) { this.value = i[0]?.value || ''; }, focus() {}, scrollIntoView() {}}); return nodes.get(id); };
  const calls = [], navigations = [];
  const ctx = vm.createContext({Intl, Date, URLSearchParams, location: {search: '?type=live&id=fnl&date=2026-12-18', assign: u => navigations.push(u)}, document: {getElementById: el, createElement: () => ({})},
    fetch: async (url, options) => {
      const body = options?.body ? JSON.parse(options.body) : null;
      calls.push({url, body});
      if (url === '/api/checkout') return {ok: checkout.ok, json: async () => checkout.body};
      if (options?.method === 'POST') return {ok: true, json: async () => ({paymentsEnabled, review: {type: 'live', title: 'Friday Night Live', wrestler: 'Wrestler', dates: ['2026-12-18'], start: '18:00', end: '19:00', memberCents: 1000, nonMemberCents: 2000, cents: 2000, memberEligible: false, message: 'Non-member price applies.'}})};
      return {ok: true, json: async () => url === '/api/family' ? {data: {wrestlers: [{id: 'kid', name: 'Wrestler', grade: '6'}]}} : catalog};
    }});
  vm.runInContext(readFileSync('app/booking/screen.html', 'utf8').match(/<script>([\s\S]*)<\/script>/)[1], ctx);
  await new Promise(r => setImmediate(r));
  el('wrestler').value = 'kid';
  await el('form').onsubmit({preventDefault() {}});
  return {el, calls, navigations};
}

// Checkout closed: the screen stays review-only and offers no way to pay.
{
  const {el} = await openScreen({paymentsEnabled: false});
  assert.equal(el('payBox').hidden, true);
  assert.equal(el('payPending').hidden, false);
  assert.equal(el('reviewHeading').textContent, 'Not booked yet');
  assert.equal(el('status').textContent, '', 'the notice explains how to pay once; the status line stays empty');
  assert.match(el('details').innerHTML, /Fri, Dec 18/, 'dates read as people say them, not 2026-12-18');
  assert.match(el('details').innerHTML, /\$20\.00 \(non-member price\)/, 'the wrestler sees their own price');
}

// Checkout open: terms gate the button, and paying sends exactly what was reviewed, then goes to Stripe.
{
  const {el, calls, navigations} = await openScreen({paymentsEnabled: true});
  assert.equal(el('payBox').hidden, false);
  assert.equal(el('interestBox').hidden, true);
  assert.equal(el('reviewHeading').textContent, 'Review and pay');
  assert.match(el('status').textContent, /pay securely to register/, 'no review-only wording while checkout is open');
  assert.equal(el('payButton').disabled, true, 'pay is disabled until terms are accepted');
  await el('payButton').onclick();
  assert.equal(calls.filter(c => c.url === '/api/checkout').length, 0, 'clicking without accepting terms does nothing');
  el('acceptTerms').checked = true; el('acceptTerms').onchange();
  assert.equal(el('payButton').disabled, false);
  await el('payButton').onclick();
  const sent = calls.find(c => c.url === '/api/checkout').body;
  assert.deepEqual({...sent}, {source: 'booking', type: 'live', id: 'fnl', format: null, date: '2026-12-18', wrestlerId: 'kid', option: '', acceptTerms: true});
  assert.ok(!('cents' in sent) && !('amountCents' in sent), 'the browser never sends a price');
  assert.deepEqual(navigations, ['https://checkout.stripe.test/1']);
}

// A refused checkout shows the reason and lets the family try again.
{
  const {el, navigations} = await openScreen({paymentsEnabled: true, checkout: {ok: false, body: {error: 'This is already paid. View it in your family account.'}}});
  el('acceptTerms').checked = true; el('acceptTerms').onchange();
  await el('payButton').onclick();
  assert.equal(el('status').textContent, 'This is already paid. View it in your family account.');
  assert.equal(el('payButton').disabled, false);
  assert.deepEqual(navigations, []);
}

console.log('Passed: booking screen hides payment while checkout is closed, requires terms, sends only the reviewed selection, never a price, redirects to Stripe, and shows refusals.');
