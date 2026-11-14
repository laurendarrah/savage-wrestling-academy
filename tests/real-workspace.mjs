// Issue #147: the owner workspace has no sample screens, and one owner click publishes the real programs.
// Runs the workspace script against the real /api/academy and /api/public-schedule handlers and the launch checklist,
// on a fresh database built from every migration.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import {portalCode as code, portalHtml as html, workspaceCode} from './fixtures/portal-script.mjs';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }, async run() { return {meta: sqlite.prepare(sql).run(...a)}; },
  _execute() { const st = sqlite.prepare(sql); return st.columns().length ? {results: st.all(...a)} : {results: [], meta: st.run(...a)}; }}; },
  async batch(list) { sqlite.exec('BEGIN'); try { const r = list.map(x => x._execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }};
const owner = {userId: 'owner-1', displayName: 'savagewrestlingclub@gmail.com'};
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const module = {exports: {}}; modules.set(file, module.exports);
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js, {module, exports: module.exports, Response, Request, Headers, URL, Intl, Date, JSON, console, crypto, TextEncoder, Uint8Array, require(name) {
    if (name === 'cloudflare:workers') return {env: {DB}};
    if (name.endsWith('/account-auth')) return {ownerIdentity: async () => ({owner, headers: new Headers()})};
    return load(join(dirname(file), name) + '.ts');
  }});
  return modules.get(file);
}
const academy = load('app/api/academy/route.ts'), schedule = load('app/api/public-schedule/route.ts'), {launchChecklist} = load('lib/launch-checklist.ts');
const publicSchedule = async () => (await schedule.GET(new Request('https://academy.test/api/public-schedule'))).json();
const programsItem = async () => (await launchChecklist(DB, {}, '2026-11-06')).items.find(i => i.key === 'programs');

// The workspace script, with the real save path behind fetch.
const nodes = new Map(), node = s => { if (!nodes.has(s)) nodes.set(s, {value: '', style: {}, textContent: '', innerHTML: '', classList: {remove() {}, toggle() {}}, setAttribute() {}}); return nodes.get(s); };
const location = {hash: '', href: ''}, asked = [];
let answer = false, puts = 0;
const ctx = vm.createContext({console, structuredClone, crypto, URL, Intl, Date, JSON, Set, FormData, Promise, location, history: {pushState(state, title, url) { location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''; }},
  document: {querySelector: node, getElementById: id => ['semesterForm', 'holidayPlanner', 'extraPracticeCalendar'].includes(id) ? null : node('#' + id), addEventListener() {}}, window: {addEventListener() {}}, setTimeout() {},
  confirm: text => { asked.push(text); return answer; },
  fetch: async (url, options) => {
    if (url !== '/api/academy') return {ok: false, json: async () => ({})};
    if (options?.method === 'PUT') { puts++; return academy.PUT(new Request('https://academy.test/api/academy', {method: 'PUT', headers: {origin: 'https://academy.test', 'content-type': 'application/json'}, body: options.body})); }
    return academy.GET(new Request('https://academy.test/api/academy'));
  }});
vm.runInContext(code, ctx);
const run = s => vm.runInContext(s, ctx);

// A fresh site: nothing saved, no programs for families, and the checklist offers to publish them.
assert.deepEqual((await publicSchedule()).programs, []);
let item = await programsItem();
assert.equal(item.status, 'todo'); assert.equal(item.action, 'publish-programs');
await run('reloadAcademy()');
assert.equal(node('#syncStatus').textContent, 'Nothing saved yet');
assert.match(run('ownerPrograms()'), /Not on the welcome page yet[\s\S]*onclick="publishPrograms\(\)"/);
assert.deepEqual(JSON.parse(run('JSON.stringify([data.kids,data.staff,data.bookings])')), [[], [], []], 'a new academy has no sample wrestlers, staff or purchases');

// The owner sees exactly what will be published, and can say no.
await run('publishPrograms()');
assert.equal(puts, 0, 'declining publishes nothing');
assert.match(asked[0], /SWA Development \(Grades K–6\): \$200\.00 a month, \$40\.00 walk-in/);
assert.match(asked[0], /SWA Intermediate \(Grades 7–12\): \$200\.00 a month, \$40\.00 walk-in/);
assert.match(asked[0], /SWA Advance \(Grades 7–12 · Coach approval required\): \$200\.00 a month, \$40\.00 walk-in/);

