// Issue #223, design polish on the coach pages: one hours-and-minutes formatter for every duration (server flags and
// page scripts agree), coach home shortcuts, the /coach-time Send button and tiles, /timesheets labels, the coach
// profile preview that reuses the team page's card, and one back link per page. The page scripts run in a fake DOM
// (inline JavaScript is not typechecked). The month calendar's folding is tested in coach-month-calendar.mjs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {load, request} from './accounts.mjs';

const T = load('lib/coach-time.ts'), W = load('lib/website.ts');
const read = f => readFileSync(f, 'utf8');
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };
// A page's scripts in order (shared public/*.js first, as the browser loads them) in a fake DOM.
function page(file, fetch, extra = {}) {
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, disabled: false, innerHTML: '', textContent: '', dataset: {}, style: {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => []}); return nodes.get(id); };
  const ctx = vm.createContext({document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, readyState: 'complete', head: {appendChild() {}}, createElement: () => ({})},
    location: {search: '', hash: ''}, fetch, confirm: () => true, URLSearchParams, Date, JSON, Promise, Error, Object, Array, Number, String, Set, Map, Math, console, window: {}, FormData: class {}, ...extra});
  for (const [, src, code] of read(file).matchAll(/<script(?: src="\/([\w-]+\.js)")?>([\s\S]*?)<\/script>/g)) vm.runInContext(src ? read('public/' + src) : code, ctx);
  return {el, ctx, run: s => vm.runInContext(s, ctx)};
}
const json = body => ({ok: true, status: 200, json: async () => body});

// ---------- 1. One formatter for durations ----------
{
  const c = vm.createContext({}); vm.runInContext(read('public/hours-text.js'), c);
  const page = m => vm.runInContext('hoursText(' + JSON.stringify(m) + ')', c);
  for (const [m, text] of [[224, '3 h 44 min'], [60, '1 h'], [120, '2 h'], [45, '45 min'], [0, '0 min'], [61.9, '1 h 1 min'], [-5, '0 min'], ['90', '1 h 30 min'], [null, '0 min']]) {
    assert.equal(page(m), text, 'page ' + m); assert.equal(T.hoursText(m), text, 'server ' + m);
  }
  for (let m = 0; m <= 1500; m++) assert.equal(page(m), T.hoursText(m), 'page and server agree at ' + m);
  // Flags read in hours and minutes too, never "224 min".
  const base = {id: 'x', user_id: 'u', coach_email: 'c@x', coach_name: 'C', work_date: '2026-11-02', session_key: 'practice:Intermediate:2026-11-02:18:00', session_title: 'SWA Intermediate',
    session_start: '18:00', session_end: '19:30', duty: 'head', source: 'clock', clock_in: '2026-11-03T02:44:00.000Z', clock_out: null, fixed_in: null, fixed_out: null,
    coach_note: null, submitted_at: null, owner_minutes: null, owner_duty: null, owner_note: null, approved_at: null, approved_by: null, approved_minutes: null, approved_duty: null,
    approved_rate_cents: null, approved_cents: null, voided_at: null, voided_by: null, void_reason: null, history: '[]', revision: 1, created_at: 'x'};
  deq(T.shiftFlags(base), ['Still clocked in: no clock-out yet.', 'Clocked in 3 h 44 min after SWA Intermediate started.']);
  deq(T.shiftFlags({...base, clock_in: '2026-11-02T21:30:00.000Z', clock_out: '2026-11-03T02:14:00.000Z'}),
    ['Clocked in 1 h 30 min before SWA Intermediate started.', 'Clocked out 1 h 44 min after SWA Intermediate ended.', 'Clocked 4 h 44 min, 3 h 14 min longer than the practice. Only the practice time is paid.']);
  // Every page that shows durations loads the shared formatter before its own script and has no formatter of its own.
  for (const f of ['app/coach/screen.html', 'app/coach-time/screen.html', 'app/timesheets/screen.html']) {
    const s = read(f), at = s.indexOf('<script src="/hours-text.js"></script>');
    assert.ok(at > 0 && at < s.indexOf('<script>') && (s.indexOf('/coach-clock.js') < 0 || at < s.indexOf('/coach-clock.js')), f + ' loads /hours-text.js first');
    assert.doesNotMatch(s, /Math\.floor\(m\/60\)|' min'/, f + ' has no formatter of its own');
  }
  assert.doesNotMatch(read('public/coach-clock.js'), /Math\.floor\(m \/ 60\)/, 'the clock card uses the shared formatter');
}

