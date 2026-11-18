// One list of built-in program names (issue #355): lib/program-names.ts. Nothing else keeps its own copy, and inside a
// settings document a program's name is always the built-in one. The owner's own names (issue #363) are saved beside
// the settings and put in at the last step; tests/program-renames.mjs covers that.
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
const NAMES = {Elementary: 'SWA Development', Intermediate: 'SWA Intermediate', Advanced: 'SWA Advanced'};

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
const standard = {programNamingVersion: 2, programs: [{id: 'Advanced', name: 'SWA Advanced', priceCents: 1}]};
assert.equal(upgradeProgramNames(standard), standard, 'a document already in order comes back as it is');
assert.equal(standardProgramNames(standard.programs)[0], standard.programs[0]);
for (const v of [null, undefined, 'x', {}, {programs: 'no'}]) assert.equal(upgradeProgramNames(v), v);

// The program was SWA Advance until Nov 17, 2026 (issue #359). The starter settings saved the old name in the standard
// description; that exact text is shown with the new name, and a description the owner edited is left alone.
{
  const now = programDetails.Advanced.description, before = now.replace('All SWA Advanced wrestlers', 'All SWA Advan' + 'ce wrestlers');
  assert.notEqual(before, now); assert.match(now, /All SWA Advanced wrestlers require coach approval\.$/);
  const starter = {programNamingVersion: 2, programs: [{id: 'Advanced', name: 'SWA Advan' + 'ce', description: before, priceCents: 20000}, {id: 'Intermediate', name: 'SWA Intermediate', description: 'Not SWA Advan' + 'ce. My own words.', priceCents: 1}]};
  assert.deepEqual(plain(upgradeProgramNames(starter).programs), [{id: 'Advanced', name: 'SWA Advanced', description: now, priceCents: 20000}, {id: 'Intermediate', name: 'SWA Intermediate', description: 'Not SWA Advan' + 'ce. My own words.', priceCents: 1}]);
  const edited = {programNamingVersion: 2, programs: [{id: 'Advanced', name: 'SWA Advan' + 'ce', description: before + ' Ask Justin first.'}]};
  assert.equal(upgradeProgramNames(edited).programs[0].description, before + ' Ask Justin first.', 'an edited description is the owner’s own');
  // Nowhere else: no page, library file, stylesheet or script still says the old name.
  const all = dir => readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? all(dir + '/' + e.name) : [dir + '/' + e.name]);
  for (const file of [...all('app'), ...all('lib'), ...all('public').filter(f => /\.(css|js|html|txt|json)$/.test(f)), ...all('docs/email-templates')]) {
    const text = readFileSync(file, 'utf8').replace(/const EARLIER_NAME=\/SWA Advance\(\?!d\)\/g;/, '').replace(/^\/\/ The program was "SWA Advance" until.*$/m, '');
    assert.doesNotMatch(text, /SWA Advance(?!d)/, file + ' still says the old name');
  }
}

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
// The owner's form has a name field again (issue #363). What it saves goes to `programNames`, never into the program.
assert.match(portal, /<label>Program name<input name="name" required maxlength="40" value="\$\{esc\(p\.name\)\}"><\/label><div class="fixed"><span>Grade eligibility<\/span>/);
assert.match(portal, /W\.programNamesFromForm\(data,data\.programs\[i\]\.id,fields\.name\)/);
assert.match(portal, /A new name shows everywhere: every page, email and receipt\./);
console.log('Passed: one list of built-in program names; no second copy in lib/; inside saved settings and the family catalog a program always carries its built-in name, whatever a form sends.');
