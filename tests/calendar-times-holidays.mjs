// Issue #189: times for each camp, clinic and event day, U.S. holidays as a label on the calendars, and today
// highlighted on every calendar and date grid. Inline page scripts run with a fake DOM, because they are not typechecked.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {portalCode} from './fixtures/portal-script.mjs';

// ---------- Server code ----------
const cache = new Map();
function load(file, stubs = {}) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, Intl, Date, JSON, Math, Map, Set, URL, console,
      require(name) { if (name in stubs) return stubs[name]; if (name.startsWith('.')) return load(path.join(path.dirname(file), name) + '.ts', stubs); throw Error('unexpected import ' + name); }});
  return module.exports;
}
const {validEventSchedule, eventSessions, eventDays} = load('lib/event-schedule.ts');
const {federalHolidays, holidaysInMonth} = load('lib/holidays.ts');
const {validState} = load('lib/academy-validation.ts');
const {publicSchedule} = load('lib/public-schedule.ts');
const {sessionsOn} = load('lib/roster.ts', {'cloudflare:workers': {env: {}}, './usaw': {cardStatus() {}}, './waivers': {currentWaiver() {}}, './transfers': {PROGRAM_ON: ''}});

// Event times: one entry per timed day, both times, start before end; days may stay without a time.
const dates = ['2026-12-12', '2026-12-13'];
assert.equal(validEventSchedule(dates, []), true, 'no times yet is fine');
assert.equal(validEventSchedule(dates, [{date: '2026-12-13', start: '09:00', end: '12:00'}]), true, 'some days timed');
assert.equal(validEventSchedule(dates, [{date: '2026-12-12', start: '09:00', end: '12:00'}, {date: '2026-12-13', start: '10:00', end: '13:30'}]), true);
for (const bad of [[{date: '2026-12-14', start: '09:00', end: '12:00'}], [{date: '2026-12-12', start: '12:00', end: '09:00'}], [{date: '2026-12-12', start: '09:00', end: '09:00'}],
  [{date: '2026-12-12', start: '9:00', end: '12:00'}], [{date: '2026-12-12', start: '09:00'}], [{date: '2026-12-12', start: '09:00', end: '12:00'}, {date: '2026-12-12', start: '13:00', end: '14:00'}],
  [{date: '2026-12-12', start: '09:00', end: '12:00', note: 'x'}], 'times', [null]])
  assert.equal(validEventSchedule(dates, bad), false, JSON.stringify(bad));
assert.deepEqual(JSON.parse(JSON.stringify(eventSessions(dates, [{date: '2026-12-13', start: '10:00', end: '13:30'}, {date: '2026-12-12', start: '09:00', end: '12:00'}]))).map(s => s.date), ['2026-12-12', '2026-12-13'], 'sorted by date');
assert.deepEqual(JSON.parse(JSON.stringify(eventSessions(dates, undefined))), [], 'events saved before times: none');
assert.deepEqual(JSON.parse(JSON.stringify(eventSessions(dates, [{date: 'nope'}]))), [], 'a damaged schedule shows no times');
assert.deepEqual(JSON.parse(JSON.stringify(eventDays(dates, [{date: '2026-12-13', start: '10:00', end: '13:30'}]))), [{date: '2026-12-12', start: null, end: null}, {date: '2026-12-13', start: '10:00', end: '13:30'}]);

// Saved state: old events and backups without times stay valid; a bad schedule is refused.
const base = {kids: [], bookings: [], messages: [], offers: [], seasons: [], staff: [], attendance: {}, settings: {}};
const camp = {id: 'camp', name: 'Winter camp', type: 'Camp', dates, price: 160, slots: 20};
assert.equal(validState({...base, events: [camp]}), true, 'an event saved without times');
assert.equal(validState({...base, events: [{...camp, schedule: [{date: '2026-12-12', start: '09:00', end: '12:00'}]}]}), true);
assert.equal(validState({...base, events: [{...camp, schedule: [{date: '2026-12-20', start: '09:00', end: '12:00'}]}]}), false, 'a time for a day the event does not have');
assert.equal(validState({...base, events: [{...camp, schedule: [{date: '2026-12-12', start: '13:00', end: '12:00'}]}]}), false, 'end before start');
assert.equal(validState({...base, events: [{id: 'old', name: 'Old clinic', type: 'Clinic', date: 'Some day', price: 0, slots: 5, schedule: []}]}), false, 'times need real dates');

