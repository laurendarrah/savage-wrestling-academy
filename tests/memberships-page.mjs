// Issue #413: the owner's Memberships page. Every running monthly membership in one list, filtered by state and
// searched by name, with Cancel membership only where it can be done, sending the same action as Payments. No freeze
// (Justin, Nov 24). The page's inline script is run here because the typecheck does not cover it.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const src = readFileSync('app/memberships/screen.html', 'utf8');
const m = (o) => ({orderId: 'o' + Math.random().toString(36).slice(2, 8), wrestler: 'Sam Example', parent: 'Pat Example', email: 'pat@example.test', program: 'SWA Intermediate', amountCents: 20000,
  startedOn: '2026-10-05', paidThrough: '2026-12-05', endsOn: null, state: 'active', canCancel: true, plan: 'monthly', livemode: true, ...o});
const list = [m({orderId: 'a1'}), m({orderId: 'p1', wrestler: 'Jo <b>Two</b>', parent: 'Riley Parent', email: 'riley@example.test', state: 'past_due'}),
  m({orderId: 'z1', wrestler: 'Zed Paused', state: 'paused', canCancel: false}), m({orderId: 'e1', wrestler: 'Eli Ending', state: 'ending', canCancel: false, endsOn: '2026-12-05', livemode: false})];
const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: id === 'show' ? 'all' : '', hidden: false, innerHTML: '', textContent: ''}); return nodes.get(id); };
const calls = [], confirmed = [];
let cancelReply = {status: 200, body: {ok: true, endsOn: '2026-12-05', wrestler: 'Sam Example'}};
const ctx = vm.createContext({document: {getElementById: el, querySelectorAll: () => []}, Intl, Date, JSON, Promise, Error, String, Object, Array, Number, console,
  confirm: text => { confirmed.push(text); return true; },
  fetch: async (url, o) => { const body = o?.body ? JSON.parse(o.body) : null; calls.push({url, body}); const r = body ? cancelReply : {status: 200, body: {memberships: list}}; return {ok: r.status === 200, status: r.status, json: async () => r.body}; }});
vm.runInContext(src.match(/<script>([\s\S]*)<\/script>/)[1], ctx);
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
await settle();

assert.equal(calls[0].url, '/api/payments?memberships=1');
const rows = el('rows').innerHTML;
assert.equal((rows.match(/<tr>/g) || []).length, 4);
assert.equal((rows.match(/data-cancel=/g) || []).length, 2, 'Cancel only on active and payment-failed memberships');
assert.match(rows, /data-cancel="a1"/); assert.match(rows, /data-cancel="p1"/); assert.doesNotMatch(rows, /data-cancel="z1"|data-cancel="e1"/);
assert.match(rows, /Jo &lt;b&gt;Two&lt;\/b&gt;/, 'names are escaped');
assert.match(rows, /<span class="state paused">Paused<\/span><small>The family restarts it from their account<\/small>/);
assert.match(rows, /<span class="state ending">Canceled<\/span><small>Ends Dec 5, 2026<\/small>/);
assert.match(rows, /<span class="state past_due">Card payment failed<\/span><small>Stripe is retrying the card<\/small>/);
assert.match(rows, /Eli Ending<\/strong><span class="test">Test<\/span>/, 'a test-mode membership says so');
assert.match(rows, /<td class="money">\$200\.00<\/td>/);
assert.equal(el('counts').textContent, '4 running · 1 active · 1 card failed · 1 paused · 1 canceled, still running');
assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /freeze|data-pause|>Pause\b|Pause membership/i, 'no freeze or pause button (Justin, Nov 24)');

// Filter and search.
el('show').value = 'paused'; vm.runInContext('render()', ctx);
assert.equal((el('rows').innerHTML.match(/<tr>/g) || []).length, 1); assert.match(el('rows').innerHTML, /Zed Paused/);
el('show').value = 'all'; el('q').value = 'riley@'; vm.runInContext('render()', ctx);
assert.equal((el('rows').innerHTML.match(/<tr>/g) || []).length, 1, 'search covers the parent and email'); assert.match(el('rows').innerHTML, /Jo &lt;b&gt;Two/);
el('q').value = 'nobody'; vm.runInContext('render()', ctx); assert.equal(el('empty').hidden, false);
el('q').value = '';

// Cancel: the same confirmation and action as Payments; the result shows on the row.
await vm.runInContext("cancel('a1')", ctx); await settle();
assert.match(confirmed[0], /^Cancel Sam Example’s membership for the family\? No more charges\. Sam Example stays on the roster through the end of the paid month, and the family gets an email\.$/);
assert.deepEqual(calls.find(c => c.body).body, {action: 'membership-cancel', orderId: 'a1'});
assert.equal(calls.at(-1).url, '/api/payments?memberships=1', 'the list reloads after canceling');
assert.match(el('rows').innerHTML, /<span class="result" role="status">Canceled\. Sam Example can practice through Dec 5, 2026\.<\/span>/);
// A refusal is shown on the row, in the server's words.
cancelReply = {status: 409, body: {error: 'This membership is already canceled.'}};
await vm.runInContext("cancel('p1')", ctx); await settle();
assert.match(el('rows').innerHTML, /<span class="result" role="status">This membership is already canceled\.<\/span>/);

// The page is in the owner navigation, right under Payments, and is an owner page.
assert.match(readFileSync('lib/owner-nav.ts', 'utf8'), /\{href: '\/payments'[^\n]*\n\s*\{href: '\/memberships', label: 'Memberships'/);
assert.match(readFileSync('app/memberships/route.ts', 'utf8'), /ownerPage\(request, html\)/);

console.log('Memberships page (#413): every running membership with its state, Cancel only where it applies, the same confirmation and action as Payments, results on the row, filter and search, escaped names, test-mode marked, no freeze, owner-only page under Payments.');
