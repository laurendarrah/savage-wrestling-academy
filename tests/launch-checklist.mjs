// Issue #123: the owner's launch checklist reflects the real records and settings, and never reveals a secret.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }}; }};
// Loads a lib module and the lib modules it imports (pure code only: no Cloudflare runtime).
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const module = {exports: {}}; modules.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, JSON, Date, Number, Array, Object, Set, Math, String, Intl, require: name => {
      if (!/^\.\/[a-z-]+$/.test(name)) throw Error(name);
      return load('lib/' + name.slice(2) + '.ts');
    }});
  return modules.get(file);
}
const {launchChecklist, LAUNCH_BOARD, REPO_ISSUES} = load('lib/launch-checklist.ts');
const today = '2026-11-06', now = Date.parse('2026-11-06T15:00:00Z');
const by = list => Object.fromEntries(list.items.map(i => [i.key, i]));

// A brand-new site: everything to do, payments closed and in test mode, email waiting on its setup.
let r = await launchChecklist(DB, {}, today, now), i = by(r);
assert.equal(r.ready, 1, 'only site health is ready on a new site');
for (const k of ['programs', 'schedule', 'website', 'waiver', 'coaches', 'lessons', 'address', 'signin', 'stripe', 'backup']) assert.equal(i[k].status, 'todo', k);
assert.equal(i.email.status, 'waiting'); assert.equal(i.checkout.status, 'info'); assert.equal(i.health.status, 'done');
assert.match(i.address.detail, /site address is not set/);
// Issue #252: with no programs published, the schedule is not "done" just because no program lacks times.
assert.equal(i.schedule.detail, 'Publish the programs, then add weekly practices so families can see and book them');
// Public website (#215): a to-do until the owner saves it, linking to its editor.
assert.equal(i.website.href, '/website'); assert.match(i.website.detail, /^Write your public website/);
// Camps and events: for information, opening the dashboard's Camps & events section.
assert.equal(i.events.status, 'info'); assert.equal(i.events.section, 'Camps & events'); assert.equal(i.events.href, undefined);
assert.equal(i.events.detail, 'No upcoming camps, clinics or events. Add them under Camps & events');
// Coaches: no coach and no invite yet.
assert.equal(i.coaches.detail, 'Give each coach access to their programs'); assert.equal(i.coaches.href, '/staff');
// Justin sets up Resend and Stripe on his own accounts (decided): the wording says so, and names the missing settings.
assert.equal(i.email.detail, 'Set up Resend on your account, then add its settings in Supabase and Cloudflare: Resend’s SMTP details under Supabase Authentication → Emails, and EMAIL_API_KEY and MAIL_FROM on the site in Cloudflare. Until then notices go to each family’s Messages inbox');
assert.match(i.stripe.detail, /^Create your Stripe account and save a restricted test key on Online payment setup\. Give the key the Balance \(read\) permission/);
// Live payments: for information in test mode; never counted.
assert.equal(i.live.status, 'info'); assert.equal(i.live.href, '/payment-setup'); assert.match(i.live.detail, /Switch to live when you’re ready \(#26\)$/);
// Decisions and the attorney's review stay in GitHub: one information line to the Launch board, no items of their own.
assert.equal(i.decisions.status, 'info'); assert.equal(i.decisions.label, 'Decisions and attorney review'); assert.match(i.decisions.detail, /^See the Launch board in GitHub/);
assert.equal(i.decisions.href, LAUNCH_BOARD); assert.ok(LAUNCH_BOARD.startsWith(REPO_ISSUES + '/'));
assert.equal(REPO_ISSUES, 'https://github.com/laurendarrah/savage-wrestling-academy/issues');
assert.ok(!r.items.some(x => /membership terms|refund/i.test(x.label)), 'decisions are not checklist items');
for (const k of ['authenticator', 'mfa-off']) assert.equal(i[k], undefined, k);
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
// Issue #252: the practice schedule is per program. Intermediate's only semester has ended, so it has no times.
assert.equal(i.schedule.status, 'todo'); assert.equal(i.schedule.section, 'Schedules');
assert.equal(i.schedule.detail, 'SWA Intermediate has no practice times yet. Add a semester under Schedules', 'a season that ended does not count');
// Two programs without times are both named; a semester with no weekly practices doesn't count either.
{
  const state = JSON.parse(sqlite.prepare("SELECT payload FROM academy_state WHERE id='academy'").get().payload);
  const save = s => sqlite.prepare("UPDATE academy_state SET payload=? WHERE id='academy'").run(JSON.stringify(s));
  save({...state, programs: [...state.programs, {id: 'Advanced', priceCents: 0}], seasons: [...state.seasons, {program: 'Advanced', start: '2026-12-01', end: '2027-03-01', weekly: []}]});
  assert.equal(by(await launchChecklist(DB, settings, today, now)).schedule.detail, 'SWA Intermediate and SWA Advance have no practice times yet. Add a semester under Schedules');
  // An upcoming semester counts: Intermediate starts in January.
  state.seasons.push({program: 'Intermediate', start: '2027-01-04', end: '2027-05-01', weekly: [{day: 'Tuesday'}]});
  save(state);
}
// Public website: done once saved with a headline (#215).
sqlite.prepare("INSERT INTO academy_settings(id,payload,updated_at,updated_by) VALUES ('website',?,?,'owner')").run(JSON.stringify({headline: 'Train with Savage', intro: 'Wrestling K–12.', coaches: []}), at);
// Camps and events: counts what the public calendar shows (not archived, not over).
{
  const state = JSON.parse(sqlite.prepare("SELECT payload FROM academy_state WHERE id='academy'").get().payload);
  state.events = [{id: 'camp-1', type: 'Camp', name: 'Winter camp', dates: ['2026-12-28', '2026-12-29']}, {id: 'clinic-1', type: 'Clinic', name: 'Takedowns', dates: ['2026-11-06']},
    {id: 'clinic-2', type: 'Clinic', name: 'Mat returns', dates: ['2026-11-20']}, {id: 'old', type: 'Event', name: 'Over', dates: ['2026-10-01']},
    {id: 'hidden', type: 'Event', name: 'Archived', dates: ['2026-12-01'], archived: true}];
  sqlite.prepare("UPDATE academy_state SET payload=? WHERE id='academy'").run(JSON.stringify(state));
}
r = await launchChecklist(DB, settings, today, now); i = by(r);
assert.equal(r.ready, r.total, JSON.stringify(r.items.filter(x => x.status === 'todo')));
assert.match(i.programs.detail, /^2 programs listed, 1 with prices/); assert.equal(i.programs.action, undefined);
assert.equal(i.schedule.status, 'done'); assert.equal(i.schedule.detail, 'Practice times for SWA Development and SWA Intermediate');
assert.equal(i.website.status, 'done'); assert.equal(i.website.detail, 'Saved, with the headline “Train with Savage”');
assert.equal(i.events.status, 'info'); assert.equal(i.events.detail, '1 camp and 2 clinics coming up');
assert.equal(i.coaches.detail, '1 coach can sign in');
assert.match(i.waiver.detail, /Participation waiver/);
assert.equal(i.consent.status, 'done'); assert.match(i.consent.detail, /“Parent Consent Form” is published/);
assert.equal(i.contract.status, 'done'); assert.match(i.contract.detail, /Coach contract 2026/);
assert.match(i.checkout.detail, /^Open for walk-ins and camps & events$/, 'plain names, not the CHECKOUT_KINDS ids');
assert.equal(i.email.status, 'waiting');
assert.match(i.stripe.detail, /^Test key saved Thu, Nov 5\. Card fees need its Balance \(read\) permission$/);
assert.equal(i.live.status, 'info');
assert.ok(!JSON.stringify(r).includes('must_not_leak'), 'a secret value appeared in the checklist');

// Email notices: still waiting with one setting, naming the one that is missing; done with both.
assert.match(by(await launchChecklist(DB, {...settings, EMAIL_API_KEY: 're_must_not_leak'}, today, now)).email.detail, /and MAIL_FROM on the site in Cloudflare/);
{
  const e = await launchChecklist(DB, {...settings, EMAIL_API_KEY: 're_must_not_leak', MAIL_FROM: 'Savage <hello@mail.example>'}, today, now);
  assert.equal(by(e).email.status, 'done'); assert.equal(by(e).email.detail, 'Sent from Savage <hello@mail.example>');
  assert.ok(!JSON.stringify(e).includes('must_not_leak'));
}

// Coaches: invites from Coaches (#207) that are not used or canceled show beside the coaches, expired ones counted.
{
  const invite = (id, extra = {}) => sqlite.prepare('INSERT INTO coach_invites(id,token_hash,email,name,programs,created_by,created_at,expires_at,used_at,revoked_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, 'hash-' + id, id + '@example.test', 'Coach ' + id, '[]', 'owner', at, extra.expires ?? '2026-11-12T12:00:00Z', extra.used ?? null, extra.revoked ?? null);
  invite('open'); invite('used', {used: at}); invite('canceled', {revoked: at});
  let c = by(await launchChecklist(DB, settings, today, now)).coaches;
  assert.equal(c.status, 'done'); assert.equal(c.detail, '1 coach can sign in. 1 invite not accepted yet'); assert.equal(c.href, '/staff');
  invite('late', {expires: '2026-11-01T12:00:00Z'});
  c = by(await launchChecklist(DB, settings, today, now)).coaches;
  assert.equal(c.detail, '1 coach can sign in. 2 invites not accepted yet (1 expired)');
  // Invites alone don't give access: still a to-do until a coach can sign in.
  sqlite.exec('UPDATE staff_access SET active=0');
  c = by(await launchChecklist(DB, settings, today, now)).coaches;
  assert.equal(c.status, 'todo'); assert.equal(c.detail, 'Give each coach access to their programs. 2 invites not accepted yet (1 expired)');
  sqlite.exec('UPDATE staff_access SET active=1'); sqlite.exec('DELETE FROM coach_invites');
}

// Live payments (#26): live only when STRIPE_MODE is exactly "live"; done with a live key and the live webhook secret.
// The test key and test webhook secret never stand in for the live ones.
{
  for (const mode of ['test', 'LIVE', ' live', '']) assert.equal(by(await launchChecklist(DB, {...settings, STRIPE_MODE: mode}, today, now)).live.status, 'info', mode);
  const liveSettings = {...settings, STRIPE_MODE: 'live'};
  let l = by(await launchChecklist(DB, liveSettings, today, now)).live;
  assert.equal(l.status, 'todo'); assert.equal(l.detail, 'The site is in live mode. Save a restricted live key on Online payment setup');
  sqlite.prepare("INSERT INTO integration_secrets(id,encrypted,updated_at,updated_by) VALUES ('stripe-live','{\"secret\":\"rk_live_must_not_leak\"}',?,'owner')").run('2026-11-06T13:00:00Z');
  l = by(await launchChecklist(DB, liveSettings, today, now)).live;
  assert.equal(l.status, 'todo', 'the test webhook secret does not count for live'); assert.match(l.detail, /live Stripe webhook secret/);
  const done = await launchChecklist(DB, {...liveSettings, STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_live_must_not_leak'}, today, now);
  assert.equal(by(done).live.status, 'done'); assert.equal(by(done).live.detail, 'Live. Live key saved Fri, Nov 6'); assert.equal(done.ready, done.total);
  assert.ok(!JSON.stringify(done).includes('must_not_leak'), 'a live secret appeared in the checklist');
  // A saved live key alone, in test mode, changes nothing.
  assert.equal(by(await launchChecklist(DB, settings, today, now)).live.status, 'info');
  sqlite.exec("DELETE FROM integration_secrets WHERE id='stripe-live'");
}
// A saved website row without a headline (an unreadable restore) is still a to-do.
sqlite.exec(`UPDATE academy_settings SET payload='{"headline":"  "}' WHERE id='website'`);
assert.equal(by(await launchChecklist(DB, settings, today, now)).website.status, 'todo');
sqlite.exec(`UPDATE academy_settings SET payload='not json' WHERE id='website'`);
assert.equal(by(await launchChecklist(DB, settings, today, now)).website.status, 'todo');

// Things that fall out of date: an old backup, a retired waiver, server errors.
sqlite.exec("UPDATE security_events SET created_at='2026-10-01T00:00:00Z'");
sqlite.exec("UPDATE waiver_versions SET retired_at='2026-11-05T13:00:00Z' WHERE kind='waiver'");
sqlite.prepare("INSERT INTO error_log(id,at,method,path,status,message) VALUES ('x',?,'GET','/a',500,'boom')").run('2026-11-06T14:00:00Z');
r = await launchChecklist(DB, settings, today, now); i = by(r);
assert.equal(i.backup.status, 'todo'); assert.match(i.backup.detail, /Download a fresh one/);
assert.equal(i.waiver.status, 'todo'); assert.equal(i.consent.status, 'done', 'retiring the waiver leaves the consent form'); assert.equal(i.health.status, 'todo'); assert.match(i.health.detail, /1 site error /);

// An insecure public address is flagged; a local test address is fine.
for (const [o, ok] of [['http://register.savagewrestling.example', false], ['http://127.0.0.1:8799', true], ['https://x.workers.dev', true]]) {
  const a = by(await launchChecklist(DB, {...settings, APP_ORIGIN: o}, today, now)).address;
  assert.equal(a.status, ok ? 'done' : 'todo', o); if (!ok) assert.match(a.detail, /must start with https/);
}

// Backup authenticator (issue #167): to do with one, done with two, left out when the caller doesn't say.
{
  const on = {...settings, STAFF_MFA: 'on'};
  const one = by(await launchChecklist(DB, on, today, now, 1)).authenticator;
  assert.equal(one.status, 'todo'); assert.equal(one.href, '/security'); assert.match(one.detail, /lost phone/);
  assert.equal(by(await launchChecklist(DB, on, today, now, 2)).authenticator.status, 'done');
  assert.equal(by(await launchChecklist(DB, on, today, now)).authenticator, undefined);
  assert.equal(by(await launchChecklist(DB, settings, today, now, 1)).authenticator, undefined, 'no backup-authenticator item while staff sign in with a password only (#306)');
}
const routeText = readFileSync('app/api/launch-checklist/route.ts', 'utf8');
assert.match(routeText, /factors \?\? \[\]\)\.filter\(f => f\.status === 'verified'\)/, 'counts only verified authenticators');

// Issue #306: no red Safety item about the authenticator, whatever STAFF_MFA says.
for (const v of [undefined, 'off', 'on']) assert.equal(by(await launchChecklist(DB, {...settings, STAFF_MFA: v}, today, now))['mfa-off'], undefined, String(v));

// The page is owner-only and the dashboard shows it.
const route = readFileSync('app/api/launch-checklist/route.ts', 'utf8');
assert.match(route, /ownerIdentity/); assert.match(route, /if \(!auth\.owner\) return/);
assert.match(readFileSync('app/portal.html', 'utf8'), /fetch\('\/api\/launch-checklist'/);
console.log('Launch checklist: new site, fully set up, and items that fall out of date; no secrets shown; owner-only');
