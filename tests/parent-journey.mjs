// Redesign Phase 2 (issue #282): the parent journey's page scripts, which the typecheck skips. The family tab bar's
// unread count, the wrestler chip row and the plan segment on Choose training, the booking receipt that reviews itself,
// the lesson receipt, the inbox list with its captions, the pass with the next session, the wrestler view's ten rows, and
// the calendar's doors with one "Choose a walk-in" per day. Each script runs in a fake document.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const settle = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const json = (body, ok = true, status) => ({ok, status: status ?? (ok ? 200 : 400), json: async () => body});
// A fake document: elements by id, made on demand; querySelectorAll finds data attributes in rendered HTML so clicks run
// the page's own handlers; document-level listeners are kept so delegated clicks can be fired.
function page(file, {fetch, search = '', hidden = []}) {
  const nodes = new Map(), clicks = new Map(), listeners = {};
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, {id, value: '', min: '', hidden: hidden.includes(id), checked: false, disabled: false, innerHTML: '', textContent: '', className: '', href: '', style: {}, dataset: {}, options: [], attrs: {},
      elements: {parentName: {value: '', focus() {}, scrollIntoView() {}}, phone: {value: ''}}, open: false,
      replaceChildren(...items) { this.options = items; this.value = items[0]?.value ?? ''; }, focus() {}, select() {}, scrollIntoView() {}, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; }, querySelector() { return null; }, classList: {add() {}, remove() {}, toggle() {}}});
    return nodes.get(id);
  };
  const selected = html => { const m = /<option(?: value="([^"]*)")? selected>([^<]*)/.exec(html.slice(0, html.indexOf('</select>') + 1 || undefined)); return m ? m[1] ?? m[2] : ''; };
  const all = sel => {
    const m = /^\[data-([a-z-]+)(?:="([^"]*)")?\]$/.exec(sel); if (!m) return [];
    const out = [];
    for (const node of nodes.values()) for (const x of String(node.innerHTML).matchAll(new RegExp(`<(\\w+)[^>]*data-${m[1]}="([^"]*)"[^>]*>`, 'g'))) {
      if (m[2] !== undefined && x[2] !== m[2]) continue;
      const key = m[1] + ':' + x[2], camel = m[1].replace(/-(\w)/g, (_, c) => c.toUpperCase());
      if (!clicks.has(key)) clicks.set(key, {dataset: {[camel]: x[2]}, checked: /\bchecked\b/.test(x[0]), value: selected(String(node.innerHTML).slice(x.index)), pressed: (x[0].match(/aria-pressed="(\w+)"/) || [])[1], focus() {}, closest(s) { return all(s).includes(this) || s.split(',').some(p => all(p.trim()).includes(this)) ? this : null; }});
      out.push(clicks.get(key));
    }
    return out;
  };
  const calls = [];
  const ctx = vm.createContext({Intl, Date, JSON, URLSearchParams, Promise, setTimeout: f => setImmediate(f), clearTimeout() {}, structuredClone, console, encodeURIComponent, crypto: {randomUUID: () => 'new-id'},
    location: {search, href: '', origin: 'https://swa.test', pathname: '/' + file.split('/')[1], hash: '', assign() {}}, confirm: () => true, window: {addEventListener(t, f) { if (t === 'DOMContentLoaded') setImmediate(f); }, qrSvg: (code, label) => `<svg aria-label="${label}">${code}</svg>`}, navigator: {},
    document: {getElementById: el, querySelectorAll: all, querySelector: sel => all(sel)[0] ?? null, createElement: () => ({getContext: () => null}), addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, title: ''},
    ApprovalChat: {open() {}, close() {}},
    fetch: async (url, options) => { calls.push({url, method: options?.method || 'GET', body: options?.body ? JSON.parse(options.body) : null}); return fetch(url, options); }});
  const html = readFileSync(file, 'utf8');
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(code, ctx);
  // A click on an element found by its data attribute, through the page's document-level listener.
  const click = (attr, v) => { const target = all(`[data-${attr}="${v}"]`)[0]; assert.ok(target, `no [data-${attr}="${v}"]`); for (const fn of listeners.click || []) fn({target, preventDefault() {}}); };
  return {el, ctx, html, calls, click, button: (attr, v) => all(`[data-${attr}="${v}"]`)[0]};
}
const wrestlers = [{id: 'w1', name: 'Sam Example', grade: '8'}, {id: 'w2', name: 'Riley Example', grade: 'K'}];