// Holidays: actual and observed U.S. federal holidays, the same list as the owner's semester planner.
const h2026 = federalHolidays(2026).map(h => h.date + ' ' + h.name);
for (const want of ['2026-01-01 New Year’s Day', '2026-01-19 Martin Luther King Jr. Day', '2026-02-16 Washington’s Birthday', '2026-05-25 Memorial Day', '2026-06-19 Juneteenth',
  '2026-07-04 Independence Day', '2026-07-03 Independence Day (observed)', '2026-09-07 Labor Day', '2026-10-12 Columbus Day', '2026-11-11 Veterans Day', '2026-11-26 Thanksgiving Day', '2026-12-25 Christmas Day'])
  assert.ok(h2026.includes(want), want);
assert.equal(h2026.length, 12);
assert.deepEqual(JSON.parse(JSON.stringify(holidaysInMonth('2027-12'))), [{date: '2027-12-24', name: 'Christmas Day (observed)'}, {date: '2027-12-25', name: 'Christmas Day'}, {date: '2027-12-31', name: 'New Year’s Day (observed)'}], 'New Year’s Day 2028 is a Saturday');
assert.deepEqual(JSON.parse(JSON.stringify(holidaysInMonth('2027-05'))).map(h => h.date), ['2027-05-31'], 'Memorial Day is the last Monday');
assert.deepEqual(JSON.parse(JSON.stringify(holidaysInMonth('2026-13'))), []);

// The owner's planner uses the shared list (issue #45): the page's holidays come from lib/holidays.ts.
const portal = portalCode;
const nodes = new Map(), node = id => { if (!nodes.has(id)) nodes.set(id, {innerHTML: '', textContent: '', value: '', hidden: false, style: {}}); return nodes.get(id); };
class FormFields { constructor(f) { this.fields = f.fields ?? f; } *[Symbol.iterator]() { yield* this.fields; } getAll(name) { return this.fields.filter(([k]) => k === name).map(([, v]) => v); } }
const owner = vm.createContext({structuredClone, crypto, Intl, Date, JSON, URLSearchParams, Set, FormData: FormFields, console, location: {hash: '', href: ''}, document: {querySelector: node, getElementById: () => null, addEventListener() {}}, window: {addEventListener() {}}, setTimeout() {}, confirm: () => true});
vm.runInContext(portal, owner); const run = s => vm.runInContext(s, owner);
for (let y = 2024; y <= 2040; y++) assert.deepEqual(JSON.parse(run(`JSON.stringify(SwaWorkspace.federalHolidays(${y}).map(h=>h.date+' '+h.name).sort())`)), JSON.parse(JSON.stringify(federalHolidays(y).map(h => h.date + ' ' + h.name).sort())), 'holidays ' + y);
assert.deepEqual(JSON.parse(run(`JSON.stringify(holidayNamesOn('2027-12-31'))`)), ['New Year’s Day (observed)'], 'the planner labels an observed holiday');

// Public schedule: event times and the month's holidays. A holiday never adds or removes a practice.
const state = {programs: [{id: 'Elementary', name: 'SWA Development', description: '', priceCents: 20000}],
  seasons: [{program: 'Elementary', start: '2026-11-01', end: '2026-12-31', weekly: [{day: 'Wednesday', start: '17:00', end: '18:15'}, {day: 'Thursday', start: '17:00', end: '18:15'}], excludedDates: ['2026-12-24']}],
  events: [{...camp, dates: ['2026-11-11', '2026-11-12'], schedule: [{date: '2026-11-11', start: '09:00', end: '12:00'}]}, {id: 'clinic', name: 'Clinic', type: 'Clinic', dates: ['2026-11-14'], price: 40, slots: 5}]};
