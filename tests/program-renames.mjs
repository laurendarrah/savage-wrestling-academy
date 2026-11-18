// Issue #363: the owner renames a program on Programs & pricing and the new name shows everywhere. Inside the site the
// built-in names stay the one vocabulary; at the last step every page, data reply, spreadsheet, email and the product
// name at Stripe has each built-in name replaced by the owner's.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
let queries = 0;
const DB = {prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { queries++; return sqlite.prepare(sql).get(...a) ?? null; }}; }};
const env = {DB, EMAIL_API_KEY: 'key', MAIL_FROM: 'Savage <info@example.test>'};
const requests = [];
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, RegExp, console, structuredClone,
      fetch: async (url, init) => { requests.push({url, body: JSON.parse(init.body)}); return new Response('{}', {status: 200}); },
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test', OWNER_EMAIL: 'owner@example.test'};
        if (name.endsWith('/net')) return {EMAIL_TIMEOUT_MS: 10000, timeoutSignal: () => undefined};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
const plain = v => JSON.parse(JSON.stringify(v));
const N = load('lib/program-names.ts'), R = load('lib/program-renames.ts');
const saveNames = names => { sqlite.prepare("DELETE FROM academy_state WHERE id='academy'").run();
  sqlite.prepare("INSERT INTO academy_state(id,payload,revision,updated_at,updated_by) VALUES ('academy',?,1,'2026-11-18T00:00:00.000Z','owner')").run(typeof names === 'string' ? names : JSON.stringify({programs: [], ...(names ? {programNames: names} : {})}));
  R.forgetProgramNames(); };

// ---------- What a name may be ----------
for (const [typed, clean] of [['Elementary (K-6)', 'Elementary (K-6)'], ['  HS  &  MS   Advanced ', 'HS & MS Advanced'], ['Black Program', 'Black Program'], ['Little Savages 5+', 'Little Savages 5+'], ['Élite 2: Varsity', 'Élite 2: Varsity'], ['Dev/Novice, Fall', 'Dev/Novice, Fall'], ['K-6', 'K-6']])
  assert.equal(N.cleanProgramName(typed), clean, typed);
// Nothing that means something to a page, a script, a spreadsheet or a data reply; not too short or too long.
for (const bad of ['', ' ', 'x', 'a'.repeat(41), 'A&B', 'R &amp; D', 'A & ', '& Co', 'Coach\'s Choice', '"Quoted"', '<b>Bold</b>', 'back\\slash', 'tick`', '$money', 'curly {x}', 'semi;colon', 'equals=sum', '=SUM(A1)', '+1 Advanced', '-Dash first', 'emoji 🤼', 5, null, undefined, {}])
  assert.equal(N.cleanProgramName(bad), null, JSON.stringify(bad));
assert.equal(N.NAME_MAX, 40);
assert.equal(N.cleanProgramName('Line\nbreak\tand   spaces'), 'Line break and spaces', 'pasted line breaks and runs of spaces become one space');

