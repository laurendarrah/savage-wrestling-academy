// Issue #123: the owner's launch checklist reflects the real records and settings, and never reveals a secret.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }}; }};
const module = {exports: {}};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/launch-checklist.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
  {module, exports: module.exports, JSON, Date, Number, Array, Object, Set, require: name => {
    if (name !== './purchase-kinds') throw Error(name);
    const m = {exports: {}}; vm.runInNewContext(ts.transpileModule(readFileSync('lib/purchase-kinds.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {module: m, exports: m.exports}); return m.exports;
  }});
const {launchChecklist} = module.exports;
const today = '2026-11-06', now = Date.parse('2026-11-06T15:00:00Z');
const by = list => Object.fromEntries(list.items.map(i => [i.key, i]));

// A brand-new site: everything to do, payments closed, email waiting on its decision.
let r = await launchChecklist(DB, {}, today, now), i = by(r);
assert.equal(r.ready, 1, 'only site health is ready on a new site');
for (const k of ['programs', 'schedule', 'waiver', 'coaches', 'lessons', 'address', 'signin', 'stripe', 'backup']) assert.equal(i[k].status, 'todo', k);
assert.equal(i.email.status, 'waiting'); assert.equal(i.checkout.status, 'info'); assert.equal(i.health.status, 'done');
assert.match(i.address.detail, /site address is not set/);
// Issue #147: on a new site the programs item offers to publish the default programs, right on the dashboard.
assert.equal(i.programs.label, 'Programs on the welcome page and calendar'); assert.equal(i.programs.action, 'publish-programs');
assert.equal(i.programs.section, undefined); assert.match(i.programs.detail, /Families see no programs yet/);
assert.equal(i.waiver.href, '/waivers');
// Issue #195 (decision Q15 on #197): the Parent Consent Form is a to-do until the owner publishes it after the attorney's
// review; the coach contract is for information until published.
assert.equal(i.consent.status, 'todo'); assert.equal(i.consent.href, '/consent-forms');
assert.equal(i.consent.detail, 'Publish the Parent Consent Form (after attorney review). Until then families can book without it');
assert.equal(i.contract.status, 'info'); assert.equal(i.contract.href, '/contracts');
// Saved programs without any price still need attention, from Programs & pricing; nothing to publish.
sqlite.prepare("INSERT INTO academy_state(id,payload,revision,updated_at,updated_by) VALUES ('academy',?,1,?,'owner')").run(JSON.stringify({programs: [{id: 'Elementary', priceCents: 0}]}), '2026-11-05T11:00:00Z');
i = by(await launchChecklist(DB, {}, today, now));
assert.equal(i.programs.status, 'todo'); assert.equal(i.programs.action, undefined); assert.equal(i.programs.section, 'Programs & pricing'); assert.match(i.programs.detail, /Listed without prices/);
sqlite.exec("DELETE FROM academy_state");

// Set up the academy, then check each item turns ready.
const at = '2026-11-05T12:00:00Z';
sqlite.prepare("INSERT INTO academy_state(id,payload,revision,updated_at,updated_by) VALUES ('academy',?,1,?,'owner')").run(JSON.stringify({
  programs: [{id: 'Elementary', priceCents: 20000}, {id: 'Intermediate', priceCents: 0, walkInPriceCents: 0}],
  seasons: [{program: 'Elementary', start: '2026-09-01', end: '2027-06-01', weekly: [{day: 'Monday'}]}, {program: 'Intermediate', start: '2026-01-01', end: '2026-06-01', weekly: [{day: 'Monday'}]}]}), at);
sqlite.prepare("INSERT INTO waiver_versions(id,title,body,sha256,published_at,published_by) VALUES ('w1','Participation waiver','Body','x',?,'owner')").run(at);
// A consent form or contract is not a waiver: the waiver item still reads the waiver after they are published.
sqlite.prepare("INSERT INTO waiver_versions(id,kind,title,body,sha256,published_at,published_by) VALUES ('c1','parent_consent','Parent Consent Form','Body','y',?,'owner')").run('2026-11-05T12:30:00Z');
sqlite.prepare("INSERT INTO waiver_versions(id,kind,title,body,sha256,published_at,published_by) VALUES ('k1','coach_contract','Coach contract 2026','Body','z',?,'owner')").run('2026-11-05T12:40:00Z');
sqlite.prepare("INSERT INTO staff_access(email,name,programs,active,updated_at) VALUES ('c@example.test','Coach','[]',1,?)").run(at);
sqlite.prepare("INSERT INTO academy_settings(id,payload,updated_at,updated_by) VALUES ('lessons',?,?,'owner')").run(JSON.stringify({prices: {'one-on-one': 6000}}), at);
sqlite.prepare("INSERT INTO integration_secrets(id,encrypted,updated_at,updated_by) VALUES ('stripe-test','{\"secret\":\"sk_test_must_not_leak\"}',?,'owner')").run(at);
sqlite.prepare("INSERT INTO security_events(id,actor,action,target,created_at) VALUES ('e1','owner','backup_exported','all',?)").run(at);
const settings = {APP_ORIGIN: 'https://register.savagewrestling.example', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
  STRIPE_TEST_WEBHOOK_SECRET: 'whsec_must_not_leak', CHECKOUT_KINDS: 'walkin,event'};
r = await launchChecklist(DB, settings, today, now); i = by(r);
assert.equal(r.ready, r.total, JSON.stringify(r.items.filter(x => x.status === 'todo')));
assert.match(i.programs.detail, /^2 programs listed, 1 with prices/); assert.equal(i.programs.action, undefined);
assert.match(i.schedule.detail, /^1 program schedule published/, 'a season that ended does not count');
assert.match(i.waiver.detail, /Participation waiver/);
assert.equal(i.consent.status, 'done'); assert.match(i.consent.detail, /“Parent Consent Form” is published/);
assert.equal(i.contract.status, 'done'); assert.match(i.contract.detail, /Coach contract 2026/);
assert.match(i.checkout.detail, /^Open for walk-ins and camps & events$/, 'plain names, not the CHECKOUT_KINDS ids');
assert.equal(i.email.status, 'waiting');
assert.ok(!JSON.stringify(r).includes('must_not_leak'), 'a secret value appeared in the checklist');

// Things that fall out of date: an old backup, a retired waiver, server errors.
sqlite.exec("UPDATE security_events SET created_at='2026-10-01T00:00:00Z'");
sqlite.exec("UPDATE waiver_versions SET retired_at='2026-11-05T13:00:00Z' WHERE kind='waiver'");
sqlite.prepare("INSERT INTO error_log(id,at,method,path,status,message) VALUES ('x',?,'GET','/a',500,'boom')").run('2026-11-06T14:00:00Z');
r = await launchChecklist(DB, settings, today, now); i = by(r);
assert.equal(i.backup.status, 'todo'); assert.match(i.backup.detail, /Download a fresh one/);
assert.equal(i.waiver.status, 'todo'); assert.equal(i.consent.status, 'done', 'retiring the waiver leaves the consent form'); assert.equal(i.health.status, 'todo'); assert.match(i.health.detail, /1 server error /);

// An insecure public address is flagged; a local test address is fine.
for (const [o, ok] of [['http://register.savagewrestling.example', false], ['http://127.0.0.1:8799', true], ['https://x.workers.dev', true]]) {
  const a = by(await launchChecklist(DB, {...settings, APP_ORIGIN: o}, today, now)).address;
  assert.equal(a.status, ok ? 'done' : 'todo', o); if (!ok) assert.match(a.detail, /must start with https/);
}

// Backup authenticator (issue #167): to do with one, done with two, left out when the caller doesn't say.
{
  const one = by(await launchChecklist(DB, settings, today, now, 1)).authenticator;
  assert.equal(one.status, 'todo'); assert.equal(one.href, '/security'); assert.match(one.detail, /lost phone/);
  assert.equal(by(await launchChecklist(DB, settings, today, now, 2)).authenticator.status, 'done');
  assert.equal(by(await launchChecklist(DB, settings, today, now)).authenticator, undefined);
}
const routeText = readFileSync('app/api/launch-checklist/route.ts', 'utf8');
assert.match(routeText, /factors \?\? \[\]\)\.filter\(f => f\.status === 'verified'\)/, 'counts only verified authenticators');

// Issue #204: a red Safety item while STAFF_MFA=off; nothing otherwise.
assert.equal(by(await launchChecklist(DB, {...settings, STAFF_MFA: 'off'}, today, now))['mfa-off'].status, 'todo');
assert.equal(by(await launchChecklist(DB, settings, today, now))['mfa-off'], undefined);

// The page is owner-only and the dashboard shows it.
const route = readFileSync('app/api/launch-checklist/route.ts', 'utf8');
assert.match(route, /ownerIdentity/); assert.match(route, /if \(!auth\.owner\) return/);
assert.match(readFileSync('app/portal.html', 'utf8'), /fetch\('\/api\/launch-checklist'/);
console.log('Launch checklist: new site, fully set up, and items that fall out of date; no secrets shown; owner-only');
