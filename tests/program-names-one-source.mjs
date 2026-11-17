// One list of program names (issue #355): lib/program-names.ts. A name reads the same on every page, email and receipt
// because nothing else keeps its own copy and the owner's form cannot retype it.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports: {}}; cache.set(file, module);
  const dir = file.slice(0, file.lastIndexOf('/'));
  const resolve = spec => { const parts = (dir + '/' + spec).split('/'), stack = []; for (const p of parts) { if (p === '..') stack.pop(); else if (p !== '.') stack.push(p); } return stack.join('/') + '.ts'; };
  vm.runInNewContext(out, {module, exports: module.exports, require: spec => spec.startsWith('.') ? load(resolve(spec)) : require(spec), structuredClone, console, Intl, crypto});
  return module.exports;
}
const plain = v => JSON.parse(JSON.stringify(v));
const {programDetails, programName, standardProgramNames, upgradeProgramNames} = load('lib/program-names.ts');
const NAMES = {Elementary: 'SWA Development', Intermediate: 'SWA Intermediate', Advanced: 'SWA Advance'};

// The list, and the helper everything else calls.
assert.deepEqual(Object.fromEntries(Object.entries(programDetails).map(([id, d]) => [id, d.name])), NAMES);
for (const [id, name] of Object.entries(NAMES)) assert.equal(programName(id), name);
assert.equal(programName('Something else'), 'Something else', 'an unknown id is shown as it is, never as undefined');

// No second copy in lib/: a literal that maps a program id to its name belongs in lib/program-names.ts only.
const walk = dir => readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(dir + '/' + e.name) : e.name.endsWith('.ts') ? [dir + '/' + e.name] : []);
for (const file of walk('lib')) {
  if (file === 'lib/program-names.ts') continue;
  assert.doesNotMatch(readFileSync(file, 'utf8'), /(Elementary|Intermediate|Advanced)['"]?\s*:\s*['"]SWA /, file + ' keeps its own copy of a program name; import programName from lib/program-names.ts');
}

// A saved settings document always carries the standard names; descriptions and prices stay the owner's.
const typed = {programNamingVersion: 2, programs: [{id: 'Elementary', name: 'Elementary K-6', description: 'Mine', priceCents: 15000, walkInPriceCents: 3000}, {id: 'Intermediate', name: 'SWA Intermediate', description: 'x', priceCents: 20000}, {id: 'Extra', name: 'Kept'}]};
const fixed = upgradeProgramNames(typed);
assert.deepEqual(plain(fixed.programs), [{id: 'Elementary', name: 'SWA Development', description: 'Mine', priceCents: 15000, walkInPriceCents: 3000}, {id: 'Intermediate', name: 'SWA Intermediate', description: 'x', priceCents: 20000}, {id: 'Extra', name: 'Kept'}]);
assert.equal(typed.programs[0].name, 'Elementary K-6', 'the document passed in is not changed');
const standard = {programNamingVersion: 2, programs: [{id: 'Advanced', name: 'SWA Advance', priceCents: 1}]};
assert.equal(upgradeProgramNames(standard), standard, 'a document already in order comes back as it is');
assert.equal(standardProgramNames(standard.programs)[0], standard.programs[0]);
for (const v of [null, undefined, 'x', {}, {programs: 'no'}]) assert.equal(upgradeProgramNames(v), v);

// What families see comes through the same door: the welcome page, calendar and Choose training read this catalog.
const {registrationCatalog} = load('lib/registration-catalog.ts');
assert.deepEqual(plain(registrationCatalog(typed, '2026-12', '2026-12-01').programs.map(p => p.name)), ['SWA Development', 'SWA Intermediate']);

// The owner's page: the settings it shows and saves carry the standard names, and the form cannot retype one.
const {hydratePrograms} = load('lib/workspace/settings.ts'), {programFromForm} = load('lib/workspace/pricing.ts');
const doc = structuredClone(typed);
assert.deepEqual(plain(hydratePrograms(doc, []).map(p => p.name)), ['SWA Development', 'SWA Intermediate', 'Kept']);
assert.equal(doc.programs[0].name, 'SWA Development', 'so the next save stores the standard name');
const saved = programFromForm({id: 'Elementary', name: 'SWA Development', grades: 'Grades K–6', description: '', priceCents: 20000}, {name: 'Elementary K-6', grades: 'Grades K–6', description: ' New words ', price: '210', walkInPrice: '45'});
assert.deepEqual(plain(saved.value), {id: 'Elementary', name: 'SWA Development', grades: 'Grades K–6', description: 'New words', priceCents: 21000, walkInPriceCents: 4500});
assert.equal(programFromForm({id: 'Elementary', name: 'x', grades: 'g', description: '', priceCents: 1}, {grades: 'g', description: '', price: '10000.01', walkInPrice: ''}).error, 'Enter a valid price.');
const portal = readFileSync('app/portal.html', 'utf8');
assert.match(portal, /<div class="fixed"><span>Program name<\/span><p>\$\{esc\(p\.name\)\}<\/p><\/div><div class="fixed"><span>Grade eligibility<\/span>/, 'the name is shown as fixed, like the grades');
assert.doesNotMatch(portal, /<input name="name" required maxlength="100" value="\$\{esc\(p\.name\)\}">/, 'no field to retype a program name');
assert.match(portal, /The name and grades are fixed, so they read the same on every page, email and receipt\./);
console.log('Passed: one list of program names; no second copy in lib/; saved settings, the family catalog and the owner page always carry the standard names; the owner form cannot retype one.');
