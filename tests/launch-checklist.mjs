// Issue #123: the owner's launch checklist reflects the real records and settings, and never reveals a secret.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }}; }};
const module = {exports: {}};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/launch-checklist.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
  {module, exports: module.exports, JSON, Date, Number, Array, Object, Set});
const {launchChecklist} = module.exports;
const today = '2026-11-06', now = Date.parse('2026-11-06T15:00:00Z');
const by = list => Object.fromEntries(list.items.map(i => [i.key, i]));

// A brand-new site: everything to do, payments closed, email waiting on its decision.
let r = await launchChecklist(DB, {}, today, now), i = by(r);
assert.equal(r.ready, 1, 'only site health is ready on a new site');
for (const k of ['programs', 'schedule', 'waiver', 'coaches', 'lessons', 'address', 'signin', 'stripe', 'backup']) assert.equal(i[k].status, 'todo', k);
assert.equal(i.email.status, 'waiting'); assert.equal(i.checkout.status, 'info'); assert.equal(i.health.status, 'done');
assert.match(i.address.detail, /APP_ORIGIN is not set/);
assert.equal(i.programs.section, 'Programs & pricing'); assert.equal(i.waiver.href, '/waivers');

// Set up the academy, then check each item turns ready.
const at = '2026-11-05T12:00:00Z';
sqlite.prepare("INSERT INTO academy_state(id,payload,revision,updated_at,updated_by) VALUES ('academy',?,1,?,'owner')").run(JSON.stringify({
  programs: [{id: 'Elementary', priceCents: 20000}, {id: 'Intermediate', priceCents: 0, walkInPriceCents: 0}],
  seasons: [{program: 'Elementary', start: '2026-09-01', end: '2027-06-01', weekly: [{day: 'Monday'}]}, {program: 'Intermediate', start: '2026-01-01', end: '2026-06-01', weekly: [{day: 'Monday'}]}]}), at);
sqlite.prepare("INSERT INTO waiver_versions(id,title,body,sha256,published_at,published_by) VALUES ('w1','Participation waiver','Body','x',?,'owner')").run(at);
sqlite.prepare("INSERT INTO staff_access(email,name,programs,active,updated_at) VALUES ('c@example.test','Coach','[]',1,?)").run(at);
sqlite.prepare("INSERT INTO academy_settings(id,payload,updated_at,updated_by) VALUES ('lessons',?,?,'owner')").run(JSON.stringify({prices: {'one-on-one': 6000}}), at);
sqlite.prepare("INSERT INTO integration_secrets(id,encrypted,updated_at,updated_by) VALUES ('stripe-test','{\"secret\":\"sk_test_must_not_leak\"}',?,'owner')").run(at);
sqlite.prepare("INSERT INTO security_events(id,actor,action,target,created_at) VALUES ('e1','owner','backup_exported','all',?)").run(at);
const settings = {APP_ORIGIN: 'https://register.savagewrestling.example', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
  STRIPE_TEST_WEBHOOK_SECRET: 'whsec_must_not_leak', CHECKOUT_KINDS: 'walkin,event'};
r = await launchChecklist(DB, settings, today, now); i = by(r);
assert.equal(r.ready, r.total, JSON.stringify(r.items.filter(x => x.status === 'todo')));
assert.match(i.programs.detail, /^1 program with prices/);
assert.match(i.schedule.detail, /^1 program schedule published/, 'a season that ended does not count');
assert.match(i.waiver.detail, /Participation waiver/);
assert.match(i.checkout.detail, /walkin, event/);
assert.equal(i.email.status, 'waiting');
assert.ok(!JSON.stringify(r).includes('must_not_leak'), 'a secret value appeared in the checklist');

// Things that fall out of date: an old backup, a retired waiver, server errors.
sqlite.exec("UPDATE security_events SET created_at='2026-10-01T00:00:00Z'");
sqlite.exec("UPDATE waiver_versions SET retired_at='2026-11-05T13:00:00Z'");
sqlite.prepare("INSERT INTO error_log(id,at,method,path,status,message) VALUES ('x',?,'GET','/a',500,'boom')").run('2026-11-06T14:00:00Z');
r = await launchChecklist(DB, settings, today, now); i = by(r);
assert.equal(i.backup.status, 'todo'); assert.match(i.backup.detail, /Download a fresh one/);
assert.equal(i.waiver.status, 'todo'); assert.equal(i.health.status, 'todo'); assert.match(i.health.detail, /1 server error /);

// An insecure public address is flagged; a local test address is fine.
for (const [o, ok] of [['http://register.savagewrestling.example', false], ['http://127.0.0.1:8799', true], ['https://x.workers.dev', true]]) {
  const a = by(await launchChecklist(DB, {...settings, APP_ORIGIN: o}, today, now)).address;
  assert.equal(a.status, ok ? 'done' : 'todo', o); if (!ok) assert.match(a.detail, /must start with https/);
}

// The page is owner-only and the dashboard shows it.
const route = readFileSync('app/api/launch-checklist/route.ts', 'utf8');
assert.match(route, /ownerIdentity/); assert.match(route, /if \(!auth\.owner\) return/);
assert.match(readFileSync('app/portal.html', 'utf8'), /fetch\('\/api\/launch-checklist'/);
console.log('Launch checklist: new site, fully set up, and items that fall out of date; no secrets shown; owner-only');
