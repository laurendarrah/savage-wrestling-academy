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
  assert.match(cards, /\$200 a month, month to month/);
  assert.doesNotMatch(cards, /upfront|2,400/, 'no year paid upfront (#210)');
  assert.match(cards, /\$40 for a single walk-in practice/);
  // Weekly practice times on each card, from the published practices (issue #180).
  assert.match(cards, /SWA Development<\/h3><span class="times">Mon · 6:00–7:30 PM<\/span>/);
  assert.match(cards, /SWA Advance<\/h3><span class="times">Tue · 3:00–4:30 PM<\/span>/, 'next month\'s practices count too');
  assert.match(cards, /\$225\.50 a month/, 'cents shown when the price has them');
  assert.equal((cards.match(/needs coach approval/g) || []).length, 1, 'only SWA Advance says coach approval');
  assert.match(cards, /">Grades 7–12<\/span><h3>SWA Advance<\/h3>/, 'approval is said once, in the note');
  // Coming up is one row in the hero (#282): the soonest session, with sessions at the same time sharing it.
  const week = el('week').innerHTML;
  assert.equal(week, '<span class="lbl">Coming up</span><span class="when">Mon, Nov 30 · 6:00 PM</span><span class="what">SWA Development practice, SWA Intermediate practice</span><a href="/calendar">Full calendar →</a>');
  assert.doesNotMatch(week, /2026-1|18:00/);
  // The rest of the list is still computed (next month included), for the row to reach into December when November is over.
  const groups = vm.runInContext('upcoming(__s,"2026-11-30",5)', Object.assign(page('app/welcome/screen.html', {fetch: async () => json({}, false)}).ctx, {__s: [months[''], months['?month=2026-12']]}));
  assert.equal(JSON.stringify(groups.map(g => g.date + ' ' + g.items.map(i => i.title).join('+'))), JSON.stringify(['2026-11-30 SWA Development practice+SWA Intermediate practice', '2026-12-01 SWA Advance practice', '2026-12-04 Friday Night Live', '2026-12-20 Winter camp (camp)']));
  // One red button in the first screen: Join; Sign in is the quiet link. The mark lives in the top bar only.
  assert.match(html, /<div class="actions"><a class="button primary" href="\/login\?mode=signup">Join the academy<\/a><a class="button quiet" href="\/login">Sign in<\/a><\/div>/);
  assert.doesNotMatch(html, /savage-logo-256\.png/, 'no second mark in the hero');
  assert.match(html, /<div class="hero__media" aria-hidden="true"><\/div>/, 'the photo slot for Phase 5');
  // The programs are one comparison card with a switch on a phone; the first program shows until the switch is tapped.
  assert.match(cards, /^<article class="program is-on" data-program="Elementary">/); assert.match(cards, /<article class="program" data-program="Intermediate">/);
  assert.match(el('programSwitch').innerHTML, /<button type="button" data-program="Elementary" aria-pressed="true">Development<\/button><button type="button" data-program="Intermediate" aria-pressed="false">Intermediate<\/button>/);
  assert.equal(el('programSwitch').hidden, false);
  assert.match(cards, /<a class="button quiet" href="\/register\?program=Elementary">Choose SWA Development<\/a>/, 'a quiet Choose on each');
  assert.doesNotMatch(cards, /primary/, 'the red button comes once, after the card');
  assert.match(html, /<p class="compare-cta"><a class="button primary" href="\/login\?mode=signup">Start registration<\/a>/);
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
  // Nothing saved yet: no empty membership or purchase sections, and no week, doors, payments or family card either (#282).
  for (const id of ['memberships', 'purchases', 'week', 'book', 'payments', 'contacts']) assert.equal(el(id).hidden, true, id + ' waits until there is something to show');
  assert.match(html, /<section id="yourData" class="card" hidden/, 'the close-account card waits for the Account menu');
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
  assert.match(steps, /class="step current" data-step="wrestler"[\s\S]*Sam Example needs a current USA Wrestling card[\s\S]*class="primary" data-action="start-wrestler">Add the card/);
  assert.match(steps, /data-step="waiver"[\s\S]*Sign the Participation waiver for Sam Example/);
  assert.doesNotMatch(steps, /href="\/waiver/, 'the waiver step gets its button once it is the current step');
  assert.match(el('startLede').textContent, /^Four steps /);
  assert.equal(el('memberships').hidden, false, 'a saved family sees its memberships');
  assert.equal((steps.match(/primary/g) || []).length, 1, 'one main button');
  assert.equal(el('hello').textContent, 'Hi, Pat');
  // The wrestler card (#282): avatar initials, the name, grade and membership, then the card and waiver chips.
  const details = el('savedDetails').innerHTML;
  assert.match(details, /<div class="swa-avatar" aria-hidden="true">SE<\/div><div><h3>Sam Example<\/h3><p class="kid-sub">Kindergarten · No membership yet<\/p>/, 'Kindergarten is stored as "K" and shown in words');
  assert.match(details, /<div class="chips"><span class="pill warn">No USA Wrestling card<\/span><span class="pill warn">Waiver not signed<\/span><\/div>/);
  assert.match(details, /<ul class="status-lines"><li>Add the card number[\s\S]*Booking is blocked until this is fixed[\s\S]*<li><strong>Booking is blocked until it is signed\.<\/strong> <a href="\/waiver\?wrestler=w-1">Sign the waiver →<\/a><\/li><li>Not signed up for a membership yet/, 'what needs the family, as lines under the chips');
  assert.match(details, /href="\/pass\?wrestler=w-1">Entry pass[\s\S]*href="\/wrestler\?id=w-1">Sam’s page/);
  assert.equal(el('contacts').hidden, false); assert.match(el('contactRows').innerHTML, /<dt class="d">Parent<\/dt><dd class="t">Pat Example · 555-0100<\/dd>[\s\S]*<dt class="d">Address<\/dt><dd class="t"><span class="muted">Not added yet/);
  assert.equal(el('book').hidden, false); assert.match(el('doors').innerHTML, /href="\/register\?plan=walkin"[\s\S]*Walk-in practice[\s\S]*href="\/lesson"[\s\S]*Private lesson[\s\S]*href="\/calendar#comingUp"[\s\S]*Camps &amp; events/, 'three doors');
  assert.equal((el('doors').innerHTML.match(/primary/g) || []).length, 0, 'no red on the doors');
  assert.equal(el('payments').hidden, false); assert.match(el('moneyLine').innerHTML, /\$0\.00<\/div><div class="lbl">due at the academy[\s\S]*>0<\/div><div class="lbl">payments on record/);
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
  // The dark card (#282): the day, the time as the figure, the session and the wrestler, the pass button.
  const next = el('nextUpBody').innerHTML;
  // (The day reads "Today" or "Tomorrow" when the test happens to run on those dates.)
  assert.match(next, /^<p class="next-day">(?:<b class="today">Today<\/b>|Tomorrow|Mon, Nov 9)<\/p><p class="next-when swa-figure">3:00 PM<\/p>/, 'the soonest session first, time as the figure');
  assert.match(next, /One-on-one lesson with Coach Dana<\/strong> <span>· Sam Example<\/span>/);
  assert.match(next, /class="next-meta">Paid · ends 4:00 PM<\/p>/);
  assert.match(next, /class="button primary" href="\/pass\?wrestler=w-1">Show entry pass/);
  assert.doesNotMatch(next, /Directions/, 'no Directions until the academy’s address is in');
  // This week: the rest of the sessions within seven days, as rows; the link goes to the one wrestler's page.
  assert.equal(el('week').hidden, false);
  assert.match(el('weekRows').innerHTML, /<li><div class="d">(?:Today|Tomorrow|Tue, Nov 10)<small>6:00 PM<\/small><\/div><div class="t">SWA Intermediate practice<small>Sam Example · membership<\/small><\/div><div class="r"><\/div><\/li>/);
  assert.equal(el('weekMore').href, '/wrestler?id=w-1'); assert.equal(el('weekMore').textContent, 'All of Sam’s sessions →');
  assert.match(el('savedDetails').innerHTML, /SWA Intermediate member through [\s\S]*<span class="pill ok">[\s\S]*USA Wrestling card verified<\/span><span class="pill ok">[\s\S]*Waiver signed<\/span>/);
  assert.match(el('savedDetails').innerHTML, /<li class="swa-caption">Current through [\s\S]*<li class="swa-caption"><a href="\/waiver-copy\?id=s1"/, 'what is in order stays as a caption');
  assert.match(el('moneyLine').innerHTML, /1<\/div><div class="lbl">payment on record/);
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
  // A two-way segmented control since #282, over the hidden #plan value.
  for (const k of ['monthly', 'walkin']) assert.match(html, new RegExp(`<button type="button" id="plan-${k}" data-plan="${k}" aria-pressed="(true|false)">`));
  assert.match(html, /<details class="included" id="included"><summary>What’s included<\/summary><p>Includes every scheduled practice/, 'the policy paragraph sits behind a disclosure');
  const line = start => { const i = script.indexOf(start); assert.ok(i >= 0, start); return script.slice(i, script.indexOf('\n', i)); };
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {value: '', textContent: '', checked: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }}); return nodes.get(id); };
  const ctx = {Intl, $: el}; vm.runInNewContext(line('const money=') + '\n' + line('function choosePlan') + '\n' + line('function renderPlanCards'), ctx);
  el('plan').value = 'monthly';
  ctx.renderPlanCards({monthlyCents: 20000, walkInCents: 4000});
  assert.equal(el('planPrice-monthly').textContent, '$200.00 a month'); assert.equal(el('planTerm-monthly').textContent, 'Month to month, cancel any time');
  assert.equal(el('planPrice-walkin').textContent, '$40.00');
  assert.equal(el('planPrice-annual').textContent, '', 'no upfront plan card (#210)');
  assert.doesNotMatch(html, /plan-annual|paid upfront/, 'the register page offers only monthly and walk-in');
  assert.equal(el('plan-monthly').checked, true); assert.equal(el('plan-walkin').checked, false);
  assert.equal(el('plan-monthly').attrs['aria-pressed'], 'true'); assert.equal(el('plan-walkin').attrs['aria-pressed'], 'false', 'the segment shows which is chosen');
  ctx.renderPlanCards({monthlyCents: null, walkInCents: 4000});
  assert.equal(el('planPrice-monthly').textContent, 'Price to be set by the academy'); assert.equal(el('planTerm-monthly').textContent, 'Month to month, cancel any time');
  let changed = 0; el('plan').onchange = () => changed++;
  ctx.choosePlan('walkin'); assert.equal(el('plan').value, 'walkin'); assert.equal(changed, 1, 'a card choice runs the same update as before');
}

