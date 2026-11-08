// Issue #127: what families, coaches and the owner read is plain, complete and in one date format. Runs page scripts
// with a fake DOM (inline JavaScript is not typechecked) and checks family and coach pages for builder language.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function page(file, {fetch, search = '', extra = {}}) {
  const nodes = new Map();
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, checked: false, disabled: false, innerHTML: '', textContent: '', href: '', style: {}, dataset: {},
      replaceChildren() {}, focus() {}, scrollIntoView() {}, setAttribute() {}, removeAttribute() {}, querySelector() { return null; }, classList: {add() {}, remove() {}, toggle() {}}});
    return nodes.get(id);
  };
  const ctx = vm.createContext({Intl, Date, JSON, URLSearchParams, Promise, setTimeout, console, location: {search, href: '', pathname: '/' + file.split('/')[1]},
    document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({})}, fetch, confirm: () => true, ...extra});
  const html = readFileSync(file, 'utf8');
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(code, ctx);
  return {el, ctx, html};
}
const settle = () => new Promise(r => setImmediate(r));
const reply = body => ({ok: true, status: 200, json: async () => body});

// Coach home leads with today's practices and puts booked lessons before open times (issue #133).
{
  const fetch = async path => reply(path === '/api/roster'
    ? {sessions: [{title: 'SWA Intermediate', start: '18:00', end: '19:30', entries: [{}, {}, {}, {}, {}], checkedIn: 3}]}
    : {name: 'Coach Dana', programs: ['Intermediate'], openings: [{id: 'o2', date: '2026-11-10', start: '09:30', end: '10:30', format: null, capacity: 1, spotsLeft: 1, hosted: null, roster: []},
        {id: 'o1', date: '2026-11-09', start: '15:00', end: '16:00', format: 'one-on-one', formatName: 'One-on-one lesson', capacity: 1, spotsLeft: 0, hosted: null, roster: [{wrestler: 'Sam Example', parent: 'Pat Example', status: 'paid'}]}]});
  const {el, html} = page('app/coach/screen.html', {fetch});
  await settle(); await settle();
  assert.match(el('sessions').innerHTML, /6:00 PM<\/span><span class="name">SWA Intermediate<\/span><span class="count">3 of 5 checked in/);
  assert.ok(el('slots').innerHTML.indexOf('Booked:') < el('slots').innerHTML.indexOf('Open for families'), 'booked lessons come first');
  assert.ok(html.indexOf('Today on the mat') < html.indexOf('Add a one-hour opening'), 'today comes before the opening form');
  const empty = page('app/coach/screen.html', {fetch: async p => reply(p === '/api/roster' ? {sessions: []} : {name: 'C', programs: [], openings: []})});
  await settle(); await settle();
  assert.match(empty.el('sessions').innerHTML, /Nothing is on the mat for your programs today/);
}

// Coach home: no "workspace", no claim that booking is "still being connected", dates and times as people say them.
{
  const {el, html} = page('app/coach/screen.html', {fetch: async () => reply({name: 'Coach Dana', programs: ['Intermediate'], openings: [
    {id: 'o1', date: '2026-11-09', start: '15:00', end: '16:00', format: 'one-on-one', formatName: 'One-on-one lesson', capacity: 1, spotsLeft: 0, hosted: null, roster: [{wrestler: 'Sam Example', parent: 'Pat Example', phone: '555-0100', email: 'pat@example.test', status: 'paid'}]},
    {id: 'o2', date: '2026-11-10', start: '09:30', end: '10:30', format: null, capacity: 1, spotsLeft: 1, hosted: null, roster: []}]})});
  await settle();
  assert.equal(el('heading').textContent, 'Coach Dana', 'the coach\'s name alone, so it fits a phone (issue #173)');
  assert.equal(el('programs').textContent, 'You coach SWA Intermediate.');
  const slots = el('slots').innerHTML;
  assert.match(slots, /<b>Mon, Nov 9<\/b><p>3:00 PM–4:00 PM<\/p>/);
  assert.match(slots, /<b>Tue, Nov 10<\/b><p>9:30 AM–10:30 AM<\/p>/);
  assert.match(slots, /Booked: One-on-one lesson with Sam Example/);
  assert.doesNotMatch(slots, /2026-11-09|15:00/);
  assert.doesNotMatch(html, /workspace|being connected/i);
}

// Account security: a signed-in person goes back to their own home, and no role label is shown.
for (const [role, destination, label] of [['family', '/family', 'Back to your family account'], ['coach', '/coach', 'Back to coach home'], ['owner', '/', 'Back to the owner dashboard']]) {
  const {el} = page('app/security/screen.html', {fetch: async () => reply({email: 'x@example.test', role, strong: role !== 'family', required: role !== 'family', destination, factors: []})});
  await settle();
  assert.equal(el('identity').textContent, 'x@example.test', 'no lowercase role label');
  assert.equal(el('home').href, destination); assert.equal(el('home').textContent, label);
  assert.doesNotMatch(el('explain').textContent + el('continue').textContent, /workspace/);
  if (role === 'family') assert.equal(el('status').textContent, '', 'nothing to do, so no status line');
}

