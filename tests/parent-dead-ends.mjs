// #273, the parent dead ends from the phone audit, on the pages themselves (inline JavaScript is not typechecked):
// Register stops offering today's started practices, keeps the approval conversation under the approval card, leaves
// room for the sticky bar and offers "Tell the academy I want this" for a closed membership; Book offers cash for a camp
// and the same action for a lesson inquiry; Lessons do not pick a wrestler for a group spot when there are several; the
// family page keeps the red card warning for the saved view, names what a save is missing, and says why a booking can no
// longer be canceled; the calendar's jump links stick on phones and "Coming up" links camps to their booking page.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const json = (body, ok = true, status) => ({ok, status: status ?? (ok ? 200 : 400), json: async () => body});
function page(file, {fetch, search = '', hidden = []}) {
  const nodes = new Map(), clicks = new Map(), scrolled = [], focused = [];
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, {id, value: '', min: '', hidden: hidden.includes(id), checked: false, disabled: false, innerHTML: '', textContent: '', className: '', href: '', style: {}, dataset: {}, options: [],
      elements: {parentName: {value: '', focus() {}, scrollIntoView() {}}, phone: {value: ''}},
      replaceChildren(...items) { this.value = items[0]?.value ?? ''; }, focus() { focused.push(id); }, select() {}, scrollIntoView() { scrolled.push(id); }, setAttribute() {}, removeAttribute() {}, querySelector() { return null; }, classList: {add() {}, remove() {}, toggle() {}}});
    return nodes.get(id);
  };
  const calls = [];
  const selected = html => { const m = /<option(?: value="([^"]*)")? selected>([^<]*)/.exec(html.slice(0, html.indexOf('</select>') + 1 || undefined)); return m ? m[1] ?? m[2] : ''; };
  // querySelectorAll finds buttons by their data attribute in the rendered HTML, so clicks run the page's handlers.
  const all = sel => {
    const m = /^\[data-([a-z-]+)(?:="([^"]*)")?\]$/.exec(sel); if (!m) return [];
    const out = [];
    for (const node of nodes.values()) for (const x of String(node.innerHTML).matchAll(new RegExp(`<(\\w+)[^>]*data-${m[1]}="([^"]*)"[^>]*>`, 'g'))) {
      if (m[2] !== undefined && x[2] !== m[2]) continue;
      const key = m[1] + ':' + x[2], camel = m[1].replace(/-(\w)/g, (_, c) => c.toUpperCase());
      if (!clicks.has(key)) clicks.set(key, {dataset: {[camel]: x[2]}, checked: /\bchecked\b/.test(x[0]), value: selected(String(node.innerHTML).slice(x.index)), focus() {}});
      out.push(clicks.get(key));
    }
    return out;
  };
  const ctx = vm.createContext({Intl, Date, JSON, URLSearchParams, Promise, setTimeout: f => setImmediate(f), clearTimeout() {}, structuredClone, console, encodeURIComponent, crypto: {randomUUID: () => 'new-id'},
    location: {search, href: '', origin: 'https://swa.test', pathname: '/' + file.split('/')[1], assign() {}}, confirm: () => true, prompt: () => '', window: {addEventListener() {}}, navigator: {},
    document: {getElementById: el, querySelectorAll: all, querySelector: sel => all(sel)[0] ?? null, createElement: () => ({getContext: () => null})},
    ApprovalChat: {open() {}, close() {}},
    fetch: async (url, options) => { calls.push({url, method: options?.method || 'GET', body: options?.body ? JSON.parse(options.body) : null}); return fetch(url, options); }});
  const html = readFileSync(file, 'utf8');
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(code, ctx);
  return {el, ctx, html, calls, scrolled, focused, button: (attr, v) => all(`[data-${attr}="${v}"]`)[0]};
}
const contact = {address: '1 Mat Way, Melville, NY 11747', email: 'hello@swa.test'};