assert.deepEqual(plain(N.programNamesFrom({Elementary: 'Elementary (K-6)', Advanced: 'Black Program'})), {names: {Elementary: 'Elementary (K-6)', Advanced: 'Black Program'}});
assert.deepEqual(plain(N.programNamesFrom({Elementary: ' SWA  Development ', Advanced: 'SWA Advanced'})), {names: {}}, 'typed back to the built-in name: nothing to save');
assert.deepEqual(plain(N.programNamesFrom({})), {names: {}});
assert.match(N.programNamesFrom({Elementary: 'Kids <3'}).error, /can’t be used\. Use 2 to 40 letters, numbers and spaces\. These marks are fine too: - \. \( \) \/ \+ , : and & with a space on each side\./);
assert.match(N.programNamesFrom({Elementary: 'Varsity', Advanced: 'varsity'}).error, /Two programs can’t have the same name/);
assert.match(N.programNamesFrom({Elementary: 'swa intermediate'}).error, /includes the site’s name for another program \(SWA Intermediate\)/, 'a program cannot take another program’s built-in name');
assert.match(N.programNamesFrom({Elementary: 'New SWA Advanced Juniors'}).error, /another program \(SWA Advanced\)/);
assert.deepEqual(plain(N.programNamesFrom({Elementary: 'SWA Development (K-6)'})), {names: {Elementary: 'SWA Development (K-6)'}}, 'its own built-in name inside the new one is fine');
for (const bad of [null, 'x', [], {Other: 'Name'}]) assert.ok(N.programNamesFrom(bad).error, JSON.stringify(bad));
// What is read back from saved settings: only names that pass the same check; anything else counts as none.
assert.deepEqual(plain(N.customProgramNames({programNames: {Advanced: 'Black Program'}})), {Advanced: 'Black Program'});
for (const doc of [null, {}, {programNames: null}, {programNames: {Advanced: '<script>'}}, {programNames: {Advanced: 'A', Elementary: 'Fine name'}}, {programNames: 'x'}]) assert.deepEqual(plain(N.customProgramNames(doc)), {}, JSON.stringify(doc));
assert.equal(N.shownProgramName('Advanced', {Advanced: 'Black Program'}), 'Black Program'); assert.equal(N.shownProgramName('Intermediate', {Advanced: 'Black Program'}), 'SWA Intermediate');

// ---------- The replacing itself: one pass, only renamed programs, never twice ----------
const names = {Elementary: 'SWA Development (K-6)', Advanced: 'Black Program'};
assert.equal(N.applyProgramNames('SWA Development practice. SWA Advanced approvals. SWA Intermediate stays.', names), 'SWA Development (K-6) practice. Black Program approvals. SWA Intermediate stays.');
assert.equal(N.applyProgramNames('The owner wrote: SWA Development (K-6) is off tonight; Black Program is on.', names), 'The owner wrote: SWA Development (K-6) is off tonight; Black Program is on.', 'text that already has the owner’s name is left alone');
assert.equal(N.applyProgramNames(N.applyProgramNames('SWA Development and SWA Advanced', names), names), 'SWA Development (K-6) and Black Program', 'applying it twice changes nothing more');
assert.equal(N.applyProgramNames('SWA Advanced', {}), 'SWA Advanced'); assert.equal(N.applyProgramNames('', names), '');
assert.equal(N.applyProgramNames('SWA Advanced', {Advanced: 'A.B (C) + D/E: F, G & H-I'}), 'A.B (C) + D/E: F, G & H-I', 'every mark a name may hold is taken literally');
// A swap of meaning is impossible: each built-in name maps to that program's own new name.
assert.equal(N.applyProgramNames('SWA Development, SWA Intermediate, SWA Advanced', {Elementary: 'Youth', Intermediate: 'Varsity', Advanced: 'Elite'}), 'Youth, Varsity, Elite');

// ---------- Saved with the settings, checked again by the server ----------
const {validState} = load('lib/academy-validation.ts'), {emptyAcademy, hydratePrograms} = load('lib/workspace/settings.ts'), {programNamesFromForm, programFromForm} = load('lib/workspace/pricing.ts');
const base = () => ({...emptyAcademy(), programs: ['Elementary', 'Intermediate', 'Advanced'].map(id => ({id, name: N.programName(id), grades: 'g', description: '', priceCents: 20000}))});
assert.equal(validState(base()), true);
assert.equal(validState({...base(), programNames: {Advanced: 'Black Program'}}), true);
assert.equal(validState({...base(), programNames: {}}), true);
for (const bad of [{Advanced: '<b>x</b>'}, {Advanced: ' Black Program '}, {Advanced: 'SWA Advanced'}, {Advanced: 'Same', Elementary: 'same'}, {Elementary: 'SWA Intermediate 2'}, {Other: 'Name'}, [], 'x', null])
  assert.equal(validState({...base(), programNames: bad}), false, JSON.stringify(bad));
