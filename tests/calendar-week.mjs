// Issue #135: on phones the calendar shows one week at a time, and the program buttons filter what it shows.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const nodes = new Map();
const el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, innerHTML: '', textContent: '', options: [], dataset: {}, style: {}, setAttribute() {}, scrollIntoView() {}, appendChild() {}, replaceChildren() {}}); return nodes.get(id); };
const filters = ['all', 'Elementary', 'Intermediate', 'Advanced', 'extras'].map(f => ({dataset: {filter: f}, pressed: f === 'all' ? 'true' : 'false', setAttribute(k, v) { this.pressed = v; }}));
const schedule = {month: '2026-11', today: '2026-11-11', programs: [{id: 'Elementary', name: 'SWA Development', grades: 'K–6', description: '', monthlyCents: 20000, annualCents: 240000, walkInCents: 4000}, {id: 'Intermediate', name: 'SWA Intermediate', grades: '7–12', description: '', monthlyCents: 20000, annualCents: 240000, walkInCents: 4000}],
  practices: ['2026-11-03', '2026-11-10', '2026-11-12', '2026-11-24'].flatMap(date => [{program: 'Elementary', date, start: '18:00', end: '19:30'}, {program: 'Intermediate', date, start: '19:30', end: '21:00'}]),
  events: [{id: 'winter-camp', name: 'Winter camp', type: 'Camp', dates: ['2026-11-13'], cents: 16000, dayCents: 9000, full: false}], liveClasses: [], privateFormats: []};
let fetched = [];
const ctx = vm.createContext({Intl, Date, JSON, Math, Number, String, Array, URLSearchParams, Promise, setTimeout, console, location: {search: '', href: '', hash: ''},
  document: {getElementById: el, querySelectorAll: sel => (sel === '[data-filter]' ? filters : []), querySelector: () => null, createElement: () => ({})},
  fetch: async url => { fetched.push(url); return {ok: true, status: 200, json: async () => ({...schedule, month: (new URL(url, 'https://x.test').searchParams.get('month')) || schedule.month})}; },
  window: {addEventListener() {}}, addEventListener() {}, history: {replaceState() {}}});
const html = readFileSync('app/calendar/screen.html', 'utf8');
for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(code, ctx);
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
await settle(); el('month').value = '2026-11';
const list = () => el('calendar').innerHTML.split('<div class="list">')[1] ?? '';

// Opens on the week with today in it (Mon Nov 9 – Sun Nov 15), not the whole month.
assert.match(list(), /Mon, Nov 9[^<]*– Sun, Nov 15/);
assert.match(list(), /Tue, Nov 10/); assert.match(list(), /Winter camp/);
assert.doesNotMatch(list(), /Nov 3,|Nov 24,/, 'other weeks are not on the page');
// Next and previous week.
vm.runInContext('stepWeek(1)', ctx); assert.match(list(), /Mon, Nov 16 – Sun, Nov 22/); assert.match(list(), /Nothing is scheduled this week/);
vm.runInContext('stepWeek(-2)', ctx); assert.match(list(), /Tue, Nov 3</);
// Going back from the first week loads the previous month at its last week.
vm.runInContext('stepWeek(-1)', ctx); assert.match(list(), /Mon, Oct 26 – Sun, Nov 1/, 'the first week of the month starts in October');
vm.runInContext('stepWeek(-1)', ctx); await settle(); assert.ok(fetched.some(u => /month=2026-10/.test(u)), 'previous month requested');
vm.runInContext('thisWeek()', ctx); await settle(); assert.match(list(), /Mon, Nov 9 – Sun, Nov 15/);
// Filters: one program only, then extras only; the grid and the list both follow.
filters[2].onclick(); assert.equal(filters[2].pressed, 'true'); assert.equal(filters[0].pressed, 'false');
assert.match(el('calendar').innerHTML, /SWA Intermediate/); assert.doesNotMatch(el('calendar').innerHTML, /SWA Development<\/strong>|Winter camp/);
filters[4].onclick(); assert.match(el('calendar').innerHTML, /Winter camp/); assert.doesNotMatch(el('calendar').innerHTML, /SWA Intermediate<\/strong>/);
filters[0].onclick(); assert.match(el('calendar').innerHTML, /SWA Development<\/strong>/);
// Issue #182: opening on an empty week moves to the next week with practices; This week still shows this week.
vm.runInContext("state.today='2026-11-17';week=null;pendingWeek=null;render()", ctx);
assert.match(list(), /Mon, Nov 23 – Sun, Nov 29/); assert.match(list(), /next week with practices/); assert.match(list(), /Tue, Nov 24</);
vm.runInContext('thisWeek()', ctx); await settle(); assert.match(list(), /Mon, Nov 16 – Sun, Nov 22/); assert.match(list(), /Nothing is scheduled this week/);
// Program buttons choose a plan; they don't promise online payment.
// One "Choose a walk-in" per day (#282), none per chip, and no promise of online payment.
assert.match(html, /'Choose a walk-in →','choose'/); assert.doesNotMatch(html, /Choose this walk-in|Pay monthly for 12 months|Pay for the year upfront/);
assert.equal((el('calendar').innerHTML.split('<div class="list">')[0].match(/Choose a walk-in/g) || []).length, 1, 'with today Nov 17, the grid links Nov 24 only: past days get no link');
console.log('Calendar: one week at a time on phones, week paging across months, program filters');