// ---------- Family home: the Messages tab counts unread, the Account tab opens the menu ----------
{
  const profile = {parentName: 'Pat Example', phone: '555-0100', wrestlers: [wrestlers[0]]};
  const p = page('app/family/screen.html', {hidden: ['summary'], fetch: async url => {
    if (url === '/api/family') return json({email: 'pat@example.test', data: structuredClone(profile), revision: 1, updatedAt: '2026-11-01T12:00:00Z', cards: {}});
    if (url === '/api/inbox') return json({unread: 3});
    if (url === '/api/interest') return json({contact: {address: '20 Railroad St, Huntington Station, NY 11746', email: 'x@example.test'}});
    if (url.startsWith('/api/wrestler')) return json({id: 'w1', name: 'Sam Example', upcoming: [{date: '2099-01-05', start: '18:00', end: '19:30', title: 'SWA Intermediate', type: 'practice', why: 'Membership'}]});
    return json({});
  }});
  p.ctx.location.hash = '#account';
  await settle();
  assert.equal(p.el('inboxBadge').hidden, false); assert.equal(p.el('inboxBadge').innerHTML, '3<span class="swa-sr"> new</span>', 'the tab bar badge: a count, with "new" for screen readers');
  assert.equal(p.el('accountMenu').open, true, '/family#account opens the Account menu');
  assert.match(p.el('nextUpBody').innerHTML, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=20%20Railroad%20St%2C%20Huntington%20Station%2C%20NY%2011746" target="_blank" rel="noopener">Directions<\/a>/, 'Directions when the academy has an address');
  assert.match(p.el('doors').innerHTML, /Camps &amp; events<small>See what is coming up<\/small>/, 'no schedule yet: the camps door still opens');
  // "Add another" (data-action="add-wrestler" on the wrestler card) opens the editor with a new wrestler.
  assert.match(p.html, /<button type="button" class="quiet" data-action="add-wrestler">Add another<\/button>/);
  vm.runInContext('addAnother()', p.ctx); await settle();
  assert.equal(p.el('editor').hidden, false); assert.equal(vm.runInContext('profile.wrestlers.length', p.ctx), 2);
  assert.equal(p.el('contacts').hidden, true, 'the Family card steps aside while the editor is open');
}

// ---------- Choose training: the chip row and the plan segment over hidden values ----------
{
  const catalog = {today: '2026-11-07', now: '09:00', month: '2026-11', programs: [{id: 'Elementary', name: 'SWA Development', walkInCents: 4000, monthlyCents: 20000, grades: 'Grades K–6'}, {id: 'Intermediate', name: 'SWA Intermediate', walkInCents: 4000, monthlyCents: 20000, grades: 'Grades 7–12'}], practices: [{id: 'Intermediate:2026-11-12:18:00', program: 'Intermediate', date: '2026-11-12', start: '18:00', end: '19:30'}]};
  const p = page('app/register/screen.html', {fetch: async (url, o) => {
    if (url === '/api/family') return json({data: {wrestlers}});
    if (url.startsWith('/api/registration') && o?.method !== 'POST') return json(catalog);
    if (url === '/api/program-approvals') return json({approvals: []});
    if (url === '/api/registration') return json({paymentsEnabled: false, cashEnabled: true, review: {wrestlerName: 'Sam Example', programName: 'SWA Intermediate', programId: 'Intermediate', plan: 'walkin', cents: 4000, baseCents: 4000, practice: catalog.practices[0]}});
    return json({});
  }});
  p.el('plan').value = 'monthly'; // as in the page's markup
  await settle();
  assert.equal(p.el('wrestler').value, 'w1', 'the first wrestler is chosen');
  assert.match(p.el('wrestlerChips').innerHTML, /^<button type="button" class="swa-chip" data-wrestler="w1" aria-pressed="true">Sam Example<small>Grade 8<\/small><\/button><button type="button" class="swa-chip" data-wrestler="w2" aria-pressed="false">Riley Example<small>Kindergarten<\/small><\/button><a class="swa-chip add" href="\/family#add">\+ Add<\/a>$/);
  assert.equal(p.el('program').value, 'Intermediate', 'a Grade 8 wrestler starts on SWA Intermediate');
  p.click('wrestler', 'w2'); await settle();
  assert.equal(p.el('wrestler').value, 'w2'); assert.equal(p.el('program').value, 'Elementary', 'the chip changes the wrestler and the program follows the grade');
  assert.match(p.el('wrestlerChips').innerHTML, /data-wrestler="w2" aria-pressed="true"/);
  // The segment: a tap sets the hidden value and the pressed state; the prices stay the catalog's.
  assert.equal(p.el('plan').value, 'monthly'); assert.equal(p.el('plan-monthly').attrs['aria-pressed'], 'true');
  vm.runInContext("choosePlan('walkin')", p.ctx); await settle(); // what a tap on the data-plan button calls
  assert.equal(p.el('plan').value, 'walkin'); assert.equal(p.el('plan-walkin').attrs['aria-pressed'], 'true'); assert.equal(p.el('plan-monthly').attrs['aria-pressed'], 'false');
  assert.equal(p.el('planPrice-walkin').textContent, '$40.00'); assert.equal(p.el('planPrice-monthly').textContent, '$200.00 a month');
  assert.equal(p.el('reviewButton').disabled, true, 'a walk-in needs a practice');
  // The day grid: ink, with the chosen day pressed; a walk-in review becomes the receipt.
  p.click('wrestler', 'w1'); await settle();
  vm.runInContext("selectPracticeTime('Intermediate:2026-11-12:18:00')", p.ctx);
  assert.match(p.el('practiceCalendar').innerHTML, /id="day-2026-11-12" aria-label="[^"]*"\s+aria-pressed="true"/);
  assert.doesNotMatch(p.el('practiceCalendar').innerHTML, /practice-dot/);
  await p.el('selection').onsubmit({preventDefault() {}}); await settle();
  const r = p.el('reviewDetails').innerHTML;
  assert.match(r, /^<div class="swa-receipt"><div class="swa-receipt__row"><span class="k">Wrestler<\/span><span class="v">Sam Example<\/span><\/div><div class="swa-receipt__row"><span class="k">Program<\/span><span class="v">SWA Intermediate<\/span><\/div><div class="swa-receipt__row"><span class="k">Plan<\/span><span class="v">Single-practice walk-in<\/span><\/div><div class="swa-receipt__row"><span class="k">Practice<\/span><span class="v">Thu, Nov 12, 2026<small>6:00 PM–7:30 PM · New York time<\/small><\/span><\/div><div class="swa-receipt__total"><span class="k">Total<\/span><span class="v">\$40\.00<small>One payment<\/small><\/span><\/div><\/div>/);
  assert.equal(p.el('cashBox').hidden, false, 'one Confirm: cash at the academy');
  assert.doesNotMatch(p.html, /\son[a-z]+=/, 'no inline handlers: the page carries the nonce policy');
}

// ---------- Book: the receipt reviews itself once the wrestler is chosen ----------
{
  const camp = {id: 'camp', name: 'Winter camp', type: 'Camp', dates: ['2026-11-20', '2026-11-21'], schedule: [{date: '2026-11-20', start: '09:00', end: '12:00'}], cents: 16000, dayCents: 9000, full: false};
  const reviews = [];
  const p = page('app/booking/screen.html', {search: '?type=event&id=camp&wrestler=w2', fetch: async (url, o) => {
    if (url === '/api/family') return json({data: {wrestlers}});
    if (url.startsWith('/api/public-schedule')) return json({today: '2026-11-07', liveClasses: [], events: [camp], privateFormats: []});
    if (url === '/api/orders') return json({orders: [{kind: 'event', item_id: 'camp', wrestler_id: 'w1', status: 'paid', dates: camp.dates}], cashBookings: []});
    if (url === '/api/booking-review') { reviews.push(JSON.parse(o.body)); return json({paymentsEnabled: false, cashEnabled: true, review: {type: 'event', title: 'Winter camp', wrestler: JSON.parse(o.body).wrestlerId === 'w1' ? 'Sam Example' : 'Riley Example', dates: camp.dates, schedule: camp.schedule, cents: 16000, seatsLeft: 2, message: 'Online payment isn’t open yet. You can book now and pay cash at the academy.'}}); }
    return json({});
  }});
  await settle();
  assert.equal(p.el('wrestler').value, 'w2', '?wrestler= picks the chip');
  assert.equal(reviews.length, 1, 'reviewed on load, without a Review button'); assert.doesNotMatch(p.html, /id="submit"/);
  assert.equal(p.el('review').hidden, false);
  const d = p.el('details').innerHTML;
  assert.match(d, /<span class="k">Event<\/span><span class="v">Winter camp<\/span>/); assert.match(d, /<span class="k">Wrestler<\/span><span class="v">Riley Example<\/span>/);
  assert.match(d, /<span class="k">Days<\/span><span class="v">Fri, Nov 20 · 9:00 AM–12:00 PM<br>Sat, Nov 21 · Time to be announced<\/span>/, 'dates in words');
  assert.match(d, /<span class="k">Seats<\/span><span class="v">2 spots left<\/span>/);
  assert.match(d, /<div class="swa-receipt__total"><span class="k">Total<\/span><span class="v">\$160\.00<small>One payment<\/small>/);
  assert.equal(p.el('notice').textContent, 'Online payment isn’t open yet. You can book now and pay cash at the academy.');
  assert.equal(p.el('wrestlerStatus').textContent, 'Riley Example is not registered yet.');
  assert.equal(p.el('cashBox').hidden, false);
  // The other chip is already registered: the status line says so and there is no receipt or Confirm to review.
  p.click('wrestler', 'w1'); await settle();
  assert.equal(reviews.length, 1, 'nothing to review for a registered wrestler');
  assert.equal(p.el('wrestlerStatus').textContent, 'Sam Example is already registered. You don’t need to book again.');
  assert.equal(p.el('review').hidden, true);
  // Back to Riley: the receipt is read again for them.
  p.click('wrestler', 'w2'); await settle();
  assert.equal(reviews.length, 2); assert.equal(reviews[1].wrestlerId, 'w2'); assert.equal(p.el('review').hidden, false);
}

// ---------- Lessons: the receipt, and the list/month toggle as the shared segment ----------
{
  const formats = [{id: 'one-on-one', name: 'One-on-one lesson', description: 'd', cents: 6000}];
  const p = page('app/lesson/screen.html', {fetch: async url => json(url.startsWith('/api/lessons') ? {formats, openings: [{id: 'o', date: '2026-11-09', start: '15:00', end: '16:00', coach: 'Coach Dana', coachKey: 'k', format: null, capacity: 1, spotsLeft: 1}], mine: []} : url === '/api/family' ? {data: {wrestlers: [wrestlers[0]]}} : {review: {title: 'One-on-one lesson', coach: 'Coach Dana', dates: ['2026-11-09'], start: '15:00', end: '16:00', wrestler: 'Sam Example', cents: 6000, capacity: 1, spotsLeft: 1, message: ''}, paymentsEnabled: true})});
  await settle();
  p.button('opening', 'o').onclick(); await settle();
  assert.equal(p.el('summary').innerHTML, '<div class="swa-receipt"><div class="swa-receipt__row"><span class="k">Lesson</span><span class="v"><strong>One-on-one lesson</strong><small>with Coach Dana</small></span></div><div class="swa-receipt__row"><span class="k">When</span><span class="v">Mon, Nov 9 · 3:00 PM–4:00 PM</span></div><div class="swa-receipt__row"><span class="k">For</span><span class="v">Sam Example</span></div><div class="swa-receipt__total"><span class="k">Total</span><span class="v">$60.00</span></div></div>');
  assert.equal(p.el('payArea').hidden, false); assert.equal(p.el('pay').disabled, true, 'Confirm waits for the terms line beneath it');
  assert.match(p.html, /<div class="swa-seg" role="group" aria-label="Show open times as"><button type="button" id="viewList" aria-pressed="true">List<\/button><button type="button" id="viewMonth" aria-pressed="false">Month<\/button><\/div>/);
  assert.match(p.html, /<div id="payArea" class="confirm"><button class="primary" id="pay" disabled>Confirm and pay<\/button><label class="check">/);
}

// ---------- Messages: one list with the type as a caption, the dot while unread, the quiet Mark all ----------
{
  const p = page('app/inbox/screen.html', {fetch: async () => json({announcements: [{id: 'a1', subject: 'Practice moved', body: 'Starts at 6:30.', sentAt: '2026-11-06T19:13:00Z', read: false}], notices: [{id: 'n1', subject: 'Payment received', body: 'b', at: '2026-11-05T19:13:00Z', read: true}], thread: [], unread: 1})});
  await settle();
  assert.equal(p.el('announcements').innerHTML, '<details data-id="a1" open><summary class="unread"><span class="sum"><span class="kind">Announcement</span><span class="subj"><span class="dot" aria-label="Unread"></span>Practice moved</span><span class="muted when">Fri, Nov 6 · 2:13 PM</span></span></summary><div class="body">Starts at 6:30.</div></details>');
  assert.match(p.el('notices').innerHTML, /<span class="kind">Notice<\/span><span class="subj">Payment received<\/span>/);
  assert.match(p.html, /<div class="top"><h1>Messages<\/h1><button type="button" class="quiet" id="markAll" hidden>Mark all as read<\/button><\/div>/, 'the quiet action in the title row');
  assert.match(p.html, /<div class="card inbox"><section id="announcementsBox"[\s\S]*<section id="noticesBox" hidden/, 'one card holds both lists');
}

// ---------- The pass: the card, the name, the next session; the wrestler view: ten rows ----------
{
  const upcoming = Array.from({length: 14}, (_, i) => ({date: '2099-01-' + String(i + 5).padStart(2, '0'), start: '18:00', end: '19:30', title: 'SWA Intermediate', type: 'practice', why: 'Membership'}));
  const p = page('app/pass/screen.html', {search: '?wrestler=w1', fetch: async url => json(url === '/api/passes' ? {passes: [{wrestlerId: 'w1', name: 'Sam Example', code: 'SWA1:abc', createdAt: '2026-11-01T12:00:00Z'}, {wrestlerId: 'w2', name: 'Riley Example', code: 'SWA1:def', createdAt: '2026-11-01T12:00:00Z'}]} : {id: 'w1', name: 'Sam Example', upcoming})});
  await settle();
  const out = p.el('passes').innerHTML;
  assert.equal((out.match(/<section class="pass"/g) || []).length, 1, 'only the wrestler asked for');
  assert.match(out, /<h2>Sam Example<\/h2><div class="qr"><svg aria-label="Entry pass for Sam Example">SWA1:abc<\/svg><\/div><p class="swa-day">Next up · Mon, Jan 5<\/p><div class="swa-practice"><p class="swa-practice__name">SWA Intermediate<\/p><p class="swa-practice__time">6:00 PM<\/p><\/div><\/section>/);
  assert.match(out, /<button type="button" class="quiet" data-replace="w1">Replace this pass<\/button>/);
  const w = page('app/wrestler/screen.html', {search: '?id=w1', fetch: async () => json({id: 'w1', name: 'Sam Example', grade: '8', card: {state: 'verified'}, pass: 'SWA1:abc', upcoming, checkInsThisMonth: 2})});
  await settle();
  assert.equal((w.el('list').innerHTML.match(/<li>/g) || []).length, 10, 'Coming up stops at ten rows');
  assert.match(w.el('list').innerHTML, /<a href="\/calendar">4 more in the next three weeks: see the calendar →<\/a>/);
  assert.match(w.el('list').innerHTML, /^<ul class="swa-rows"><li><div class="d">Mon, Jan 5<small>6:00 PM<\/small><\/div><div class="t">SWA Intermediate<small>Membership<\/small><\/div><div class="r">Practice<\/div><\/li>/);
}

// ---------- Welcome: the program switch on a phone ----------
{
  const schedule = {month: '2026-11', today: '2026-11-09', programs: [{id: 'Elementary', name: 'SWA Development', monthlyCents: 20000, walkInCents: 4000}, {id: 'Intermediate', name: 'SWA Intermediate', monthlyCents: 20000, walkInCents: 4000}, {id: 'Advanced', name: 'SWA Advance', monthlyCents: 20000, walkInCents: 4000}], practices: [], events: [], liveClasses: []};
  const p = page('app/welcome/screen.html', {fetch: async () => json(schedule)});
  await settle();
  assert.equal(p.el('programSwitch').hidden, false);
  assert.deepEqual([...p.el('programSwitch').innerHTML.matchAll(/data-program="(\w+)" aria-pressed="(\w+)"/g)].map(m => m[1] + ':' + m[2]), ['Elementary:true', 'Intermediate:false', 'Advanced:false']);
  assert.equal((p.el('programs').innerHTML.match(/class="program is-on"/g) || []).length, 1, 'one column shows on a phone until the switch is tapped');
}

// ---------- Public calendar: the doors and one Choose per day ----------
{
  const state = {today: '2026-11-07', month: '2026-11', programs: [{id: 'Intermediate', name: 'SWA Intermediate', monthlyCents: 20000, walkInCents: 4000}], holidays: [], privateFormats: [],
    practices: [{id: 'a', program: 'Intermediate', date: '2026-11-10', start: '18:00', end: '19:30'}, {id: 'b', program: 'Intermediate', date: '2026-11-10', start: '19:45', end: '21:00'}, {id: 'c', program: 'Intermediate', date: '2026-11-03', start: '18:00', end: '19:30'}],
    events: [], liveClasses: []};
  const p = page('app/calendar/screen.html', {fetch: async () => json(state)});
  await settle();
  const grid = p.el('calendar').innerHTML.split('<div class="list">')[0];
  assert.equal((grid.match(/Choose a walk-in →/g) || []).length, 1, 'two practices on Nov 10: one Choose for the day; the past Nov 3 gets none');
  assert.match(grid, /<div class="slot development"><strong>SWA Intermediate<\/strong><span>6:00 PM–7:30 PM<\/span><\/div><div class="slot development"><strong>SWA Intermediate<\/strong><span>7:45 PM–9:00 PM<\/span><\/div><a class="choose" href="\/register\?plan=walkin&amp;date=2026-11-10" target="_top">Choose a walk-in →<\/a>/);
  assert.match(grid, /<div class="slot development past"><strong>SWA Intermediate<\/strong>/, 'past practices are greyed');
  assert.equal(p.el('doorPrograms').textContent, '$200.00 a month · $40.00 walk-in'); assert.equal(p.el('doorEvents').textContent, 'Camps, clinics and events');
  assert.match(p.html, /<a class="swa-door" href="#schedule" id="doorLiveLink" data-filter-door="extras">/, 'the Extra practices door filters the grid');
  vm.runInContext("setFilter('extras')", p.ctx); await settle();
  assert.doesNotMatch(p.el('calendar').innerHTML, /SWA Intermediate/);
}

console.log('Parent journey (#282): tab bar badge and Account tab, wrestler chips and plan segment, the booking and lesson receipts, the inbox captions, the pass with its next session, ten rows on the wrestler view, the welcome switch and the calendar doors');
