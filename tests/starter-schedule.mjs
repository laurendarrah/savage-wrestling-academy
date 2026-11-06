// Issue #178: the starter programs and practice schedule are valid, list the decided times, and never overwrite
// settings the owner has saved.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';

const load = (file, deps = {}) => {
  const module = {exports: {}};
  const require = name => deps[name] ?? (() => { throw new Error('unexpected import ' + name); })();
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {module, exports: module.exports, require, URL, Intl, Date, JSON, Math});
  return module.exports;
};
const {validState} = load('lib/academy-validation.ts', {'./friday-live': load('lib/friday-live.ts', {'./program-names': load('lib/program-names.ts')})});
const {registrationCatalog} = load('lib/registration-catalog.ts', {'./program-names': load('lib/program-names.ts')});

const files = readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort();
const starter = files.find(f => f.includes('_starter_programs_and_schedule')), justin = files.find(f => f.includes('_starter_justin_schedule'));
assert(justin, 'Justin\'s schedule migration exists (issue #199)');
assert(starter, 'starter migration exists');

// A brand-new database gets the starter document.
const fresh = new DatabaseSync(':memory:');
for (const f of files.filter(f => f !== justin)) fresh.exec(readFileSync('drizzle/' + f, 'utf8'));
const row = fresh.prepare("SELECT payload,revision,updated_by FROM academy_state WHERE id='academy'").get();
assert.equal(row.revision, 1); assert.equal(row.updated_by, 'setup:issue-178');
const doc = JSON.parse(row.payload);
assert.equal(validState(doc), true, 'the owner can save over it without a validation error');
assert.deepEqual(doc.programs.map(p => [p.id, p.name, p.priceCents, p.walkInPriceCents]),
  [['Elementary', 'SWA Development', 20000, 4000], ['Intermediate', 'SWA Intermediate', 20000, 4000], ['Advanced', 'SWA Advance', 20000, 4000]]);
const times = Object.fromEntries(doc.seasons.map(s => [s.program, s.weekly.map(w => `${w.day.slice(0, 3)} ${w.start}-${w.end}`).join(', ')]));
assert.deepEqual(times, {
  Elementary: 'Mon 18:00-19:30, Wed 18:00-19:30, Fri 18:00-19:30',
  Intermediate: 'Mon 19:30-21:00, Wed 19:30-21:00',
  Advanced: 'Tue 19:30-21:00, Thu 19:30-21:00, Sun 10:00-12:00'});
for (const s of doc.seasons) { assert.equal(s.start, '2026-11-09'); assert.equal(s.end, '2027-03-31'); assert.deepEqual(s.excludedDates, []); }
assert.deepEqual([doc.kids, doc.bookings, doc.messages, doc.staff, doc.events, doc.extraPractices], [[], [], [], [], [], []], 'no sample families, staff or events');

// Families see the practices: November from the 9th, December in full.
const nov = registrationCatalog(doc, '2026-11', '2026-11-06'), dec = registrationCatalog(doc, '2026-12', '2026-11-06');
assert.equal(nov.programs.length, 3);
assert.ok(nov.practices.every(p => p.date >= '2026-11-09'), 'nothing before the season starts');
assert.ok(nov.practices.some(p => p.program === 'Advanced' && p.date === '2026-11-15' && p.start === '10:00'), 'Sunday Advance practice');
assert.ok(dec.practices.some(p => p.program === 'Elementary' && p.date === '2026-12-04' && p.start === '18:00'), 'Friday Development practice');
assert.ok(!dec.practices.some(p => p.program === 'Intermediate' && p.date === '2026-12-01'), 'no Intermediate on Tuesdays');

// Issue #199: Justin's schedule replaces the starter seasons; programs stay.
fresh.exec(readFileSync('drizzle/' + justin, 'utf8'));
const after = fresh.prepare("SELECT payload,revision,updated_by FROM academy_state WHERE id='academy'").get(), next = JSON.parse(after.payload);
assert.equal(after.updated_by, 'setup:issue-199'); assert.equal(after.revision, 2);
assert.equal(validState(next), true);
assert.deepEqual(next.programs, doc.programs, 'programs and prices unchanged');
assert.deepEqual(Object.fromEntries(next.seasons.map(s => [s.program, s.weekly.map(w => `${w.day.slice(0, 3)} ${w.start}-${w.end}`).join(', ')])), {
  Elementary: 'Mon 18:00-19:30, Tue 18:00-19:30, Wed 18:00-19:30, Thu 18:00-19:30',
  Advanced: 'Tue 19:30-21:00, Thu 19:30-21:00, Sun 10:00-12:00'});
assert.deepEqual(next.seasons[0].excludedDates, ['2026-12-25', '2027-01-01', '2027-01-18']);
const decJ = registrationCatalog(next, '2026-12', '2026-11-06');
assert.ok(!decJ.practices.some(p => p.date === '2026-12-25'), 'Christmas is a day off');
assert.ok(decJ.practices.some(p => p.program === 'Elementary' && p.date === '2026-12-01' && p.start === '18:00'), 'Development starts Tue Dec 1');
assert.ok(!decJ.practices.some(p => p.program === 'Intermediate'), 'no Intermediate schedule in Justin\'s settings');
assert.equal(registrationCatalog(next, '2026-11', '2026-11-06').practices.length, 0, 'nothing in November');

// It never overwrites what the owner has saved.
const saved = new DatabaseSync(':memory:');
for (const f of files.filter(f => f !== starter && f !== justin)) saved.exec(readFileSync('drizzle/' + f, 'utf8'));
saved.prepare("INSERT INTO academy_state (id,payload,revision,updated_by,updated_at) VALUES ('academy','{\"owner\":true}',7,'supabase:owner','2026-11-07')").run();
saved.exec(readFileSync('drizzle/' + starter, 'utf8')); saved.exec(readFileSync('drizzle/' + justin, 'utf8'));
assert.deepEqual({...saved.prepare("SELECT payload,revision FROM academy_state WHERE id='academy'").get()}, {payload: '{"owner":true}', revision: 7});
console.log('starter-schedule ok');