// The owner's form: one program's name at a time, the others kept.
const doc = {...base(), programNamingVersion: 2, programNames: {Advanced: 'Black Program'}};
assert.deepEqual(plain(programNamesFromForm(doc, 'Elementary', ' Elementary  (K-6) ')), {value: {Advanced: 'Black Program', Elementary: 'Elementary (K-6)'}});
assert.deepEqual(plain(programNamesFromForm(doc, 'Advanced', 'SWA Advanced')), {value: {}}, 'typed back to the built-in name removes the owner’s name');
assert.deepEqual(plain(programNamesFromForm(doc, 'Advanced', 'Gold')), {value: {Advanced: 'Gold'}});
assert.match(programNamesFromForm(doc, 'Elementary', 'black program').error, /Two programs can’t have the same name/);
assert.match(programNamesFromForm(doc, 'Elementary', '').error, /can’t be used/);
assert.equal(programFromForm(doc.programs[2], {name: 'Gold', grades: 'g', description: '', price: '200', walkInPrice: ''}).value.name, 'SWA Advanced', 'inside the settings the program keeps its built-in name');
// The dashboard's copy of the programs shows the owner's names; the document itself keeps the built-in ones.
assert.deepEqual(plain(hydratePrograms(doc, []).map(p => p.name)), ['SWA Development', 'SWA Intermediate', 'Black Program']);
assert.deepEqual(doc.programs.map(p => p.name), ['SWA Development', 'SWA Intermediate', 'SWA Advanced']);
// The security log says a program was renamed, by its grades (a built-in name in a stored line reads as the owner's).
const {changeSummary} = load('lib/academy-changes.ts');
assert.match(changeSummary({...base(), programNamingVersion: 2}, {...base(), programNamingVersion: 2, programNames: {Advanced: 'Black Program'}}), /program for Grades 7–12 renamed “Black Program”/);
assert.match(changeSummary(doc, {...base(), programNamingVersion: 2, programNames: {Elementary: 'Youth'}}), /program for Grades K–6 renamed “Youth”[\s\S]*program for Grades 7–12 back to its built-in name|program for Grades 7–12 back to its built-in name[\s\S]*program for Grades K–6 renamed “Youth”/);

// ---------- Reading the owner's names: one small read, kept a few seconds, never a failure ----------
saveNames(null);
assert.deepEqual(plain(await R.currentProgramNames(DB, 1000)), {});
saveNames({Advanced: 'Black Program', Elementary: 'Elementary (K-6)'});
queries = 0;
assert.deepEqual(plain(await R.currentProgramNames(DB, 1000)), {Advanced: 'Black Program', Elementary: 'Elementary (K-6)'});
await R.currentProgramNames(DB, 1000 + R.NAMES_KEPT_MS - 1); assert.equal(queries, 1, 'kept for a few seconds');
await R.currentProgramNames(DB, 1000 + R.NAMES_KEPT_MS); assert.equal(queries, 2, 'then read again');
R.forgetProgramNames(); await R.currentProgramNames(DB, 1000); assert.equal(queries, 3);
for (const broken of ['{not json', JSON.stringify({programNames: {Advanced: '<x>'}}), JSON.stringify({programNames: 5})]) { saveNames(broken); assert.deepEqual(plain(await R.currentProgramNames(DB, 1)), {}, broken); }
R.forgetProgramNames(); assert.deepEqual(plain(await R.currentProgramNames({prepare() { throw Error('db down'); }}, 1)), {}, 'a database problem means the built-in names, never an error');
R.forgetProgramNames(); assert.deepEqual(plain(await R.currentProgramNames(undefined, 1)), {});
assert.equal(await R.withProgramNames('SWA Advanced walk-in', DB), 'SWA Advanced walk-in');