// ---------- Lessons (M2) ----------
const lessonPage = (lessons, wrestlers = [{id: 'w', name: 'Sam'}]) => page('app/lesson/screen.html', {fetch: async url => json(url === '/api/lessons' ? lessons : {data: {wrestlers}})});
const formats = [{id: 'one-on-one', name: 'One-on-one lesson', description: 'd', cents: 6000}, {id: 'partner', name: 'Partner lesson', description: 'd', cents: null}, {id: 'small-group', name: 'Small-group lesson', description: 'd', cents: null}];
{
  const {el} = lessonPage({formats, openings: []}); await settle();
  assert.equal(el('closed').hidden, false); assert.equal(el('closedHeading').textContent, 'No open lesson times right now');
  assert.match(el('closedText').textContent, /No coach has open lesson times right now/);
  assert.match(readFileSync('app/lesson/screen.html', 'utf8'), /<a class="button primary" href="\/inbox" id="messageAcademy">Message the academy<\/a>/);
  assert.equal(el('stepType').hidden, true); assert.equal(el('stepWrestler').hidden, true); assert.equal(el('stepTime').hidden, true);
  assert.equal(el('status').textContent, '');
}
{
  const {el} = lessonPage({formats: formats.map(f => ({...f, cents: null})), openings: [{id: 'o', date: '2026-11-09', start: '15:00', end: '16:00', coach: 'Coach Dana', coachKey: 'k', format: null, capacity: 1, spotsLeft: 1}]}); await settle();
  assert.equal(el('closed').hidden, false); assert.match(el('closedText').textContent, /can’t be booked online yet/);
}
{
  const {el} = lessonPage({formats, openings: []}, []); await settle();
  assert.equal(el('closedHeading').textContent, 'Add your wrestler first'); assert.equal(el('addWrestler').hidden, false);
}
{
  // Only one-on-ones are priced and one open time exists, so that is the only way to book, already chosen (issue #177).
  const {el, ctx} = lessonPage({formats, openings: [{id: 'o', date: '2026-11-09', start: '15:00', end: '16:00', coach: 'Coach Dana', coachKey: 'k', format: null, capacity: 1, spotsLeft: 1}], mine: []}); await settle();
  assert.equal(el('closed').hidden, true); assert.equal(el('stepType').hidden, false);
  assert.match(el('paths').innerHTML, /Book a one-on-one[\s\S]*\$60\.00 per wrestler[\s\S]*1 open time/);
  assert.match(el('paths').innerHTML, /data-path="group" aria-pressed="false" disabled><b>Join a partner or small group/, 'no group lessons to join');
  assert.match(el('paths').innerHTML, /data-path="request" aria-pressed="false" disabled>/, 'partner and small group are not priced, so no private group');
  assert.equal(vm.runInContext('path', ctx), 'one', 'the only way to book is already chosen');
  assert.match(el('times').innerHTML, /Mon, Nov 9[\s\S]*3:00 PM–4:00 PM/);
}

