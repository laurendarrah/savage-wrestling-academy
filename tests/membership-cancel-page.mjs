// Issue #314 (NY GBL §527-a): canceling a monthly membership online is as easy as signing up. On the family page and on
// the register page, "Cancel membership" on the membership opens a short confirmation right there (never a browser
// confirm()), one button cancels, and the result shows under it straight away. Runs the page scripts in a fake DOM,
// because inline JavaScript in .html files is not typechecked. The server side (another family's membership is refused)
// is in tests/monthly-memberships.mjs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const through = addDays(today, 20);
const short = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'});
const withDay = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'});
const ORDER = '00000000-0000-4000-8000-000000000314';
const membership = (extra = {}) => ({id: ORDER, kind: 'monthly', program: 'Intermediate', item_label: 'SWA Intermediate: monthly membership', wrestler_id: 'w-1', wrestler_name: 'Sam Example',
  dates: [], amount_cents: 20000, discount_cents: 0, status: 'paid', created_at: today + 'T12:00:00Z', paid_at: today + 'T12:00:00Z', term_start: addDays(through, -30), term_end: through,
  payments_made: 3, payments_total: null, subscription_status: 'active', membership_end: null, paid_through: through, cancel_on: null, ...extra});
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };

// A fake page: elements by id, the page's click listener, and every fetch it makes. The cancel answer is set per test.
function fakePage(file, routes) {
  const nodes = new Map(), sent = [], listeners = {};
  const el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, checked: false, disabled: false, innerHTML: '', textContent: '', style: {}, dataset: {}, options: [],
    classList: {add() {}, remove() {}, toggle() {}}, focus() {}, scrollIntoView() {}, addEventListener() {}, setAttribute() {}, querySelectorAll: () => [], querySelector: () => null,
    elements: new Proxy({}, {get: (t, k) => (t[k] ??= {value: '', checked: false})}),
    replaceChildren(...items) { this.options = items; this.value = items[0]?.value ?? ''; }}); return nodes.get(id); };
  const ctx = vm.createContext({Intl, Date, JSON, URL, URLSearchParams, Promise, setTimeout: f => setImmediate(f), structuredClone, location: {search: '', href: ''}, crypto: {randomUUID: () => 'x'},
    confirm: () => { throw Error('no browser confirm() for canceling'); }, ApprovalChat: {open() {}, close() {}},
    document: {getElementById: el, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}), addEventListener: (type, fn) => { listeners[type] = fn; }}, window: {addEventListener() {}},
    fetch: async (url, options) => { sent.push({url, options}); const [status, body] = await routes(url, options); return {ok: status < 400, status, json: async () => body}; }});
  const html = readFileSync(file, 'utf8');
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(code, ctx);
  // A tap on a button, through the page's own click listener (the pages run with no inline handlers).
  const tap = async button => { listeners.click({target: {closest: () => button}, preventDefault() {}}); await settle(); };
  return {el, sent, tap};
}

