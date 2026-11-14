// The design pass on the coach screens (Nov 14): what each screen shows when it has nothing to show, where an error is
// written, and the pieces of page script that changed. The page scripts run in a fake DOM (inline JavaScript is not
// typechecked). Layout that other tests already pin (the doors and Account menu on coach home, the mat screen's header
// box and phone rows, the month's day cells) stays in coach-polish.mjs, roster-mat.mjs and coach-month-calendar.mjs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {load} from './accounts.mjs';

const read = f => readFileSync(f, 'utf8');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const json = (body, ok = true) => ({ok, status: ok ? 200 : 400, json: async () => body});
// A page's scripts in order (shared public/*.js first, as the browser loads them) in a fake DOM.
function page(file, fetch, {hash = '', extra = {}} = {}) {
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, disabled: false, open: false, innerHTML: '', textContent: '', className: '', dataset: {}, style: {}, addEventListener() {}, reset() {}, focus() {}, querySelector: () => null, querySelectorAll: () => []}); return nodes.get(id); };
  const ctx = vm.createContext({document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, readyState: 'complete', head: {appendChild() {}}, createElement: () => ({})},
    location: {search: '', hash, assign() {}, reload() {}}, fetch, confirm: () => true, URLSearchParams, Date, JSON, Promise, Error, Object, Array, Number, String, Set, Map, Math, Intl, console, window: {}, setTimeout, FormData: class {}, ...extra});
  for (const [, src, code] of read(file).matchAll(/<script(?: src="\/([\w-]+\.js)")?>([\s\S]*?)<\/script>/g)) vm.runInContext(src ? read('public/' + src) : code, ctx);
  return {el, ctx, run: s => vm.runInContext(s, ctx)};
}