// ---------- Event booking (M3) ----------
async function booking({orders = []}) {
  const catalog = {month: '2026-11', today: '2026-11-06', programs: [], practices: [], liveClasses: [], privateFormats: [], events: [{id: 'camp', name: 'Winter camp', type: 'Camp', dates: ['2026-11-16', '2026-11-17'], cents: 16000, dayCents: 9000, gradeRange: '', description: ''}]};
  const p = page('app/booking/screen.html', {search: '?type=event&id=camp', fetch: async url => json(url === '/api/family' ? {data: {wrestlers: [{id: 'w-1', name: 'Sam Example', grade: 'K'}]}} : url === '/api/orders' ? {orders} : catalog)});
  await settle(); p.el('wrestler').value = 'w-1'; vm.runInContext('showWrestlerStatus()', p.ctx); return p;
}
{
  const {el, html} = await booking({});
  assert.equal(el('heading').textContent, 'Winter camp', 'the heading is the event name'); assert.equal(el('kind').textContent, 'Camp');
  assert.equal(el('description').textContent, 'Mon, Nov 16 · Tue, Nov 17 · Time to be announced · $160.00', 'an event saved without times says so (issue #189)');
  assert.equal(el('wrestlerStatus').textContent, 'Sam Example is not registered yet.');
  assert.doesNotMatch(html, /← Calendar|Review only/, 'no own back link and no disclaimer first');
  assert.equal((html.match(/Online payment isn’t open yet/g) || []).length, 0, 'payment is explained at review, in the server’s words; no disabled "isn’t open yet" button (#273)');
}
{
  const {el} = await booking({orders: [{kind: 'event', item_id: 'camp', wrestler_id: 'w-1', status: 'paid', dates: ['2026-11-16', '2026-11-17']}]});
  assert.equal(el('wrestlerStatus').textContent, 'Sam Example is already registered. You don’t need to book again.'); assert.match(el('wrestlerStatus').className, /ok/);
}
{
  // No waitlists (#210): the page only asks for the family's orders.
  const {el, calls, html} = await booking({orders: [{kind: 'event', item_id: 'other', wrestler_id: 'w-1', status: 'paid', dates: []}]});
  assert.equal(el('wrestlerStatus').textContent, 'Sam Example is not registered yet.');
  assert.ok(!calls.some(c => c.url.includes('waitlist')), 'no waitlist request');
  assert.doesNotMatch(html, /joinWaitlist|Join the waitlist/);
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