// Publishing saves through the owner's normal save, and the welcome page and calendar list the programs.
answer = true;
await run('publishPrograms()');
assert.equal(puts, 1); assert.equal(run('saveBlocked'), false); assert.equal(run('programsSaved'), true);
const pub = await publicSchedule();
assert.deepEqual(pub.programs.map(p => [p.id, p.name, p.grades, p.monthlyCents, p.walkInCents]), [
  ['Elementary', 'SWA Development', 'Grades K–6', 20000, 4000],
  ['Intermediate', 'SWA Intermediate', 'Grades 7–12', 20000, 4000],
  ['Advanced', 'SWA Advance', 'Grades 7–12 · Coach approval required', 20000, 4000]]);
assert.ok(pub.programs.every(p => !('annualCents' in p)), 'no upfront-year price is published (#210)');
assert.ok(pub.programs.every(p => p.description.length > 40), 'each program has its description');
assert.deepEqual(pub.practices, [], 'publishing the programs publishes no practice schedule; that stays under Schedules');
item = await programsItem();
assert.equal(item.status, 'done'); assert.equal(item.action, undefined); assert.match(item.detail, /^3 programs listed, 3 with prices/);
assert.doesNotMatch(run('ownerPrograms()'), /Not on the welcome page yet/);
const saved = JSON.parse(sqlite.prepare("SELECT payload FROM academy_state WHERE id='academy'").get().payload);
assert.deepEqual([saved.kids, saved.staff], [[], []], 'nothing sample is saved with the programs');

// The published grade wording matches the server's grade rules (lib/program-approval.ts).
const rules = readFileSync('lib/program-approval.ts', 'utf8');
assert.match(rules, /program==='Elementary'\)return \['K','1','2','3','4','5','6'\]/);
assert.match(rules, /HIGH_SCHOOL=\['7','8','9','10','11','12'\]/);
assert.match(rules, /program==='Intermediate'\)return HIGH_SCHOOL\.includes/);
assert.match(rules, /program==='Advanced'&&HIGH_SCHOOL\.includes/);

// Every owner destination (lib/owner-nav.ts, the shell's sidebar, issue #261) is a real page or a real settings editor,
// and nothing says sample, preview or demo. Sections open on the dashboard, each with its own address.
const nav = JSON.parse(run('JSON.stringify(W.OWNER_NAV.flatMap(g=>g.items))'));
assert.equal(nav.length, 21, 'four groups, about fourteen items plus the fold and two hidden section aliases (issue #283)');
const editors = {Dashboard: /Launch checklist|id="launch"/, Calendar: /<h1>Practice calendar<\/h1>/, Schedules: /<h1>Schedules<\/h1>[\s\S]*Plan a semester/, 'Camps & events': /<h1>Camps &amp; events<\/h1>/, 'Programs & pricing': /<h1>Programs &amp; pricing<\/h1>/};
assert.deepEqual(nav.filter(i => i.section).map(i => i.section).sort(), Object.keys(editors).sort());
for (const item of nav) {
  location.href = ''; run(`go(${JSON.stringify(item.section || item.label)})`);
  if (item.section) {
    assert.equal(location.href, '', item.label); assert.equal(run('page'), item.section); assert.match(node('#main').innerHTML, editors[item.section], item.label);
    assert.equal(location.hash.split('?')[0], item.href.slice(1), item.label + ' has its own address');
  } else { assert.equal(location.href, item.href, item.label); assert.ok(existsSync(`app${item.href}/route.ts`), `${item.label} opens ${item.href}, which exists`); }
  assert.doesNotMatch(node('#main').innerHTML, /sample|preview|simulat|demo\b|fictional/i, item.label);
}
// The page and its typed modules (lib/workspace/, issue #45).
for (const src of [html, workspaceCode]) assert.doesNotMatch(src, /[Ss]ample (data|famil|wrestler|workspace)|Demo|admin-demo|attendance-demo|Simulate|Reset workspace data|Import prior browser edits/);
console.log('Real workspace: no sample screens; one click publishes the three programs with their prices to the welcome page and calendar');
