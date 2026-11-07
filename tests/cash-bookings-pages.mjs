// Issue #248: the pages for paying cash at the academy, run with a fake DOM because inline JavaScript is not typechecked.
// Register and Book offer "Pay online" (only when open) and "Pay cash at the academy"; the family home lists what is due
// with Cancel; the roster shows "$40.00 due" with Cash received (Undo for the owner); Payments lists unpaid bookings.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const json = (body, ok = true) => ({ok, status: ok ? 200 : 400, json: async () => body});
function page(file, {fetch, search = '', hidden = [], extra = {}}) {
  const nodes = new Map();
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, {id, value: '', min: '', hidden: hidden.includes(id), checked: false, disabled: false, innerHTML: '', textContent: '', className: '', href: '', style: {}, dataset: {}, options: [],
      elements: {parentName: {value: '', focus() {}}, phone: {value: ''}},
      replaceChildren(...items) { this.value = items[0]?.value ?? ''; }, focus() {}, scrollIntoView() {}, setAttribute() {}, removeAttribute() {}, querySelector() { return null; }, classList: {add() {}, remove() {}, toggle() {}}});
    return nodes.get(id);
  };
  const calls = [];
  const ctx = vm.createContext({Intl, Date, JSON, URLSearchParams, Promise, setTimeout: f => setImmediate(f), clearTimeout() {}, structuredClone, console, crypto: {randomUUID: () => 'new-id'},
    location: {search, href: '', assign() {}}, confirm: () => true, prompt: () => 'Tapped by mistake', window: {addEventListener() {}}, navigator: {},
    document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({getContext: () => null})},
    fetch: async (url, options) => { calls.push({url, body: options?.body ? JSON.parse(options.body) : null}); return fetch(url, options); }, ...extra});
  const html = readFileSync(file, 'utf8');
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(code, ctx);
  return {el, ctx, html, calls};
}
const day = '2026-11-12';
const booking = (extra = {}) => ({id: 'cb-1', kind: 'walkin', program: 'Intermediate', itemId: `Intermediate:${day}:18:00`, item: 'SWA Intermediate walk-in', date: day, start: '18:00', end: '19:30',
  wrestlerId: 'w-1', wrestler: 'Jo Example', amountCents: 4000, status: 'due', orderId: null, label: 'Pay at the academy: $40.00 due', cancellable: true, past: false, ...extra});