// ---------- Every page, data reply and spreadsheet on its way out ----------
saveNames({Advanced: 'Black Program', Elementary: 'Elementary (K-6)'});
const O = 'https://swa.test', res = (body, type, init = {}) => new Response(body, {...init, headers: {'Content-Type': type, 'Cache-Control': 'private, no-store', 'Content-Length': '999', ...(init.headers || {})}});
const send = async (pathname, response, method = 'GET') => R.renameResponse(new Request(O + pathname, {method}), response, DB);
let out = await send('/welcome', res('<title>SWA Advanced | Savage</title><h1>SWA Development</h1><script>const label=\'SWA Advanced is for grades 7–12\';</script><p>SWA Intermediate</p>', 'text/html; charset=utf-8', {status: 200}));
assert.equal(await out.text(), '<title>Black Program | Savage</title><h1>Elementary (K-6)</h1><script>const label=\'Black Program is for grades 7–12\';</script><p>SWA Intermediate</p>');
assert.equal(out.headers.get('Content-Length'), null, 'the old length is dropped'); assert.equal(out.headers.get('Cache-Control'), 'private, no-store'); assert.equal(out.headers.get('Content-Type'), 'text/html; charset=utf-8');
out = await send('/api/roster', res(JSON.stringify({sessions: [{title: 'SWA Advanced', program: 'Advanced'}], error: 'SWA Development is for grades K–6.'}), 'application/json'));
assert.deepEqual(await out.json(), {sessions: [{title: 'Black Program', program: 'Advanced'}], error: 'Elementary (K-6) is for grades K–6.'}, 'still valid data, and the program id is untouched');
out = await send('/api/timesheets', res('Coach,Program\nDana,SWA Advanced\n', 'text/csv', {headers: {'Content-Disposition': 'attachment; filename="hours.csv"'}}));
assert.equal(await out.text(), 'Coach,Program\nDana,Black Program\n'); assert.equal(out.headers.get('Content-Disposition'), 'attachment; filename="hours.csv"');
out = await send('/api/checkout', res(JSON.stringify({error: 'SWA Advanced requires coach approval.'}), 'application/json', {status: 403, statusText: 'Forbidden'}), 'POST');
assert.equal(out.status, 403); assert.equal(out.statusText, 'Forbidden'); assert.equal((await out.json()).error, 'Black Program requires coach approval.');
assert.equal(await (await send('/x', res('SWA Advanced', 'text/plain'))).text(), 'Black Program');
// Left exactly as they are: the owner's raw settings, backups, the Stripe webhook, the health checks, files, empty replies.
const same = async (pathname, response, method) => assert.equal(await send(pathname, response, method), response, pathname);
for (const p of ['/api/academy', '/api/backups', '/api/backups/part', '/api/stripe-webhook', '/api/health', '/api/setup-status']) await same(p, res('{"name":"SWA Advanced"}', 'application/json'));
await same('/brand/logo.png', res('SWA Advanced', 'image/png')); await same('/portal-workspace.js', res('"SWA Advanced"', 'text/javascript'));
await same('/welcome', new Response(null, {status: 204, headers: {'Content-Type': 'text/html'}})); await same('/welcome', res('SWA Advanced', 'text/html'), 'HEAD');
await same('/welcome', new Response(null, {status: 303, headers: {Location: '/login', 'Content-Type': 'text/html'}}));
// With no renamed program nothing is rewritten: the very same response goes out.
saveNames(null);
await same('/welcome', res('<h1>SWA Advanced</h1>', 'text/html'));
// Saving the settings makes this Worker read the names again straight away.
saveNames({Advanced: 'Black Program'}); await R.currentProgramNames(DB);
sqlite.prepare("UPDATE academy_state SET payload=? WHERE id='academy'").run(JSON.stringify({programNames: {Advanced: 'Gold'}}));
assert.equal(await (await send('/welcome', res('SWA Advanced', 'text/html'))).text(), 'Black Program', 'kept names until the settings are saved');
await send('/api/academy', res('{}', 'application/json'), 'PUT');
assert.equal(await (await send('/welcome', res('SWA Advanced', 'text/html'))).text(), 'Gold');
// A database problem never fails a page: it goes out with the built-in names.
R.forgetProgramNames();
out = await R.renameResponse(new Request(O + '/welcome'), res('<h1>SWA Advanced</h1>', 'text/html'), {prepare() { throw Error('db down'); }});
assert.equal(await out.text(), '<h1>SWA Advanced</h1>');
// The Worker runs it last, after the shared top bar and styles are added.
assert.match(readFileSync('build/worker.ts', 'utf8'), /return await renameResponse\(request, await decorateResponse\(request, response\), db\);/);

