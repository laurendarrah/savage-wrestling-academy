// Issue #231: design polish for the family and public pages. Button-style links, the family quick nav on phones, the
// Memberships "Paid" pill, announcements first on /inbox, wording that matches what the team page shows, "Practice
// times coming soon" on /welcome, the shared header band on /register, 44px "View / print" links and the calendar's
// plan buttons. Page scripts run with a fake DOM, because inline JavaScript is not typechecked.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {load} from './accounts.mjs';

const settle = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const read = f => readFileSync(f, 'utf8');
const style = html => html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
function fakeDom() {
  const nodes = new Map();
  const el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, checked: false, disabled: false, innerHTML: '', textContent: '', options: [], dataset: {}, style: {},
    classList: {add() {}, remove() {}, toggle() {}}, focus() {}, scrollIntoView() {}, setAttribute() {}, addEventListener() {}, appendChild() {}, replaceChildren() {},
    querySelectorAll: () => [], querySelector: () => null, elements: new Proxy({}, {get: (t, k) => (t[k] ??= {value: '', checked: false, focus() {}})})}); return nodes.get(id); };
  return el;
}
function run(file, {fetch, search = ''}) {
  const el = fakeDom(), html = read(file);
  const ctx = vm.createContext({Intl, Date, JSON, Math, URLSearchParams, Promise, setTimeout: f => setImmediate(f), structuredClone, console, crypto: {randomUUID: () => 'x'},
    location: {search, href: '', pathname: '/'}, confirm: () => true, window: {addEventListener() {}}, addEventListener() {}, history: {replaceState() {}},
    document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({}), addEventListener() {}, title: ''}, fetch});
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(code, ctx);
  return {el, ctx, html};
}
const json = body => ({ok: true, status: 200, json: async () => body});

