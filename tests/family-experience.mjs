// Issue #132: the family-facing pages. Welcome page for visitors, the family home's guided start and "Next up",
// plan cards on Register, lessons that say first when nothing can be booked, event booking status and Messages.
// Page scripts run with a fake DOM, because inline JavaScript is not typechecked.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const json = (body, ok = true) => ({ok, status: ok ? 200 : 400, json: async () => body});
function page(file, {fetch, search = '', hidden = []}) {
  const nodes = new Map();
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: hidden.includes(id), checked: false, disabled: false, innerHTML: '', textContent: '', className: '', href: '', style: {}, dataset: {},
      elements: {parentName: {value: '', focus() { el('__focus').textContent = 'parentName'; }}, phone: {value: ''}},
      replaceChildren(...items) { this.value = items[0]?.value ?? ''; }, focus() {}, scrollIntoView() {}, setAttribute() {}, querySelector() { return null; }, classList: {add() {}, remove() {}, toggle() {}}});
    return nodes.get(id);
  };
  const calls = [];
  const ctx = vm.createContext({Intl, Date, JSON, URLSearchParams, Promise, setTimeout: f => setImmediate(f), structuredClone, console, crypto: {randomUUID: () => 'new-id'},
    location: {search, href: '', assign() {}}, confirm: () => true,
    document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({})},
    fetch: async (url, options) => { calls.push({url, body: options?.body ? JSON.parse(options.body) : null}); return fetch(url, options); }});
  const html = readFileSync(file, 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], ctx);
  return {el, ctx, html, calls};
}

