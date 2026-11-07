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
  assert.match(html, /<a class="button" href="\/api\/my-data\?format=download" download>/);
  assert.match(html, /<a class="button" href="\/register\?plan=monthly&amp;wrestler=/); assert.match(html, /<a class="button" href="\/register\?plan=walkin&amp;wrestler=/);
  // The quick nav wraps instead of scrolling sideways, so Memberships and Purchases stay on a phone screen.
  const quick = css.match(/\.quick\{[^}]*\}/)[0];
  assert.match(quick, /flex-wrap:wrap/); assert.doesNotMatch(css, /\.quick\{[^}]*overflow-x/, 'no hidden sideways scroll');
  assert.doesNotMatch(css, /\.quick a\{[^}]*white-space:nowrap[^}]*padding:0 1\dpx/, 'no side padding that misaligns a wrapped second line');
  // Shared tokens, not literals, for the page ground, width and the warning pill.
  assert.match(css, /body\{background:var\(--swa-ground\)/); assert.match(css, /main\{max-width:var\(--swa-width-narrow\)/);
  assert.match(css, /\.billing-pill\.warning\{background:var\(--swa-warn-bg\);color:var\(--swa-warn-ink\)\}/);
  assert.doesNotMatch(css, /#C4222C|#F4F5F7/i, 'red and the page ground come from tokens');
  // The pill beside Memberships starts hidden.
  assert.match(html, /<span class="billing-pill active" id="paymentsPill" hidden>Paid<\/span>/);
}
// The "Paid" pill shows only while a wrestler has an active membership in good standing.
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
    el('paymentsPill').hidden = true; // as in the page's markup
    await settle(); return el;
  };
  let el = await open([lesson]);
  assert.equal(el('paymentsPill').hidden, true, 'a paid lesson is not a membership: no "Paid" beside Memberships');
  assert.match(el('purchaseList').innerHTML, /Private lesson/, 'the lesson is still under Purchases');
  el = await open([]);
  assert.equal(el('paymentsPill').hidden, true, 'nothing paid: no pill');
  el = await open([lesson, membership({})]);
  assert.equal(el('paymentsPill').hidden, false, 'an active membership shows "Paid"');
  el = await open([membership({subscription_status: 'past_due'})]);
  assert.equal(el('paymentsPill').hidden, true, 'a past-due membership says "Payment needs attention" on its card instead');
  el = await open([membership({term_start: '2024-01-01', term_end: '2025-01-01'})]);
  assert.equal(el('paymentsPill').hidden, true, 'an ended membership is not active');
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

  // A coach with no bio gets a compact card that keeps to its own height (the card's markup has no .coach__bio).
  const teamCss = style(read('app/team/screen.html'));
  assert.match(teamCss, /\.coach:not\(:has\(\.coach__bio\)\)\{[^}]*align-self:start/);
  const team = W.renderTeam(read('app/team/screen.html'), site, [{name: 'Lee Tran', bio: 'Ten years.', specialties: []}, {name: 'Justin', bio: '', specialties: []}], null);
  assert.equal((team.match(/class="coach__bio"/g) || []).length, 1, 'only the coach with a bio has a bio block');
  // Shared width and page ground. (The coach card's own styles move to lib/website.ts in #223, so they are left as they are.)
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
  assert.equal((pageHead(html).match(/class="swa-head"/g) || []).length, 1, 'the Worker leaves the band as it is');
  assert.match(style(html), /main\{max-width:var\(--swa-width-narrow\)/);
}

// ---------- Waiver and consent: 44px "View / print" and "View copy" ----------
{
  const html = read('app/waiver/screen.html');
  assert.match(style(html), /a\.copy\{display:inline-flex;align-items:center;min-height:44px\}/);
  assert.match(html, /<a class="copy" href="\/waiver-copy\?id='\+encodeURIComponent\(s\.id\)\+'" target="_blank" rel="noopener">View \/ print<\/a>/);
  assert.match(html, /<a class="copy" href="\/waiver-copy\?id='\+encodeURIComponent\(s\.id\)\+'" target="_blank" rel="noopener">View copy<\/a>/);
  assert.match(style(html), /\.pill\.warn\{background:var\(--swa-warn-bg\);color:var\(--swa-warn-ink\)\}/);
  // /consent is the same page.
  assert.match(read('app/consent/route.ts'), /import html from '\.\.\/waiver\/screen\.html\?raw'/);
}

// ---------- Calendar: the two plan buttons sit in one group with a gap ----------
{
  const schedule = {month: '2026-11', today: '2026-11-11', programs: [{id: 'Intermediate', name: 'SWA Intermediate', grades: '7–12', description: '', monthlyCents: 20000, walkInCents: 4000}], practices: [], events: [], liveClasses: [], privateFormats: []};
  const {el, html} = run('app/calendar/screen.html', {fetch: async () => json(schedule)});
  await settle();
  assert.match(el('programCards').innerHTML, /<div class="plan-actions"><a class="button primary" href="\/register\?program=Intermediate&amp;plan=monthly" target="_top">Choose the monthly plan →<\/a><a class="button" href="\/register\?program=Intermediate&amp;plan=walkin" target="_top">Choose a walk-in →<\/a><\/div><\/article>/);
  assert.match(style(html), /\.plan-actions\{display:flex;flex-direction:column;gap:10px;margin-top:auto\}/);
  assert.match(style(html), /\.competition\{background:var\(--swa-prog-advance\)/, 'program colors from the shared tokens');
}

// ---------- The walkthrough checks /welcome and /team against the 390px phone screen ----------
{
  const journey = read('scripts/e2e/journey.mjs');
  for (const path of ['/welcome', '/team']) assert.match(journey, new RegExp(`scrollWidth - 390\\); expect\\(over <= 1, \`${path} scrolls sideways`), path);
}
console.log('Family and public polish (#231): buttons, quick nav, Paid pill, inbox order, team wording, practice times, register band, tap targets, plan buttons');