// ---------- Register: a walk-in offers Pay online (only when open) and Pay cash at the academy ----------
for (const online of [false, true]) {
  const catalog = {today: '2026-11-07', month: '2026-11', programs: [{id: 'Intermediate', name: 'SWA Intermediate', walkInCents: 4000, monthlyCents: 20000, grades: 'Grades 7–12'}],
    practices: [{id: `Intermediate:${day}:18:00`, program: 'Intermediate', date: day, start: '18:00', end: '19:30'}]};
  const {el, ctx, calls, html} = page('app/register/screen.html', {fetch: async (url, o) => {
    if (url === '/api/family') return json({data: {wrestlers: [{id: 'w-1', name: 'Jo Example', grade: '8'}]}});
    if (url.startsWith('/api/registration') && o?.method !== 'POST') return json(catalog);
    if (url === '/api/program-approvals') return json({approvals: []});
    if (url === '/api/registration') return json({paymentsEnabled: online, cashEnabled: true, review: {wrestlerName: 'Jo Example', programName: 'SWA Intermediate', programId: 'Intermediate', plan: 'walkin', cents: 4000, baseCents: 4000, practice: catalog.practices[0]}});
    if (url === '/api/cash-bookings') return json({ok: true, booking: booking()});
    return json({});
  }});
  await settle();
  el('wrestler').value = 'w-1'; el('program').value = 'Intermediate';
  vm.runInContext(`selectPracticeTime('Intermediate:${day}:18:00')`, ctx);
  assert.equal(el('plan').value, 'walkin');
  await el('selection').onsubmit({preventDefault() {}}); await settle();
  assert.equal(el('review').hidden, false);
  assert.equal(el('payChoice').hidden, false, 'how to pay is asked');
  assert.equal(el('payOnlineOption').hidden, !online, online ? 'Pay online when checkout is open' : 'no Pay online while checkout is closed');
  assert.equal(el('cashHint').textContent, 'Book now and pay $40.00 in cash at the practice.');
  assert.equal(el('payPending').hidden, true, 'no dead "isn’t open" button: cash is always available');
  if (online) {
    assert.equal(el('payWayOnline').checked, true); assert.equal(el('payBox').hidden, false); assert.equal(el('cashBox').hidden, true);
    assert.match(el('status').textContent, /pay online or book and pay cash at the academy/);
    vm.runInContext("choosePayWay('cash')", ctx);
  } else {
    assert.match(el('payNotice').innerHTML, /Online payment isn’t open yet, so book now and pay cash at the academy/);
    assert.equal(el('previewBanner').hidden, true);
  }
  assert.equal(el('cashBox').hidden, false); assert.equal(el('payBox').hidden, true);
  await el('cashButton').onclick(); await settle();
  const sent = calls.find(c => c.url === '/api/cash-bookings').body;
  assert.equal(sent.action, 'book'); assert.equal(sent.plan, 'walkin'); assert.equal(sent.practiceId, `Intermediate:${day}:18:00`);
  assert.ok(!('amountCents' in sent) && !('cents' in sent), 'the browser sends no amount');
  assert.equal(el('reviewHeading').textContent, 'You’re booked');
  assert.match(el('cashDone').innerHTML, /<p class="cash-due">Pay at the academy: \$40\.00 due<\/p>/);
  assert.match(el('cashDone').innerHTML, /Jo Example<\/strong> is booked for SWA Intermediate walk-in, Thu, Nov 12, 2026 at 6:00 PM/);
  assert.equal(el('status').textContent, 'Booked. Pay at the academy: $40.00 due.');
  assert.equal(el('changeButton').hidden, true); assert.equal(el('cashBox').hidden, true);
  assert.match(html, /<strong>Pay cash at the academy<\/strong>/);
  assert.match(html, /\.pay-options\{grid-template-columns:1fr\}/, 'one column at phone width');
}
// A membership never offers cash.
{
  const {el, ctx} = page('app/register/screen.html', {fetch: async () => json({data: {wrestlers: []}, programs: [], practices: [], approvals: []})});
  await settle();
  vm.runInContext('showPay(false,false,20000)', ctx);
  assert.equal(el('payChoice').hidden, true); assert.equal(el('cashBox').hidden, true); assert.equal(el('payPending').hidden, false);
}