const nov = JSON.parse(JSON.stringify(publicSchedule(state, '2026-11', '2026-11-06')));
assert.deepEqual(nov.holidays, [{date: '2026-11-11', name: 'Veterans Day'}, {date: '2026-11-26', name: 'Thanksgiving Day'}]);
assert.ok(nov.practices.some(p => p.date === '2026-11-11'), 'practice still on Veterans Day');
assert.ok(nov.practices.some(p => p.date === '2026-11-26'), 'practice still on Thanksgiving: only days off cancel practice');
assert.deepEqual(nov.events[0].schedule, [{date: '2026-11-11', start: '09:00', end: '12:00'}]);
assert.deepEqual(nov.events[1].schedule, [], 'an event saved without times');
const dec = JSON.parse(JSON.stringify(publicSchedule(state, '2026-12', '2026-11-06')));
assert.ok(!dec.practices.some(p => p.date === '2026-12-24'), 'the owner’s day off still cancels');
assert.deepEqual(dec.holidays, [{date: '2026-12-25', name: 'Christmas Day'}]);

// Roster and check-in: event days carry their times; the session key has no time, so attendance stays put.
const roster = JSON.parse(JSON.stringify(sessionsOn(state, '2026-11-11'))), campDay = roster.find(s => s.type === 'event');
assert.deepEqual([campDay.key, campDay.start, campDay.end], ['event:camp:2026-11-11', '09:00', '12:00']);
assert.deepEqual(roster.map(s => s.type), ['event', 'practice'], 'sorted by start time');
const second = JSON.parse(JSON.stringify(sessionsOn(state, '2026-11-12'))).find(s => s.type === 'event');
assert.deepEqual([second.start, second.end], [null, null]);
console.log('Passed: event times are validated and published, holidays match the planner and never change practices, roster times.');

// ---------- Owner workspace ----------
run("hydratePrograms();save=()=>{};render=()=>{};academyToday=()=>'2026-11-11';page='Calendar';year=2026;month=10;filter='All programs';calendarPlanSummaries['2026-11']={status:'ready',items:[]}");
run(`data.seasons=${JSON.stringify(state.seasons)};data.events=${JSON.stringify(state.events)}`);
const cal = run('calendar()');
assert.match(cal, /<div class="day is-today" aria-current="date">11<span class="today-tag">Today<\/span><span class="holiday-tag">Veterans Day<\/span>/, 'today ringed, with its holiday');
assert.match(cal, /26<span class="holiday-tag">Thanksgiving Day<\/span><button class="event cal-elementary"/, 'Thanksgiving still has its practice');
// Card lines are blocks; a time keeps "9:00 AM" together and may wrap only after the dash (issue #232).
assert.match(cal, /Winter camp<\/strong><span class="event-time">9:00\u00a0AM–12:00\u00a0PM<\/span><span>Camp<\/span>/); assert.match(cal, /Winter camp<\/strong><span class="event-time">Time to be announced<\/span><span>Camp<\/span>/);
assert.doesNotMatch(cal, />\s*No practice\s*</i, 'no "No practice" cards');
assert.equal((cal.match(/class="day is-today"/g) || []).length, 1, 'one day is today');
run("filter='Advanced'");
let phone = run('mobilePracticeCalendar()');
assert.match(phone, /No practices or events scheduled/, 'still says nothing is scheduled for this filter');
assert.match(phone, /<section class="mobile-calendar-day is-today" aria-current="date"><h3>Wednesday, November 11<span class="today-tag">Today<\/span><\/h3><span class="holiday-tag">Veterans Day<\/span><\/section>/, 'today and its holiday, nothing else');
assert.match(phone, /Thursday, November 26<\/h3><span class="holiday-tag">Thanksgiving Day<\/span><\/section>/, 'a holiday with no practice shows just its label');
run("filter='All programs'"); phone = run('mobilePracticeCalendar()');
assert.doesNotMatch(phone, /No practices or events scheduled/); assert.match(phone, /<span class="event-time">9:00\u00a0AM–12:00\u00a0PM<\/span><span>Camp<\/span>/);

