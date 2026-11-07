// Issue #45: the owner workspace's program, schedule, pricing, event and settings logic moved out of app/portal.html
// into typed modules in lib/workspace/. Before anything moved, this test ran the page's inline functions on
// representative inputs and froze what they returned in tests/fixtures/workspace-before-45.json. It now runs the page
// as the browser does, with /portal-workspace.js built from those modules, and everything must still be the same.
// It runs in several time zones, because the old planner and holiday code used the browser's local time.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {portalCode} from './fixtures/portal-script.mjs';

const FIXTURE = 'tests/fixtures/workspace-before-45.json';
const ZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata'];

if (!process.env.WORKSPACE_TZ_CHILD) {
  let failed = 0;
  for (const zone of ZONES) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {stdio: 'inherit', env: {...process.env, TZ: zone, WORKSPACE_TZ_CHILD: '1'}});
    if (r.status !== 0) { failed++; console.error('Failed in time zone ' + zone); }
  }
  if (failed) process.exit(1);
  console.log('Passed: the owner workspace returns the same programs, schedules, prices, events and settings in ' + ZONES.length + ' time zones.');
  process.exit(0);
}

// ---------- The page's script in a fake browser ----------
const nodes = new Map();
const node = s => { if (!nodes.has(s)) nodes.set(s, {innerHTML: '', textContent: '', value: '', hidden: false, style: {}, classList: {remove() {}, toggle() {}}, setAttribute() {}}); return nodes.get(s); };
class Fields {
  constructor(form) { this.fields = form.fields; }
  *[Symbol.iterator]() { yield* this.fields; }
  get(name) { return this.fields.find(([k]) => k === name)?.[1] ?? null; }
  getAll(name) { return this.fields.filter(([k]) => k === name).map(([, v]) => v); }
}
let ids = 0;
const ctx = vm.createContext({console, structuredClone, Intl, Date, JSON, Set, Map, URLSearchParams, FormData: Fields, crypto: {randomUUID: () => 'id-' + (++ids)},
  location: {hash: '', href: ''}, document: {querySelector: node, getElementById: () => null, addEventListener() {}}, window: {addEventListener() {}}, setTimeout() {}, confirm: () => true});
vm.runInContext(portalCode, ctx);
const run = s => vm.runInContext(s, ctx);
// Functions the page no longer needs itself are checked where they live now.
const moved = {clockLabel: 'clockTime', extraPracticeDateLabel: 'fullDate', federalHolidays: 'federalHolidays', eventFormSchedule: 'eventFormSchedule'};
for (const [was, now] of Object.entries(moved)) run(`if(typeof ${was}==='undefined')globalThis.${was}=SwaWorkspace.${now}`);
const json = s => JSON.parse(run('JSON.stringify(' + s + ')') ?? 'null');