// Calendar: the status line only shows real problems, and Refresh stays because the error tells people to use it.
{
  const catalog = {month: '2026-11', today: '2026-11-06', programs: [], practices: [], events: [], privateFormats: [], liveClasses: []};
  let ok = true;
  const {el, html} = page('app/calendar/screen.html', {fetch: async () => ok ? reply(catalog) : {ok: false, json: async () => ({})}});
  await settle();
  assert.equal(el('status').textContent, '');
  ok = false; await el('reload').onclick(); await settle();
  assert.equal(el('status').textContent, 'The schedule could not be loaded. Choose Refresh to try again.');
  assert.match(html, /id="reload">Refresh</);
  assert.doesNotMatch(html, /in testing|Saved schedule loaded/);
}

// Approvals: real singular and plural, and readable request times.
{
  const request = (id, status) => ({id, status, wrestler_name: 'Sam', current_name: 'Sam', grade: '8', current_grade: '8', parent_name: 'Pat', email: 'p@x', phone: '', created_at: '2026-11-06T19:13:26Z', updated_at: 't'});
  for (const [list, text] of [[[], 'No requests are waiting for you.'], [[request('a', 'pending')], '1 request is waiting for you.'], [[request('a', 'pending'), request('b', 'pending')], '2 requests are waiting for you.']]) {
    const {el} = page('app/approvals/screen.html', {fetch: async () => reply({requests: list}), extra: {ApprovalChat: {open() {}}}});
    await settle();
    assert.equal(el('status').textContent, text);
    if (list.length) assert.match(el('requests').innerHTML, /Requested Fri, Nov 6 · 2:13 PM/);
  }
}

// Private lessons: the review reads "Mon, Nov 9 · 3:00 PM–4:00 PM" and adds no empty note when online payment is closed.
{
  const {el, ctx} = page('app/lesson/screen.html', {fetch: async url => reply(url === '/api/lessons' ? {formats: [], openings: []} : {data: {wrestlers: []}})});
  await settle();
  vm.runInContext("review={title:'One-on-one lesson',coach:'Coach Dana',dates:['2026-11-09'],start:'15:00',end:'16:00',wrestler:'Sam',cents:6000,message:'',paymentsEnabled:false};render()", ctx);
  assert.match(el('summary').innerHTML, /Mon, Nov 9 · 3:00 PM–4:00 PM/);
  assert.doesNotMatch(el('summary').innerHTML, /<p class="muted"><\/p>/);
  assert.equal(el('notOpen').hidden, false);
}

// Messages: notices and replies carry "Fri, Nov 6 · 2:13 PM".
{
  const {el} = page('app/inbox/screen.html', {fetch: async () => reply({notices: [{id: 'n', subject: 'Lesson booked', body: 'b', at: '2026-11-06T19:13:00Z', read: true}], announcements: [], thread: []})});
  await settle();
  assert.match(el('notices').innerHTML, /<span class="kind">Notice<\/span><span class="subj">Lesson booked<\/span><span class="muted when">Fri, Nov 6 · 2:13 PM<\/span>/);
}

// Family and coach pages carry no builder language.
const familyAndCoach = ['family', 'register', 'booking', 'calendar', 'lesson', 'inbox', 'pass', 'waiver', 'wrestler', 'scholarship', 'security', 'coach', 'help', 'help/coach', 'membership-terms', 'login']
  .map(p => `app/${p}/screen.html`);
for (const file of familyAndCoach) {
  const text = readFileSync(file, 'utf8');
  for (const phrase of [/\bdraft\b/i, /workspace/i, /being connected/i, /Reload saved profile/, /Saved online/, /Ready for your first save/, /Review only/, /in testing/i, /\w\(s\)/, /'Ready\.'/, /decision #\d+|\(#\d+\)/])
    assert.doesNotMatch(text, phrase, `${file} says ${phrase}`);
}
// The lesson notices, review and booking pages no longer print the 24-hour clock.
assert.doesNotMatch(readFileSync('lib/notify.ts', 'utf8'), /at \$\{p\.start/);

// Owner pages explain settings in words instead of showing setting names, API paths or issue numbers.
for (const file of ['app/lesson-settings/screen.html', 'app/messages/screen.html', 'app/site-health/screen.html', 'app/payment-setup/screen.html', 'lib/launch-checklist.ts'])
  assert.doesNotMatch(readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/settings\.[A-Z_]+|[A-Z_]+\?: string/g, ''), /CHECKOUT_KINDS|STRIPE_TEST_WEBHOOK_SECRET|\/api\/health|#87|decision #/, file);

console.log('Clear wording tests passed');
