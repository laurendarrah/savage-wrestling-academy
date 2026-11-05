// Issue #21: the family page shows real memberships and purchases, and confirms a checkout only once Stripe has.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';

// --- API: a family sees only its own orders ---
const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }}; }};
let actor = {id: 'parent-1', email_confirmed_at: 'yes', strong: true};
const mod = {exports: {}};
vm.runInNewContext(ts.transpileModule(readFileSync('app/api/orders/route.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
  {module: mod, exports: mod.exports, URL, JSON, String, Response, Headers, require: n => n === 'cloudflare:workers' ? {env: {DB}} : n.endsWith('/checkout-config') ? {checkoutKinds: () => new Set(['event'])} : n.endsWith('/account-auth') ? {strongAccount: async () => ({user: actor, strong: actor?.strong, headers: new Headers()}), accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})} : (() => { throw Error(n); })()});
const ins = (id, user, status, extra = {}) => sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'usd','{}','{}',?,?,0,?,?,?,?,?)`).run(id, user, 'x@example.test', extra.w ?? 'w-1', 'Sam Example', extra.kind ?? 'event', extra.program ?? null, 'item', extra.label ?? 'Takedown Camp', JSON.stringify(extra.dates ?? []), extra.base ?? 16000, extra.disc ?? 0, (extra.base ?? 16000) - (extra.disc ?? 0), status, id, extra.created ?? '2026-11-05T12:00:00Z', '2026-11-05T12:00:00Z', extra.paid ?? null, extra.start ?? null, extra.end ?? null);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
ins(uuid(1), 'parent-1', 'paid', {paid: '2026-11-05T12:00:00Z'});
ins(uuid(2), 'parent-1', 'canceled');
ins(uuid(3), 'parent-1', 'expired');
ins(uuid(4), 'parent-1', 'refunded', {paid: '2026-11-04T12:00:00Z'});
ins(uuid(5), 'someone-else', 'paid', {paid: '2026-11-05T12:00:00Z'});
const get = async q => { const r = await mod.exports.GET(new Request('https://x.test/api/orders' + q)); return {status: r.status, body: await r.json()}; };
let r = await get('');
assert.equal(r.status, 200);
assert.deepEqual(r.body.orders.map(o => o.id).sort(), [uuid(1), uuid(4)], 'own paid and refunded orders only; abandoned and canceled hidden');
assert.ok(Array.isArray(r.body.orders[0].dates));
assert.equal(r.body.checkoutOpen, true, 'the page learns whether online payment is open');
assert.equal((await get('?order=' + uuid(1))).body.order.status, 'paid');
assert.equal((await get('?order=' + uuid(5))).status, 404, 'cannot read another family\'s order');
assert.equal((await get('?order=not-a-uuid')).status, 404);
actor = null; assert.equal((await get('')).status, 401);
actor = {id: 'parent-1', email_confirmed_at: 'yes', strong: false, factors: [{status: 'verified'}]}; assert.equal((await get('')).status, 403, 'MFA enforced when enrolled');

// --- Screen ---
const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const yearOn = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y + 1, m - 1, dd) - 86400000).toISOString().slice(0, 10); };
const screenOrders = [
  {id: uuid(10), kind: 'annual', program: 'Intermediate', item_label: 'SWA Intermediate: 12-month membership, paid upfront', wrestler_id: 'w-1', wrestler_name: 'Sam Example', dates: [], amount_cents: 240000, discount_cents: 0, status: 'paid', created_at: today + 'T12:00:00Z', paid_at: today + 'T12:00:00Z', term_start: today, term_end: yearOn(today)},
  {id: uuid(11), kind: 'event', program: null, item_label: 'Takedown Camp', wrestler_id: 'w-1', wrestler_name: 'Sam Example', dates: ['2026-12-01', '2026-12-02'], amount_cents: 14400, discount_cents: 1600, status: 'paid', created_at: today + 'T13:00:00Z', paid_at: today + 'T13:00:00Z'},
  {id: uuid(12), kind: 'live', program: null, item_label: 'Friday Night Live on 2026-12-04', wrestler_id: 'w-2', wrestler_name: 'Alex Example', dates: ['2026-12-04'], amount_cents: 2000, discount_cents: 0, status: 'pending', created_at: today + 'T14:00:00Z'}
];
async function openFamily({search = '', orderStatuses = ['paid']}) {
  const nodes = new Map();
  const el = id => { if (!nodes.has(id)) nodes.set(id, {value: '', hidden: false, checked: false, disabled: false, innerHTML: '', textContent: '', style: {}, classList: {add() {}, remove() {}, toggle() {}}, focus() {}, scrollIntoView() {}, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, elements: new Proxy({}, {get: (t, k) => (t[k] ??= {value: '', checked: false})})}); return nodes.get(id); };
  let polls = 0;
  const ctx = vm.createContext({Intl, Date, JSON, URLSearchParams, Promise, setTimeout: f => setImmediate(f), structuredClone, location: {search, href: ''}, crypto: {randomUUID: () => 'x'},
    document: {getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}), addEventListener() {}}, window: {addEventListener() {}},
    fetch: async url => {
      if (url.startsWith('/api/orders?order=')) { const status = orderStatuses[Math.min(polls++, orderStatuses.length - 1)]; return {ok: true, json: async () => ({order: {...screenOrders[1], status}})}; }
      if (url === '/api/orders') return {ok: true, json: async () => ({orders: screenOrders, checkoutOpen: true})};
      if (url === '/api/scholarship') return {ok: true, json: async () => ({awards: []})};
      return {ok: true, status: 200, json: async () => ({email: 'pat@example.test', data: {parentName: 'Pat', phone: '', wrestlers: [{id: 'w-1', name: 'Sam Example', grade: '8'}, {id: 'w-2', name: 'Alex Example', grade: '4'}]}, revision: 1, updatedAt: '2026-11-05T12:00:00Z'})};
    }});
  const html = readFileSync('app/family/screen.html', 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], ctx);
  for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r));
  return {el, polls: () => polls};
}

{
  const {el} = await openFamily({});
  const cards = el('membershipCards').innerHTML;
  assert.match(cards, /Active membership/);
  assert.match(cards, /\$2,400\.00 paid upfront/);
  assert.match(cards, /12-month term ends/);
  assert.match(cards, /Not enrolled/, 'the second wrestler without a membership is still offered one');
  const list = el('purchaseList').innerHTML;
  assert.match(list, /Takedown Camp/); assert.match(list, /\$144\.00/); assert.match(list, /Includes \$16\.00 discount/);
  assert.match(list, /Checkout not finished/); assert.match(list, /Nothing has been charged/);
  assert.equal(el('paymentsPill').textContent, 'Paid online');
  assert.equal(el('notEnrolledNote').hidden, true, 'no "nothing has been paid" notice for a family that has paid');
  assert.match(el('readyNote').textContent, /pay securely online/);
  assert.doesNotMatch(el('editorNotice').textContent, /still being connected/);
}
{
  const {el} = await openFamily({search: `?checkout=success&order=${uuid(11)}`, orderStatuses: ['pending', 'pending', 'paid']});
  assert.match(el('status').textContent, /^Payment confirmed: Takedown Camp for Sam Example\.$/, 'success shown only after the webhook marked it paid');
}
{
  const {el, polls} = await openFamily({search: `?checkout=success&order=${uuid(11)}`, orderStatuses: ['pending']});
  assert.equal(polls(), 15, 'polls a bounded number of times');
  assert.match(el('status').textContent, /taking longer than usual/);
}
{
  const {el} = await openFamily({search: `?checkout=canceled&order=${uuid(11)}`});
  assert.equal(el('status').textContent, 'Checkout canceled. Nothing was charged.');
}

console.log('Passed: orders API returns only the family\'s own visible orders with MFA enforced; family page shows active membership terms, purchase history, unfinished checkouts, and confirms payment only after Stripe does.');