// ---------- Welcome page (C3) ----------
{
  const route = readFileSync('app/route.ts', 'utf8');
  assert.match(route, /auth\.user\?'\/family':'\/welcome'/, 'signed-out visitors go to /welcome');
  assert.match(route, /role==='coach'\?'\/coach'/, 'coaches still go to their own home');
  const welcomeRoute = readFileSync('app/welcome/route.ts', 'utf8');
  assert.doesNotMatch(welcomeRoute, /strongAccount|ownerIdentity/, 'the welcome page is public');
  assert.match(welcomeRoute, /X-Content-Type-Options':'nosniff'/); assert.match(welcomeRoute, /frame-ancestors 'self'/);

  const programs = [
    {id: 'Elementary', name: 'SWA Development', grades: '', description: '', monthlyCents: 20000, annualCents: 240000, walkInCents: 4000},
    {id: 'Intermediate', name: 'SWA Intermediate', grades: 'Grades 7–12', description: 'Teens', monthlyCents: 20000, annualCents: 240000, walkInCents: 4000},
    {id: 'Advanced', name: 'SWA Advance', grades: 'Grades 7–12 · Coach approval required', description: '', monthlyCents: 22550, annualCents: 270600, walkInCents: null}];
  // Near the end of November the next sessions are in December.
  const months = {
    '': {month: '2026-11', today: '2026-11-30', programs, practices: [{id: 'Elementary:2026-11-30:18:00', program: 'Elementary', date: '2026-11-30', start: '18:00', end: '19:30'}, {id: 'Intermediate:2026-11-30:18:00', program: 'Intermediate', date: '2026-11-30', start: '18:00', end: '19:30'}], liveClasses: [], events: []},
    '?month=2026-12': {month: '2026-12', today: '2026-11-30', programs, practices: [{id: 'Advanced:2026-12-01:15:00', program: 'Advanced', date: '2026-12-01', start: '15:00', end: '16:30'}], liveClasses: [{id: 'fnl', name: 'Friday Night Live', date: '2026-12-04', start: '16:00'}], events: [{id: 'c', name: 'Winter camp', type: 'Camp', dates: ['2026-12-20', '2026-12-21']}]}};
  const {el, calls, html} = page('app/welcome/screen.html', {fetch: async url => json(months[url.replace('/api/public-schedule', '')])});
  await settle();
  assert.deepEqual(calls.map(c => c.url), ['/api/public-schedule', '/api/public-schedule?month=2026-12'], 'this month and next month');
  const cards = el('programs').innerHTML;
  assert.match(cards, /<span class="grades" style="[^"]*">Grades K–6<\/span><h3>SWA Development<\/h3>/, 'grades fall back to the program rules, shown as a label above the name');
  assert.doesNotMatch(cards, /class="swatch"/, 'no colour square that looks like a checkbox (issue #171)');
  assert.match(cards, /\$200 a month for a 12-month membership, or \$2,400 paid upfront/);
  assert.match(cards, /\$40 for a single walk-in practice/);
  // Weekly practice times on each card, from the published practices (issue #180).
  assert.match(cards, /SWA Development<\/h3><span class="times">Mon · 6:00–7:30 PM<\/span>/);
  assert.match(cards, /SWA Advance<\/h3><span class="times">Tue · 3:00–4:30 PM<\/span>/, 'next month\'s practices count too');
  assert.match(cards, /\$225\.50 a month/, 'cents shown when the price has them');
  assert.equal((cards.match(/needs coach approval/g) || []).length, 1, 'only SWA Advance says coach approval');
  assert.match(cards, /">Grades 7–12<\/span><h3>SWA Advance<\/h3>/, 'approval is said once, in the note');
  const week = el('week').innerHTML;
  assert.match(week, /Mon, Nov 30<span>6:00 PM<\/span>[\s\S]*SWA Development practice[\s\S]*SWA Intermediate practice/, 'same-time sessions share a row');
  assert.match(week, /Tue, Dec 1<span>3:00 PM<\/span>[\s\S]*SWA Advance practice/, 'next month is included');
  assert.match(week, /Fri, Dec 4<span>4:00 PM[\s\S]*Friday Night Live/);
  assert.match(week, /Sun, Dec 20[\s\S]*Winter camp \(camp\)/);
  assert.doesNotMatch(week, /2026-1|18:00/);
  assert.match(html, /href="\/login\?mode=signup">Join the academy/); assert.match(html, /href="\/login">Sign in/);
  assert.match(html, /\/brand\/savage-logo-256\.png/);
  assert.equal(vm.runInContext("nextMonth('2026-12')", page('app/welcome/screen.html', {fetch: async () => json({}, false)}).ctx), '2027-01');
}

// ---------- Family home (H1, H2) ----------
const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const ny = k => new Date(Date.now() + k * 864e5).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
async function family({profile, updatedAt, cards = {}, waiver = {waiver: null, signatures: [], exceptions: {}}, orders = [], upcoming = [], editorHidden = false}) {
  return page('app/family/screen.html', {hidden: editorHidden ? [] : ['summary'], fetch: async url => {
    if (url === '/api/family') return json({email: 'pat@example.test', data: structuredClone(profile), revision: 1, updatedAt, cards});
    if (url === '/api/waiver') return json(waiver);
    if (url === '/api/orders') return json({orders, checkoutOpen: false});
    if (url === '/api/scholarship') return json({awards: []});
    if (url.startsWith('/api/wrestler?id=')) { const id = decodeURIComponent(url.split('=')[1]); const w = profile.wrestlers.find(x => x.id === id); return json({id, name: w.name, upcoming: upcoming.filter(s => s.wrestlerId === id)}); }
    return json({});
  }});
}
// Brand-new family: the guided start leads, nothing is done, and the open profile form keeps the one red button.
{
  const {el, html} = await family({profile: {parentName: '', phone: '', wrestlers: []}, updatedAt: null});
  await settle();
  assert.equal(el('start').hidden, false); assert.equal(el('startCount').textContent, '0 of 3 done', 'no waiver step while the academy has no waiver');
  const steps = el('startSteps').innerHTML;
  assert.deepEqual([...steps.matchAll(/data-step="(\w+)"/g)].map(m => m[1]), ['details', 'wrestler', 'training']);
  assert.match(steps, /class="step current" data-step="details"/);
  assert.doesNotMatch(steps, /primary/, 'Save family profile is the main action while the form is open');
  // Only the current step carries a button; later steps are listed quietly (issue #141).
  assert.match(steps, /data-step="details"[\s\S]*Add your details<\/button>/); assert.doesNotMatch(steps, /Add a wrestler<\/button>|href="\/register">Choose training/);
  assert.match(el('startLede').textContent, /^Three steps /, 'the step count in the text matches the list');
  for (const id of ['memberships', 'purchaseHistory', 'yourData', 'billingExample', 'membershipsLink', 'purchasesLink']) assert.equal(el(id).hidden, true, id + ' waits until there is something to show');
  assert.equal(el('nextUp').hidden, true); assert.equal(el('editor').hidden, false); assert.equal(el('status').textContent, '');
  assert.equal(el('hello').textContent, 'Welcome');
  // Account things live in one menu, not as four buttons at the top.
  const menu = html.match(/<details class="account-menu" id="accountMenu">[\s\S]*?<\/details>/)[0];
  for (const label of ['Help', 'Account security', 'Change password', 'Sign out']) assert.match(menu, new RegExp('>' + label + '<'));
  assert.equal((html.match(/href="\/help"/g) || []).length, 1, 'Help appears once, in the menu');
  assert.doesNotMatch(html, /class="brand"|>SAVAGE</, 'no page-drawn logo or brand header');
}
// Saved details and a wrestler without a card; the academy has a waiver: step 2 is next and is the main action.
{
  const profile = {parentName: 'Pat Example', phone: '555-0100', wrestlers: [{id: 'w-1', name: 'Sam Example', grade: 'K'}]};
  const {el, ctx} = await family({profile, updatedAt: '2026-11-01T12:00:00Z', editorHidden: true, waiver: {waiver: {id: 'v1', title: 'Participation waiver'}, signatures: [], exceptions: {}}});
  await settle();
  assert.equal(el('startCount').textContent, '1 of 4 done');
  const steps = el('startSteps').innerHTML;
  assert.match(steps, /class="step done" data-step="details"/);
  assert.match(steps, /class="step current" data-step="wrestler"[\s\S]*Sam Example needs a current USA Wrestling card[\s\S]*class="primary" onclick="startWrestler\(\)">Add the card/);
  assert.match(steps, /data-step="waiver"[\s\S]*Sign the Participation waiver for Sam Example/);
  assert.doesNotMatch(steps, /href="\/waiver/, 'the waiver step gets its button once it is the current step');
  assert.match(el('startLede').textContent, /^Four steps /);
  assert.equal(el('memberships').hidden, false, 'a saved family sees its memberships');
  assert.equal((steps.match(/primary/g) || []).length, 1, 'one main button');
  assert.equal(el('hello').textContent, 'Hi, Pat');
  const details = el('savedDetails').innerHTML;
  assert.match(details, /Sam Example<\/h3><span class="muted">Kindergarten/, 'Kindergarten is stored as "K" and shown in words');
  assert.match(details, /No USA Wrestling card[\s\S]*Waiver not signed[\s\S]*No membership/);
  assert.match(details, /href="\/wrestler\?id=w-1">Wrestler view[\s\S]*href="\/pass\?wrestler=w-1">Entry pass/);
  vm.runInContext('startDetails()', ctx);
  assert.equal(el('editor').hidden, false); assert.equal(el('__focus').textContent, 'parentName');
  assert.match(el('status').textContent, /Add your name and phone number/);
}
// Set up: card verified, waiver signed, a paid membership and a booked session. "Next up" leads with the entry pass.
{
  const profile = {parentName: 'Pat Example', phone: '555-0100', wrestlers: [{id: 'w-1', name: 'Sam Example', grade: '8', usawNumber: 'AB-1234', usawExpires: ny(300)}]};
  const {el} = await family({profile, updatedAt: '2026-11-01T12:00:00Z', editorHidden: true,
    cards: {'w-1': {state: 'verified', number: 'AB-1234', expires: ny(300)}},
    waiver: {waiver: {id: 'v1', title: 'Participation waiver'}, signatures: [{id: 's1', wrestlerId: 'w-1', current: true}], exceptions: {}},
    orders: [{id: 'o1', kind: 'annual', program: 'Intermediate', item_id: 'Intermediate', item_label: 'SWA Intermediate', wrestler_id: 'w-1', wrestler_name: 'Sam Example', dates: [], amount_cents: 240000, status: 'paid', paid_at: today + 'T12:00:00Z', term_start: ny(-1), term_end: ny(360)}],
    upcoming: [{wrestlerId: 'w-1', date: '2026-11-10', start: '18:00', end: '19:30', title: 'SWA Intermediate', type: 'practice', why: 'Membership'},
      {wrestlerId: 'w-1', date: '2026-11-09', start: '15:00', end: '16:00', title: 'One-on-one lesson with Coach Dana', type: 'lesson', why: 'Paid'}]});
  await settle();
  assert.equal(el('start').hidden, true, 'no guided start once everything is done');
  assert.equal(el('nextUp').hidden, false);
  const next = el('nextUpBody').innerHTML;
  assert.match(next, /class="next-when">Mon, Nov 9 · 3:00 PM<\/p>/, 'the soonest session first, in the shared date format');
  assert.match(next, /One-on-one lesson with Coach Dana<\/strong> · Sam Example/);
  assert.match(next, /class="button primary" href="\/pass\?wrestler=w-1">Show entry pass/);
  assert.match(next, /Tue, Nov 10 · 6:00 PM<\/b><span>SWA Intermediate practice · Sam Example/);
  assert.match(el('savedDetails').innerHTML, /USA Wrestling card verified[\s\S]*Waiver signed[\s\S]*Member<\/span> SWA Intermediate, 12-month membership through/);
}
// Set up but nothing booked in the next three weeks: say so plainly.
{
  const profile = {parentName: 'Pat', phone: '1', wrestlers: [{id: 'w-1', name: 'Sam', grade: '8', usawNumber: 'AB-1234', usawExpires: ny(300)}]};
  const {el} = await family({profile, updatedAt: 't', editorHidden: true, orders: [{id: 'o', kind: 'walkin', wrestler_id: 'w-1', wrestler_name: 'Sam', item_label: 'Walk-in', dates: [], amount_cents: 4000, status: 'paid'}]});
  await settle();
  assert.equal(el('start').hidden, true); assert.equal(el('nextUp').hidden, false);
  assert.match(el('nextUpBody').innerHTML, /Nothing is booked for the next three weeks/);
}

// ---------- Register plan cards (M7) ----------
{
  const html = readFileSync('app/register/screen.html', 'utf8'), script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotMatch(html, /<select id="plan"/, 'no plan dropdown');
  for (const k of ['monthly', 'annual', 'walkin']) assert.match(html, new RegExp(`<input type="radio" name="planChoice" id="plan-${k}" value="${k}"`));
  assert.match(html, /<details class="included" id="included"><summary>What’s included<\/summary><p>Includes every scheduled practice/, 'the policy paragraph sits behind a disclosure');
  const line = start => { const i = script.indexOf(start); assert.ok(i >= 0, start); return script.slice(i, script.indexOf('\n', i)); };
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {value: '', textContent: '', checked: false}); return nodes.get(id); };
  const ctx = {Intl, $: el}; vm.runInNewContext(line('const money=') + '\n' + line('function choosePlan') + '\n' + line('function renderPlanCards'), ctx);
  el('plan').value = 'monthly';
  ctx.renderPlanCards({monthlyCents: 20000, annualCents: 240000, walkInCents: 4000});
  assert.equal(el('planPrice-monthly').textContent, '$200.00 a month'); assert.equal(el('planTerm-monthly').textContent, '12 monthly payments · $2,400.00 total');
  assert.equal(el('planPrice-annual').textContent, '$2,400.00'); assert.equal(el('planPrice-walkin').textContent, '$40.00');
  assert.equal(el('plan-monthly').checked, true); assert.equal(el('plan-walkin').checked, false);
  ctx.renderPlanCards({monthlyCents: null, annualCents: null, walkInCents: 4000});
  assert.equal(el('planPrice-monthly').textContent, 'Price to be set by the academy'); assert.equal(el('planTerm-monthly').textContent, '12 monthly payments');
  let changed = 0; el('plan').onchange = () => changed++;
  ctx.choosePlan('walkin'); assert.equal(el('plan').value, 'walkin'); assert.equal(changed, 1, 'a card choice runs the same update as before');
}

// ---------- Lessons (M2) ----------
const lessonPage = (lessons, wrestlers = [{id: 'w', name: 'Sam'}]) => page('app/lesson/screen.html', {fetch: async url => json(url === '/api/lessons' ? lessons : {data: {wrestlers}})});
const formats = [{id: 'one-on-one', name: 'One-on-one lesson', description: 'd', cents: 6000}, {id: 'partner', name: 'Partner lesson', description: 'd', cents: null}];
{
  const {el} = lessonPage({formats, openings: []}); await settle();
  assert.equal(el('closed').hidden, false); assert.equal(el('closedHeading').textContent, 'No open lesson times right now');
  assert.match(el('closedText').textContent, /No coach has open lesson times right now/);
  assert.match(readFileSync('app/lesson/screen.html', 'utf8'), /<a class="button primary" href="\/inbox" id="messageAcademy">Message the academy<\/a>/);
  assert.equal(el('stepType').hidden, true); assert.equal(el('stepWrestler').hidden, true); assert.equal(el('stepTime').hidden, true);
  assert.equal(el('status').textContent, '');
}
{
  const {el} = lessonPage({formats: formats.map(f => ({...f, cents: null})), openings: [{id: 'o', date: '2026-11-09', start: '15:00', end: '16:00', coach: 'Coach Dana', coachKey: 'k'}]}); await settle();
  assert.equal(el('closed').hidden, false); assert.match(el('closedText').textContent, /can’t be booked online yet/);
}
{
  const {el} = lessonPage({formats, openings: []}, []); await settle();
  assert.equal(el('closedHeading').textContent, 'Add your wrestler first'); assert.equal(el('addWrestler').hidden, false);
}
{
  const {el, ctx} = lessonPage({formats, openings: [{id: 'o', date: '2026-11-09', start: '15:00', end: '16:00', coach: 'Coach Dana', coachKey: 'k'}]}); await settle();
  assert.equal(el('closed').hidden, true); assert.equal(el('stepType').hidden, false);
  assert.match(el('formats').innerHTML, /One-on-one lesson[\s\S]*\$60\.00 per lesson/);
  assert.doesNotMatch(el('formats').innerHTML, /Partner lesson|Ask the academy/, 'lesson types not bookable online are hidden');
  assert.equal(vm.runInContext('format', ctx), 'one-on-one', 'the only lesson type is already chosen');
  assert.match(el('times').innerHTML, /Mon, Nov 9[\s\S]*3:00 PM–4:00 PM/);
}

// ---------- Event booking (M3) ----------
async function booking({orders = [], entries = []}) {
  const catalog = {month: '2026-11', today: '2026-11-06', programs: [], practices: [], liveClasses: [], privateFormats: [], events: [{id: 'camp', name: 'Winter camp', type: 'Camp', dates: ['2026-11-16', '2026-11-17'], cents: 16000, dayCents: 9000, gradeRange: '', description: ''}]};
  const p = page('app/booking/screen.html', {search: '?type=event&id=camp', fetch: async url => json(url === '/api/family' ? {data: {wrestlers: [{id: 'w-1', name: 'Sam Example', grade: 'K'}]}} : url === '/api/orders' ? {orders} : url === '/api/waitlist' ? {entries} : catalog)});
  await settle(); p.el('wrestler').value = 'w-1'; vm.runInContext('showWrestlerStatus()', p.ctx); return p;
}
{
  const {el, html} = await booking({});
  assert.equal(el('heading').textContent, 'Winter camp', 'the heading is the event name'); assert.equal(el('kind').textContent, 'Camp');
  assert.equal(el('description').textContent, 'Mon, Nov 16 · Tue, Nov 17 · $160.00');
  assert.equal(el('wrestlerStatus').textContent, 'Sam Example is not registered yet.');
  assert.doesNotMatch(html, /← Calendar|Review only/, 'no own back link and no disclaimer first');
  assert.equal((html.match(/Online payment isn’t open yet/g) || []).length, 1, 'payment is explained once, at review');
}
{
  const {el} = await booking({orders: [{kind: 'event', item_id: 'camp', wrestler_id: 'w-1', status: 'paid', dates: ['2026-11-16', '2026-11-17']}]});
  assert.equal(el('wrestlerStatus').textContent, 'Sam Example is already registered. You don’t need to book again.'); assert.match(el('wrestlerStatus').className, /ok/);
}
{
  const {el} = await booking({orders: [{kind: 'event', item_id: 'other', wrestler_id: 'w-1', status: 'paid', dates: []}], entries: [{eventId: 'camp', wrestler: 'Sam Example', status: 'waiting', position: 2}]});
  assert.equal(el('wrestlerStatus').textContent, 'Sam Example is on the waitlist, number 2 in line. The academy can offer a seat if one opens.');
}

// ---------- Messages (P3) ----------
{
  let unread = 2;
  const inbox = () => ({notices: [{id: 'n2', subject: 'Newest', body: 'b', at: '2026-11-06T19:13:00Z', read: unread === 0}, {id: 'n1', subject: 'Older', body: 'b', at: '2026-11-05T19:13:00Z', read: unread === 0}], announcements: [{id: 'a', subject: 'Gym closed', body: 'b', sentAt: '2026-11-04T19:13:00Z', read: true}], thread: [], unread});
  const {el, calls} = page('app/inbox/screen.html', {fetch: async (url, o) => { if (o?.method === 'POST' && JSON.parse(o.body).all === true) unread = 0; return json(inbox()); }});
  await settle();
  assert.match(el('notices').innerHTML, /^<details data-notice="n2" open>/, 'the newest notice is open');
  assert.equal((el('notices').innerHTML.match(/ open>/g) || []).length, 1, 'only the newest');
  assert.doesNotMatch(el('announcements').innerHTML, / open>/, 'announcements stay closed while there are notices');
  assert.equal(el('markAll').hidden, false);
  await el('markAll').onclick();
  assert.deepEqual(calls.at(-1).body, {action: 'read', all: true});
  assert.equal(el('markAll').hidden, true); assert.equal(el('status').textContent, 'All messages are marked as read.');
  assert.doesNotMatch(el('notices').innerHTML, /unread/);
}

console.log('Family experience tests passed: welcome page, guided start, Next up, wrestler status lines, plan cards, lesson and booking status, Mark all as read');