// Camps & events: the editor saves a time for each day, both or neither; the card lists them.
run('data.events=[]');
owner.form = new FormFields([['name', 'Holiday camp'], ['type', 'Camp'], ['campDate', '2026-12-29'], ['campStart', '09:00'], ['campEnd', '12:00'], ['campDate', '2026-12-28'], ['campStart', ''], ['campEnd', ''], ['price', '100'], ['slots', '20']]);
run('saveEvent(-1,form)');
assert.deepEqual(JSON.parse(run('JSON.stringify(data.events[0])')).dates, ['2026-12-28', '2026-12-29']);
assert.deepEqual(JSON.parse(run('JSON.stringify(data.events[0].schedule)')), [{date: '2026-12-29', start: '09:00', end: '12:00'}]);
assert.equal(validState({...base, events: JSON.parse(run('JSON.stringify(data.events)'))}), true, 'the server accepts what the editor saves');
const ownerCard = run('eventCard(data.events[0],0)');
assert.match(ownerCard, /Dec 28, 2026 · Time to be announced<br>Dec 29, 2026 · 9:00 AM–12:00 PM/);
for (const [start, end] of [['09:00', ''], ['', '12:00'], ['12:00', '09:00']]) {
  node('#eventError').textContent = '';
  owner.form = new FormFields([['name', 'Clinic'], ['type', 'Clinic'], ['singleDate', '2026-12-30'], ['singleStart', start], ['singleEnd', end], ['price', '40'], ['slots', '10']]);
  run('saveEvent(-1,form)'); assert.match(node('#eventError').textContent, /both a start and an end time/); assert.equal(run('data.events.length'), 1);
}
owner.form = new FormFields([['name', 'Clinic'], ['type', 'Clinic'], ['singleDate', '2026-12-30'], ['singleStart', '18:00'], ['singleEnd', '20:00'], ['price', '40'], ['slots', '10']]);
run('saveEvent(-1,form)'); assert.deepEqual(JSON.parse(run('JSON.stringify(data.events[1].schedule)')), [{date: '2026-12-30', start: '18:00', end: '20:00'}]);
// Editing keeps the saved times, and an event saved before times opens with blank time boxes.
assert.equal(run("eventSession(data.events[1],'2026-12-30').start"), '18:00'); assert.equal(run("eventSession({dates:['2026-12-30']},'2026-12-30')"), undefined);

// Date grids in Schedules: today is underlined in red.
run("extraPracticeMonth='2026-11'"); assert.match(run('extraPracticeCalendar()'), /aria-label="Today, Nov 11, 2026"[^>]*><span class="today-mark">11<\/span>/);
run("plannerMonth='2026-11'"); assert.match(run("holidayPlannerMarkup('2026-11-01','2026-12-31')"), /aria-label="Today, Wednesday, November 11, 2026, Veterans Day[^"]*"[^>]*><b><span class="today-mark">11<\/span>/);
console.log('Passed: owner calendar holidays and today, phone list, event editor times and date grids.');