// ---------- Inputs ----------
const seasons = [
  {season: 'Fall', program: 'Elementary', start: '2026-09-08', end: '2026-12-20', weekly: [{day: 'Monday', start: '18:00', end: '19:30'}, {day: 'Wednesday', start: '18:00', end: '19:30'}, {day: 'Friday', start: '17:30', end: '19:00'}], excludedDates: ['2026-11-11', '2026-11-27']},
  {season: 'Fall', program: 'Intermediate', start: '2026-09-08', end: '2026-12-20', weekly: [{day: 'Monday', start: '19:30', end: '21:00'}, {day: 'Wednesday', start: '19:30', end: '21:00'}], excludedDates: []},
  {season: 'Fall', program: 'Advanced', start: '2026-10-01', end: '2027-03-31', weekly: [{day: 'Tuesday', start: '19:30', end: '21:00'}, {day: 'Thursday', start: '19:30', end: '21:00'}, {day: 'Sunday', start: '10:00', end: '12:00'}], excludedDates: ['2026-12-24', '2026-12-31', '2027-03-08']},
  // A later semester overlapping the first one wins where they overlap.
  {season: 'Winter', program: 'Elementary', start: '2026-12-01', end: '2027-02-28', weekly: [{day: 'Saturday', start: '09:00', end: '10:30'}, {day: 'Monday', start: '00:00', end: '00:45'}], excludedDates: ['2026-12-26']},
  // A semester saved before days off were dates still shows its old note.
  {season: 'Spring', program: 'Intermediate', start: '2027-03-01', end: '2027-06-30', weekly: [{day: 'Tuesday', start: '12:00', end: '13:15'}], exceptions: 'No practice spring break'},
];
const events = [
  {id: 'camp', name: 'Winter <Camp>', type: 'Camp', gradeRange: 'K–6', description: 'Bring water.\nAnd shoes.', dates: ['2026-12-29', '2026-12-28', '2026-12-30'], schedule: [{date: '2026-12-29', start: '09:00', end: '12:00'}, {date: '2026-12-30', start: '13:30', end: '16:00'}], price: 150, day: 60.5, slots: 30},
  {id: 'clinic', name: 'Neutral clinic', type: 'Clinic', dates: ['2026-11-21'], schedule: [], price: 40, day: null, slots: 0},
  {id: 'gala', name: 'Fundraiser', type: 'Event', dates: ['2026-11-14'], price: 25.25, day: null, slots: 100, archived: true, archivedAt: '2026-11-01T10:00:00.000Z'},
  {id: 'past', name: 'Old camp', type: 'Camp', dates: ['2026-10-01', '2026-10-02'], price: 100, day: null, slots: 10},
  {name: 'Legacy event', type: 'Event', date: 'Sometime in March', price: 10, slots: 5},
];
const extraPractices = [
  {id: 'fnl', name: 'Friday Night Live', gradeRange: '7–12', description: '', dates: ['2026-11-13', '2026-11-20', '2026-12-04'], start: '18:00', end: '19:00', memberCents: 1000, nonMemberCents: 2000, enabled: true},
  {id: 'hidden', name: 'Hidden practice', dates: ['2026-11-20'], start: '07:00', end: '08:15', memberCents: 0, nonMemberCents: 1550, enabled: false},
];
const teamCodes = [{id: 'tc1', name: 'North High', code: 'NORTH10', percent: 10, programs: ['Intermediate', 'Advanced'], active: true}, {id: 'tc2', name: 'South', code: 'SOUTH-5', percent: 5, programs: ['Elementary'], active: false}];

ctx.input = {seasons, events, extraPractices, teamCodes};
// A known academy: the starter programs, then the saved semesters, events, practices and codes. Today is fixed.
const reset = (extra = '') => run(`ids=0;data=structuredClone(seed);programs.splice(0,programs.length,...structuredClone(starterPrograms));hydratePrograms();save=()=>{saves=(globalThis.saves||0)+1};render=()=>{};academyToday=(now)=>now?new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now):'2026-11-11';
  data.seasons=structuredClone(input.seasons);data.events=structuredClone(input.events);data.extraPractices=structuredClone(input.extraPractices);data.teamCodes=structuredClone(input.teamCodes);
  editingSeason=null;editingExtraPractice=null;extraPracticeDates=new Set();extraPracticeMonth='';plannerMonth='';plannerExcluded=new Set();programsSaved=true;page='Dashboard';year=2026;month=10;filter='All programs';eventArchiveView=false;calendarPlanSummaries={};${extra}`);