// ---------- Register: today's started practice reads "In progress" and cannot be chosen ----------
{
  const today = '2026-11-07', tomorrow = '2026-11-08';
  const practices = [{id: `Intermediate:${today}:18:00`, program: 'Intermediate', date: today, start: '18:00', end: '19:30'}, {id: `Intermediate:${today}:19:45`, program: 'Intermediate', date: today, start: '19:45', end: '21:00'}, {id: `Intermediate:${tomorrow}:18:00`, program: 'Intermediate', date: tomorrow, start: '18:00', end: '19:30'}];
  const catalog = {today, now: '18:30', month: '2026-11', programs: [{id: 'Intermediate', name: 'SWA Intermediate', walkInCents: 4000, monthlyCents: 20000, grades: 'Grades 7–12'}], practices};
  const {el, ctx, html} = page('app/register/screen.html', {search: `?plan=walkin&date=${today}`, fetch: async (url, o) => {
    if (url === '/api/family') return json({data: {wrestlers: [{id: 'w-1', name: 'Jo Example', grade: '8'}]}});
    if (url.startsWith('/api/registration') && o?.method !== 'POST') return json(catalog);
    if (url === '/api/program-approvals') return json({approvals: []});
    return json({});
  }});
  await settle();
  assert.equal(el('plan').value, 'walkin');
  vm.runInContext(`selectPracticeDay('${today}')`, ctx);
  assert.match(el('practices').innerHTML, /<button type="button" class="practice" disabled><strong>6:00 PM–7:30 PM<\/strong><br>SWA Intermediate<br><small>In progress · can’t be booked here now<\/small><\/button>/, 'the started practice is greyed, not offered');
  assert.doesNotMatch(el('practices').innerHTML, new RegExp(`data-slot="Intermediate:${today}:18:00"`), 'no button for it');
  assert.match(el('practices').innerHTML, new RegExp(`data-slot="Intermediate:${today}:19:45"`), 'the later practice today is offered');
  assert.equal(el('calendarAvailability').textContent, '2 scheduled practices for SWA Intermediate this month.', 'started practices are not counted');
  vm.runInContext(`selectPracticeTime('Intermediate:${today}:18:00')`, ctx);
  assert.equal(vm.runInContext('selected', ctx), '', 'a started practice cannot be chosen');
  assert.equal(el('reviewButton').disabled, true);
  vm.runInContext(`selectPracticeTime('Intermediate:${today}:19:45')`, ctx);
  assert.equal(vm.runInContext('selected', ctx), `Intermediate:${today}:19:45`);
  assert.match(el('selectedPractice').textContent, /^Selected: .* · 7:45 PM–9:00 PM · SWA Intermediate/);
  assert.equal(el('reviewButton').disabled, false);
  // The catalog's clock, not the browser's, decides; without one the browser's New York clock stands in.
  vm.runInContext("catalog.now='';", ctx);
  assert.match(vm.runInContext('academyClock()', ctx), /^\d{2}:\d{2}$/);
  // Layout: the conversation lives inside the approval card, the calendar step ends with room for the sticky bar.
  assert.match(html, /<div id="approvalGate" hidden>[\s\S]*<section id="chat" hidden tabindex="-1"[^>]*><\/section><\/div>/, 'the approval conversation is inside the approval card');
  assert.doesNotMatch(html, /<\/section>\s*<section id="chat"/, 'and no longer at the end of the page');
  assert.match(html, /html body \.step\.practice-calendar\{padding-bottom:calc\(24px \+ var\(--reviewbar-space\)\)\}/, 'room under the calendar for the review bar');
  assert.match(html, /@media\(max-width:640px\)\{[^@]*:root\{--reviewbar-space:132px\}/, 'a taller bar on phones');
  assert.match(html, /\.practice-selection\{[^}]*scroll-margin-bottom:var\(--reviewbar-space\)/, 'the Selected line scrolls clear of the bar');
  assert.doesNotMatch(html, /id="payPending"/, 'no disabled "isn’t open yet" button');
}

// ---------- Register: a closed membership offers "Tell the academy I want this" ----------
{
  const catalog = {today: '2026-11-07', now: '09:00', month: '2026-11', programs: [{id: 'Intermediate', name: 'SWA Intermediate', walkInCents: 4000, monthlyCents: 20000, grades: 'Grades 7–12'}], practices: []};
  let interestStatus = 200;
  const {el, calls} = page('app/register/screen.html', {fetch: async (url, o) => {
    if (url === '/api/family') return json({data: {wrestlers: [{id: 'w-1', name: 'Jo Example', grade: '8'}]}});
    if (url.startsWith('/api/registration') && o?.method !== 'POST') return json(catalog);
    if (url === '/api/program-approvals') return json({approvals: []});
    if (url === '/api/registration') return json({paymentsEnabled: false, cashEnabled: false, review: {wrestlerName: 'Jo Example', programName: 'SWA Intermediate', programId: 'Intermediate', plan: 'monthly', cents: 20000, baseCents: 20000, totalCents: 240000}});
    if (url === '/api/interest' && o?.method !== 'POST') return json({contact});
    if (url === '/api/interest') return interestStatus === 200 ? json({ok: true, message: 'Request from the website: …', contact}) : json({error: 'You already told the academy about this today. They have your message and will be in touch; you can add to it under Messages.'}, false, 409);
    return json({});
  }});
  await settle();
  el('wrestler').value = 'w-1'; el('program').value = 'Intermediate'; el('plan').value = 'monthly';
  await el('selection').onsubmit({preventDefault() {}}); await settle();
  assert.equal(el('review').hidden, false);
  assert.equal(el('interestBox').hidden, false, 'the one action is offered'); assert.equal(el('payChoice').hidden, true); assert.equal(el('payBox').hidden, true);
  assert.match(el('payNotice').innerHTML, /Online payment for memberships isn’t open yet\. Tell the academy you want this/);
  assert.match(el('status').textContent, /then tell the academy you want this/);
  assert.match(el('contactLine').innerHTML, /1 Mat Way, Melville, NY 11747 · <a href="mailto:hello@swa\.test">hello@swa\.test<\/a>/, 'the academy’s saved address and email');
  await el('interestButton').onclick(); await settle();
  const sent = calls.find(c => c.url === '/api/interest' && c.method === 'POST').body;
  assert.deepEqual(sent, {kind: 'membership', wrestlerId: 'w-1', program: 'Intermediate'}, 'only which wrestler and program; the server writes the message');
  assert.equal(el('interestBox').hidden, true); assert.equal(el('interestDone').hidden, false);
  assert.match(el('interestDone').innerHTML, /<strong>Sent\.<\/strong> The academy has your request for Jo Example’s SWA Intermediate membership and will reply under Messages/);
  assert.match(el('interestDone').innerHTML, /1 Mat Way[\s\S]*<a href="\/inbox">Open Messages →<\/a>/);
  assert.equal(el('status').textContent, 'Request sent. The academy will be in touch.');
  // Sent once already today: the page says so and the button comes back.
  interestStatus = 409;
  await el('selection').onsubmit({preventDefault() {}}); await settle();
  assert.equal(el('interestBox').hidden, false, 'a fresh review offers the action again');
  await el('interestButton').onclick(); await settle();
  assert.match(el('status').textContent, /already told the academy about this today/); assert.equal(el('interestButton').disabled, false); assert.equal(el('interestDone').hidden, true);
}

// ---------- Book: a camp can be paid cash at the academy; a lesson inquiry has the one action ----------
{
  const d1 = '2026-11-20', d2 = '2026-11-21';
  const camp = {id: 'camp', name: 'Winter camp', type: 'Camp', dates: [d1, d2], schedule: [{date: d1, start: '09:00', end: '12:00'}], cents: 16000, dayCents: 9000, full: false};
  const {el, calls} = page('app/booking/screen.html', {search: '?type=event&id=camp', fetch: async (url, o) => {
    if (url === '/api/family') return json({data: {wrestlers: [{id: 'w-1', name: 'Jo Example', grade: '8'}]}});
    if (url.startsWith('/api/public-schedule')) return json({today: '2026-11-07', liveClasses: [], events: [camp], privateFormats: []});
    if (url === '/api/orders') return json({orders: [], cashBookings: []});
    if (url === '/api/booking-review') return json({paymentsEnabled: false, cashEnabled: true, review: {type: 'event', title: 'Winter camp', wrestler: 'Jo Example', dates: [d1, d2], schedule: camp.schedule, cents: 16000, baseCents: 16000, seatsLeft: 2, message: 'The price shown is the full price for this event. Online payment isn’t open yet. You can book now and pay cash at the academy.'}});
    if (url === '/api/cash-bookings') return json({ok: true, booking: {id: 'cb-9', kind: 'event', itemId: 'camp', item: 'Winter camp', date: d1, start: '09:00', end: '12:00', dates: [d1, d2], wrestlerId: 'w-1', wrestler: 'Jo Example', amountCents: 16000, status: 'due', label: 'Pay at the academy: $160.00 due', cancellable: true, cancelBlocked: null}});
    return json({});
  }});
  await settle();
  el('wrestler').value = 'w-1'; el('option').value = 'full';
  await el('form').onsubmit({preventDefault() {}}); await settle();
  assert.equal(el('payChoice').hidden, false, 'how to pay is asked for a camp'); assert.equal(el('payOnlineOption').hidden, true); assert.equal(el('cashBox').hidden, false); assert.equal(el('interestBox').hidden, true);
  assert.equal(el('reviewHeading').textContent, 'Review and book');
  assert.equal(el('cashHint').textContent, 'Book now and pay $160.00 in cash at the academy on the first day.');
  assert.match(el('cashNote').textContent, /Pay in cash at the academy on the first day\. You can cancel in your family account before it starts\./);
  assert.match(el('status').textContent, /book and pay cash at the academy/);
  await el('cashButton').onclick(); await settle();
  const sent = calls.find(c => c.url === '/api/cash-bookings').body;
  assert.equal(sent.action, 'book'); assert.equal(sent.source, 'booking'); assert.equal(sent.type, 'event'); assert.equal(sent.id, 'camp'); assert.equal(sent.option, 'full');
  assert.ok(!('amountCents' in sent) && !('cents' in sent), 'the browser sends no amount');
  assert.equal(el('reviewHeading').textContent, 'You’re booked');
  assert.match(el('cashDone').innerHTML, /Pay at the academy: \$160\.00 due[\s\S]*Jo Example<\/strong> is booked for Winter camp, Fri, Nov 20, Sat, Nov 21 \(New York time\)[\s\S]*Bring the cash to the academy on the first day/);
  el('wrestler').onchange();
  assert.equal(el('wrestlerStatus').textContent, 'Jo Example is booked. Pay at the academy: $160.00 due. You don’t need to book again.');
}
{
  const {el, calls} = page('app/booking/screen.html', {search: '?type=lesson&format=one-on-one', fetch: async (url, o) => {
    if (url === '/api/family') return json({data: {wrestlers: [{id: 'w-1', name: 'Jo Example', grade: '8'}]}});
    if (url.startsWith('/api/public-schedule')) return json({today: '2026-11-07', liveClasses: [], events: [], privateFormats: [{id: 'one-on-one', name: 'One-on-one lesson', description: 'Individual coaching for one wrestler.'}]});
    if (url === '/api/orders') return json({orders: [], cashBookings: []});
    if (url === '/api/booking-review') return json({paymentsEnabled: false, cashEnabled: false, review: {type: 'lesson', title: 'One-on-one lesson', wrestler: 'Jo Example', cents: null, message: 'The academy will confirm the coach, date and price with you. Nothing is reserved or charged yet.'}});
    if (url === '/api/interest' && o?.method !== 'POST') return json({contact});
    if (url === '/api/interest') return json({ok: true, contact});
    return json({});
  }});
  await settle();
  el('wrestler').value = 'w-1';
  await el('form').onsubmit({preventDefault() {}}); await settle();
  assert.equal(el('payChoice').hidden, true); assert.equal(el('interestBox').hidden, false, 'a lesson inquiry has one real action');
  assert.match(el('contactLine').innerHTML, /1 Mat Way/);
  await el('interestButton').onclick(); await settle();
  assert.deepEqual(calls.find(c => c.url === '/api/interest' && c.method === 'POST').body, {kind: 'lesson', wrestlerId: 'w-1', format: 'one-on-one'});
  assert.match(el('interestDone').innerHTML, /Sent\.[\s\S]*Jo Example’s one-on-one lesson[\s\S]*Open Messages/);
}
// An extra practice already under way today is not booked here.
{
  const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
  const {el} = page('app/booking/screen.html', {search: `?type=live&id=fnl&date=${today}`, hidden: ['choice'], fetch: async url => {
    if (url === '/api/family') return json({data: {wrestlers: [{id: 'w-1', name: 'Jo Example', grade: '8'}]}});
    if (url.startsWith('/api/public-schedule')) return json({today, liveClasses: [{id: 'fnl', name: 'Friday Night Live', date: today, start: '00:00', end: '00:30', memberCents: 1000, nonMemberCents: 2000}], events: [], privateFormats: []});
    return json({orders: [], cashBookings: []});
  }});
  await settle();
  assert.equal(el('choice').hidden, true, 'no booking form for a started practice');
  assert.match(el('status').textContent, /This practice has already started, so it can’t be booked here/);
}

// ---------- Lessons: no wrestler picked for a group spot when the family has several ----------
{
  const formats = [{id: 'one-on-one', name: 'One-on-one lesson', description: 'd', cents: 6000}, {id: 'partner', name: 'Partner lesson', description: 'd', cents: 4500}, {id: 'small-group', name: 'Small-group lesson', description: 'd', cents: 3500}];
  const at = (id, extra) => ({id, date: '2026-11-09', start: '15:00', end: '16:00', coach: 'Coach Dana', coachKey: 'k', format: null, capacity: 1, spotsLeft: 1, ...extra});
  const openings = [at('one'), at('grp', {start: '10:00', end: '11:00', format: 'small-group', capacity: 4, spotsLeft: 2})];
  const wrestlers = [{id: 'w1', name: 'Sam'}, {id: 'w2', name: 'Sasha'}];
  const review = {title: 'Small-group lesson', coach: 'Coach Dana', dates: ['2026-11-09'], start: '10:00', end: '11:00', wrestler: 'Sasha', cents: 3500, capacity: 4, spotsLeft: 2, message: ''};
  const p = page('app/lesson/screen.html', {fetch: async (url, o) => url.startsWith('/api/lessons') ? json({formats, openings, mine: []}) : url === '/api/family' ? json({data: {wrestlers}})
    : url === '/api/interest' && o?.method !== 'POST' ? json({contact}) : url === '/api/interest' ? json({ok: true, contact}) : json({review, paymentsEnabled: false})});
  await settle();
  p.button('path', 'group').onclick(); await settle();
  assert.equal(p.el('wrestler').value, '', 'no wrestler is picked for a group spot');
  assert.equal(p.el('wrestlerLabelText').textContent, 'Which of your wrestlers?');
  assert.match(p.el('wrestler').innerHTML, /^<option value="">Choose a wrestler<\/option><option value="w1">Sam<\/option>/);
  p.button('opening', 'grp').onclick(); await settle();
  assert.equal(p.calls.filter(c => c.url === '/api/booking-review').length, 0, 'nothing is checked until a wrestler is chosen');
  assert.equal(p.el('status').textContent, 'Choose which of your wrestlers this lesson is for.');
  p.el('wrestler').value = 'w2'; p.el('wrestler').onchange(); await settle();
  assert.deepEqual(p.calls.find(c => c.url === '/api/booking-review').body, {type: 'lesson', wrestlerId: 'w2', openingId: 'grp'});
  assert.equal(p.el('reviewBox').hidden, false); assert.equal(p.el('notOpen').hidden, false, 'lesson payment is closed');
  assert.match(p.el('contactLine').innerHTML, /1 Mat Way/);
  // The one action while lesson payment is closed.
  await p.el('interestButton').onclick(); await settle();
  assert.deepEqual(p.calls.find(c => c.url === '/api/interest' && c.method === 'POST').body, {kind: 'lesson', wrestlerId: 'w2', openingId: 'grp'});
  assert.match(p.el('interestDone').innerHTML, /Sent\.[\s\S]*Sasha’s small-group lesson with Coach Dana, Mon, Nov 9 · 10:00 AM/);
  assert.equal(p.el('notOpen').hidden, true);
  // A one-on-one keeps the first wrestler chosen, as before; the picked wrestler is kept when switching paths.
  p.button('path', 'one').onclick(); await settle();
  assert.equal(p.el('wrestler').value, 'w2', 'the wrestler the family picked stays');
  // Starting a private group: no wrestler is ticked for them either.
  p.button('path', 'request').onclick(); await settle();
  assert.equal(p.el('ownLegend').textContent, 'Which of your wrestlers are in this group?');
  assert.match(p.el('ownWrestlers').innerHTML, /data-own="w1"> Sam[\s\S]*data-own="w2"> Sasha/); assert.doesNotMatch(p.el('ownWrestlers').innerHTML, /checked/);
  // One wrestler: chosen, with the plain label.
  const one = page('app/lesson/screen.html', {fetch: async url => url.startsWith('/api/lessons') ? json({formats, openings, mine: []}) : url === '/api/family' ? json({data: {wrestlers: [wrestlers[0]]}}) : json({review, paymentsEnabled: false})});
  await settle();
  one.button('path', 'group').onclick(); await settle();
  assert.equal(one.el('wrestler').value, 'w1'); assert.equal(one.el('wrestlerLabelText').textContent, 'Wrestler');
  one.button('path', 'request').onclick(); await settle();
  assert.match(one.el('ownWrestlers').innerHTML, /data-own="w1" checked/); assert.equal(one.el('ownLegend').textContent, 'Your wrestlers in this group');
  // An invite link with several wrestlers asks too.
  const invite = {id: 'pg', date: '2026-11-10', start: '09:30', end: '10:30', coach: 'Coach Dana', format: 'partner', capacity: 2, spotsLeft: 1, organizer: 'Pat', mine: false, booked: []};
  const join = page('app/lesson/screen.html', {search: '?join=' + 'C'.repeat(32), fetch: async url => url.startsWith('/api/lessons') ? json({formats, openings: [], mine: [], invite}) : url === '/api/family' ? json({data: {wrestlers}}) : json({review, paymentsEnabled: false})});
  await settle();
  assert.equal(join.el('joinWrestler').value, ''); assert.equal(join.el('joinWrestlerLabelText').textContent, 'Which of your wrestlers?');
  assert.equal(join.calls.filter(c => c.url === '/api/booking-review').length, 0);
}

// ---------- Family: the editor's card hint, what a save is missing, and why Cancel is gone ----------
{
  const day = '2026-11-12';
  const profile = {parentName: 'Pat Example', phone: '555-0100', wrestlers: [{id: 'w-1', name: 'Jo Example', grade: '8'}]};
  const due = [{id: 'cb-1', kind: 'walkin', program: 'Intermediate', itemId: `Intermediate:${day}:18:00`, item: 'SWA Intermediate walk-in', date: day, start: '18:00', end: '19:30', dates: [day], wrestlerId: 'w-1', wrestler: 'Jo Example', amountCents: 4000, status: 'due', label: 'Pay at the academy: $40.00 due', cancellable: false, past: false, cancelBlocked: 'The practice has started, so this can no longer be canceled. Ask the academy if you need to change it.'},
    {id: 'cb-2', kind: 'event', program: null, itemId: 'camp', item: 'Winter camp', date: '2026-11-20', start: '09:00', end: '12:00', dates: ['2026-11-20', '2026-11-21'], wrestlerId: 'w-1', wrestler: 'Jo Example', amountCents: 16000, status: 'due', label: 'Pay at the academy: $160.00 due', cancellable: true, past: false, cancelBlocked: null}];
  const {el, ctx, calls, scrolled, focused} = page('app/family/screen.html', {hidden: ['summary'], fetch: async (url, o) => {
    if (url === '/api/family' && o?.method === 'PUT') return json({revision: 2, updatedAt: '2026-11-02T12:00:00Z', data: JSON.parse(o.body).data});
    if (url === '/api/family') return json({email: 'pat@example.test', data: structuredClone(profile), revision: 1, updatedAt: '2026-11-01T12:00:00Z', cards: {}});
    if (url === '/api/orders') return json({orders: [], checkoutOpen: false, cashBookings: due});
    return json({});
  }});
  await settle(60);
  // Saved view: the red warning. Editor: a plain hint while the card is typed.
  assert.match(el('savedDetails').innerHTML, /<span class="pill warn">No USA Wrestling card<\/span>/, 'the saved view says what blocks booking');
  vm.runInContext('editProfile()', ctx);
  assert.doesNotMatch(el('wrestlers').innerHTML, /pill warn|Booking is blocked/, 'no red warning inside the editor');
  assert.match(el('wrestlers').innerHTML, /<p class="muted card-line">Add the card number and choose its season\. Booking needs a current card\.<\/p>/);
  assert.match(vm.runInContext("editorCardLine({id:'x',usawNumber:'AB12',usawExpires:'2020-08-31'})", ctx), /USA Wrestling card expired/, 'an expired card is still named in the editor');
  // Saving with the address missing: the browser's own check fails, the status says what is missing and the field is
  // brought into view; nothing is sent.
  let valid = false; el('familyForm').checkValidity = () => valid;
  el('familyForm').elements.parentName.value = 'Pat Example'; el('homeAddress').value = ''; el('homeCity').value = 'Huntington Station';
  await el('familyForm').onsubmit({preventDefault() {}}); await settle();
  assert.equal(el('status').textContent, 'Add the street address. Then choose Save family profile.');
  assert.ok(scrolled.includes('homeAddress') && focused.includes('homeAddress'), 'the missing field is scrolled to and focused');
  assert.equal(calls.filter(c => c.method === 'PUT').length, 0, 'nothing was saved');
  el('homeAddress').value = '20 Railroad St'; el('homeState').value = 'NY'; el('homeZip').value = '1174';
  await el('familyForm').onsubmit({preventDefault() {}}); await settle();
  assert.equal(el('status').textContent, 'Check the ZIP code: 5 digits, for example 11746. Then choose Save family profile.');
  el('homeZip').value = '11746'; el('emergencyContactName').value = 'Sam'; el('emergencyContactPhone').value = '555-0101';
  el('name0').value = 'Jo Example'; el('birth0').value = '';
  await el('familyForm').onsubmit({preventDefault() {}}); await settle();
  assert.equal(el('status').textContent, 'Add Jo Example’s birth date. Then choose Save family profile.');
  el('birth0').value = '2012-01-01'; el('allergies0').value = ''; el('none0').checked = false;
  await el('familyForm').onsubmit({preventDefault() {}}); await settle();
  assert.match(el('status').textContent, /^Add Jo Example’s allergies or medical notes, or tick “No allergies or medical notes”\./);
  el('none0').checked = true; el('usaw0').value = ''; el('usawSeason0').value = ''; valid = true;
  await el('familyForm').onsubmit({preventDefault() {}}); await settle();
  assert.equal(calls.filter(c => c.method === 'PUT').length, 1, 'a complete profile saves');
  assert.match(el('status').textContent, /Your changes are saved/);
  assert.match(readFileSync('app/family/screen.html', 'utf8'), /<form id="familyForm" novalidate>/, 'the page’s own words, not the browser bubble');
  // Purchase history: why the walk-in can no longer be canceled; where the camp cash goes.
  const list = el('purchaseList').innerHTML;
  assert.match(list, /SWA Intermediate walk-in[\s\S]*The practice has started, so this can no longer be canceled\. Ask the academy if you need to change it\./);
  assert.doesNotMatch(list, /data-cash-cancel="cb-1"/, 'no Cancel once it has started');
  assert.match(list, /Winter camp[\s\S]*Fri, Nov 20 · Sat, Nov 21[\s\S]*Bring the cash to the academy on the first day\. You can cancel until it starts/);
  assert.match(list, /data-cash-cancel="cb-2">Cancel booking/);
}

// ---------- Calendar: sticky jump links, Coming up with camps linked, camp titles linked ----------
{
  const today = '2026-11-07';
  const state = {today, month: '2026-11', programs: [], practices: [], holidays: [], privateFormats: [],
    events: [{id: 'camp', name: 'Winter camp', type: 'Camp', dates: ['2026-11-20', '2026-11-21'], schedule: [{date: '2026-11-20', start: '09:00', end: '12:00'}], cents: 16000, dayCents: 9000, full: false, gradeRange: '', description: ''},
      {id: 'clinic', name: 'Spring clinic', type: 'Clinic', dates: ['2026-11-15'], schedule: [], cents: 6000, dayCents: null, full: true, gradeRange: '', description: ''}],
    liveClasses: [{id: 'fnl', name: 'Friday Night Live', date: '2026-11-13', start: '16:00', end: '17:00', memberCents: 1000, nonMemberCents: 2000}]};
  const {el, html} = page('app/calendar/screen.html', {fetch: async () => json(state)});
  await settle();
  assert.equal(el('comingUp').hidden, false);
  const soon = el('soonList').innerHTML;
  // Rows (#282): the day and time, the session with its details, and the link to its booking page.
  assert.match(soon, /^<li><div class="d">Fri, Nov 13<small>4:00 PM<\/small><\/div><div class="t">Friday Night Live<small>Extra practice · \$10\.00 members · \$20\.00 non-members<\/small><\/div><div class="r"><a class="" href="\/booking\?type=live&amp;id=fnl&amp;date=2026-11-13" target="_top">Details →<\/a><\/div><\/li>/, 'soonest first');
  assert.match(soon, /<div class="d">Sun, Nov 15<\/div><div class="t">Spring clinic<small>Clinic · \$60\.00 · Full<\/small><\/div><div class="r"><a class="" href="\/booking\?type=event&amp;id=clinic" target="_top">/, 'a day without a time has none; a full clinic says so');
  assert.match(soon, /<div class="d">Fri, Nov 20<small>9:00 AM<\/small><\/div><div class="t">Winter camp<small>Camp · 2 days · \$160\.00<\/small><\/div><div class="r"><a class="" href="\/booking\?type=event&amp;id=camp" target="_top">/, 'the camp links to its booking page');
  // The camps door counts what is coming up and leads to this list (#282); the grid's camp chips still open the booking page.
  assert.equal(el('doorEvents').textContent, '2 coming up');
  assert.match(el('calendar').innerHTML, /<a class="slot special" href="\/booking\?type=event&amp;id=camp" target="_top"><strong>Winter camp<\/strong><span>9:00 AM–12:00 PM<\/span><span>Camp<\/span><\/a>/);
  assert.doesNotMatch(html, /class="jump"/, 'no jump links: the doors above the grid take their place');
  // Nothing coming up: the section stays hidden. Embedded: hidden too, with the doors and the join band.
  const quiet = page('app/calendar/screen.html', {fetch: async () => json({...state, events: [], liveClasses: []})});
  await settle();
  assert.equal(quiet.el('comingUp').hidden, true);
  const embedded = page('app/calendar/screen.html', {search: '?embed=1', fetch: async () => json(state)});
  await settle();
  assert.equal(embedded.el('comingUp').hidden, true); assert.equal(embedded.el('doors').hidden, true); assert.equal(embedded.el('join').hidden, true);
}

console.log('Passed: the parent dead ends are gone on the pages: started practices read In progress, the approval chat sits under its card, the sticky bar has room, closed memberships and lessons offer "Tell the academy I want this", camps can be paid cash on the Book page, group lessons do not pick a wrestler, the family editor keeps its card hint plain and names what a save is missing, purchase history says why Cancel is gone, and the calendar’s jump links stick with camps under Coming up.');
