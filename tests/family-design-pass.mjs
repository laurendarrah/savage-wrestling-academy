// Issue #340: the design pass on the family and public screens. What a parent sees first on the family home, the
// academy's practice box for the next session, and a sentence with a way on wherever a grid, a list or a page would
// otherwise be empty. Page scripts run with a fake DOM, because inline JavaScript is not typechecked.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const settle = async (n = 60) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const read = f => readFileSync(f, 'utf8');
const style = html => html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
function fakeDom() {
  const nodes = new Map();
  return id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, checked: false, disabled: false, innerHTML: '', textContent: '', className: '', min: '', options: [], dataset: {}, style: {},
    classList: {add() {}, remove() {}, toggle() {}}, focus() {}, scrollIntoView() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {}, appendChild() {}, replaceChildren() {},
    getContext: () => ({}), querySelectorAll: () => [], querySelector: () => null, elements: new Proxy({}, {get: (t, k) => (t[k] ??= {value: '', checked: false, focus() {}})})}); return nodes.get(id); };
}
function run(file, {fetch, search = '', pathname = '/'}) {
  const el = fakeDom(), html = read(file);
  const ctx = vm.createContext({Intl, Date, JSON, Math, URLSearchParams, Promise, setTimeout: f => setImmediate(f), structuredClone, console, crypto: {randomUUID: () => 'x'},
    location: {search, hash: '', href: '', pathname}, confirm: () => true, window: {addEventListener() {}}, addEventListener() {}, history: {replaceState() {}},
    document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({}), addEventListener() {}, title: ''}, fetch});
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(code, ctx);
  return {el, ctx, html};
}
const json = (body, status = 200) => ({ok: status < 400, status, json: async () => body});
const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});

