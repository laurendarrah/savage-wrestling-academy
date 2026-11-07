// Issue #45: the owner workspace's rules are typed modules in lib/workspace/. This loads them directly and checks that
// they agree with the server: the program and grade rules with lib/program-approval.ts for every grade, practices with
// the public schedule, and the settings document with the server's own upgrade and validation. It also checks that the
// page loads them as /portal-workspace.js before its own script.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {portalHtml, workspaceCode} from './fixtures/portal-script.mjs';

const cache = new Map();
function load(file, stubs = {}) {
  if (cache.has(file)) return cache.get(file);
  const mod = {exports: {}}; cache.set(file, mod.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module: mod, exports: mod.exports, Intl, Date, JSON, Math, Map, Set, structuredClone, crypto, console,
      require(name) { if (name in stubs) return stubs[name]; if (name.startsWith('.')) return load(path.join(path.dirname(file), name) + '.ts', stubs); throw Error('unexpected import ' + name + ' in ' + file); }});
  return mod.exports;
}
const plain = v => JSON.parse(JSON.stringify(v));
const programs = load('lib/workspace/programs.ts'), settings = load('lib/workspace/settings.ts'), schedule = load('lib/workspace/schedule.ts');
const events = load('lib/workspace/events.ts'), pricing = load('lib/workspace/pricing.ts');

// ---------- Programs and grades agree with the server, for every grade ----------
let approval = 'approved';
const DB = {prepare: () => ({bind: (...args) => ({first: async () => ({status: approval, wrestler_name: 'Sam', grade: args[0] === 'u1' ? current : null})})})};
let current = null;
const server = load('lib/program-approval.ts', {'cloudflare:workers': {env: {DB}}});
const {programDetails, upgradeProgramNames} = load('lib/program-names.ts');
const grades = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'Adult', '', '13', '0', 7, 3];
let checked = 0;
for (const program of [...programs.PROGRAM_IDS, 'Other']) {
  for (const grade of grades) {
    current = grade;
    const w = {id: 'w1', name: 'Sam', grade};
    approval = 'approved';
    const allowed = await server.checkCompetitionAccess('u1', program, w) === null;
    assert.equal(programs.gradeAllowed(program, grade), allowed, `${program} grade ${JSON.stringify(grade)}: allowed`);
    assert.equal(programs.needsCoachApproval(program, grade), server.requiresApproval(program, w), `${program} grade ${JSON.stringify(grade)}: coach approval`);
    approval = 'pending';
    const withoutApproval = await server.checkCompetitionAccess('u1', program, w) === null;
    assert.equal(programs.gradeAllowed(program, grade) && !programs.needsCoachApproval(program, grade), withoutApproval, `${program} grade ${JSON.stringify(grade)}: before approval`);
    checked++;
  }
}
assert.deepEqual(plain(programs.PROGRAM_RULES.Elementary.grades), ['K', '1', '2', '3', '4', '5', '6'], 'Kindergarten is "K"');
for (const id of programs.PROGRAM_IDS) {
  assert.equal(programs.gradesLabel(id), programDetails[id].grades, id + ': the label families see');
  const r = programs.PROGRAM_RULES[id];
  current = 'Adult'; approval = 'approved';
  assert.match(await server.checkCompetitionAccess('u1', id, {id: 'w1', name: 'Sam', grade: 'Adult'}), new RegExp(`grades ${r.grades[0]}–${r.grades.at(-1)}`), id + ': the server names the same grades');
}
assert.deepEqual(plain(programs.starterPrograms().map(p => [p.id, p.name, p.grades])), plain(programs.PROGRAM_IDS.map(id => [id, programDetails[id].name, programDetails[id].grades])));
console.log(`Passed: program and grade rules agree with lib/program-approval.ts for ${checked} programs and grades, with and without approval.`);