// ---------- 2. /coach-time: tiles, the Send button and its hint ----------
{
  const s = read('app/coach-time/screen.html');
  assert.match(s, /@media\(max-width:520px\)\{\.tiles\{grid-template-columns:1fr 1fr\}\.tiles \.tile:first-child\{grid-column:1\/-1\}\}/, 'three tiles on a phone: one across, two under it');
  assert.equal((s.match(/<div class="tile">/g) || []).length, 3);
  assert.match(s, /html body \.send button\.primary:disabled,html body \.send button\.primary:disabled:hover\{background:#EEF0F2;[^}]*color:#55585F;opacity:1/, 'a neutral grey Send button until it opens');
  const p = page('app/coach-time/screen.html', async () => json({}));
  const help = d => { p.ctx.d = d; return p.run('submitHelp(d)'); };
  const nov = (o, totals) => ({monthLabel: 'November 2026', submitOpens: '2026-11-30', submitOpensText: 'Nov 30, 2026', today: '2026-11-07', canSubmit: false, ...o, totals: {drafts: 0, open: 0, shifts: 0, submitted: 0, ...totals}});
  assert.equal(help(nov({}, {})), 'You can send November 2026 from Nov 30, 2026, its last day.', 'no shifts yet: says when it opens');
  assert.equal(help(nov({}, {drafts: 3, shifts: 4, open: 1})), 'Clock out first. You can send November 2026 from Nov 30, 2026, its last day.');
  assert.equal(help(nov({}, {drafts: 3, shifts: 3})), 'You can send November 2026 from Nov 30, 2026, its last day.');
  assert.equal(help(nov({today: '2026-12-01'}, {drafts: 1, shifts: 1, open: 1})), 'Clock out first.');
  assert.equal(help(nov({today: '2026-12-01'}, {shifts: 2, submitted: 2})), 'Nothing new to send.');
  assert.equal(help(nov({today: '2026-12-01'}, {})), 'No shifts to send for November 2026.');
  assert.match(help(nov({today: '2026-11-30', canSubmit: true}, {drafts: 2, shifts: 2})), /^Sends every shift in November 2026/);
  // The month renders in hours and minutes.
  p.ctx.m = {month: '2026-11', monthLabel: 'November 2026', today: '2026-11-07', submitOpens: '2026-11-30', submitOpensText: 'Nov 30, 2026', canSubmit: false, next: null, handMonths: ['2026-11', '2026-10'],
    rates: [{label: 'Head coach', centsPerHour: 4000}], timeOff: [], timeOffRequests: [], notices: [],
    totals: {minutes: 224, amountCents: 14933, shifts: 2, drafts: 2, open: 0, submitted: 0, breakdown: [{label: 'SWA Intermediate', duty: 'Head coach', minutes: 224, amountCents: 14933}]},
    shifts: [{id: 's1', revision: 1, status: 'draft', date: '2026-11-02', session: null, dutyLabel: 'Head coach', inTime: '18:00', outTime: '21:44', paidMinutes: 224, amountCents: 14933, flags: ['Clocked in 3 h 44 min after SWA Intermediate started.']}]};
  p.run('render(m)');
  assert.equal(p.el('tMinutes').textContent, '3 h 44 min'); assert.match(p.el('breakdown').innerHTML, /3 h 44 min · \$149\.33/);
  assert.match(p.el('shifts').innerHTML, /Paid 3 h 44 min · \$149\.33/); assert.doesNotMatch(p.el('shifts').innerHTML + p.el('breakdown').innerHTML, /\b224 min/);
  assert.equal(p.el('submit').disabled, true); assert.equal(p.el('submit').textContent, 'Send November 2026 to the academy');
  assert.equal(p.el('submitHelp').textContent, 'You can send November 2026 from Nov 30, 2026, its last day.');
}

// ---------- 3. /timesheets: hours and minutes, the download label ----------
{
  const s = read('app/timesheets/screen.html');
  assert.match(s, /<a class="button" id="csv" href="#">Download spreadsheet<\/a>/); assert.doesNotMatch(s, /\(CSV\)/);
  const p = page('app/timesheets/screen.html', async () => json({}));
  p.ctx.c = {email: 'd@x', name: 'Coach Dana', active: true, state: 'not-submitted', programs: ['Intermediate'], timeOff: [], lessons: null,
    totals: {shifts: 1, minutes: 224, amountCents: 14933, approved: 0, drafts: 1, open: 0, flagged: 1, breakdown: [{label: 'SWA Intermediate', duty: 'Head coach', shifts: 1, minutes: 224, amountCents: 14933}]},
    shifts: [{id: 's1', revision: 1, status: 'draft', date: '2026-11-02', session: null, dutyLabel: 'Head coach', duty: 'head', inTime: '18:00', outTime: '21:44', clockedMinutes: 224, paidMinutes: 224, rateCents: 4000, amountCents: 14933, flags: []}]};
  const h = p.run('coachHtml(c,"2026-11","November 2026")');
  assert.match(h, /1 shift · 3 h 44 min paid/); assert.match(h, /Clocked 6:00 PM – 9:44 PM \(3 h 44 min\)/); assert.match(h, /Paid 3 h 44 min at \$40\.00 an hour/); assert.doesNotMatch(h, /\b224 min/);
}

// ---------- 4. Coach home: tonight first, then two rows, the opening form behind the lessons (issue #286) ----------
{
  const s = read('app/coach/screen.html');
  const at = re => { const m = s.search(re); assert.ok(m >= 0, 'coach home has ' + re); return m; };
  // Order on the page: the title, the notices, the dark Today card (its sessions, the clock, the actions), the two
  // rows, the week, the lessons with the opening form behind them, then More.
  const order = [/<h1 id="heading">/, /<p id="contractTodo" class="owner-note" hidden><\/p>/, /<section class="dark tonight" id="tonight"/, /<div id="sessions">/,
    /<section id="clockCard" data-coach-clock aria-labelledby="clockCardTitle">/, /<a class="button" id="openCheckin" href="\/roster">Open check-in<\/a>/,
    /<nav class="rows" aria-label="Lessons and hours">/, /<section aria-labelledby="weekTitle">/, /<section id="lessons" aria-labelledby="lessonsTitle">/, /<div id="slots">/,
    /<details class="add" id="openingBox"><summary>Add a one-hour opening<\/summary><form id="opening">/, /<h2 id="moreTitle">More<\/h2>/];
  order.reduce((prev, re) => { const i = at(re); assert.ok(i > prev, re + ' comes after the one before it'); return i; }, -1);
  // The two rows and the More links. No grid of shortcuts; the contract to-do is a notice, never the primary button.
  const rows = s.match(/<nav class="rows"[\s\S]*?<\/nav>/)[0];
  deq([...rows.matchAll(/<a href="([^"]+)"><span><b>([^<]+)<\/b>/g)].map(m => [m[2], m[1]]), [['Lessons', '#lessons'], ['Your hours', '/coach-time']]);
  const more = s.match(/<div class="more">([\s\S]*?)<\/div>/)[1];
  deq([...more.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map(m => [m[2], m[1]]),
    [['Your month and practice plans →', '/practice-plans'], ['Your profile →', '/coach-profile'], ['Coach help →', '/help/coach'], ['Your contract →', '/contract'], ['Time off →', '/coach-time'], ['Account security →', '/security']]);
  assert.doesNotMatch(s, /quickContract|class="quick"|Sign your contract/, 'no shortcut grid and no primary contract button');
  assert.doesNotMatch(s, /<a class="button primary"/, 'the one red action before the clock state is known is the clock-in button');
  // The dark card restates the clock card's colors, and once the coach is on the clock, check-in turns red and Clock
  // out steps back.
  assert.match(s, /html body #clockCard \.cc-role button\[aria-pressed=true\]\{background:#fff;color:var\(--swa-ink,#111113\)/);
  assert.match(s, /html body \.tonight\.on #clockCard \.cc-big\[data-cc="out"\]\{background:transparent/);
  assert.match(s, /\$\('openCheckin'\)\.classList\?\.toggle\('primary',on\)/, 'Open check-in turns red when the coach is clocked in');
  // The page script: the card's word, the Lessons row's line, today's plan line.
  const p = page('app/coach/screen.html', async u => json(u === '/api/roster' ? {sessions: [{title: 'SWA Intermediate', start: '18:00', end: '19:30', entries: [{}, {}], checkedIn: 1}]}
    : u === '/api/coach' ? {name: 'Coach Dana', programs: ['Intermediate'], openings: [
      {id: 'a', date: '2026-11-09', start: '15:00', end: '16:00', format: 'one-on-one', formatName: 'One-on-one lesson', capacity: 1, spotsLeft: 0, roster: [{wrestler: 'Sam', parent: 'Pat', status: 'paid'}]},
      {id: 'b', date: '2026-11-10', start: '15:00', end: '16:00', format: null, capacity: 1, spotsLeft: 1, roster: []}, {id: 'c', date: '2026-11-11', start: '15:00', end: '16:00', format: null, capacity: 1, spotsLeft: 1, roster: []}]}
    : u === '/api/practice-plans?summary=1' ? {today: '2026-11-09', plans: [{program: 'Intermediate', date: '2026-11-09', published: true, title: 'Leg attacks'}, {program: 'Intermediate', date: '2026-11-10', published: true, title: 'Not today'}]} : {}));
  await settle();
  assert.equal(p.el('todayTitle').textContent, 'Tonight on the mat', 'every session starts at 4 PM or later');
  assert.equal(p.el('lessonsSummary').textContent, '1 booked · 2 open times');
  assert.equal(p.el('planLine').innerHTML, 'Plan shared for today: <b>Leg attacks</b>'); assert.equal(p.el('planLink').href, '/practice-plans?date=2026-11-09');
  const word = sessions => { p.ctx.sess = sessions; return p.run('tonightWord(sess)'); };
  assert.equal(word([{start: '09:00'}, {start: '18:00'}]), 'Today on the mat'); assert.equal(word([]), 'Today on the mat'); assert.equal(word([{start: '16:00'}]), 'Tonight on the mat');
  p.ctx.list = []; assert.equal(p.run('lessonsSummary(list)'), 'No lessons or open times yet');
  p.ctx.list = [{roster: [{}]}]; assert.equal(p.run('lessonsSummary(list)'), '1 booked');
  p.ctx.d = {today: '2026-11-09', plans: []}; assert.equal(p.run('planLine(d)'), '');
  p.ctx.d = {today: '2026-11-09', plans: [{date: '2026-11-09', published: true, title: '<b>x</b>'}]}; assert.equal(p.run('planLine(d)'), 'Plan shared for today: <b>&lt;b&gt;x&lt;/b&gt;</b>', 'escaped');
  // The contract to-do shows when the coach has not signed the version in force, and hides once they have.
  for (const [signed, hidden] of [[false, false], [true, true]]) {
    const p = page('app/coach/screen.html', async u => json(u === '/api/contract' ? {document: {title: 'Coach contract 2026'}, signatures: signed ? [{current: true}] : []} : u === '/api/roster' ? {sessions: []} : u === '/api/coach' ? {name: 'Coach Dana', programs: [], openings: []} : {}));
    await settle();
    assert.equal(p.el('contractTodo').hidden, hidden, 'contract to-do, signed=' + signed);
  }
}

// ---------- 5. /coach-profile: the preview is the team page's card ----------
{
  const s = read('app/coach-profile/screen.html');
  assert.doesNotMatch(s, /photo/i, 'no promise of photos');
  const p = page('app/coach-profile/screen.html', async () => json({}));
  const cases = [{name: 'Lee Tran', bio: 'Ten years coaching folkstyle.\n\nFormer state qualifier.\nStill wrestles.', specialties: ['Takedowns', 'Mat returns']},
    {name: '<i>Coach</i> "Lee"', bio: '<script>alert(1)</script> & more', specialties: ['<b>Top</b>']}, {name: 'dana', bio: '', specialties: []}, {name: '  ', bio: 'x', specialties: []}];
  for (const c of cases) { p.ctx.c = c; assert.equal(p.run('teamCard(c)'), W.coachCard(c), 'the preview card matches the team page: ' + c.name); }
  assert.match(W.coachCard(cases[1]), /&lt;script&gt;/);
  // As the coach types: the card, specialties without repeats, the bio as the server saves it, and a note with no bio.
  p.el('displayName').value = ' Lee Tran '; p.el('bio').value = 'Line one\r\n\r\n\r\n\r\nLine two  '; p.el('specialties').value = 'Takedowns, takedowns, , Mat returns';
  p.run('preview()');
  assert.equal(p.el('preview').innerHTML, W.coachCard({name: 'Lee Tran', bio: 'Line one\n\nLine two', specialties: ['Takedowns', 'Mat returns']}));
  assert.equal(p.el('previewNote').hidden, true);
  p.el('bio').value = '  '; p.run('preview()'); assert.equal(p.el('previewNote').hidden, false); assert.doesNotMatch(p.el('preview').innerHTML, /coach__bio/);
  // The styles come from the same place as the team page's.
  const route = file => { const module = {exports: {}}; vm.runInNewContext(ts.transpileModule(read(file), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText, {module, exports: module.exports, require(name) {
    const path = resolve(dirname(file), name.replace(/\?raw$/, '')); return name.endsWith('?raw') ? {__esModule: true, default: read(path)} : load(path + '.ts'); }}); return module.exports; };
  const r = await route('app/coach-profile/route.ts').GET(request('/coach-profile', 'GET', null, 'owner'));
  assert.equal(r.status, 200); const html = await r.text();
  assert.ok(html.includes(W.COACH_CARD_CSS), 'the profile page has the team card styles'); assert.doesNotMatch(html, /<!--slot:/);
  const team = W.renderTeam(read('app/team/screen.html'), {headline: 'x', intro: 'x', mission: '', coaches: [], achievements: [], alumni: [], address: '', email: ''}, [cases[0]], null);
  assert.ok(team.includes(W.COACH_CARD_CSS) && team.includes(W.coachCard(cases[0])), 'the team page uses the same card and styles');
  assert.doesNotMatch(read('app/team/screen.html'), /\.coach\{|\.mono\{/, 'the card styles live in one place');
}

// ---------- 6. One back link per page, and the list's Refresh button is gone ----------
{
  for (const [f, text] of [['app/coach-time/screen.html', '← Coach home'], ['app/coach-profile/screen.html', '← Coach home'], ['app/practice-plans/screen.html', '← Coach home']]) {
    const s = read(f), opening = s.slice(s.indexOf('<main>'), s.indexOf('<h1'));
    assert.match(opening, new RegExp('<a [^>]*class="swa-back"[^>]*>' + text + '</a>'), f + ' back link');
    assert.equal((opening.match(/<a [^>]*>/g) || []).filter(a => !/ hidden>$/.test(a)).length, 1, f + ' shows one back link');
  }
  assert.doesNotMatch(read('app/practice-plans/screen.html'), /Refresh plans|id="reload"/);
  // Owner pages have the owner shell's sidebar instead of a back link (issue #261).
  assert.doesNotMatch(read('app/timesheets/screen.html'), /class="swa-back"/);
}
console.log('Coach polish tests passed: one hours-and-minutes formatter on pages and in flags, /coach-time tiles and the grey Send button with when it opens, /timesheets labels, coach home with tonight first and the opening form behind the lessons, the profile preview is the team page card with its styles, one back link per page.');