// ---------- The shared practice box ----------
{
  const css = read('public/savage.css');
  assert.match(css, /Family and public screens: the design pass of Nov 14 \(issue #340\)/, 'this pass keeps its shared styles in one labeled block');
  assert.match(css, /html body \.swa-practice\{border:1px solid #C9CCD2;border-left:6px solid var\(--swa-red\);border-radius:0;/, 'a thin outline with the red bar on its left');
  assert.match(css, /html body \.swa-practice__name\{[^}]*text-transform:uppercase/, 'the session in caps');
  assert.match(css, /html body \.swa-practice__time\{[^}]*font-family:var\(--swa-display\)[^}]*font-size:var\(--swa-t-35\)/, 'the time larger under it');
  assert.match(css, /html body \.swa-day \.today\{[^}]*color:var\(--swa-red\)\}/, 'one red caps line when it is today');
  assert.match(css, /html body \.card\.dark \.swa-day \.today\{color:var\(--swa-red-on-dark\)\}/);
}

// ---------- Family home: who and what is next first; details fold away when everything is in order ----------
{
  const html = read('app/family/screen.html');
  // One order on a phone and a desk: next up and each wrestler's status, then what is due, the week, booking, contacts.
  const order = ['id="start"', 'id="nextUp"', 'id="summary"', 'id="payments"', 'id="week"', 'id="book"', 'id="contacts"', 'id="memberships"', 'id="purchases"'].map(s => html.indexOf('<section ' + s));
  assert.ok(order.every(i => i > 0), 'every section is there');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections come in the order a parent needs them');
  assert.doesNotMatch(style(html), /#nextUp::after/, 'no red glow on the dark card: red is the bar, the Today line and the button');
  const family = {email: 'pat@example.test', data: {parentName: 'Pat Example', phone: '555-0100', homeAddress: '20 Railroad St', homeCity: 'Huntington Station', homeState: 'NY', homeZip: '11746', emergencyContactName: 'Jordan Example', emergencyContactPhone: '555-0199',
    wrestlers: [{id: 'w-1', name: 'Sam Example', grade: '8', usawNumber: 'ABC1234', usawExpires: '2099-08-31', birthDate: '2012-04-18', allergies: 'None'}, {id: 'w-2', name: 'Alex Example', grade: '4', birthDate: '2016-02-02', allergies: 'Peanuts'}]},
    cards: {'w-1': {state: 'verified', number: 'ABC1234', expires: '2099-08-31'}}, revision: 1, updatedAt: today + 'T12:00:00Z'};
  const {el, ctx} = run('app/family/screen.html', {fetch: async url => url.startsWith('/api/family') ? json(family) : url === '/api/waiver' ? json({waiver: {id: 'v1', title: 'Waiver'}, signatures: [{id: 's1', current: true, wrestlerId: 'w-1'}]}) : url === '/api/orders' ? json({orders: [], cashBookings: []}) : url === '/api/scholarship' ? json({awards: []}) : json({})});
  await settle();
  const cards = el('savedDetails').innerHTML.split('<article class="kid"');
  const sam = cards.find(c => c.includes('Sam Example')), alex = cards.find(c => c.includes('Alex Example'));
  // Sam: card verified and waiver signed. The dates and the signed copy sit behind "Details"; "No membership" still shows.
  assert.match(sam, /<span class="pill ok">[\s\S]*?USA Wrestling card verified<\/span>/);
  assert.match(sam, /<details class="kid-more"><summary>Details<\/summary><ul class="status-lines"><li class="swa-caption">Current through Aug 31, 2099[\s\S]*View signed waiver<\/a><\/li><\/ul><p class="kid-safety quiet">Born Apr 18, 2012 · No allergies or medical notes<\/p><\/details>/);
  assert.match(sam.split('<details')[0], /<ul class="status-lines"><li>Not signed up for a membership yet\./, 'what needs the family stays in the open');
  // Alex: no card, waiver not signed, an allergy. Nothing of that is folded away.
  assert.match(alex.split('<details')[0], /Add the card number[\s\S]*Booking is blocked until it is signed[\s\S]*<p class="kid-safety"><b>Allergies or medical notes:<\/b> Peanuts/);
  assert.doesNotMatch(alex, /<details class="kid-more">/, 'nothing in order to fold away');
  // A card on file that can still be checked keeps its "Check my card" button in the open.
  vm.runInContext(`cards['w-1']={state:'current',number:'ABC1234',expires:'2099-08-31'};showSummary()`, ctx);
  assert.match(el('savedDetails').innerHTML.split('<details')[0], /Check my card<\/button>/);
}

// ---------- Choose training: a month with no practice left is one sentence and a jump to the next practice ----------
{
  const month = today.slice(0, 7), next = (() => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7); })();
  const programs = [{id: 'Intermediate', name: 'SWA Intermediate', description: '', grades: 'Grades 7–12', monthlyCents: 20000, walkInCents: 4000}];
  const asked = [];
  const {el, ctx, html} = run('app/register/screen.html', {search: '?plan=walkin', fetch: async url => {
    if (url.startsWith('/api/registration')) { const m = new URL('https://x.test' + url).searchParams.get('month') || month; asked.push(m);
      return json({today, now: '10:00', month: m, programs, onlineKinds: [], practices: m === next ? [{id: `Intermediate:${next}-03:18:00`, program: 'Intermediate', date: next + '-03', start: '18:00', end: '19:30'}, {id: `Intermediate:${next}-10:18:00`, program: 'Intermediate', date: next + '-10', start: '18:00', end: '19:30'}] : []}); }
    if (url === '/api/family') return json({data: {wrestlers: [{id: 'w-1', name: 'Sam Example', grade: '8'}]}});
    if (url === '/api/program-approvals') return json({approvals: []});
    return json({orders: []});
  }});
  await settle();
  vm.runInContext(`document.getElementById('program').value='Intermediate';update()`, ctx);
  const monthName = m => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'long'});
  assert.equal(el('calendarGrid').hidden, true, 'no grid of faded days');
  assert.equal(el('noPractices').hidden, false);
  assert.match(el('noPractices').innerHTML, new RegExp(`<p>No practices left in ${monthName(month)} for SWA Intermediate\\.</p><p class="next">Looking for the next practice…</p>$`));
  assert.equal(el('reviewButton').disabled, true, 'nothing to review without a practice');
  await settle();
  const nextDay = new Date(next + '-03T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric'});
  assert.match(el('noPractices').innerHTML, new RegExp(`<p class="next">Next: <strong>${nextDay}</strong></p><button type="button" class="button" data-jump="${next}-03">Go to ${monthName(next)}</button>$`));
  // Looking ahead uses the month picker's own call, one month at a time, and asks once.
  const calls = asked.length;
  vm.runInContext('update()', ctx); await settle();
  assert.equal(asked.length, calls, 'the answer is kept');
  // The jump opens that month on the day of the next practice, with its times.
  await vm.runInContext(`jumpTo('${next}-03')`, ctx); await settle();
  assert.equal(vm.runInContext('catalog.month', ctx), next);
  assert.equal(vm.runInContext('selectedDate', ctx), next + '-03');
  assert.equal(el('calendarGrid').hidden, false); assert.equal(el('noPractices').hidden, true);
  assert.match(el('practices').innerHTML, new RegExp(`data-slot="Intermediate:${next}-03:18:00"`));
  assert.equal(el('calendarAvailability').textContent, '2 scheduled practices for SWA Intermediate this month.');
  // The month is chosen in one row, and the review sits where the steps were.
  assert.match(html, /<div class="calendar-toolbar"><button type="button" id="prevMonth" aria-label="Previous month">←<\/button><label class="calendar-month-input"><span class="swa-sr">Month<\/span><select id="month"><\/select><\/label><button type="button" id="nextMonth" aria-label="Next month">→<\/button><\/div>/);
  assert.match(style(html), /html body main>section#review\{max-width:calc\(100% - 320px - var\(--swa-s-24\)\)\}/);
  assert.match(html, /<div id="noPractices" class="empty" role="status" aria-live="polite" hidden><\/div>/);
}
// If the months ahead cannot be read, the sentence stays and nothing is claimed about what is scheduled.
{
  let first = true;
  const {el, ctx} = run('app/register/screen.html', {fetch: async url => {
    if (url.startsWith('/api/registration')) { if (!first) return json({error: 'Unable to load registration options.'}, 500); first = false; return json({today, now: '10:00', month: today.slice(0, 7), programs: [{id: 'Intermediate', name: 'SWA Intermediate', monthlyCents: 20000, walkInCents: 4000}], onlineKinds: [], practices: []}); }
    if (url === '/api/family') return json({data: {wrestlers: [{id: 'w-1', name: 'Sam Example', grade: '8'}]}});
    if (url === '/api/program-approvals') return json({approvals: []});
    return json({orders: []});
  }});
  await settle();
  vm.runInContext(`document.getElementById('program').value='Intermediate';update()`, ctx); await settle();
  assert.match(el('noPractices').innerHTML, /<p>No practices left in \w+ for SWA Intermediate\.<\/p><p class="next">Choose another month above to see its practices\.<\/p>$/);
  assert.doesNotMatch(el('noPractices').innerHTML, /Nothing is scheduled|Next:/);
}
// With nothing scheduled in the six months after it, the page says so and points to Messages.
{
  const {el, ctx} = run('app/register/screen.html', {fetch: async url => {
    if (url.startsWith('/api/registration')) return json({today, now: '10:00', month: new URL('https://x.test' + url).searchParams.get('month') || today.slice(0, 7), programs: [{id: 'Intermediate', name: 'SWA Intermediate', monthlyCents: 20000, walkInCents: 4000}], onlineKinds: [], practices: []});
    if (url === '/api/family') return json({data: {wrestlers: [{id: 'w-1', name: 'Sam Example', grade: '8'}]}});
    if (url === '/api/program-approvals') return json({approvals: []});
    return json({orders: []});
  }});
  await settle();
  vm.runInContext(`document.getElementById('program').value='Intermediate';update()`, ctx); await settle();
  assert.match(el('noPractices').innerHTML, /Nothing is scheduled for the six months after it yet\. Message the academy to ask when practices start\.<\/p><a class="button" href="\/inbox">Message the academy<\/a>$/);
}