// Grade ranges on additional practices and events.
assert.deepEqual(plain(programs.parseGradeRange('K–6')), {from: 'K', through: '6'});
assert.deepEqual(plain(programs.parseGradeRange('7 - 12')), {from: '7', through: '12'});
assert.deepEqual(plain(programs.parseGradeRange('All grades')), {from: 'K', through: '12'});
assert.deepEqual(plain(programs.parseGradeRange('Adults')), {from: '', through: ''});
assert.deepEqual(plain(programs.pickGradeRange('9', '3', 'from')), {from: '9', through: '9', range: '9'});
assert.deepEqual(plain(programs.pickGradeRange('9', '3', 'through')), {from: '3', through: '3', range: '3'});
assert.deepEqual(plain(programs.pickGradeRange('K', '', 'from')), {from: 'K', through: 'K', range: 'K'});
assert.deepEqual(plain(programs.pickGradeRange('', '6', 'from')), {from: '', through: '', range: ''});
assert.equal(programs.gradeRangeText('K', '6'), 'K–6');

// ---------- The settings document ----------
const fresh = settings.emptyAcademy();
const shown = settings.hydratePrograms(fresh, programs.starterPrograms());
assert.equal(fresh.programNamingVersion, 2);
assert.deepEqual(plain(fresh.extraPractices), []);
assert.deepEqual(plain(shown), plain(fresh.programs), 'the page gets a copy');
assert.notEqual(shown, fresh.programs);
assert.deepEqual(plain(shown.map(p => [p.description, p.priceCents, p.walkInPriceCents])), plain(programs.PROGRAM_IDS.map(id => [programDetails[id].description, 20000, 4000])));
// What the workspace publishes passes the server's checks.
const validation = load('lib/academy-validation.ts');
assert.equal(validation.validState(plain(fresh)), true, 'a fresh academy with the starter programs is a valid save');
// A document from before the program names changed is upgraded as the server upgrades it.
const old = {...settings.emptyAcademy(), programs: programs.PROGRAM_IDS.map(id => ({id, name: id, grades: 'old', description: 'old', priceCents: 15000}))};
const upgraded = upgradeProgramNames(structuredClone(old));
settings.hydratePrograms(old, []);
assert.deepEqual(plain(old.programs), plain(upgraded.programs), 'same upgrade as upgradeProgramNames()');
// A saved document is left alone.
const saved = {...settings.emptyAcademy(), programNamingVersion: 2, programs: [{id: 'Elementary', name: 'Mine', grades: 'g', description: 'd', priceCents: 1}]};
settings.hydratePrograms(saved, programs.starterPrograms());
assert.deepEqual(plain(saved.programs), [{id: 'Elementary', name: 'Mine', grades: 'g', description: 'd', priceCents: 1}]);
let n = 0;
const withEvents = {...settings.emptyAcademy(), events: [{name: 'a'}, {id: 'keep', name: 'b'}]};
settings.ensureEventIds(withEvents, () => 'new-' + (++n));
assert.deepEqual(plain(withEvents.events.map(e => e.id)), ['new-1', 'keep']);
console.log('Passed: the settings document is filled in and upgraded as the server expects, and saved programs are kept.');

// ---------- Practices agree with the server's schedule ----------
const {registrationCatalog} = load('lib/registration-catalog.ts');
const seasons = [
  {season: 'Fall', program: 'Elementary', start: '2026-09-08', end: '2026-12-20', weekly: [{day: 'Monday', start: '18:00', end: '19:30'}, {day: 'Friday', start: '17:30', end: '19:00'}], excludedDates: ['2026-11-27']},
  {season: 'Fall', program: 'Advanced', start: '2026-10-01', end: '2027-03-31', weekly: [{day: 'Tuesday', start: '19:30', end: '21:00'}, {day: 'Sunday', start: '10:00', end: '12:00'}], excludedDates: ['2026-12-27']},
  {season: 'Winter', program: 'Elementary', start: '2026-12-01', end: '2027-02-28', weekly: [{day: 'Saturday', start: '09:00', end: '10:30'}], excludedDates: []},
  {season: 'Winter', program: 'Intermediate', start: '2027-01-04', end: '2027-01-31', weekly: [{day: 'Wednesday', start: '19:30', end: '21:00'}]},
];
const state = {programs: plain(shown), seasons};
let days = 0;
for (const month of ['2026-09', '2026-11', '2026-12', '2027-01', '2027-02', '2027-04']) {
  const practices = registrationCatalog(state, month, '0000-01-01').practices;
  for (const date of schedule.monthGrid(month).dates) for (const id of programs.PROGRAM_IDS) {
    const server = practices.find(p => p.program === id && p.date === date), slot = schedule.practiceSlot(seasons, id, date);
    assert.deepEqual(slot && [slot.start, slot.end], server ? [server.start, server.end] : null, `${id} on ${date}`);
    days++;
  }
}
assert.equal(schedule.practiceSlot(seasons, 'Elementary', '2026-12-07'), null, 'the later winter semester wins where they overlap');
assert.equal(schedule.practiceSlot(seasons, 'Elementary', '2026-12-05').label, '9:00 AM–10:30 AM');
console.log(`Passed: owner calendar practices match the server's schedule on ${days} program days.`);