// --- The family page ---
async function familyPage(order, cancelAnswer) {
  const page = fakePage('app/family/screen.html', async (url, options) => {
    if (url === '/api/memberships') return cancelAnswer(JSON.parse(options.body));
    if (url === '/api/orders') return [200, {orders: [order], checkoutOpen: true}];
    if (url === '/api/scholarship') return [200, {awards: []}];
    return [200, {email: 'pat@example.test', data: {parentName: 'Pat', phone: '555-0100', wrestlers: [{id: 'w-1', name: 'Sam Example', grade: '8'}]}, revision: 1, updatedAt: today}];
  });
  await settle();
  return page;
}
{
  const {el, sent, tap} = await familyPage(membership(), body => [200, {ok: true, endsOn: through, wrestler: 'Sam Example'}]);
  let card = el('membershipCards').innerHTML;
  assert.match(card, /<span class="pill ok">Active membership<\/span>/);
  assert.match(card, /<dt>Next payment<\/dt><dd>\$200\.00 on /);
  assert.match(card, /Month to month, no contract\. Cancel any time here/);
  // Step 1: Cancel membership, right on the membership.
  assert.match(card, new RegExp(`<div class="cancel-area" id="cancel-${ORDER}"><div class="billing-actions"><button type="button" data-action="cancel-membership" data-order="${ORDER}" data-wrestler="Sam Example" data-through="${through}">Cancel membership</button>`));
  await tap({dataset: {action: 'cancel-membership', order: ORDER, wrestler: 'Sam Example', through}});
  // Step 2: a short confirmation in the same place, saying only what happens, with one button.
  const panel = el('cancel-' + ORDER).innerHTML;
  assert.match(panel, /<div class="swa-receipt__next cancel-confirm" role="group"/);
  assert.match(panel, /<strong>Cancel Sam Example’s membership\?<\/strong>/);
  assert.equal(panel.replace(/<[^>]+>/g, '|').split('|').filter(Boolean).filter(t => !/^(Go back|Yes, cancel my membership|Cancel Sam Example’s membership\?)$/.test(t)).join(' '),
    `No more charges. Sam Example can keep practicing through ${short(through)}.`, 'the panel says only this');
  assert.match(panel, /data-action="confirm-cancel"[^>]*>Yes, cancel my membership<\/button>/);
  assert.doesNotMatch(panel, /refund|reason|why|offer|discount/i, 'no refund wording, no reason asked, no offer to stay');
  assert.equal(sent.filter(s => s.url === '/api/memberships').length, 0, 'nothing is canceled before Yes');
  const yes = {dataset: {action: 'confirm-cancel', order: ORDER, wrestler: 'Sam Example'}, disabled: false};
  await tap(yes);
  // The result: straight away, under the button, and the card now says it is canceled.
  const posted = sent.filter(s => s.url === '/api/memberships');
  assert.equal(posted.length, 1); assert.equal(posted[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(posted[0].options.body), {action: 'cancel', orderId: ORDER});
  card = el('membershipCards').innerHTML;
  assert.match(card, new RegExp(`<span class="pill neutral">Canceled · ends ${short(through)}</span>`));
  assert.match(card, new RegExp(`<p class="formnote" role="status" aria-live="polite">Canceled\\. No more charges\\. Sam Example can practice through ${short(through)}\\.</p>`));
  assert.match(card, new RegExp(`<dt>Last day</dt><dd>${short(through)}</dd>`));
  assert.doesNotMatch(card, /Cancel membership|Next payment/, 'nothing left to cancel and no next payment');
}
{
  // A refusal shows under the button, and the family can try again.
  const {el, tap} = await familyPage(membership(), () => [502, {error: 'Stripe didn’t answer, so nothing changed. Please try again in a minute.'}]);
  await tap({dataset: {action: 'cancel-membership', order: ORDER, wrestler: 'Sam Example', through}});
  const yes = {dataset: {action: 'confirm-cancel', order: ORDER, wrestler: 'Sam Example'}, disabled: false};
  await tap(yes);
  assert.equal(el('cancelNote-' + ORDER).textContent, 'Stripe didn’t answer, so nothing changed. Please try again in a minute.');
  assert.equal(yes.disabled, false, 'the button works again');
  assert.match(el('membershipCards').innerHTML, /Active membership/);
  // Go back puts the membership as it was.
  await tap({dataset: {action: 'keep-membership', order: ORDER}});
  assert.match(el('membershipCards').innerHTML, /data-action="cancel-membership"/);
}
{
  // Already canceled: the card says so, with the last day, and offers no button.
  const {el} = await familyPage(membership({cancel_on: through}), () => [500, {}]);
  const card = el('membershipCards').innerHTML;
  assert.match(card, new RegExp(`Canceled · ends ${short(through)}`));
  assert.match(card, new RegExp(`No more charges\\. Sam Example can keep practicing through ${short(through)}\\.`));
  assert.doesNotMatch(card, /data-action="cancel-membership"/);
}
{
  // Paused (#313): no cancel button; Restart membership goes to a new sign-up for the same wrestler and program.
  const {el} = await familyPage(membership({subscription_status: 'paused', term_end: addDays(today, -3), paid_through: addDays(today, -3)}), () => [500, {}]);
  const card = el('membershipCards').innerHTML;
  assert.match(card, /<span class="pill warn">Paused<\/span>/);
  assert.match(card, /Nothing more is charged, and Sam Example is off the practice roster/);
  assert.match(card, /Missed months are not charged\./);
  assert.match(card, /<a class="button primary" href="\/register\?plan=monthly&amp;program=Intermediate&amp;wrestler=w-1">Restart membership →<\/a>/);
  assert.doesNotMatch(card, /data-action="cancel-membership"/);
}

// --- The register page: the current membership, with the same button and confirmation ---
{
  const catalog = {month: today.slice(0, 7), today, now: '08:00', programs: [{id: 'Intermediate', name: 'SWA Intermediate', monthlyCents: 20000, walkInCents: 4000, grades: '7–12'}], practices: []};
  let orders = [membership({wrestler_name: 'Sam Example'})];
  const {el, sent, tap} = fakePage('app/register/screen.html', async (url, options) => {
    if (url === '/api/memberships') return [200, {ok: true, endsOn: through, wrestler: 'Sam Example'}];
    if (url === '/api/orders') return [200, {orders}];
    if (url.startsWith('/api/registration')) return [200, catalog];
    if (url === '/api/program-approvals') return [200, {approvals: []}];
    return [200, {data: {parentName: 'Pat', phone: '555-0100', wrestlers: [{id: 'w-1', name: 'Sam Example', grade: '8'}]}}];
  });
  await settle();
  let box = el('currentMembership');
  assert.equal(box.hidden, false);
  assert.match(box.innerHTML, /<strong>Sam Example is a member of this program\.<\/strong> \$200\.00 a month, on the \d+(st|nd|rd|th)\. Next payment /);
  assert.match(box.innerHTML, new RegExp(`<button type="button" data-cancel="${ORDER}">Cancel membership</button>`));
  await tap({dataset: {cancel: ORDER}});
  const panel = el('cancel-' + ORDER).innerHTML;
  assert.match(panel, /<strong>Cancel Sam Example’s membership\?<\/strong><\/p><p>No more charges\. Sam Example can keep practicing through /);
  assert.ok(panel.includes(withDay(through)), 'the paid-through day');
  assert.match(panel, /data-confirm-cancel="[^"]+">Yes, cancel my membership<\/button>/);
  assert.doesNotMatch(panel, /refund|reason/i);
  await tap({dataset: {confirmCancel: ORDER}, disabled: false});
  assert.deepEqual(JSON.parse(sent.find(s => s.url === '/api/memberships').options.body), {action: 'cancel', orderId: ORDER});
  box = el('currentMembership');
  assert.ok(box.innerHTML.includes(`Canceled · ends ${withDay(through)}`));
  assert.ok(box.innerHTML.includes(`<p class="formnote" role="status" aria-live="polite">Canceled. No more charges. Sam Example can practice through ${withDay(through)}.</p>`));
  assert.doesNotMatch(box.innerHTML, /data-cancel=/);
}

console.log('Passed: Cancel membership on the family and register pages opens a same-page confirmation (no browser confirm, no reason asked, no refund wording), one button cancels through /api/memberships, the result shows under it at once and the card reads "Canceled · ends <date>"; errors can be retried; a paused membership offers Restart membership instead.');