// ---------- Book: Friday Night Live can be paid cash at the academy too ----------
{
  const live = {id: 'fnl', name: 'Friday Night Live', date: day, start: '17:00', end: '18:00', memberCents: 1000, nonMemberCents: 2000};
  const {el, calls} = page('app/booking/screen.html', {search: `?type=live&id=fnl&date=${day}`, fetch: async (url, o) => {
    if (url === '/api/family') return json({data: {wrestlers: [{id: 'w-1', name: 'Jo Example', grade: '8'}]}});
    if (url.startsWith('/api/public-schedule')) return json({today: '2026-11-07', liveClasses: [live], events: [], privateFormats: []});
    if (url === '/api/orders') return json({orders: [], cashBookings: []});
    if (url === '/api/booking-review') return json({paymentsEnabled: false, cashEnabled: true, review: {type: 'live', title: 'Friday Night Live', wrestler: 'Jo Example', dates: [day], start: '17:00', end: '18:00', cents: 2000, memberCents: 1000, nonMemberCents: 2000, memberEligible: false, message: 'Online payment isn’t open yet. You can book now and pay cash at the academy.'}});
    if (url === '/api/cash-bookings') return json({ok: true, booking: booking({id: 'cb-2', kind: 'live', itemId: 'fnl', item: `Friday Night Live on Thu, Nov 12`, start: '17:00', amountCents: 2000, label: 'Pay at the academy: $20.00 due'})});
    return json({});
  }});
  await settle();
  el('wrestler').value = 'w-1';
  await el('form').onsubmit({preventDefault() {}}); await settle();
  assert.equal(el('payChoice').hidden, false); assert.equal(el('payOnlineOption').hidden, true); assert.equal(el('cashBox').hidden, false); assert.equal(el('payPending').hidden, true);
  assert.equal(el('reviewHeading').textContent, 'Review and book');
  assert.equal(el('cashHint').textContent, 'Book now and pay $20.00 in cash at the practice.');
  await el('cashButton').onclick(); await settle();
  const sent = calls.find(c => c.url === '/api/cash-bookings').body;
  assert.equal(sent.action, 'book'); assert.equal(sent.source, 'booking'); assert.equal(sent.type, 'live'); assert.equal(sent.id, 'fnl');
  assert.match(el('cashDone').innerHTML, /Pay at the academy: \$20\.00 due/);
  assert.equal(el('status').textContent, 'Booked. Pay at the academy: $20.00 due.');
  // Coming back to the page, the wrestler shows as booked.
  el('wrestler').onchange();
  assert.equal(el('wrestlerStatus').textContent, 'Jo Example is booked. Pay at the academy: $20.00 due. You don’t need to book again.');
}

// ---------- Family home: what is due, with Cancel until it starts, and Next up ----------
{
  const profile = {parentName: 'Pat Example', phone: '555-0100', address: '1 Main St', emergencyContactName: 'Sam', emergencyContactPhone: '555-0101',
    wrestlers: [{id: 'w-1', name: 'Jo Example', grade: '8', birthDate: '2012-01-01', allergies: 'None', usawNumber: 'X', usawExpires: '2099-08-31'}]};
  let due = [booking(), booking({id: 'cb-old', date: '2026-11-01', past: true, cancellable: false})];
  const {el, ctx, calls} = page('app/family/screen.html', {hidden: ['summary'], fetch: async (url, o) => {
    if (url === '/api/family') return json({email: 'pat@example.test', data: structuredClone(profile), revision: 1, updatedAt: '2026-11-01T12:00:00Z', cards: {}});
    if (url === '/api/orders') return json({orders: [], checkoutOpen: false, cashBookings: due});
    if (url.startsWith('/api/wrestler?id=')) return json({id: 'w-1', name: 'Jo Example', upcoming: [{date: day, start: '18:00', end: '19:30', title: 'SWA Intermediate', type: 'practice', why: 'Pay at the academy', dueCents: 4000}]});
    if (url === '/api/cash-bookings') { due = due.filter(b => b.id !== o && JSON.parse(o.body).id !== b.id); return json({ok: true, bookings: due}); }
    return json({});
  }});
  await settle(60);
  const list = el('purchaseList').innerHTML;
  assert.match(list, /<span class="billing-pill warning">Pay at the academy<\/span><\/div><strong class="due">\$40\.00 due<\/strong>/);
  assert.match(list, /Pay at the academy: \$40\.00 due\. Bring the cash to the practice\. You can cancel until it starts; nothing is charged\./);
  assert.match(list, /data-cash-cancel="cb-1">Cancel booking<\/button>/);
  assert.doesNotMatch(list, /data-cash-cancel="cb-old"/, 'no Cancel once the practice has started');
  assert.match(list, /The academy will follow up with you about this payment\./);
  assert.equal(el('purchaseHistory').hidden, false);
  assert.match(el('nextUpBody').innerHTML, /Pay at the academy: \$40\.00 due/, 'Next up says what is due');
  await vm.runInContext("cancelCash('cb-1')", ctx); await settle();
  assert.equal(calls.filter(c => c.url === '/api/cash-bookings').at(-1).body.action, 'cancel');
  assert.equal(el('status').textContent, 'Booking canceled. Nothing was charged.');
  assert.doesNotMatch(el('purchaseList').innerHTML, /cb-1/);
}