// Months, the planner and semesters.
assert.deepEqual(plain(schedule.monthGrid('2026-11')).lead, 6, 'November 2026 starts on a Sunday');
assert.equal(schedule.monthGrid('2026-11', 'sunday').lead, 0);
assert.equal(schedule.monthGrid('2028-02').dates.length, 29);
assert.equal(schedule.shiftMonth('2026-12', 1), '2027-01'); assert.equal(schedule.shiftMonth('2026-01', -13), '2024-12');
assert.equal(schedule.plannerMonthShown('', '2027-03-01', '2026-11-07'), '2027-03');
assert.equal(schedule.academyToday(new Date('2026-11-01T03:59:59Z')), '2026-10-31');
assert.deepEqual(plain(schedule.holidayNamesOn('2026-11-26')), ['Thanksgiving Day']);
class Fields { constructor(f) { this.f = f; } get(k) { return this.f.find(([n]) => n === k)?.[1] ?? null; } getAll(k) { return this.f.filter(([n]) => n === k).map(([, v]) => v); } }
const fields = new Fields([['selectedDays', 'Tuesday'], ['start_Tuesday', '18:00'], ['end_Tuesday', '19:30']]);
const season = schedule.seasonFromForm({season: 'Spring', start: '2027-03-01', end: '2027-05-31', program: 'Advanced', exceptions: '["2027-02-01","2027-03-16"]'}, fields);
assert.deepEqual(plain(season.value), {season: 'Spring', start: '2027-03-01', end: '2027-05-31', program: 'Advanced', excludedDates: ['2027-03-16'], weekly: [{day: 'Tuesday', start: '18:00', end: '19:30'}]});
assert.equal(validation.validState({...plain(fresh), seasons: [season.value]}), true, 'the server accepts the semester');
assert.equal(schedule.seasonFromForm({start: '2027-03-01', end: '2027-02-01'}, fields).error, 'Semester end date must follow the first practice date.');
console.log('Passed: months, the semester planner and the semester form.');

// ---------- Events ----------
const camp = {name: 'Camp', type: 'Camp', dates: ['2026-12-29', '2026-12-28'], schedule: [{date: '2026-12-29', start: '09:00', end: '12:00'}], price: 100, slots: 10};
assert.deepEqual(plain(events.eventDayLines(camp)), ['Dec 28, 2026 · Time to be announced', 'Dec 29, 2026 · 9:00 AM–12:00 PM']);
assert.equal(events.eventEnded(camp, '2026-12-29'), false); assert.equal(events.eventEnded(camp, '2026-12-30'), true);
assert.equal(events.isEventArchived({...camp, archived: true}, '2026-01-01'), true);
const campForm = new Fields([['campDate', '2026-12-29'], ['campStart', '09:00'], ['campEnd', '12:00'], ['campDate', '2026-12-28'], ['campStart', ''], ['campEnd', '']]);
const made = events.eventFromForm({name: ' Camp ', type: 'Camp', price: '100.555', slots: '20'}, campForm, undefined, () => 'camp-1');
assert.deepEqual(plain(made.value), {archived: false, archivedAt: null, id: 'camp-1', name: 'Camp', gradeRange: '', description: '', type: 'Camp', dates: ['2026-12-28', '2026-12-29'],
  schedule: [{date: '2026-12-29', start: '09:00', end: '12:00'}], date: 'Dec 28, 2026 · Dec 29, 2026', price: 100.56, day: null, slots: 20});