// ---------- Family and coach pages ----------
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const json = body => ({ok: true, status: 200, json: async () => body});
function page(file, {fetch, search = ''}) {
  const els = new Map();
  const el = id => { if (!els.has(id)) els.set(id, {id, value: '', hidden: false, checked: false, disabled: false, innerHTML: '', textContent: '', className: '', href: '', style: {}, dataset: {}, options: [],
    replaceChildren(...items) { this.value = items[0]?.value ?? ''; }, focus() {}, scrollIntoView() {}, setAttribute() {}, querySelector() { return null; }, classList: {add() {}, remove() {}, toggle() {}}}); return els.get(id); };
  const ctx = vm.createContext({Intl, Date, JSON, URLSearchParams, Promise, setTimeout: f => setImmediate(f), structuredClone, console, location: {search, href: '', assign() {}}, confirm: () => true,
    document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({})}, fetch: async (url, o) => fetch(url, o), MutationObserver: undefined});
  const html = readFileSync(file, 'utf8');
  for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(code, ctx);
  return {el, ctx};
}
const schedule = {month: '2026-11', today: '2026-11-11', programs: [{id: 'Elementary', name: 'SWA Development', grades: '', description: '', monthlyCents: 20000, annualCents: 240000, walkInCents: 4000}, {id: 'Advanced', name: 'SWA Advance'}],
  practices: [{id: 'Elementary:2026-11-11:17:00', program: 'Elementary', date: '2026-11-11', start: '17:00', end: '18:15'}, {id: 'Advanced:2026-11-12:19:30', program: 'Advanced', date: '2026-11-12', start: '19:30', end: '21:00'}],
  events: [{id: 'camp', name: 'Winter camp', type: 'Camp', dates: ['2026-11-11', '2026-11-12'], schedule: [{date: '2026-11-11', start: '09:00', end: '12:00'}], cents: 16000, dayCents: 9000, full: false},
    {id: 'clinic', name: 'Single-leg clinic', type: 'Clinic', dates: ['2026-11-14'], schedule: [], cents: 4000, dayCents: null, full: false}],
  holidays: [{date: '2026-11-11', name: 'Veterans Day'}, {date: '2026-11-26', name: 'Thanksgiving Day'}], liveClasses: [], privateFormats: []};