// ---------- 1. Coach home ----------
{
  const s = read('app/coach/screen.html');
  const coach = {name: 'Coach Dana', programs: ['Intermediate'], openings: []};
  const p = page('app/coach/screen.html', async u => json(u === '/api/roster' ? {today: '2026-11-14', sessions: []} : u === '/api/coach' ? coach : {}));
  await settle();
  // No lessons: an icon and one sentence that says what will show here; the button under it adds the first opening.
  assert.match(p.el('slots').innerHTML, /^<div class="empty"><svg[^>]*>[\s\S]*?<\/svg><p>You have no lessons or open times yet\. Add a one-hour opening and families can book it\.<\/p><\/div>$/);
  assert.equal(p.el('lessonsLede').hidden, true, 'what a lesson shows is explained once there is one');
  assert.equal(p.el('lessonsSummary').textContent, 'No lessons or open times yet');
  assert.match(s, /<div id="slots"><span class="skeleton row"><\/span><span class="skeleton row"><\/span><\/div><p id="status" role="status" aria-live="polite"><\/p>\n<details class="add" id="openingBox">/, 'rows shimmer while the lessons load; what went wrong with a lesson is written right under the list');
  // Today: nothing on is one sentence; the day reads as the academy writes it.
  assert.equal(p.el('sessions').innerHTML, '<p class="muted">Nothing is on the mat for your programs today.</p>'); assert.equal(p.el('todayDate').textContent, 'Saturday, Nov 14');
  // A practice box: name, time, count. A camp day with no time yet says so; text is escaped.
  p.ctx.list = [{title: 'Winter <camp>', type: 'event', start: null, end: null, entries: [{}], checkedIn: 0}, {title: 'Open mat', type: 'live', start: null, entries: [], checkedIn: 0}, {title: 'SWA Advance', start: '09:00', end: '10:30', entries: [{}, {}], checkedIn: 2}];
  assert.equal(p.run('todayHtml(list)'), '<div class="session"><span class="name">Winter &lt;camp&gt;</span><span class="time">Time to be announced</span><span class="count"><b>0 of 1</b> checked in</span></div>'
    + '<div class="session"><span class="name">Open mat</span><span class="time">All day</span><span class="count"><b>0 of 0</b> checked in</span></div>'
    + '<div class="session"><span class="name">SWA Advance</span><span class="time">9:00 AM–10:30 AM</span><span class="count"><b>2 of 2</b> checked in</span></div>');
  assert.equal(p.run('longDay("")'), ''); assert.equal(p.run('longDay("2026-12-02")'), 'Wednesday, Dec 2');
  // With lessons, the explanation shows again.
  coach.openings = [{id: 'o', date: '2026-11-20', start: '15:00', end: '16:00', format: null, capacity: 1, spotsLeft: 1, roster: []}];
  await p.run('load()'); await settle();
  assert.equal(p.el('lessonsLede').hidden, false); assert.match(p.el('slots').innerHTML, /^<article class="lesson"><p class="when"><b>Fri, Nov 20<\/b><span>3:00 PM–4:00 PM<\/span><\/p><div class="what"><p class="muted">Open for families to book\./);
  // The opening form says what went wrong under its own button, and clears it on the next try.
  const bad = page('app/coach/screen.html', async (u, o) => o?.method === 'POST' ? json({error: 'That time overlaps one of your openings.'}, false) : json(u === '/api/roster' ? {sessions: []} : u === '/api/coach' ? coach : {}),
    {extra: {FormData: class { [Symbol.iterator]() { return [['date', '2026-12-01'], ['start', '10:00'], ['end', '11:00'], ['format', ''], ['weeks', '1']][Symbol.iterator](); } }}});
  await settle();
  await bad.el('opening').onsubmit({preventDefault() {}, target: {}}); await settle();
  assert.equal(bad.el('openingNote').textContent, 'That time overlaps one of your openings.'); assert.equal(bad.el('status').textContent, '', 'not at the foot of the list');
  assert.match(s, /<button type="submit">Save opening<\/button><p id="openingNote" role="status" aria-live="polite"><\/p><\/form>/);
  // Lessons that cannot be loaded: a sentence in place of the skeleton rows.
  const down = page('app/coach/screen.html', async u => u === '/api/coach' ? json({error: 'Something went wrong. Please try again.'}, false) : json(u === '/api/roster' ? {sessions: []} : {}));
  down.el('slots').innerHTML = '<span class="skeleton row"></span>'; await down.run('load()'); await settle();
  assert.equal(down.el('slots').innerHTML, '<p class="muted">Your lessons could not be loaded. Refresh the page to try again.</p>'); assert.match(down.el('status').textContent, /Something went wrong/);
  // The Today card follows the academy's practice posts: a caps title with a rule under it, the day in grey caps, each
  // practice in an outlined box with the red bar on its left. On a desktop the clock sits beside the practices.
  assert.match(s, /<h2 class="tonight__title" id="todayTitle">Today on the mat<\/h2><p class="eyebrow" id="todayDate"><\/p><div id="sessions">/);
  assert.match(s, /html body \.tonight h2\.tonight__title\{[^}]*border-bottom:1px solid rgba\(255,255,255,\.28\);[^}]*text-transform:uppercase/);
  assert.match(s, /\.session\{[^}]*border:1px solid rgba\(255,255,255,\.24\);border-left:4px solid var\(--swa-red,#C4222C\)/);
  assert.match(s, /@media\(min-width:900px\)\{\nhtml body main>section\.tonight\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\);/);
  assert.match(s, /\.fields\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:12px\}\.fields \.wide\{grid-column:1\/-1\}\n@media\(min-width:640px\)\{\.fields\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/, 'the opening form is three fields across on a desktop, not a stretched phone form');
  assert.doesNotMatch(s, /style="/, 'no one-off inline styles');
}

// ---------- 2. Your hours ----------
{
  const s = read('app/coach-time/screen.html');
  const month = (o = {}) => ({month: '2026-11', monthLabel: 'November 2026', today: '2026-11-07', submitOpens: '2026-11-30', submitOpensText: 'Nov 30, 2026', canSubmit: false, next: null, handMonths: ['2026-11', '2026-10'],
    rates: [{label: 'Head coach', centsPerHour: 4000}], timeOff: [], timeOffRequests: [], notices: [], totals: {minutes: 0, amountCents: 0, shifts: 0, drafts: 0, open: 0, submitted: 0, breakdown: []}, shifts: [], ...o});
  const notice = n => ({subject: 'Notice ' + n, body: 'Body ' + n, at: '2026-11-0' + n + 'T15:00:00Z'});
  const p = page('app/coach-time/screen.html', async () => json({}));
  // A month with no shifts: one sentence, and no tiles of zeros, no state line saying it again, nothing to send.
  p.ctx.m = month(); p.run('render(m)');
  assert.match(p.el('shifts').innerHTML, /^<div class="empty"><svg[^>]*>[\s\S]*?<\/svg><p>No shifts in November 2026 yet\. Clock in at practice and each shift shows here\.<\/p><\/div>$/);
  assert.equal(p.el('monthTotals').hidden, true); assert.equal(p.el('monthState').hidden, true); assert.equal(p.el('sendBox').hidden, true);
  assert.equal(p.el('noticeBox').hidden, true, 'no notices: no Notices card'); assert.equal(p.el('notices').innerHTML, '');
  assert.equal(p.el('offList').innerHTML, '<p class="empty">No time off requests yet.</p>');
  assert.equal(p.el('rates').textContent, 'Rates: Head coach $40.00 an hour. Only the scheduled practice time is paid.');
  // A month with a shift: the tiles, the state, the list under its label, and the Send button with its hint.
  p.ctx.m = month({totals: {minutes: 90, amountCents: 6000, shifts: 1, drafts: 1, open: 0, submitted: 0, breakdown: [{label: 'SWA Intermediate', duty: 'Head coach', minutes: 90, amountCents: 6000}]},
    shifts: [{id: 's1', revision: 3, status: 'draft', date: '2026-11-02', session: {title: 'SWA Intermediate', start: '18:00', end: '19:30'}, dutyLabel: 'Head coach', inTime: '18:00', outTime: '19:30', paidMinutes: 90, amountCents: 6000, flags: []}],
    notices: [1, 2, 3, 4, 5].map(notice), olderNotices: true});
  p.run('render(m)');
  assert.equal(p.el('monthTotals').hidden, false); assert.equal(p.el('monthState').hidden, false); assert.equal(p.el('sendBox').hidden, false); assert.equal(p.el('tShifts').textContent, 1);
  assert.match(p.el('shifts').innerHTML, /^<h3 class="swa-label">Shifts<\/h3><details class="shift draft"><summary><span class="s-date">Mon, Nov 2<\/span>/);
  assert.match(p.el('shifts').innerHTML, /<details class="fix"><summary>Fix the times<\/summary><div class="stack"><div class="pair times">[\s\S]*<p class="form-note" id="fixNote-s1" role="status" aria-live="polite"><\/p><\/div><\/details>/, 'the fix form has its own line for what went wrong');
  // Notices: the newest three in view, the rest behind one line; the date as on the rest of the site.
  assert.equal(p.el('noticeBox').hidden, false);
  const n = p.el('notices').innerHTML;
  assert.match(n, /^<div class="note-item"><p><b>Notice 1<\/b><span class="when">Sun, Nov 1<\/span><\/p><p>Body 1<\/p><\/div>/);
  assert.equal(n.split('<details class="older">')[0].match(/class="note-item"/g).length, 3);
  assert.match(n, /<details class="older"><summary>Show 2 earlier notices<\/summary><div class="note-item">[\s\S]*Notice 5[\s\S]*<\/details><p class="muted">Showing your newest 5 notices\. Older ones were emailed to you\.<\/p>$/);
  p.ctx.list = [1, 2, 3, 4].map(notice); assert.match(p.run('noticesHtml(list,false)'), /<summary>Show 1 earlier notice<\/summary>/);
  p.ctx.list = [1, 2, 3].map(notice); assert.doesNotMatch(p.run('noticesHtml(list,false)'), /details/);
  assert.doesNotMatch(s, /class="notice"/, 'not the class name "notice": the shared stylesheet rounds it, which bent the lines between notices');
  // What went wrong is written under the button that was pressed, and cleared when the month is drawn again.
  const bad = page('app/coach-time/screen.html', async (u, o) => o?.method === 'POST' ? json({error: 'Choose an end time after the start time.'}, false) : json(month()));
  await settle();
  assert.equal(await bad.run('act({action:"add"},"Shift added.","addNote")'), ''); assert.equal(bad.el('addNote').textContent, 'Choose an end time after the start time.'); assert.equal(bad.el('status').textContent, '');
  assert.equal(await bad.run('act({action:"submit"},"x","sendNote")'), ''); assert.equal(bad.el('sendNote').textContent, 'Choose an end time after the start time.');
  assert.equal(await bad.run('act({action:"x"},"x")'), ''); assert.equal(bad.el('status').textContent, 'Choose an end time after the start time.', 'no note to write in: the status line');
  bad.ctx.m = month(); bad.run('render(m)'); assert.equal(bad.el('addNote').textContent, ''); assert.equal(bad.el('sendNote').textContent, '');
  for (const [form, note] of [['addForm', 'addNote'], ['offForm', 'offFormNote']]) assert.match(s, new RegExp(`<form id="${form}"[\\s\\S]*?<button type="submit">[^<]+</button><p id="${note}" class="form-note" role="status" aria-live="polite"></p></form>`), form);
  // A month that cannot be loaded says so in place of the skeleton rows.
  const down = page('app/coach-time/screen.html', async () => json({error: 'Sign in again.'}, false)); await settle();
  assert.equal(down.el('shifts').innerHTML, '<p class="muted">Your month could not be loaded. Refresh the page to try again.</p>'); assert.equal(down.el('status').textContent, 'Sign in again.');
  // Time off: the requests first, the form behind its button; "Time off" on coach home opens the page at the form.
  assert.match(s, /<section class="card" id="timeOff" aria-labelledby="offTitle"><h2 id="offTitle">Time off<\/h2>\n<div id="offList"><\/div><p id="offNote" class="form-note" role="status" aria-live="polite"><\/p>\n<details class="ask" id="offBox"><summary>Ask for time off<\/summary><form id="offForm" class="stack">/);
  assert.equal(p.el('offBox').open, false);
  assert.equal(page('app/coach-time/screen.html', async () => json(month()), {hash: '#timeOff'}).el('offBox').open, true);
  assert.match(read('app/coach/screen.html'), /<a class="swa-door" href="\/coach-time#timeOff">/);
  // A desktop is two columns (the month wide, the clock, time off and notices beside it); the month's heading is the picker.
  assert.match(s, /@media\(min-width:900px\)\{\.cols\{grid-template-columns:minmax\(0,1\.55fr\) minmax\(0,1fr\);/);
  assert.match(s, /<div class="cols">\n<section class="card" id="clock" data-coach-clock data-link="off" aria-labelledby="clockTitle">/);
  assert.match(s, /Nothing is canceled\./); assert.doesNotMatch(s, /cancelled/);
}

// ---------- 3. Your contract opens with the way back, like the other coach pages ----------
{
  const src = read('app/contract/route.ts'), waiver = read('app/waiver/screen.html');
  assert.ok(waiver.includes('<main><h1 id="title">'), 'the signing page still opens the way the contract route expects');
  assert.match(src, /const BACK='<a class="swa-back" href="\/coach">← Coach home<\/a>';/); assert.match(src, /\.replace\('<main><h1 id="title">','<main>'\+BACK\+'<h1 id="title">'\)/);
  const pages = load('lib/protected-page.ts'), chrome = load('lib/page-chrome.ts');
  const html = pages.retitle(waiver, 'Waiver', 'Coach contract').replace('<main><h1 id="title">', '<main><a class="swa-back" href="/coach">← Coach home</a><h1 id="title">');
  assert.match(chrome.decoratePage(html, '/contract'), /<div class="swa-title"><div class="swa-title__text"><a class="swa-back" href="\/coach">← Coach home<\/a><h1 id="title">Coach contract<\/h1><\/div><\/div>/);
}

// ---------- 4. Coach join: the third step is accepting; a dead end offers Sign in ----------
{
  const s = read('app/coach-join/screen.html');
  assert.match(s, /<li id="step1">Your account<\/li><li id="step2">Confirm email<\/li><li id="step3">Accept<\/li><li id="step4">Coach home<\/li>/, 'no authenticator step: none is required (issue #306)');
  const invite = status => ({name: 'Coach Lee', email: 'coach.lee@example.test', programs: [], expiresAt: '2026-12-01T00:00:00Z', status});
  const open = async (reply, hash = '#invite=' + 'a'.repeat(64)) => { const p = page('app/coach-join/screen.html', async () => json(reply), {hash}); await settle(); return p; };
  let p = await open({invite: null, signedIn: null});
  assert.equal(p.el('signinBox').hidden, false, 'no invitation: Sign in is the one way on'); assert.equal(p.el('footSignin').hidden, true, 'offered once, not also in the footer'); assert.match(p.el('intro').textContent, /^Open the invitation link/);
  p = await open({invite: invite('used'), signedIn: null}); assert.equal(p.el('signinBox').hidden, false); assert.match(p.el('intro').textContent, /already used\. Sign in/);
  p = await open({invite: invite('expired'), signedIn: null}); assert.equal(p.el('signinBox').hidden, true, 'an expired link needs a new one, not a sign-in'); assert.equal(p.el('footSignin').hidden, false);
  assert.match(s, /<p id="signinBox" hidden><a class="button" href="\/login">Sign in<\/a><\/p>/);
  assert.match(s, /<footer><span>Savage Wrestling Academy · Huntington Station, NY<\/span><a href="\/login" id="footSignin">Sign in<\/a><\/footer>/);
}

// ---------- 5. Lesson openings (the owner's page): the same lesson rows and US spelling as coach home ----------
{
  const s = read('app/coach-openings/screen.html'), home = read('app/coach/screen.html');
  for (const f of [s, home]) { assert.match(f, /Family-requested private group, organized by /); assert.doesNotMatch(f, /organised|cancelled/); }
  assert.match(s, /return `<article\$\{roster\.length\?' class="booked"':''\}>\$\{when\}<div class="what">\$\{body\}\$\{edit\}\$\{remove\}<\/div><\/article>`;/);
  assert.match(s, /<span class="pill neutral spots">/); assert.doesNotMatch(s, /border-color:var\(--swa-ok\)/, 'a booked lesson is marked by its green bar, not a green outline');
  assert.match(s, /<div class="flow"><label>Lesson type<select id="format">[\s\S]*?<label>Repeat<select id="weeks">[\s\S]*?<\/label><\/div><p class="muted" id="repeatHelp" hidden><\/p>/);
}

// ---------- 6. Coach help and the profile page follow the new coach home ----------
{
  const help = read('app/help/coach/screen.html');
  assert.match(help, /Choose <strong>Practice plans<\/strong> on your <a href="\/coach">coach home<\/a>\./); assert.match(help, /under <strong>Account<\/strong> on your coach home/);
  assert.doesNotMatch(help, /Your month and practice plans|organised/);
  const profile = read('app/coach-profile/screen.html');
  assert.match(profile, /<div class="cols"><section class="card" aria-labelledby="aboutTitle">/); assert.match(profile, /<section class="preview" aria-labelledby="previewTitle">[\s\S]*<\/section><\/div>\n<p id="status"/);
  assert.match(profile, /@media\(min-width:900px\)\{\.cols\{grid-template-columns:minmax\(0,1\.5fr\) minmax\(0,1fr\);align-items:start\}\.cols>\.preview\{position:sticky;top:84px\}\}/);
}

// ---------- 7. No coach page puts the class name "empty" on something that is not an empty-state block ----------
for (const f of ['app/coach/screen.html', 'app/coach-time/screen.html', 'app/practice-plans/screen.html', 'app/roster/screen.html', 'app/coach-openings/screen.html', 'app/coach-profile/screen.html']) {
  const s = read(f);
  for (const m of s.matchAll(/class="([^"]*\bempty\b[^"]*)"/g)) assert.equal(m[1], 'empty', f + ': "' + m[1] + '"');
  assert.doesNotMatch(s, /\+' empty'|\?' empty'/, f);
}
console.log('Coach design pass: coach home (no lessons, the practice box, the day, the opening form\'s own error line, lessons that cannot load), Your hours (an empty month without tiles of zeros, notices folded after three, errors under the button pressed, time off behind its button, two columns on a desktop), the contract\'s back link, coach join\'s steps and Sign in, lesson openings and help in step with coach home, and no stray "empty" class.');