assert.equal(validation.validState({...plain(fresh), events: [made.value]}), true, 'the server accepts the event');
assert.equal(events.eventFromForm({name: 'Camp', type: 'Camp', price: '1', slots: '1'}, new Fields([['campDate', '2026-12-29']])).error, events.EVENT_FORM_ERROR);
console.log('Passed: event days, times, archiving and the event form.');

// ---------- Prices the owner sets ----------
assert.equal(pricing.formatPrice(123456), '$1,234.56'); assert.equal(pricing.formatPrice(null), '$200.00');
assert.equal(pricing.centsFromDollars('225.505'), 22551); assert.equal(pricing.dollarsText(4500), '45.00');
assert.deepEqual(plain(pricing.programFromForm({id: 'Elementary', name: 'x', grades: 'g', description: '', priceCents: 1}, {name: ' Dev ', grades: 'g', description: '', price: '210', walkInPrice: ''}).value),
  {id: 'Elementary', name: 'Dev', grades: 'g', description: '', priceCents: 21000});
assert.equal(pricing.programFromForm(shown[0], {name: 'Dev', grades: 'g', description: '', price: '10000.01', walkInPrice: ''}).error, 'Enter a valid name and price.');
const practice = pricing.extraPracticeFromForm({name: 'Open mat', start: '18:00', end: '19:00', member: '10', nonMember: '20', enabled: 'on'}, ['2026-12-04'], () => 'p1').value;
assert.deepEqual(plain(practice), {id: 'p1', name: 'Open mat', gradeRange: '', description: '', dates: ['2026-12-04'], start: '18:00', end: '19:00', memberCents: 1000, nonMemberCents: 2000, enabled: true});
assert.equal(pricing.extraPracticeClash([{...practice, id: 'p0'}], practice), true); assert.equal(pricing.extraPracticeClash([{...practice, id: 'p0', start: '17:00'}], practice), false);
const code = pricing.teamCodeFromForm(new Fields([['name', 'North'], ['code', ' north-10 '], ['percent', '10'], ['programs', 'Intermediate'], ['active', 'on']]), [], -1, programs.PROGRAM_IDS, () => 't1').value;
assert.deepEqual(plain(code), {id: 't1', name: 'North', code: 'NORTH-10', percent: 10, programs: ['Intermediate'], active: true});
assert.equal(validation.validTeamCodes([code]), true, 'the server accepts the code');
// Prices for families come only from lib/quotes.ts: the workspace's modules never load it.
for (const f of ['programs', 'settings', 'schedule', 'events', 'pricing', 'browser', 'types']) assert.doesNotMatch(readFileSync(`lib/workspace/${f}.ts`, 'utf8'), /from '[^']*(quotes|stripe|checkout)[^']*'/i, f);
console.log('Passed: program, practice and team-code prices the owner sets, checked as the server checks them.');

// ---------- The page loads the bundle ----------
const tag = '<script src="/portal-workspace.js"></script><script>';
assert.ok(portalHtml.includes(tag), 'app/portal.html loads /portal-workspace.js just before its own script');
const ctx = vm.createContext({Intl, Date, JSON, structuredClone, crypto}); vm.runInContext(workspaceCode, ctx);
for (const name of ['practiceSlot', 'hydratePrograms', 'ensureEventIds', 'gradeAllowed', 'monthGrid', 'eventFromForm', 'teamCodeFromForm', 'formatPrice', 'clockTime', 'federalHolidays'])
  assert.equal(typeof ctx.SwaWorkspace[name], 'function', name);
assert.equal(vm.runInContext("SwaWorkspace.practiceSlot([{program:'Advanced',start:'2026-01-01',end:'2026-12-31',weekly:[{day:'Sunday',start:'10:00',end:'12:00'}]}],'Advanced','2026-11-08').label", ctx), '10:00 AM–12:00 PM');
// Each name the page takes from the bundle exists there.
const names = portalHtml.match(/var \{([^}]*)\}=W;/)[1].split(',');
for (const name of names) assert.equal(typeof ctx.SwaWorkspace[name], 'function', 'the page reads ' + name);
for (const [, name] of portalHtml.matchAll(/\bW\.([A-Za-z_]+)/g)) assert.ok(name in ctx.SwaWorkspace, 'the page calls W.' + name);
console.log('Passed: the owner page loads /portal-workspace.js before its own script, and everything it reads is there.');