// ---------- Every email ----------
saveNames({Advanced: 'Black Program', Elementary: 'Elementary (K-6)'});
const email = load('lib/email.ts');
const results = await email.sendEmailsDetailed([{to: 'pat@example.test', subject: 'Sam is approved for SWA Advanced', text: 'Sam is approved for SWA Advanced. You can now register.\n\nSWA Intermediate is unchanged.'}]);
assert.deepEqual(plain(results), [{status: 'sent', reason: null}]);
const mail = requests.at(-1).body[0];
assert.equal(mail.subject, 'Sam is approved for Black Program'); assert.equal(mail.text, 'Sam is approved for Black Program. You can now register.\n\nSWA Intermediate is unchanged.');
assert.match(mail.html, /Black Program/); assert.doesNotMatch(mail.html, /SWA Advanced/, 'the Savage layout carries the owner’s name too');
saveNames(null);
await email.sendEmailsDetailed([{to: 'pat@example.test', subject: 'Welcome to SWA Advanced', text: 'SWA Advanced'}]);
assert.equal(requests.at(-1).body[0].subject, 'Welcome to SWA Advanced', 'no renamed program: sent as written');

// ---------- The product name at Stripe; the order keeps the built-in name ----------
const checkout = readFileSync('lib/checkout.ts', 'utf8');
assert.match(checkout, /const product = \{name: await withProgramNames\(charge\.itemLabel\), description: `For \$\{wrestler\.name\}`\};/);
assert.match(checkout, /import \{withProgramNames\} from '\.\/program-renames';/);

// ---------- No page's script breaks, whatever name is chosen ----------
// A name lands inside quoted text in page scripts. Every script that parses with the built-in names must still parse
// with names that use every mark a name may hold.
const tricky = {Elementary: 'Elementary (K-6): New/Returning, 5+', Intermediate: 'MS & HS Intermediate', Advanced: 'Black Program - Élite.'};
for (const n of Object.values(tricky)) assert.equal(N.cleanProgramName(n), n);
const pages = readdirSync('app', {recursive: true, withFileTypes: true}).filter(e => e.isFile() && /\.(html|ts)$/.test(e.name)).map(e => path.join(e.parentPath ?? e.path, e.name));
let scripts = 0, withNames = 0;
for (const file of pages) {
  const html = readFileSync(file, 'utf8');
  for (const m of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const code = m[1]; if (!code.trim() || /type="(?:speculationrules|application\/(?:ld\+)?json)"/.test(m[0])) continue;
    let parses = true; try { new vm.Script(code); } catch { parses = false; }
    if (!parses) continue; // a page script inside a server template is checked through its page, not here
    scripts++; if (/SWA (Development|Intermediate|Advanced)/.test(code)) withNames++;
    assert.doesNotThrow(() => new vm.Script(N.applyProgramNames(code, tricky)), file + ': a page script no longer parses with the owner’s names');
  }
}
assert.ok(scripts > 30 && withNames > 5, `checked ${scripts} page scripts, ${withNames} with program names`);
console.log(`Passed: a program name may hold only letters, numbers, spaces and a few marks; the owner’s names are saved beside the settings and checked by the server; each built-in name is replaced once, on every page, data reply and spreadsheet (not in backups, the raw settings, the Stripe webhook or the health checks), in every email and in the product name at Stripe; with no renamed program nothing is rewritten; a database problem never fails a page; ${scripts} page scripts still parse with unusual names.`);