// ---------- Family home ----------
{
  const html = read('app/family/screen.html'), css = style(html);
  // Links that look like buttons are buttons: no separate "account-action" look.
  assert.doesNotMatch(html, /account-action/, 'button-style links use the shared .button class');
  // The data download and the close-account request live in the Account menu (#282); the quick nav is the tab bar now.
  assert.match(html, /<details class="account-menu" id="accountMenu">[\s\S]*<a href="\/api\/my-data\?format=download" download id="yourDataLink">Download my family's data<\/a><button type="button" data-action="close-account">Ask to close my account<\/button>[\s\S]*<\/details>/);
  assert.doesNotMatch(html, /class="quick"/, 'no section links under the greeting: the tab bar (lib/page-chrome.ts) is the family’s navigation');
  assert.match(html, /<a class="button" href="\/register\?plan=monthly&amp;wrestler=/); assert.match(html, /<a class="button" href="\/register\?plan=walkin&amp;wrestler=/);
  // Shared tokens, not literals, for the page ground and width; the shared pill, not a page-only one.
  assert.match(css, /body\{background:var\(--swa-ground\)/); assert.match(css, /main\{max-width:var\(--swa-width-wide\)/);
  assert.doesNotMatch(css, /billing-pill/, 'the shared .pill');
  assert.doesNotMatch(css, /#C4222C|#F4F5F7/i, 'red and the page ground come from tokens');
  // No pill floats beside the Memberships heading (issue #340): each membership says its own state on its card.
  assert.doesNotMatch(html, /paymentsPill/);
  assert.match(html, /<h2 id="membershipsHeading" class="swa-label">Memberships<\/h2>/);
}
// A membership's state is on its own card, and only for a membership (issue #231): a paid lesson is not one.
{
  const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
  const later = new Date(Date.now() + 200 * 864e5).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
  const membership = extra => ({id: 'm', kind: 'monthly', program: 'Intermediate', item_label: 'SWA Intermediate', wrestler_id: 'w-1', wrestler_name: 'Sam Example', dates: [], amount_cents: 20000, discount_cents: 0, status: 'paid', created_at: today + 'T12:00:00Z', paid_at: today + 'T12:00:00Z', term_start: today, term_end: later, ...extra});
  const lesson = {id: 'l', kind: 'lesson', program: null, item_label: 'Private lesson', wrestler_id: 'w-1', wrestler_name: 'Sam Example', dates: [today], amount_cents: 6000, discount_cents: 0, status: 'paid', created_at: today + 'T12:00:00Z', paid_at: today + 'T12:00:00Z'};
  const open = async orders => {
    const {el} = run('app/family/screen.html', {fetch: async url => {
      if (url === '/api/orders') return json({orders, checkoutOpen: true});
      if (url === '/api/scholarship') return json({awards: []});
      if (url.startsWith('/api/family')) return json({email: 'pat@example.test', data: {parentName: 'Pat', phone: '1', wrestlers: [{id: 'w-1', name: 'Sam Example', grade: '8'}]}, revision: 1, updatedAt: today + 'T12:00:00Z'});
      return json({});
    }});
    await settle(); return el;
  };
  const cards = el => el('membershipCards').innerHTML;
  let el = await open([lesson]);
  assert.match(cards(el), /<span class="pill neutral">Not enrolled<\/span>/, 'a paid lesson is not a membership');
  assert.doesNotMatch(cards(el), /Active membership/);
  assert.equal(el('membershipsNote').hidden, false, 'with no membership yet, the line that says what will show here stays');
  assert.match(el('purchaseList').innerHTML, /Private lesson/, 'the lesson is still under Purchases');
  el = await open([]);
  assert.match(cards(el), /Not enrolled/, 'nothing paid: not enrolled');
  el = await open([lesson, membership({})]);
  assert.match(cards(el), /<span class="pill ok">Active membership<\/span>/, 'an active membership says so on its card');
  assert.equal(el('membershipsNote').hidden, true, 'the explaining line goes once a membership shows');
  el = await open([membership({subscription_status: 'past_due'})]);
  assert.match(cards(el), /<span class="pill warn">Payment needs attention<\/span>/, 'a past-due membership says "Payment needs attention" on its card');
  assert.doesNotMatch(cards(el), /Active membership/);
  el = await open([membership({term_start: '2024-01-01', term_end: '2025-01-01'})]);
  assert.match(cards(el), /Not enrolled/, 'an ended membership is not active');
}
// Purchases (issue #340): the latest five paid purchases show, the rest wait behind "Show all"; what is still due at the
// academy always shows.
{
  const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
  const order = n => ({id: 'o' + n, kind: 'event', program: null, item_label: 'Clinic ' + n, wrestler_id: 'w-1', wrestler_name: 'Sam Example', dates: [today], amount_cents: 6000, discount_cents: 0, status: 'paid', created_at: today + 'T12:00:00Z', paid_at: today + 'T12:00:00Z'});
  const due = {id: 'c1', kind: 'walkin', item: 'SWA Intermediate walk-in', wrestler: 'Sam Example', date: today, start: '18:00', amountCents: 4000, label: 'Pay at the academy: $40.00 due', cancellable: true};
  const open = async (orders, cashBookings = []) => {
    const page = run('app/family/screen.html', {fetch: async url => {
      if (url === '/api/orders') return json({orders, cashBookings, checkoutOpen: false});
      if (url === '/api/scholarship') return json({awards: []});
      if (url.startsWith('/api/family')) return json({email: 'pat@example.test', data: {parentName: 'Pat', phone: '1', wrestlers: [{id: 'w-1', name: 'Sam Example', grade: '8'}]}, revision: 1, updatedAt: today + 'T12:00:00Z'});
      return json({});
    }});
    await settle(); return page;
  };
  let page = await open([1, 2, 3, 4, 5].map(order));
  assert.doesNotMatch(page.el('purchaseList').innerHTML, /Show all/, 'five purchases need no "Show all"');
  page = await open([1, 2, 3, 4, 5, 6, 7].map(order), [due]);
  let list = page.el('purchaseList').innerHTML;
  assert.match(list, /Clinic 5/); assert.doesNotMatch(list, /Clinic 6/, 'the sixth and later wait');
  assert.match(list, /<button type="button" class="quiet" data-action="all-purchases">Show all 7 purchases<\/button>$/);
  assert.match(list, /Pay at the academy/, 'what is due always shows');
  vm.runInContext('ACTIONS["all-purchases"]()', page.ctx);
  list = page.el('purchaseList').innerHTML;
  assert.match(list, /Clinic 7/); assert.doesNotMatch(list, /Show all/, 'every purchase after choosing "Show all"');
}

// ---------- Family profile: disabled until the saved profile is in, and while it saves ----------
// The same race as /coach-profile and /website (issue #220): a late answer from /api/family must not overwrite what a
// parent has typed. The stand-in server holds each answer until the test releases it, as in tests/page-races.mjs.
{
  const html = read('app/family/screen.html');
  const fieldset = html.match(/<form id="familyForm" novalidate><fieldset id="familyFields" disabled>([\s\S]*?)<\/fieldset><\/form>/);
  assert.ok(fieldset, 'the profile form starts disabled');
  for (const id of ['homeAddress', 'homeCity', 'homeState', 'homeZip', 'emergencyContactName', 'emergencyContactPhone', 'wrestlers', 'save', 'cancelEdit']) assert.match(fieldset[1], new RegExp(`id="${id}"`), id + ' is inside the disabled fieldset');
  assert.match(fieldset[1], /name="parentName"[\s\S]*name="phone"[\s\S]*data-action="add-wrestler-form"/, 'name, phone and + Add wrestler wait too');
  const held = [];
  const hold = (url, init) => new Promise(resolve => held.push({url, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null,
    reply: (data, status = 200) => resolve({ok: status < 400, status, json: async () => (data === undefined ? Promise.reject(SyntaxError('Unexpected token <')) : data)})}));
  const fetch = async (url, init) => (url === '/api/family' ? hold(url, init) : json({}));
  const open = () => { held.length = 0; const p = run('app/family/screen.html', {fetch}); p.el('familyFields').disabled = true; return p; };
  const saved = {parentName: 'Pat Example', phone: '555-0100', homeAddress: '20 Railroad St', wrestlers: []};

  let {el} = open(); await settle();
  assert.equal(el('familyFields').disabled, true, 'nothing can be typed before the profile loads');
  assert.equal(el('save').disabled, true, 'the walkthrough waits for #save to turn on (familyReady)');
  assert.equal(el('status').textContent, 'Loading…');
  held[0].reply({email: 'pat@example.test', data: saved, revision: 3, updatedAt: null}); await settle();
  assert.equal(el('familyFields').disabled, false); assert.equal(el('save').disabled, false);
  assert.equal(el('familyForm').elements.parentName.value, 'Pat Example', 'the saved profile is in the form');
  assert.equal(el('homeAddress').value, '20 Railroad St');
  // Saving: disabled until the server answers.
  el('familyForm').elements.parentName.value = 'Pat Q. Example';
  el('familyForm').onsubmit({preventDefault() {}}); await settle();
  assert.equal(el('familyFields').disabled, true, 'disabled while saving'); assert.equal(el('status').textContent, 'Saving…');
  const put = held.find(h => h.method === 'PUT');
  assert.equal(put.body.revision, 3); assert.equal(put.body.data.parentName, 'Pat Q. Example');
  put.reply({revision: 4, updatedAt: '2026-11-07T15:00:00Z', data: {...saved, parentName: 'Pat Q. Example'}}); await settle();
  assert.equal(el('familyFields').disabled, false); assert.match(el('status').textContent, /^Your changes are saved\./);
  // A failed save gives the fields back and says so.
  el('familyForm').onsubmit({preventDefault() {}}); await settle();
  held.filter(h => h.method === 'PUT').at(-1).reply({error: 'Enter the ZIP code.'}, 400); await settle();
  assert.equal(el('familyFields').disabled, false); assert.equal(el('status').textContent, 'Enter the ZIP code. Your changes have not been saved.');

  // If the profile cannot load, the form stays disabled and says why: saving would replace a profile the parent never saw.
  ({el} = open()); await settle();
  held[0].reply({error: 'Check your sign-in and try again.'}, 403); await settle();
  assert.equal(el('familyFields').disabled, true); assert.equal(el('save').disabled, true); assert.equal(el('status').textContent, 'Check your sign-in and try again.');
  // An answer that isn't JSON (a proxy error page) gives the plain message, not a parser error.
  ({el} = open()); await settle();
  held[0].reply(undefined, 502); await settle();
  assert.equal(el('familyFields').disabled, true); assert.equal(el('status').textContent, 'We couldn’t load your family account. Refresh the page to try again.');
}

// ---------- Inbox: announcements first ----------
{
  const html = read('app/inbox/screen.html');
  const body = html.slice(html.indexOf('<body>'));
  assert.ok(body.indexOf('id="announcementsBox"') < body.indexOf('id="noticesBox"'), 'announcements come before notices');
  assert.match(style(html), /main\{max-width:var\(--swa-width-narrow\)/);
  const box = (announcements, notices) => async () => json({announcements, notices, thread: [], unread: 0});
  const opened = el => [...(el('announcements').innerHTML + el('notices').innerHTML).matchAll(/<details (data-\w+="[^"]+") open>/g)].map(m => m[1]);
  const a = (id, read) => ({id, subject: id, body: 'b', sentAt: '2026-11-06T19:13:00Z', read});
  const n = (id, read) => ({id, subject: id, body: 'b', at: '2026-11-06T19:13:00Z', read});
  let {el} = run('app/inbox/screen.html', {fetch: box([a('a2', true), a('a1', false)], [n('n2', false), n('n1', true)])}); await settle();
  assert.deepEqual(opened(el), ['data-id="a1"'], 'an unread announcement opens first, ahead of an unread notice');
  ({el} = run('app/inbox/screen.html', {fetch: box([a('a1', true)], [n('n2', true), n('n1', false)])})); await settle();
  assert.deepEqual(opened(el), ['data-notice="n1"'], 'otherwise the newest unread notice');
  ({el} = run('app/inbox/screen.html', {fetch: box([a('a2', true), a('a1', true)], [n('n1', true)])})); await settle();
  assert.deepEqual(opened(el), ['data-id="a2"'], 'all read: the newest announcement');
  assert.equal(el('announcementsBox').hidden, false);
  ({el} = run('app/inbox/screen.html', {fetch: box([], [n('n1', true)])})); await settle();
  assert.equal(el('announcementsBox').hidden, true, 'no empty Announcements box above the notices');
  assert.deepEqual(opened(el), ['data-notice="n1"']);
  ({el} = run('app/inbox/screen.html', {fetch: box([], [])})); await settle();
  assert.equal(el('announcementsBox').hidden, false); assert.match(el('announcements').innerHTML, /No announcements yet/);
}

// ---------- Welcome and team ----------
{
  const W = load('lib/website.ts');
  const site = {headline: 'Built on the mat', intro: 'Wrestling.', mission: '', coaches: [], achievements: [], alumni: [], address: '', email: ''};
  const coach = [{name: 'Lee Tran', bio: '', specialties: []}], ach = [{name: 'Sam', achievement: 'County champion', season: '2025–26'}], alum = [{name: 'Alex', years: '', next: 'College'}];
  assert.equal(W.teamLinkText(site, coach), 'Meet our coaches →', 'only coaches: no "and wrestlers"');
  assert.equal(W.teamLinkText({...site, achievements: ach}, []), 'Meet our wrestlers →');
  assert.equal(W.teamLinkText({...site, alumni: alum}, []), 'Meet our wrestlers →');
  assert.equal(W.teamLinkText({...site, achievements: ach}, coach), 'Meet our coaches and wrestlers →');
  const tpl = read('app/welcome/screen.html');
  assert.match(W.renderWelcome(tpl, site, coach, null), /<a class="herolink" href="\/team">Meet our coaches →<\/a>/);
  assert.doesNotMatch(W.renderWelcome(tpl, site, coach, null), /coaches and wrestlers/);

  // A coach with no bio gets a compact card that keeps to its own height (the card's markup has no .coach__bio). The
  // rule is in the shared card styles, so the coach profile page's preview shows the same card (#223).
  assert.match(W.COACH_CARD_CSS, /\.coach:not\(:has\(\.coach__bio\)\)\{[^}]*align-self:start/);
  const team = W.renderTeam(read('app/team/screen.html'), site, [{name: 'Lee Tran', bio: 'Ten years.', specialties: []}, {name: 'Justin', bio: '', specialties: []}], null);
  assert.ok(team.includes(W.COACH_CARD_CSS), 'the team page carries the card styles');
  assert.equal((team.match(/class="coach__bio"/g) || []).length, 1, 'only the coach with a bio has a bio block');
  // Shared width and page ground.
  const teamCss = style(read('app/team/screen.html'));
  for (const css of [teamCss, style(tpl)]) { assert.match(css, /max-width:var\(--swa-width-wide\)/); assert.match(css, /background:var\(--swa-ground\)/); assert.doesNotMatch(css, /#F4F5F7|1080px/i); }
  assert.doesNotMatch(style(tpl), /#C4222C/i, 'the welcome page takes red from the token');
}
// The welcome page's program cards: weekly times, or "Practice times coming soon" when nothing is published.
{
  const today = '2026-11-09';
  const schedule = {month: '2026-11', today, programs: [{id: 'Elementary', name: 'SWA Development', grades: '', description: '', monthlyCents: 20000, walkInCents: 4000}, {id: 'Advanced', name: 'SWA Advance', grades: '', description: '', monthlyCents: 22550, walkInCents: null}],
    practices: [{id: 'p1', program: 'Elementary', date: '2026-11-10', start: '18:00', end: '19:30'}], events: [], liveClasses: []};
  const {el, html} = run('app/welcome/screen.html', {fetch: async url => json(/month=/.test(url) ? {...schedule, month: '2026-12', practices: []} : schedule)});
  await settle();
  const cards = el('programs').innerHTML.split('<article').slice(1);
  assert.match(cards[0], /SWA Development[\s\S]*<span class="times">Tue · 6:00–7:30 PM<\/span>/);
  assert.doesNotMatch(cards[0], /coming soon/);
  assert.match(cards[1], /SWA Advance[\s\S]*<span class="times soon">Practice times coming soon<\/span>/, 'a program with no practices says so');
  // Program colors come from the shared tokens, as on the calendar.
  assert.match(cards[0], /background:var\(--swa-prog-development\)/); assert.match(cards[1], /background:var\(--swa-prog-advance\)/);
  assert.doesNotMatch(html, /\.program \.program \.times/, 'the times style applies (the selector had .program twice)');
}

// ---------- Register: the shared header band ----------
{
  const html = read('app/register/screen.html');
  assert.match(html, /<main>\n<div class="swa-head"><p class="eyebrow">Savage Wrestling Academy<\/p><h1>Choose training<\/h1><p class="lede">/);
  assert.doesNotMatch(html, /reg-hero/, 'no page-only header band');
  const {pageHead} = load('lib/page-chrome.ts');
  // Signed in, the Worker turns the page's own band into the title row (issue #280); nothing else is wrapped.
  const served = pageHead(html, '/register');
  assert.equal((served.match(/class="swa-title"/g) || []).length, 1); assert.equal((served.match(/class="swa-head"/g) || []).length, 0);
  // Wide since #282: the steps and the sticky summary share the width on a desk; the review itself stays narrow.
  assert.match(style(html), /main\{max-width:var\(--swa-width-wide\)/); assert.match(style(html), /section#review\{max-width:var\(--swa-width-narrow\)/);
}

// ---------- Waiver and consent: 44px "View / print" and "View copy" ----------
{
  const html = read('app/waiver/screen.html');
  assert.match(style(html), /a\.copy\{display:inline-flex;align-items:center;min-height:44px\}/);
  assert.match(html, /<a class="copy" href="\/waiver-copy\?id='\+encodeURIComponent\(s\.id\)\+'" target="_blank" rel="noopener">View \/ print<\/a>/);
  assert.match(html, /<a class="copy" href="\/waiver-copy\?id='\+encodeURIComponent\(s\.id\)\+'" target="_blank" rel="noopener">View copy<\/a>/);
  // The amber "Not signed" pill is the shared .pill.warn (public/savage.css); the page keeps no copy of it (issue #340).
  assert.doesNotMatch(style(html), /\.pill\b/);
  assert.match(read('public/savage.css'), /:is\(\.badge,\.pill,\.tag,\.billing-pill\):is\(\.warn,[^)]*\)\{background:var\(--swa-warn-bg\);border-color:transparent;color:var\(--swa-warn-ink\)\}/);
  assert.match(html, /<span class="pill warn">/);
  // /consent is the same page.
  assert.match(read('app/consent/route.ts'), /import html from '\.\.\/waiver\/screen\.html\?raw'/);
}

// ---------- Calendar: four doors above the grid instead of the product sections, and one red button (#282) ----------
{
  const schedule = {month: '2026-11', today: '2026-11-11', programs: [{id: 'Intermediate', name: 'SWA Intermediate', grades: '7–12', description: '', monthlyCents: 20000, walkInCents: 4000}], practices: [], events: [], liveClasses: [{id: 'fnl', name: 'Friday Night Live', date: '2026-11-13', start: '16:00', end: '17:00', memberCents: 1000, nonMemberCents: 2000}], privateFormats: []};
  const {el, html} = run('app/calendar/screen.html', {fetch: async () => json(schedule)});
  await settle();
  const body = html.slice(html.indexOf('<body>'), html.indexOf('<script>'));
  assert.match(body, /<nav class="swa-doors four" id="doors" aria-label="Also on the site"><a class="swa-door" href="\/welcome#programs">[\s\S]*Programs[\s\S]*<a class="swa-door" href="\/lesson">[\s\S]*Private lessons[\s\S]*data-filter-door="extras"[\s\S]*Extra practices[\s\S]*href="#comingUp">[\s\S]*Camps &amp; clinics/);
  assert.equal(el('doorPrograms').textContent, '$200.00 a month · $40.00 walk-in'); assert.equal(el('doorLive').textContent, 'Friday Night Live · Fri, Nov 13');
  assert.doesNotMatch(body, /id="programCards"|id="liveCards"|id="lessonCards"|id="eventCards"|class="jump"/, 'the product sections and the jump links are gone');
  assert.deepEqual([...body.matchAll(/class="button primary"/g)].length, 1, 'one red button: Join the academy');
  assert.match(body, /<section class="join" id="join"[^>]*>[\s\S]*<a class="button primary" href="\/login\?mode=signup">Join the academy<\/a>/);
  assert.match(style(html), /\.competition\{background:var\(--swa-prog-advance\)/, 'program colors from the shared tokens');
}

// ---------- The walkthrough checks /welcome and /team against the 390px phone screen ----------
{
  const journey = read('scripts/e2e/journey.mjs');
  for (const path of ['/welcome', '/team']) assert.match(journey, new RegExp(`scrollWidth - 390\\); expect\\(over <= 1, \`${path} scrolls sideways`), path);
}
console.log('Family and public polish (#231): buttons, quick nav, Paid pill, inbox order, team wording, practice times, register band, tap targets, plan buttons');