const every = (from, to) => { const out = []; for (let d = new Date(from + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };
const form = fields => ({fields});

// ---------- What the workspace returns ----------
const got = {};
const record = (name, value) => { assert.ok(!(name in got), 'duplicate case ' + name); got[name] = value === undefined ? '(undefined)' : value; };

// Programs and the settings document.
run('ids=0;data=structuredClone(seed)');
record('programs.defaults', json('programs'));
ctx.starterPrograms = json('programs');
run('hydratePrograms()');
record('hydrate.new', json('{data,programs}'));
run(`data={...structuredClone(seed),programs:[{id:'Elementary',name:'Elementary',grades:'Grades K–6',description:'old',priceCents:15000,walkInPriceCents:3000,days:[1]},{id:'Intermediate',name:'Middle',grades:'Grades 7–12',description:'old',priceCents:15000},{id:'Advanced',name:'Advanced',grades:'x',description:'old',priceCents:1}]};hydratePrograms()`);
record('hydrate.oldNames', json('{data,programs}'));
run(`data={...structuredClone(seed),programNamingVersion:2,extraPractices:[{id:'x'}],programs:[{id:'Elementary',name:'Mine',grades:'Grades K–6',description:'d',priceCents:12345},{id:'Intermediate',name:'Two',grades:'g',description:'',priceCents:0,walkInPriceCents:0},{id:'Advanced',name:'Three',grades:'g',description:'',priceCents:1000000}]};hydratePrograms()`);
record('hydrate.saved', json('{data,programs}'));
// With no programs saved, the programs already on the page are the starting point.
run(`data=structuredClone(seed);hydratePrograms()`);
record('hydrate.fromPage', json('{data,programs}'));
run(`data={...structuredClone(seed),programs:[{id:'Other',name:'Other'}]};hydratePrograms()`);
record('hydrate.unknownId', json('{data,programs}'));
run(`ids=0;data={...structuredClone(seed),events:[{name:'a'},{id:'keep',name:'b'},{id:null,name:'c'}]};ensurePortalData()`);
record('ensurePortalData', json('data.events'));
run(`data=structuredClone(seed);delete data.events;ensurePortalData()`);
record('ensurePortalData.none', json('data.events'));
run(`data=structuredClone(seed);normalizeFridayLive()`);
record('normalizeFridayLive', json('data.extraPractices'));
record('programName', json(`['Elementary','Intermediate','Advanced','Camps, clinics & events','All programs'].map(programName)`));
record('calendarProgramColor', json(`['Elementary','Intermediate','Advanced','x'].map(calendarProgramColor)`));

// Grade ranges on extra practices and events.
for (const saved of ['', 'K', '6', 'K–6', '7-12', '3 – 5', 'All grades', 'Adults', '12–K', '<b>'])
  record('offeringGradeFields.' + saved, run(`offeringGradeFields(${JSON.stringify(saved)})`));
record('offeringGrades', json('offeringGrades'));
const gradeSteps = [['gradeFrom', 'K'], ['gradeThrough', '6'], ['gradeFrom', '9'], ['gradeThrough', '3'], ['gradeFrom', ''], ['gradeThrough', '12'], ['gradeThrough', '12'], ['gradeFrom', '12']];
ctx.gradeForm = () => { const summary = {textContent: ''}, f = {gradeFrom: {value: ''}, gradeThrough: {value: ''}, gradeRange: {value: ''}}; for (const k of Object.keys(f)) f[k].form = null; const formObj = {elements: f, querySelector: () => summary, summary}; for (const k of Object.keys(f)) f[k].form = formObj; return formObj; };
run('gradeForm1=gradeForm()');
record('updateOfferingGrades', gradeSteps.map(([name, value]) => { run(`gradeForm1.elements.${name}.value=${JSON.stringify(value)};updateOfferingGrades(gradeForm1.elements.${name})`); return json(`[gradeForm1.elements.gradeFrom.value,gradeForm1.elements.gradeThrough.value,gradeForm1.elements.gradeRange.value,gradeForm1.summary.textContent]`); }));
record('offeringDetails', json(`[offeringDetails({}),offeringDetails({gradeRange:'K–6',description:'<x>\\nline'})]`));

// Times, dates and holidays.
const minutes = Array.from({length: 1440}, (_, i) => String(Math.floor(i / 60)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0'));
ctx.minutes = minutes;
record('clockTime.all', json('minutes.map(clockTime)'));
record('clockLabel.all', json('minutes.map(clockLabel)'));
record('federalHolidays', json('Array.from({length:31},(_,i)=>federalHolidays(2020+i))'));
record('holidayNamesOn', json(`['2026-01-01','2027-12-31','2022-12-26','2026-07-03','2026-11-11','2026-11-26','2026-11-12','2028-12-25'].map(holidayNamesOn)`));
record('dateKey', json(`[new Date(2026,0,1),new Date(2026,11,31,23,59),new Date(2027,2,14,2,30),new Date(2026,10,1,1,30)].map(dateKey)`));
record('academyToday', json(`['2026-10-17T03:59:59Z','2026-10-17T04:00:00Z','2026-03-08T06:59:59Z','2026-03-08T07:00:00Z','2026-11-01T05:30:00Z','2027-01-01T04:59:59Z','2027-01-01T05:00:00Z'].map(t=>academyToday(new Date(t)))`));
record('extraPracticeDateLabel', json(`['2026-01-05','2026-12-31','2027-02-28'].map(extraPracticeDateLabel)`));
record('nyWhen', json(`['2026-11-06T19:16:00Z','2026-07-04T03:05:00Z','2027-01-01T04:59:00Z'].flatMap(t=>[nyWhen(t),nyWhen(t,true)])`));
record('namedMonthOptions', json(`[namedMonthOptions('2026-11'),namedMonthOptions('2020-03'),namedMonthOptions('2100-11'),namedMonthOptions('2026-11','2026-06','2027-02'),namedMonthOptions('2026-13'),namedMonthOptions('')]`));
record('weekdays', json('weekdays'));

// Practices from the saved semesters, every day for a year, for each program.
reset();
ctx.days = every('2026-08-01', '2027-07-31');
record('practiceSlot.year', json(`days.map(d=>programs.map(p=>practiceSlot(p,d)?.label??null))`));
record('practiceSlot.noSeasons', json(`(data.seasons=[],days.filter(d=>programs.some(p=>practiceSlot(p,d))).length)`));
reset();
record('seasonTimes', json(`[...data.seasons,{days:'Mon & Wed',time:'6:00 PM',until:'7:30 PM'},{days:'<b>'}].map(seasonTimes)`));
record('seasonExceptions', json(`[...data.seasons,{exceptions:'<old note>'},{exceptions:'x',excludedDates:[]},{excludedDates:['2026-12-24','<x>']}].map(seasonExceptions)`));

// The semester planner: month paging, days off kept inside the semester, the form's checks and the saved semester.
reset();
record('visiblePlannerMonth', [['', ''], ['', '2027-03-15'], ['2026-13', '2027-03-15'], ['2026-02', '2027-03-15'], ['bad', '']].map(([m, start]) => run(`plannerMonth=${JSON.stringify(m)};visiblePlannerMonth(${JSON.stringify(start)})`)));
record('movePlannerMonth', [['2026-12', 1], ['2026-01', -1], ['', 1], ['2026-06', 13], ['2026-06', -25]].map(([m, n]) => run(`plannerMonth=${JSON.stringify(m)};movePlannerMonth(${n});plannerMonth`)));
const seasonForm = (fields, days) => form([...fields, ...days.flatMap(([day, start, end]) => [['selectedDays', day], ['start_' + day, start], ['end_' + day, end]])]);
const seasonCases = {
  ok: seasonForm([['season', 'Spring'], ['start', '2027-03-01'], ['end', '2027-05-31'], ['program', 'Advanced'], ['exceptions', '["2027-02-20","2027-03-15","2027-05-31","2027-06-01"]']], [['Tuesday', '18:00', '19:30'], ['Sunday', '10:00', '12:00']]),
  noDays: seasonForm([['season', 'Spring'], ['start', '2027-03-01'], ['end', '2027-05-31'], ['program', 'Advanced'], ['exceptions', '[]']], []),
  backwards: seasonForm([['season', 'Spring'], ['start', '2027-03-01'], ['end', '2027-02-28'], ['program', 'Advanced'], ['exceptions', '[]']], [['Monday', '18:00', '19:00']]),
  sameDay: seasonForm([['season', 'Summer'], ['start', '2027-07-01'], ['end', '2027-07-01'], ['program', 'Elementary'], ['exceptions', '']], [['Thursday', '18:00', '19:00']]),
  badTime: seasonForm([['season', 'Spring'], ['start', '2027-03-01'], ['end', '2027-05-31'], ['program', 'Advanced'], ['exceptions', '[]']], [['Monday', '18:00', '19:00'], ['Friday', '19:00', '19:00']]),
  noTime: seasonForm([['season', 'Spring'], ['start', '2027-03-01'], ['end', '2027-05-31'], ['program', 'Advanced'], ['exceptions', '[]']], [['Monday', '', '19:00']]),
};
for (const [name, f] of Object.entries(seasonCases)) {
  reset('saves=0;plannerExcluded=new Set(["2027-03-15"]);plannerMonth="2027-03";');
  ctx.form = f; run('saveSeason(form)');
  record('saveSeason.' + name, json(`{seasons:data.seasons.slice(5),count:data.seasons.length,saves,toast:$('#toast').innerHTML,plannerExcluded:[...plannerExcluded],plannerMonth,editingSeason}`));
  node('#toast').innerHTML = '';
}
reset('saves=0;editingSeason=1;');
ctx.form = seasonCases.ok; run('saveSeason(form)');
record('saveSeason.edit', json(`{seasons:data.seasons.map(s=>s.season+':'+s.program),last:data.seasons.at(-1),saves}`));

// Camps, clinics and events.
reset();
record('events.read', json(`data.events.map(e=>({dates:eventDates(e),label:eventDateLabel(e),lines:eventDayLines(e),ended:eventEnded(e),endedLater:eventEnded(e,'2027-01-01'),archived:isEventArchived(e),times:['2026-12-28','2026-12-29','2026-12-30','2026-11-21'].map(d=>eventTimeLabel(e,d)),session:eventSession(e,'2026-12-29')??null}))`));
record('eventSession.odd', json(`[eventSession(null,'2026-12-29'),eventSession({schedule:'x'},'d'),eventSession({schedule:[null,{date:'d',start:'1',end:'2'}]},'d')]`));
record('eventFormSchedule', json(`[[],[{date:'2026-12-01',start:'',end:''}],[{date:'2026-12-02',start:'09:00',end:'10:00'},{date:'2026-12-01',start:'08:00',end:'08:30'}],[{date:'d',start:'09:00',end:''}],[{date:'d',start:'',end:'09:00'}],[{date:'d',start:'10:00',end:'09:00'}],[{date:'d',start:'9:00',end:'10:00'}],[{date:'d',start:'24:00',end:'24:30'}],[{date:'d',start:'23:00',end:'23:59'}]].map(eventFormSchedule)`));
const eventCases = {
  camp: [['name', ' Holiday camp '], ['gradeRange', ' K–6 '], ['description', ' Fun '], ['type', 'Camp'], ['campDate', '2026-12-29'], ['campStart', '09:00'], ['campEnd', '12:00'], ['campDate', '2026-12-28'], ['campStart', ''], ['campEnd', ''], ['price', '100.555'], ['singleDays', 'on'], ['day', '40.004'], ['slots', '20']],
  campOneDay: [['name', 'Camp'], ['type', 'Camp'], ['campDate', '2026-12-29'], ['price', '100'], ['slots', '20']],
  campSameDay: [['name', 'Camp'], ['type', 'Camp'], ['campDate', '2026-12-29'], ['campDate', '2026-12-29'], ['price', '100'], ['slots', '20']],
  campBadDate: [['name', 'Camp'], ['type', 'Camp'], ['campDate', '2026-02-30'], ['campDate', '2026-03-01'], ['price', '100'], ['slots', '20']],
  campHalfTime: [['name', 'Camp'], ['type', 'Camp'], ['campDate', '2026-12-29'], ['campStart', '09:00'], ['campEnd', ''], ['campDate', '2026-12-30'], ['price', '100'], ['slots', '20']],
  clinic: [['name', 'Clinic'], ['type', 'Clinic'], ['singleDate', '2026-12-30'], ['singleStart', '18:00'], ['singleEnd', '20:00'], ['price', '40'], ['slots', '10']],
  clinicNoDate: [['name', 'Clinic'], ['type', 'Clinic'], ['singleDate', ''], ['price', '40'], ['slots', '10']],
  event: [['name', 'Gala'], ['type', 'Event'], ['singleDate', '2027-01-09'], ['singleStart', ''], ['singleEnd', ''], ['price', '0'], ['slots', '1']],
  noName: [['name', '  '], ['type', 'Event'], ['singleDate', '2027-01-09'], ['price', '10'], ['slots', '1']],
  badType: [['name', 'X'], ['type', 'Party'], ['singleDate', '2027-01-09'], ['price', '10'], ['slots', '1']],
  tooMuch: [['name', 'X'], ['type', 'Event'], ['singleDate', '2027-01-09'], ['price', '10000.01'], ['slots', '1']],
  negative: [['name', 'X'], ['type', 'Event'], ['singleDate', '2027-01-09'], ['price', '-1'], ['slots', '1']],
  fraction: [['name', 'X'], ['type', 'Event'], ['singleDate', '2027-01-09'], ['price', '10'], ['slots', '1.5']],
  noSeats: [['name', 'X'], ['type', 'Event'], ['singleDate', '2027-01-09'], ['price', '10'], ['slots', '0']],
  badDay: [['name', 'Camp'], ['type', 'Camp'], ['campDate', '2026-12-29'], ['campDate', '2026-12-30'], ['price', '100'], ['singleDays', 'on'], ['day', ''], ['slots', '20']],
  pastDates: [['name', 'Past'], ['type', 'Clinic'], ['singleDate', '2026-01-09'], ['price', '10'], ['slots', '1']],
};
for (const [name, fields] of Object.entries(eventCases)) {
  reset('saves=0;');
  ctx.form = form(fields); node('#eventError').textContent = '';
  run('saveEvent(-1,form)');
  record('saveEvent.' + name, json(`{added:data.events.length>5?data.events.at(-1):null,saves,error:$('#eventError').textContent,archiveView:eventArchiveView}`));
}
reset('saves=0;');
ctx.form = form(eventCases.clinic); run('saveEvent(0,form)');
record('saveEvent.edit', json(`{first:data.events[0],count:data.events.length}`));
reset();
run(`archiveEvent(1,true)`); record('archiveEvent', json(`[data.events[1].archived,typeof data.events[1].archivedAt,$('#toast').innerHTML]`));
run(`archiveEvent(3,false)`); record('archiveEvent.ended', json(`[data.events[3].archived??null,$('#toast').innerHTML]`));
reset();
record('eventCard', json(`data.events.map((e,i)=>eventCard(e,i))`));
record('events.active', run('events()'));
record('events.archived', run('eventArchiveView=true;events()'));

// Additional practices: the date picker, the checks and the saved practice.
reset(`extraPracticeMonth='2026-11';extraPracticeDates=new Set(['2026-11-20','2026-12-04']);`);
record('extraPracticeCalendar', run('extraPracticeCalendar()'));
record('extraPracticeManager', run('extraPracticeManager()'));
run(`toggleExtraPracticeDate('2026-11-01');toggleExtraPracticeDate('2026-11-27');toggleExtraPracticeDate('2026-11-20');moveExtraPracticeMonth(-11)`);
record('extraPractice.dates', json('{dates:[...extraPracticeDates],month:extraPracticeMonth}'));
const practiceCases = {
  ok: [['name', ' Open mat '], ['gradeRange', ''], ['description', ' x '], ['start', '18:00'], ['end', '19:30'], ['member', '12.345'], ['nonMember', '20'], ['enabled', 'on']],
  hidden: [['name', 'Open mat'], ['start', '18:00'], ['end', '19:30'], ['member', '0'], ['nonMember', '0']],
  backwards: [['name', 'Open mat'], ['start', '19:30'], ['end', '18:00'], ['member', '10'], ['nonMember', '20'], ['enabled', 'on']],
  tooMuch: [['name', 'Open mat'], ['start', '18:00'], ['end', '19:30'], ['member', '10000.01'], ['nonMember', '20'], ['enabled', 'on']],
  negative: [['name', 'Open mat'], ['start', '18:00'], ['end', '19:30'], ['member', '-1'], ['nonMember', '20'], ['enabled', 'on']],
  blank: [['name', ' '], ['start', '18:00'], ['end', '19:30'], ['member', '1'], ['nonMember', '2'], ['enabled', 'on']],
  duplicate: [['name', 'Friday Night Live'], ['start', '18:00'], ['end', '19:00'], ['member', '10'], ['nonMember', '20'], ['enabled', 'on']],
};
for (const [name, fields] of Object.entries(practiceCases)) {
  for (const dates of [['2026-12-04', '2026-11-27'], []]) {
    reset(`saves=0;extraPracticeDates=new Set(${JSON.stringify(dates)});`);
    node('#toast').innerHTML = ''; ctx.form = form(fields);
    run('saveExtraPractice(form)');
    record(`saveExtraPractice.${name}.${dates.length}`, json(`{list:data.extraPractices.slice(2),saves,toast:$('#toast').innerHTML,editing:editingExtraPractice,month:extraPracticeMonth}`));
  }
}
reset(`saves=0;editExtraPractice('fnl');`);
record('editExtraPractice', json('{dates:[...extraPracticeDates],month:extraPracticeMonth,editing:editingExtraPractice}'));
ctx.form = form(practiceCases.duplicate); run('saveExtraPractice(form)');
record('saveExtraPractice.edit', json('{list:data.extraPractices,saves}'));

// Programs and pricing, team codes.
reset();
record('formatDollars', json(`[0,1,1.005,10.5,1234.5,-3,'7.1',null,1e6].map(formatDollars)`));
record('formatPrice', json(`[0,1,99,100,20000,123456,null,undefined].map(formatPrice)`));
ctx.money = ['', '1', '1.5', '1.555', '0', 'abc', '10000'].map(value => ({value, checkValidity: () => value !== 'abc'}));
run('money.forEach(normalizeMoneyInput)'); record('normalizeMoneyInput', ctx.money.map(m => m.value));
record('ownerPrograms', run('ownerPrograms()'));
record('ownerPrograms.unpublished', run('programsSaved=false;ownerPrograms()'));
const programCases = {
  ok: [['name', ' Dev '], ['grades', ' Grades K–6 '], ['description', ' New '], ['price', '225.505'], ['walkInPrice', '45']],
  noWalkIn: [['name', 'Dev'], ['grades', 'Grades K–6'], ['description', ''], ['price', '0'], ['walkInPrice', '']],
  free: [['name', 'Dev'], ['grades', 'Grades K–6'], ['description', ''], ['price', '0'], ['walkInPrice', '0']],
  tooMuch: [['name', 'Dev'], ['grades', 'Grades K–6'], ['description', ''], ['price', '10000.01'], ['walkInPrice', '']],
  badWalkIn: [['name', 'Dev'], ['grades', 'Grades K–6'], ['description', ''], ['price', '200'], ['walkInPrice', '-1']],
  noName: [['name', ' '], ['grades', 'Grades K–6'], ['description', ''], ['price', '200'], ['walkInPrice', '']],
  text: [['name', 'Dev'], ['grades', 'Grades K–6'], ['description', ''], ['price', 'abc'], ['walkInPrice', '']],
};
for (const [name, fields] of Object.entries(programCases)) {
  reset('saves=0;'); node('#toast').innerHTML = ''; ctx.form = form(fields);
  run('saveProgram(0,form)');
  record('saveProgram.' + name, json(`{program:data.programs[0],live:programs[0],saves,toast:$('#toast').innerHTML}`));
}
reset();
record('teamCodeManager', run('teamCodeManager()'));
const codeCases = {
  ok: [['name', ' East '], ['code', ' east-15 '], ['percent', '15'], ['programs', 'Elementary'], ['programs', 'Advanced'], ['active', 'on']],
  inactive: [['name', 'East'], ['code', 'EAST'], ['percent', '100'], ['programs', 'Intermediate']],
  taken: [['name', 'East'], ['code', 'north10'], ['percent', '15'], ['programs', 'Elementary'], ['active', 'on']],
  shortCode: [['name', 'East'], ['code', 'AB'], ['percent', '15'], ['programs', 'Elementary'], ['active', 'on']],
  badPercent: [['name', 'East'], ['code', 'EAST'], ['percent', '15.5'], ['programs', 'Elementary'], ['active', 'on']],
  noPrograms: [['name', 'East'], ['code', 'EAST'], ['percent', '15'], ['active', 'on']],
  unknownProgram: [['name', 'East'], ['code', 'EAST'], ['percent', '15'], ['programs', 'Adults'], ['active', 'on']],
};
for (const [name, fields] of Object.entries(codeCases)) {
  reset('saves=0;'); node('#teamCodeError').textContent = ''; ctx.form = form(fields);
  run('saveTeamCode(-1,form)');
  record('saveTeamCode.' + name, json(`{codes:data.teamCodes.slice(2),saves,error:$('#teamCodeError').textContent}`));
}
reset('saves=0;'); ctx.form = form(codeCases.taken); run('saveTeamCode(0,form)');
record('saveTeamCode.edit', json('{codes:data.teamCodes,saves}'));

// The owner calendar, phone list, planner and pages, drawn from all of the above.
reset(`calendarPlanSummaries['2026-11']={status:'ready',items:[{program:'Elementary',date:'2026-11-16',published:true},{program:'Advanced',date:'2026-11-17',published:false}]}`);
for (const [y, m] of [[2026, 10], [2026, 11], [2027, 1], [2027, 2]]) {
  for (const f of ['All programs', 'Advanced', 'Camps, clinics & events']) {
    run(`year=${y};month=${m};filter=${JSON.stringify(f)}`);
    record(`calendar.${y}-${m + 1}.${f}`, run('calendar()'));
    record(`mobile.${y}-${m + 1}.${f}`, run('mobilePracticeCalendar()'));
  }
}
run(`year=2026;month=10;filter='All programs'`);
record('calendarPlanLabel', json(`[calendarPlanLabel('Elementary','2026-11-16'),calendarPlanLabel('Advanced','2026-11-17'),calendarPlanLabel('Intermediate','2026-11-16')]`));
for (const [m, start, end] of [['2026-11', '', ''], ['2026-11', '2026-11-01', '2026-12-31'], ['2027-03', '2027-03-01', '2027-02-01'], ['2026-12', '2026-12-10', '2027-01-10']])
  record(`holidayPlannerMarkup.${m}.${start}.${end}`, run(`plannerMonth='${m}';plannerExcluded=new Set(['2026-11-26','2026-12-25']);holidayPlannerMarkup('${start}','${end}')`));
reset();
record('schedules', run('schedules()'));
reset();
record('dashboard', run('dashboard()'));

// ---------- Compare ----------
const digest = v => { const s = JSON.stringify(v); return s.length > 300 ? {sha256: createHash('sha256').update(s).digest('hex'), length: s.length} : v; };
const actual = Object.fromEntries(Object.entries(got).map(([k, v]) => [k, digest(v)]));
const expected = JSON.parse(readFileSync(FIXTURE, 'utf8'));
assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), 'the same cases');
for (const k of Object.keys(expected)) assert.deepEqual(actual[k], expected[k], k + ' (' + process.env.TZ + ')');
console.log(`  ${process.env.TZ}: ${Object.keys(expected).length} cases match`);