// Public calendar.
{
  const {el, ctx} = page('app/calendar/screen.html', {fetch: async () => json(schedule)}); await settle();
  const all = el('calendar').innerHTML, grid = all.split('<div class="list">')[0], list = all.split('<div class="list">')[1];
  assert.match(grid, /<div class="day is-today" aria-current="date">11<span class="today-tag">Today<\/span><span class="holiday-tag">Veterans Day<\/span>/);
  assert.match(grid, /26<span class="holiday-tag">Thanksgiving Day<\/span><\/div>/, 'a holiday with no practice is just a label');
  assert.match(grid, /Winter camp<\/strong><span>9:00 AM–12:00 PM<\/span>/); assert.match(grid, /Winter camp<\/strong><span>Time to be announced<\/span>/);
  assert.match(grid, /Single-leg clinic<\/strong><span>Time to be announced<\/span>/); assert.doesNotMatch(all, /No practice/i);
  assert.match(list, /<article class="is-today"><h3>Nov 11, 2026<span class="today-tag">Today<\/span><\/h3><span class="holiday-tag">Veterans Day<\/span>/);
  assert.match(el('eventCards').innerHTML, /Camp<br>Nov 11, 2026 · 9:00 AM–12:00 PM<br>Nov 12, 2026 · Time to be announced/);
  vm.runInContext('stepWeek(2)', ctx); assert.match(el('calendar').innerHTML.split('<div class="list">')[1], /<article><h3>Nov 26, 2026<\/h3><span class="holiday-tag">Thanksgiving Day<\/span><\/article><p>Nothing is scheduled this week.<\/p>/, 'holiday-only day on phones, and the week is still empty');
}
// Welcome page "Coming up": event times, or "Time to be announced".
{
  const later = {...schedule, month: '2026-12', practices: [], events: [], holidays: []};
  const {el} = page('app/welcome/screen.html', {fetch: async url => json(url.includes('month=') ? later : {...schedule, practices: [], events: [schedule.events[1], {...schedule.events[0], dates: ['2026-11-12', '2026-11-13'], schedule: [{date: '2026-11-12', start: '09:00', end: '12:00'}]}]})}); await settle();
  assert.match(el('week').innerHTML, /Thu, Nov 12<span>9:00 AM<\/span><\/span><span class="what">[\s\S]*Winter camp \(camp\)/);
  assert.match(el('week').innerHTML, /Sat, Nov 14<span>Time to be announced<\/span><\/span><span class="what">[\s\S]*Single-leg clinic \(clinic\)/);
}
// Booking: each day with its time; the single-day choices name today; the review lists the chosen days' times.
{
  const {el, ctx} = page('app/booking/screen.html', {search: '?type=event&id=camp', fetch: async (url, o) => json(url === '/api/family' ? {data: {wrestlers: [{id: 'w-1', name: 'Sam', grade: 4}]}} : url === '/api/booking-review' ? {paymentsEnabled: false, review: {type: 'event', title: 'Winter camp', wrestler: 'Sam', dates: ['2026-11-11'], schedule: [{date: '2026-11-11', start: '09:00', end: '12:00'}], cents: 9000, message: ''}} : url.startsWith('/api/public-schedule') ? schedule : {})}); await settle();
  assert.equal(el('description').textContent, 'Wed, Nov 11 (today) · 9:00 AM–12:00 PM; Thu, Nov 12 · Time to be announced (New York time) · $160.00');
  assert.match(el('option').innerHTML, /<option value="2026-11-11">Wed, Nov 11 \(today\) · 9:00 AM–12:00 PM only · \$90.00<\/option><option value="2026-11-12">Thu, Nov 12 · Time to be announced only/);
  el('wrestler').value = 'w-1'; el('option').value = '2026-11-11'; await el('form').onsubmit({preventDefault() {}}); await settle();
  assert.match(el('details').innerHTML, /<p>Wed, Nov 11 \(today\) · 9:00 AM–12:00 PM<\/p>/);
  assert.match(readFileSync('lib/quotes.ts', 'utf8'), /schedule: \(event\.schedule \?\? \[\]\)\.filter\(\(x: any\) => eventDates\.includes\(x\.date\)\)/, 'the review carries the chosen days’ times');
}
// Register practice calendar: today underlined in red.
{
  const register = readFileSync('app/register/screen.html', 'utf8');
  assert.match(register, /today=date===catalog\.today/); assert.match(register, /\$\{today\?'<span class="today-mark">'\+\(i\+1\)\+'<\/span>':i\+1\}/); assert.match(register, /\(today\?'today, ':''\)/);
}
// Roster: a camp day without a time says so.
assert.match(readFileSync('app/roster/screen.html', 'utf8'), /s\.type==='event'\?'Time to be announced':'All day'/);
// Coach home: this week, with the coach's own practices, every camp and event, holidays as a label and today ringed.
{
  const {el, ctx} = page('app/coach/screen.html', {fetch: async url => json(url === '/api/coach' ? {name: 'Coach Dana', programs: ['Elementary'], openings: []} : url === '/api/roster' ? {sessions: []} : schedule)}); await settle();
  const week = el('week').innerHTML;
  assert.equal(el('weekRange').textContent, 'Mon, Nov 9 – Sun, Nov 15');
  assert.match(week, /<div class="wday is-today" aria-current="date"><h3>Wed, Nov 11<span class="today-tag">Today<\/span><\/h3><span class="holiday-tag">Veterans Day<\/span><div class="witem p-extra"><b>9:00 AM–12:00 PM<\/b><span>Winter camp<\/span><\/div><div class="witem p-Elementary"><b>5:00 PM–6:15 PM<\/b><span>SWA Development<\/span>/);
  assert.match(week, /<b>Time to be announced<\/b><span>Winter camp<\/span>/); assert.doesNotMatch(week, /SWA Advance/, 'only the coach’s own programs');
  assert.match(week, /<div class="wday empty"><h3>Mon, Nov 9<\/h3><\/div>/);
  vm.runInContext('showWeek(2)', ctx); await settle();
  assert.match(el('week').innerHTML, /<div class="wday"><h3>Thu, Nov 26<\/h3><span class="holiday-tag">Thanksgiving Day<\/span><\/div>/); assert.doesNotMatch(el('week').innerHTML, /is-today|No practice/i);
}
console.log('Passed: public calendar, welcome, booking, register, roster and coach week show times, holidays and today.');