// ---------- Roster: "$40.00 due", Cash received; Undo for the owner only ----------
for (const role of ['coach', 'owner']) {
  const entry = (name, cash, extra = {}) => ({userId: 'p-' + name, wrestlerId: 'w-' + name, name, grade: '8', parentName: 'Pat', phone: '555', email: null, sources: cash?.status === 'due' ? ['Pay at the academy'] : ['Walk-in paid'],
    checkedInAt: null, checkedInBy: null, card: 'verified', cardExpires: '2099-08-31', cardNote: '', waiverSigned: null, exceptions: [], checkInBlocked: null, cash, allergies: 'None', ...extra});
  let data = {date: day, today: day, role, sessions: [{key: `practice:Intermediate:${day}:18:00`, type: 'practice', title: 'SWA Intermediate', program: 'Intermediate', date: day, start: '18:00', end: '19:30', checkedIn: 1, entries: [
    entry('Ana Due', {bookingId: 'cb-a', status: 'due', cents: 4000, orderId: null, collectedAt: null, collectedBy: null}, {checkedInAt: '2026-11-12T22:55:00Z'}),
    entry('Ben Paid', {bookingId: 'cb-b', status: 'paid', cents: 4000, orderId: 'ord-b', collectedAt: '2026-11-12T22:58:00Z', collectedBy: 'Coach Dana'}),
    entry('Cal Member', null, {sources: ['Member']})]}]};
  const {el, ctx, calls, html} = page('app/roster/screen.html', {fetch: async (url, o) => {
    if (o?.body && JSON.parse(o.body).action === 'cash') { const d = structuredClone(data); d.sessions[0].entries[0].cash = {...d.sessions[0].entries[0].cash, status: 'paid', orderId: 'ord-a', collectedAt: '2026-11-12T23:01:00Z', collectedBy: 'Coach Dana'}; d.sessions[0].entries[0].sources = ['Walk-in paid']; return json(d); }
    return json(data);
  }});
  await settle();
  const out = el('sessions').innerHTML, row = name => { const at = out.indexOf(name); return out.slice(out.lastIndexOf('<div class="row', at), out.indexOf('<div class="row', at + 1) > 0 ? out.indexOf('<div class="row', at + 1) : undefined); };
  assert.match(row('Ana Due'), /<span class="badge due">Pay at the academy · \$40\.00 due<\/span>/);
  assert.doesNotMatch(row('Ana Due'), /badge ok">Pay at the academy/, 'not shown as a green paid badge');
  assert.match(row('Ana Due'), /<button class="cash" type="button" data-cash="0:0">Cash received<\/button>/);
  assert.match(row('Ana Due'), /Checked in/, 'checked in while the cash is still due');
  assert.match(row('Ana Due'), /class="row done owes"/);
  assert.match(row('Ben Paid'), /<span class="badge ok">Cash received 5:58 PM · Coach Dana<\/span>/);
  assert.equal(/data-cash-undo/.test(row('Ben Paid')), role === 'owner', 'Undo cash is the owner’s');
  assert.doesNotMatch(row('Cal Member'), /data-cash|badge due/);
  assert.match(out, /· 1 to pay at the academy \(\$40\.00 due\)/);
  assert.match(html, /\.actions button\{min-height:44px/, 'full-size buttons at phone width');
  await vm.runInContext('cashReceived(data.sessions[0].entries[0])', ctx); await settle();
  const sent = calls.at(-1).body;
  assert.equal(sent.action, 'cash'); assert.equal(sent.bookingId, 'cb-a'); assert.equal(sent.date, day); assert.ok(!('amountCents' in sent));
  assert.equal(el('status').textContent, 'Cash received: $40.00 for Ana Due. It now counts as paid.');
  assert.match(el('sessions').innerHTML, /Cash received 6:01 PM · Coach Dana/);
  if (role === 'owner') {
    await vm.runInContext('undoCash(data.sessions[0].entries[1])', ctx); await settle();
    const undo = calls.at(-1).body;
    assert.equal(undo.action, 'cash-undo'); assert.equal(undo.orderId, 'ord-b'); assert.equal(undo.reason, 'Tapped by mistake');
  }
}

// ---------- Payments: the owner's list of unpaid bookings ----------
{
  const due = {more: false, count: 2, dueCents: 6000, bookings: [booking({id: 'cb-old', date: '2026-11-01', past: true, parent: 'Pat Example', phone: '555-0100', email: 'pat@example.test'}),
    booking({id: 'cb-fnl', kind: 'live', item: 'Friday Night Live on Thu, Nov 12', amountCents: 2000, parent: '', phone: '', email: 'kim@example.test'})]};
  let fetched = [];
  const {el, ctx, calls} = page('app/payments/screen.html', {fetch: async (url, o) => {
    fetched.push(url);
    if (url === '/api/payments?cash=due') return json(due);
    if (url.startsWith('/api/payments?families=1')) return json({families: [], more: false});
    if (url.startsWith('/api/public-schedule')) return json({programs: [], practices: [], events: [], liveClasses: []});
    if (o?.body) return json({ok: true});
    return json({payments: [], next: null, matched: 0, totals: {collectedCents: 0, onlineCents: 0, offlineCents: 0, refundedCents: 0, feesCents: 0, count: 0}});
  }});
  await settle(60);
  assert.equal(el('cashSummary').textContent, '2 bookings · $60.00 due');
  const rows = el('cashRows').innerHTML;
  assert.match(rows, /Nov 1, 2026[\s\S]*Session has passed[\s\S]*Jo Example[\s\S]*Pat Example · 555-0100[\s\S]*\$40\.00 due/);
  assert.match(rows, /kim@example\.test[\s\S]*Friday Night Live on Thu, Nov 12[\s\S]*\$20\.00 due/);
  assert.match(rows, /data-cash-paid="cb-old">Cash received<\/button><button type="button" data-cash-cancel="cb-old">Cancel booking<\/button>/);
  await vm.runInContext("cashAction('cash-received','cb-old')", ctx); await settle();
  assert.equal(calls.find(c => c.body?.action === 'cash-received').body.bookingId, 'cb-old');
  assert.equal(el('status').textContent, 'Cash received for Jo Example. It now counts as paid.');
  await vm.runInContext("cashAction('cash-cancel','cb-fnl')", ctx); await settle();
  const cancel = calls.find(c => c.body?.action === 'cash-cancel').body;
  assert.equal(cancel.bookingId, 'cb-fnl'); assert.equal(cancel.reason, 'Tapped by mistake');
  assert.equal(el('status').textContent, 'Booking canceled. The family has been told.');
  due.count = 0; due.dueCents = 0; due.bookings = [];
  await vm.runInContext('loadCash()', ctx);
  assert.equal(el('cashSummary').textContent, 'Nothing is waiting to be paid at the academy.');
}

// ---------- Help for families, coaches and the owner ----------
assert.match(readFileSync('app/help/screen.html', 'utf8'), /<strong>Pay cash at the academy<\/strong>: for a walk-in or an extra practice[\s\S]*Cancel it in your account, under Purchase history, any time before the practice starts/);
assert.match(readFileSync('app/help/coach/screen.html', 'utf8'), /Take the cash and tap <strong>Cash received<\/strong>[\s\S]*You can check them in before or after they pay/);
assert.match(readFileSync('app/help/owner/screen.html', 'utf8'), /<strong>Cash due at the academy<\/strong>[\s\S]*<strong>Cancel booking<\/strong> to free the spot[\s\S]*<strong>Undo cash<\/strong>/);

console.log('Passed: Register and Book offer Pay online (only when open) and Pay cash at the academy, send no amount and confirm "Pay at the academy: $40.00 due"; the family home lists what is due with Cancel until it starts and Next up says so; the roster shows the amount due with Cash received (Undo for the owner) and check-in still allowed; Payments lists unpaid bookings to record or cancel.');