// ---------- Private lessons: no price line without a price; an empty month is a sentence ----------
{
  const {ctx, html} = run('app/lesson/screen.html', {fetch: async () => json({}, 500)});
  await settle();
  assert.equal(vm.runInContext('groupPrices()', ctx), '', 'never a bare "per wrestler"');
  vm.runInContext(`data={formats:[{id:'partner',name:'Partner lesson',cents:4500},{id:'small-group',name:'Small-group lesson',cents:3500}]}`, ctx);
  assert.equal(vm.runInContext('groupPrices()', ctx), 'Partner $45.00 · Small-group $35.00 per wrestler');
  assert.equal(vm.runInContext(`monthHtml({lead:0,days:[{date:'2026-11-01',items:[],holidays:[]},{date:'2026-11-02',items:[],holidays:['A holiday'],today:true}]},'one')`, ctx), '', 'no grid for a month with no open time');
  assert.match(vm.runInContext(`noTimes('2026-11')`, ctx), /^<div class="empty"><svg[\s\S]*<p>No open times in November\. Try the next month, or switch to List to see every open time\.<\/p><\/div>$/);
  assert.match(vm.runInContext(`monthHtml({lead:0,days:[{date:'2026-11-01',items:[{id:'o1',date:'2026-11-01',start:'12:00',end:'13:00',coach:'Coach Dana',capacity:1}],holidays:[]}]},'one')`, ctx), /<div class="cal-day"><h3>/, 'a month with an open time is the grid');
  assert.match(style(html), /main\{max-width:var\(--swa-width-narrow\)/, 'a form keeps the form width on a desk');
  assert.match(html, /<span class="k">Each wrestler<\/span><span class="v">\$\{money\(review\.cents\)\} <small>per wrestler/, 'the figure is the price; "per wrestler" sits under it');
}

// ---------- Booking: a session that is gone gets a card with the way back ----------
{
  const {el} = run('app/booking/screen.html', {search: '?type=event&id=gone', fetch: async url => url === '/api/family' ? json({data: {wrestlers: [{id: 'w-1', name: 'Sam Example', grade: '8'}]}}) : json({today, events: [], liveClasses: [], privateFormats: [], programs: []})});
  await settle();
  assert.equal(el('gone').hidden, false);
  assert.equal(el('goneText').textContent, 'This session is no longer available. Choose another one from the calendar.');
  assert.equal(el('status').textContent, '', 'not a lone line under the title');
  assert.match(read('app/booking/screen.html'), /<section id="gone" hidden><div class="empty"><svg[\s\S]*?<p id="goneText"><\/p><a class="button" href="\/calendar">See the calendar<\/a><\/div><\/section>/);
}

// ---------- Messages: an empty conversation is an empty state ----------
{
  const {el} = run('app/inbox/screen.html', {fetch: async () => json({notices: [], announcements: [], thread: [], unread: 0})});
  await settle();
  assert.match(el('announcements').innerHTML, /^<div class="empty"><svg[\s\S]*<p>No announcements yet\./);
  assert.match(el('thread').innerHTML, /^<div class="empty"><svg[\s\S]*<p>No messages yet\. Questions about schedules, payments or your wrestler\? Write to the academy here\.<\/p><\/div>$/);
}

// ---------- Calendar: the month list starts at this month ----------
{
  const {ctx} = run('app/calendar/screen.html', {fetch: async () => json({}, 500)});
  const values = s => [...s.matchAll(/<option value="(\d{4}-\d{2})"/g)].map(m => m[1]);
  const pick = (key, from) => { vm.runInContext(`setNamedMonth(document.getElementById('month'),'${key}','${from}')`, ctx); return values(vm.runInContext(`document.getElementById('month').innerHTML`, ctx)); };
  let list = pick('2026-11', '2026-11');
  assert.equal(list[0], '2026-11', 'not a year in the past'); assert.equal(list.at(-1), '2027-11');
  list = pick('2027-02', '2026-11');
  assert.equal(list[0], '2026-11', 'looking ahead, the list still starts at this month'); assert.ok(list.includes('2027-02'));
  list = pick('2026-09', '2026-11');
  assert.equal(list[0], '2026-09', 'someone who went back with the arrow keeps that month in the list');
  assert.match(read('app/calendar/screen.html'), /'><h3>'\+shortDay\(day\)\+todayTag\(day\)\+'<\/h3>'/, 'a phone\'s day cards read "Mon, Nov 9"');
}

// ---------- Account security: no "backup" button before there is a first authenticator ----------
{
  const open = async state => { const {el} = run('app/security/screen.html', {fetch: async () => json({email: 'pat@example.test', role: 'family', required: false, destination: '/family', ...state})}); await settle(); return el; };
  let el = await open({strong: true, factors: []});
  assert.equal(el('enroll').hidden, false); assert.equal(el('backupFactor').hidden, true, 'one button, not two that do the same thing');
  assert.equal(el('backupNote').hidden, true);
  el = await open({strong: true, factors: [{id: 'f1', name: 'Phone'}]});
  assert.equal(el('backupFactor').hidden, false, 'a backup is offered once there is a first one'); assert.equal(el('backupNote').hidden, false);
  el = await open({strong: true, factors: [{id: 'f1', name: 'Phone'}, {id: 'f2', name: 'Tablet'}]});
  assert.equal(el('backupFactor').hidden, true);
  assert.match(style(read('app/security/screen.html')), /main\{max-width:560px;margin:0 auto/, 'simple and centered');
  assert.match(style(read('app/login/screen.html')), /main\{max-width:440px;margin:0 auto/);
}

// ---------- Reading pages: about 70 characters wide, and the terms' table stacks on a phone ----------
{
  for (const f of ['app/membership-terms/screen.html', 'app/help/screen.html']) assert.match(style(read(f)), /section p,section li\{max-width:70ch;line-height:1\.6\}/, f);
  const terms = read('app/membership-terms/screen.html');
  assert.match(style(terms), /@media \(max-width:600px\)\{[\s\S]*table,tbody,tr,html body main td\{display:block\}/);
  assert.match(terms, /<nav class="toc" aria-label="On this page"><a href="#options">How to train<\/a><a href="#refunds">Refunds<\/a><a href="#membership">Monthly membership<\/a><a href="#contact">Contact<\/a><\/nav>/);
  for (const id of ['options', 'refunds', 'membership', 'contact']) assert.match(terms, new RegExp(`<section id="${id}">`));
  // The signing page says what the section is once everyone has signed.
  assert.match(read('app/waiver/screen.html'), /\$\('signHeading'\)\.textContent=unsigned\.length\?'Read and sign':'The '\+DOC\.name;/);
}
console.log('Passed: family home order and folded details, the practice box, empty months on Choose training and lessons, a gone session, empty messages, the calendar month list, account security, reading pages.');
