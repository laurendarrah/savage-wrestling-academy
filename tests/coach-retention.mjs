// Issue #212 (Justin's decision in #197, Q18): a coach removed permanently has all their records kept for 3 years from the
// removal date, then deleted. Records a family or the books also depend on are kept without the coach (anonymized).
// Runs the real staff and backup routes and lib/coach-retention.ts against a database built from every migration.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {load, request, sqlite} from './accounts.mjs';

const staff = load('app/api/staff/route.ts'), backups = load('app/api/backups/route.ts');
const retention = load('lib/coach-retention.ts'), backupLib = load('lib/backup-records.ts'), pay = load('lib/coach-pay.ts');
const books = load('lib/financials.ts'), hours = load('lib/coach-timesheets.ts'), securityLog = load('lib/security-log.ts');
const reply = async r => ({status: r.status, body: await r.json()});
const post = (route, path, body, who) => route.POST(request(path, 'POST', body, who)).then(reply);
const get = (route, path, who) => route.GET(request(path, 'GET', null, who)).then(reply);
const run = (sql, ...a) => sqlite.prepare(sql).run(...a);
const one = (sql, ...a) => sqlite.prepare(sql).get(...a);
const count = (sql, ...a) => Object.values(sqlite.prepare(sql).get(...a))[0];
const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const yearsBefore = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y - n, m - 1, dd)).toISOString().slice(0, 10); };
const now = new Date().toISOString();
const tables = () => sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name").all().map(r => r.name);

// Every place a text appears in the database, to prove an email or name is gone from every table.
function everywhere(text) {
  const hits = [];
  for (const name of tables())
    for (const row of sqlite.prepare(`SELECT * FROM ${name}`).all())
      for (const [col, v] of Object.entries(row)) if (typeof v === 'string' && v.toLowerCase().includes(text.toLowerCase())) hits.push(`${name}.${col}`);
  return hits;
}
const dumpAll = () => Object.fromEntries(tables().map(name => [name, sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all().map(r => ({...r}))]));

// ---------- The rule: kept until 3 years after removal, cleaned the day after ----------
{
  assert.equal(retention.keepUntil('2026-11-07'), '2029-11-07');
  assert.equal(retention.keepUntil('2028-02-29'), '2031-03-01', 'a February 29 removal is kept until March 1');
  assert.equal(retention.keepUntil('not-a-date'), '9999-12-31', 'a damaged date never comes due');
  assert.equal(retention.isDue('2026-11-07', '2029-11-07'), false, 'kept on the last day');
  assert.equal(retention.isDue('2026-11-07', '2029-11-08'), true, 'cleaned from the next day');
  assert.match(await retention.emailHash(' Coach@Example.test '), /^[0-9a-f]{64}$/);
  assert.equal(await retention.emailHash('Coach@Example.test'), await retention.emailHash('coach@example.test'), 'the hash ignores case and spaces');
}

// ---------- Permanent removal records the date; Coaches shows "Records kept until" ----------
{
  const email = 'kai.coach@example.test';
  assert.equal((await post(staff, '/api/staff', {action: 'grant', email, name: 'Kai Lee', programs: ['Intermediate']}, 'owner')).status, 200);
  run('INSERT INTO coach_profiles(email,display_name,bio,specialties,phone,photo_key,updated_at,updated_by) VALUES (?,?,?,?,?,NULL,?,?)', email, 'Coach Kai', '', '[]', '555-0102', now, 'owner');
  assert.equal((await post(staff, '/api/staff', {action: 'revoke', email}, 'owner')).status, 200);
  assert.equal((await get(staff, '/api/staff', 'owner')).body.removedForGood.length, 0, 'removing access alone starts no clock');
  assert.equal((await post(staff, '/api/staff', {action: 'delete', email, confirmed: true}, 'owner')).status, 200);
  const tomb = one('SELECT * FROM removed_coaches WHERE email=?', email);
  assert.equal(tomb.removed_on, today, 'the academy date of the removal'); assert.equal(tomb.name, 'Coach Kai', 'the name the owner knew them by');
  assert.equal(tomb.email_hash, await retention.emailHash(email)); assert.equal(tomb.cleaned_at, null);
  const r = await get(staff, '/api/staff', 'owner');
  assert.equal(r.body.retentionYears, 3);
  assert.deepEqual(r.body.removedForGood, [{email, name: 'Coach Kai', removedOn: today, keepUntil: retention.keepUntil(today)}]);
  assert.equal(retention.keepUntil(today), yearsBefore(today, -3));
  // Nothing is due for 3 years: the daily job changes nothing and logs nothing.
  const before = dumpAll();
  assert.deepEqual({...await retention.cleanupRemovedCoaches()}, {due: 0, finished: 0, inProgress: 0, deleted: 0, anonymized: 0});
  assert.deepEqual(dumpAll(), before);
  // Back on Coaches: they leave the removed list. Removed for good again: the clock restarts, still one row.
  run("INSERT INTO staff_access(email,name,programs,active,updated_at) VALUES (?,?,'[]',1,?)", email, 'Kai Lee', now);
  assert.equal((await get(staff, '/api/staff', 'owner')).body.removedForGood.length, 0);
  run("UPDATE removed_coaches SET removed_on='2020-01-01' WHERE email=?", email);
  await post(staff, '/api/staff', {action: 'revoke', email}, 'owner');
  assert.equal((await post(staff, '/api/staff', {action: 'delete', email, confirmed: true}, 'owner')).status, 200);
  assert.equal(count('SELECT count(*) FROM removed_coaches WHERE email_hash=?', tomb.email_hash), 1, 'one row per coach');
  assert.equal(one('SELECT removed_on FROM removed_coaches WHERE email=?', email).removed_on, today, 'removed again: kept 3 years from the new date');

  // The page (inline JavaScript is not typechecked).
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, innerHTML: '', textContent: '', dataset: {}, style: {}, querySelector: () => null, querySelectorAll: () => []}); return nodes.get(id); };
  const ctx = vm.createContext({document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null}, confirm: () => true, Date, JSON, Promise, Error, Object, Array, Number, String, Set, Map,
    fetch: async () => ({ok: true, status: 200, json: async () => ({staff: [], self: null, invites: [], inviteDays: 7, retentionYears: 3, removedForGood: [{email, name: 'Coach <Kai>', removedOn: '2026-11-07', keepUntil: '2029-11-07'}]})})});
  for (const [, code] of readFileSync('app/staff/screen.html', 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(code, ctx);
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(el('goneBox').hidden, false);
  assert.match(el('gone').innerHTML, /Records kept until <b>November 7, 2029<\/b>, then deleted\./);
  assert.match(el('gone').innerHTML, /removed permanently November 7, 2026/);
  assert.match(el('gone').innerHTML, /Coach &lt;Kai&gt;/, 'names are escaped');
  assert.equal(el('retentionYears').textContent, 3);
}

// ---------- The cleanup ----------
// Two removed coaches with the same kinds of records: Rae was removed 3 years and 1 day ago (cleaned), Max 3 years minus
// 1 day ago (kept). Families Alice and Bob paid for a lesson with each.
const OLD = 'rae.coach@example.test', NEW = 'max.coach@example.test';
const tombOf = async (id, email, name, removedOn) => run('INSERT INTO removed_coaches(id,email_hash,email,name,removed_on,cleaned_at) VALUES (?,?,?,?,?,NULL)', id, await retention.emailHash(email), email, name, removedOn);
function seedCoach(p, email, uid, name, lessonDay) {
  const label = `One-on-one lesson with ${name}, ${lessonDay}`;
  const pricing = JSON.stringify({format: 'one-on-one', formatName: 'One-on-one lesson', coachEmail: email, coachName: name, start: '16:00', end: '17:00', slots: 1, group: null, perWrestler: true});
  const order = (id, family, opening, status, cents) => run(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source)
    VALUES (?,?,?,?,?,'lesson',NULL,?,?,?,?,0,?,'usd',?,'{}',?,?,0,?,?,?,'offline')`, id, family + '-uuid', family + '@example.test', 'w-' + family, 'Wrestler ' + family, opening, label, JSON.stringify([lessonDay]), cents, cents, pricing, status, 'k-' + id, lessonDay + 'T15:00:00.000Z', lessonDay + 'T15:00:00.000Z', lessonDay + 'T16:00:00.000Z');
  const opening = (id, date, coachEmail = email) => run('INSERT INTO coach_openings(id,user_id,date,start,end,coach_email) VALUES (?,?,?,?,?,?)', id, uid, date, '16:00', '17:00', coachEmail);
  opening(p + '-booked', lessonDay); order(p + '-ord-a', 'alice', p + '-booked', 'paid', 6000); order(p + '-ord-b', 'bob', p + '-booked', 'refunded', 6000);
  opening(p + '-open', addDays(lessonDay, 1)); opening(p + '-legacy', addDays(lessonDay, 2), null);
  run("INSERT INTO attendance VALUES (?,?,?,?,?,?,?,?,?)", p + '-att', `practice:Intermediate:${lessonDay}:18:00`, lessonDay, 'alice-uuid', 'w-alice', 'Wrestler alice', 'Member', now, uid);
  run("INSERT INTO practice_plans VALUES (?,?,?,?,?,?,?,?)", p + '-plan', 'Intermediate', lessonDay, '{"title":"Stance","sections":[]}', 1, 1, uid, now);
  run("INSERT INTO security_events VALUES (?,?,?,?,?)", p + '-ev1', 'owner-uuid', 'coach_access_revoked', email, now);
  run("INSERT INTO security_events VALUES (?,?,?,?,?)", p + '-ev2', 'owner-uuid', 'coach_month_approved', `${email} 2023-09 2 12000`, now);
  run("INSERT INTO security_events VALUES (?,?,?,?,?)", p + '-ev3', uid, 'coach_clock_in', p + '-shift-ok', now);
  run("INSERT INTO security_events VALUES (?,?,?,?,?)", p + '-ev4', uid, 'waiver_signed', 'waiver-1/w-own', now); // as a parent: not a coach action
  if (p === 'rae') run("INSERT INTO security_events VALUES (?,?,?,?,?)", p + '-ev5', 'owner-uuid', 'coach_access_revoked', 'x' + email, now); // another email ending the same
  const shift = (id, approved, voided) => run(`INSERT INTO coach_time_entries(id,user_id,coach_email,coach_name,work_date,duty,source,clock_in,clock_out,coach_note,submitted_at,owner_note,approved_at,approved_by,approved_minutes,approved_duty,approved_rate_cents,approved_cents,voided_at,voided_by,void_reason,history,revision,created_at)
    VALUES (?,?,?,?,'2023-09-12','head','hand','2023-09-12T22:00:00.000Z','2023-09-12T23:30:00.000Z','Covered for Sam',?,?,?,?,?,?,?,?,?,?,?,?,2,?)`, id, uid, email, name,
    now, approved ? 'ok' : null, approved ? now : null, approved ? 'owner-uuid' : null, approved ? 90 : null, approved ? 'head' : null, approved ? 4000 : null, approved ? 6000 : null,
    voided ? now : null, voided ? 'owner-uuid' : null, voided ? 'Duplicate' : null, `[{"by":"coach","note":"${name}"}]`, now);
  shift(p + '-shift-ok', true, false); shift(p + '-shift-draft', false, false); shift(p + '-shift-void', false, true);
  run("INSERT INTO coach_time_off(id,user_id,coach_email,coach_name,start_date,end_date,reason,status,programs,requested_at,decided_at,decided_by,revision) VALUES (?,?,?,?,'2023-10-01','2023-10-03','Wedding','approved','[\"Intermediate\"]',?,?,'owner-uuid',2)", p + '-off', uid, email, name, now, now);
  const notice = (id, userId, to, kind, key) => run('INSERT INTO notifications(id,user_id,email,kind,subject,body,dedupe_key,created_at,read_at,email_status) VALUES (?,?,?,?,?,?,?,?,NULL,?)', id, userId, to, kind, 'Subject', 'Body', key, now, 'sent');
  notice(p + '-n1', null, email, 'coach_time_off_approved', 'time-off-decided:' + p + '-off');
  notice(p + '-n2', null, 'team.coach@example.test', 'coach_time_off_team', `time-off-team:${p}-off:team.coach@example.test`);
  notice(p + '-n3', 'alice-uuid', 'alice@example.test', 'card_expiring', p + '-card-soon');
  run("INSERT INTO waiver_signatures VALUES (?,?,?,?,?,?,?,?,?)", p + '-contract', 'contract-1', uid, '', '', name, email.toUpperCase(), '{"strokes":[]}', now);
  run("INSERT INTO waiver_signatures VALUES (?,?,?,?,?,?,?,?,?)", p + '-waiver', 'waiver-1', 'alice-uuid', 'w-alice', 'Wrestler alice ' + p, 'Alice', 'alice@example.test', '{"strokes":[]}', now);
  run('INSERT INTO coach_profiles(email,display_name,bio,specialties,phone,photo_key,updated_at,updated_by) VALUES (?,?,?,?,?,NULL,?,?)', email, name, 'Bio', '[]', '555-0199', now, uid);
  run("INSERT INTO coach_invites(id,token_hash,email,name,programs,created_by,created_at,expires_at,revoked_at) VALUES (?,?,?,?,'[]','owner-uuid',?,?,?)", p + '-inv', p + '-hash', email, name, now, now, now);
}
run("INSERT INTO waiver_versions(id,kind,title,body,sha256,published_at,published_by) VALUES ('contract-1','coach_contract','Coach contract','Text','e',?,'owner-uuid')", now);
run("INSERT INTO waiver_versions(id,kind,title,body,sha256,published_at,published_by) VALUES ('waiver-1','waiver','Waiver','Text','c',?,'owner-uuid')", now);
seedCoach('rae', OLD, 'rae-uuid', 'Rae Quinn', '2023-09-14');
seedCoach('max', NEW, 'max-uuid', 'Max Ortiz', '2023-09-21');
// A family's own membership, and the owner's own check-ins, are never touched.
run(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source)
  VALUES ('member-1','alice-uuid','alice@example.test','w-alice','Wrestler alice','annual','Intermediate','Intermediate','Membership','[]',240000,0,240000,'usd','{}','{}','paid','k-member',0,?,?,'2023-09-02T16:00:00.000Z','offline')`, now, now);
run("INSERT INTO attendance VALUES ('owner-att','practice:Intermediate:2023-09-14:18:00','2023-09-14','bob-uuid','w-bob','Wrestler bob','Member',?,'owner-uuid')", now);
run("INSERT INTO academy_settings(id,payload,updated_at,updated_by) VALUES ('lessons',?,?,'owner-uuid') ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
  JSON.stringify({prices: {'one-on-one': 6000}, splits: {[OLD]: 70, [NEW]: 60}, defaultSplit: 65}), now);
run("INSERT INTO academy_settings(id,payload,updated_at,updated_by) VALUES ('website',?,?,'owner-uuid') ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
  JSON.stringify({headline: 'SWA', intro: '', mission: '', coaches: [NEW, OLD], achievements: [], alumni: [], address: '', email: ''}), now);
const oldRemoved = addDays(yearsBefore(today, 3), -1), newRemoved = addDays(yearsBefore(today, 3), 1);
await tombOf('rae-tomb', OLD, 'Rae Quinn', oldRemoved);
await tombOf('max-tomb', NEW, 'Max Ortiz', newRemoved);
const KEY = 'former-coach-rae-tomb';

// What families paid, the books, lesson pay and approved hours for the month of those lessons, before the cleanup.
const familyTotals = () => sqlite.prepare("SELECT user_id,status,sum(amount_cents) AS cents,count(*) AS n FROM orders GROUP BY user_id,status ORDER BY user_id,status").all().map(r => ({...r}));
const ledger = async () => ({...books.totals(await books.ledgerLines('2023-09-01', '2023-09-30'))});
const payroll = async () => { const r = await pay.coachPayReport('2023-09-01', '2023-09-30'); return JSON.parse(JSON.stringify({totals: r.totals, coaches: r.coaches.map(c => [c.lessons, c.grossCents, c.splitPct, c.owedCents]).sort()})); };
// The month's pay in the hours file. (Its to-do counts drop: a shift never approved is deleted, not paid.)
const hoursFile = async () => { const o = (await hours.ownerMonth('2023-09', null)).overall; return {minutes: o.minutes, practiceCents: o.practiceCents, approvedCents: o.approvedCents, lessonCents: o.lessonCents}; };
const baseline = {families: familyTotals(), ledger: await ledger(), payroll: await payroll(), hours: await hoursFile()};
assert.equal(baseline.payroll.totals.grossCents, 12000); assert.equal(baseline.payroll.totals.owedCents, 4200 + 3600, 'each coach at their own share');
assert.equal(baseline.hours.approvedCents, 12000, 'two approved shifts in the hours file');
assert.ok(baseline.ledger.incomeCents >= 240000 + 12000);
const unchanged = async what => {
  assert.deepEqual(familyTotals(), baseline.families, what + ': families paid the same');
  assert.deepEqual(await ledger(), baseline.ledger, what + ': the books are the same');
  assert.deepEqual(await payroll(), baseline.payroll, what + ': lesson pay is the same');
  assert.deepEqual(await hoursFile(), baseline.hours, what + ': approved hours are the same');
};
const beforeFile = JSON.parse(JSON.stringify(await backupLib.readBackup())); // a backup made before the cleanup
// A recovery snapshot from an earlier restore, made while Rae's lesson times were still hers.
run('INSERT INTO recovery_snapshots(id,payload,created_at) VALUES (?,?,?)', 'snap-old', JSON.stringify(await backupLib.readCore()), now);
const maxBefore = everywhere(NEW).sort();

{
  const summary = await retention.cleanupRemovedCoaches();
  assert.equal(summary.due, 1, 'only Rae is past 3 years'); assert.equal(summary.finished, 1); assert.equal(summary.inProgress, 0);
  assert.ok(summary.deleted > 0 && summary.anonymized > 0);

  // Coach-only records are deleted.
  for (const [sql, what] of [
    ['SELECT count(*) FROM coach_profiles WHERE email=?', 'profile and phone'], ['SELECT count(*) FROM coach_invites WHERE email=?', 'old invites'],
    ['SELECT count(*) FROM coach_time_off WHERE coach_email=?', 'time off'], ['SELECT count(*) FROM coach_time_entries WHERE coach_email=?', 'shifts'],
    ['SELECT count(*) FROM waiver_signatures WHERE lower(email)=?', 'signed contract'], ['SELECT count(*) FROM notifications WHERE email=?', 'notices to the coach'],
    ['SELECT count(*) FROM coach_openings WHERE coach_email=?', 'lesson times']]) assert.equal(count(sql, OLD), 0, what);
  assert.equal(count("SELECT count(*) FROM coach_openings WHERE id IN ('rae-open','rae-legacy')"), 0, 'times nobody booked are deleted, with or without the coach email');
  assert.equal(count("SELECT count(*) FROM coach_time_entries WHERE id IN ('rae-shift-draft','rae-shift-void')"), 0, 'shifts never approved, or voided, are deleted');
  assert.equal(count("SELECT count(*) FROM notifications WHERE id IN ('rae-n1','rae-n2')"), 0, 'notices about their time off are deleted, including to the coaches covering');
  assert.equal(count("SELECT count(*) FROM notifications WHERE id='rae-n3'"), 1, 'family notices stay');
  assert.equal(count("SELECT count(*) FROM waiver_signatures WHERE id='rae-waiver'"), 1, 'family waivers stay');
  assert.equal(count("SELECT count(*) FROM waiver_versions WHERE id='contract-1'"), 1, 'the contract text stays for other coaches');

  // Shared records are kept without the coach.
  const booked = one("SELECT * FROM coach_openings WHERE id='rae-booked'");
  assert.equal(booked.coach_email, KEY); assert.equal(booked.user_id, KEY, 'the booked lesson stays for the families who paid');
  for (const id of ['rae-ord-a', 'rae-ord-b']) {
    const o = one('SELECT * FROM orders WHERE id=?', id), p = JSON.parse(o.pricing);
    assert.equal(o.item_label, 'One-on-one lesson with Former coach, 2023-09-14'); assert.equal(p.coachEmail, KEY); assert.equal(p.coachName, 'Former coach');
    assert.equal(o.amount_cents, 6000); assert.equal(p.format, 'one-on-one', 'the rest of the price record is unchanged');
  }
  assert.equal(one("SELECT status FROM orders WHERE id='rae-ord-b'").status, 'refunded');
  const shift = one("SELECT * FROM coach_time_entries WHERE id='rae-shift-ok'");
  assert.deepEqual([shift.coach_email, shift.user_id, shift.coach_name, shift.coach_note, shift.owner_note, shift.history], [KEY, KEY, 'Former coach', null, null, '[]']);
  assert.deepEqual([shift.approved_minutes, shift.approved_rate_cents, shift.approved_cents, shift.work_date], [90, 4000, 6000, '2023-09-12'], 'the approved pay record stays');
  assert.equal(one("SELECT checked_in_by FROM attendance WHERE id='rae-att'").checked_in_by, KEY, 'the check-in stays; who checked in does not');
  assert.equal(one("SELECT checked_in_by FROM attendance WHERE id='owner-att'").checked_in_by, 'owner-uuid');
  assert.equal(one("SELECT updated_by FROM practice_plans WHERE id='rae-plan'").updated_by, KEY);
  assert.ok(JSON.parse(one("SELECT payload FROM recovery_snapshots WHERE id='snap-old'").payload).openings.some(o => o.coach_email === KEY), 'old recovery snapshots no longer name the coach');
  assert.equal(one("SELECT target FROM security_events WHERE id='rae-ev1'").target, KEY);
  assert.equal(one("SELECT target FROM security_events WHERE id='rae-ev2'").target, KEY + ' 2023-09 2 12000');
  assert.equal(one("SELECT actor FROM security_events WHERE id='rae-ev3'").actor, KEY);
  assert.equal(one("SELECT actor FROM security_events WHERE id='rae-ev4'").actor, 'rae-uuid', 'their actions as a parent are not coach records');
  assert.equal(one("SELECT target FROM security_events WHERE id='rae-ev5'").target, 'x' + OLD, 'another email that merely ends the same is untouched');
  run("DELETE FROM security_events WHERE id='rae-ev5'"); // so the "gone everywhere" checks below are exact
  const lessons = JSON.parse(one("SELECT payload FROM academy_settings WHERE id='lessons'").payload);
  assert.deepEqual(lessons.splits, {[NEW]: 60, [KEY]: 70}, 'their pay share moves to the former-coach key');
  assert.deepEqual(JSON.parse(one("SELECT payload FROM academy_settings WHERE id='website'").payload).coaches, [NEW], 'they leave the team page list');

  // Gone from every table, by email and by name; the removed_coaches row keeps only the hash and dates.
  assert.deepEqual(everywhere(OLD), []);
  assert.deepEqual(everywhere('Rae Quinn'), []);
  const tomb = one("SELECT * FROM removed_coaches WHERE id='rae-tomb'");
  assert.deepEqual([tomb.email, tomb.name, tomb.email_hash, tomb.removed_on], [null, null, await retention.emailHash(OLD), oldRemoved]); assert.ok(tomb.cleaned_at);

  // Max (3 years minus a day) is untouched.
  assert.deepEqual(everywhere(NEW).sort(), maxBefore, 'records of a coach removed less than 3 years ago are kept');
  assert.equal(count('SELECT count(*) FROM coach_time_entries WHERE coach_email=?', NEW), 3); assert.equal(count('SELECT count(*) FROM coach_profiles WHERE email=?', NEW), 1);
  assert.equal(one("SELECT email FROM removed_coaches WHERE id='max-tomb'").email, NEW);

  await unchanged('after the cleanup');
  assert.equal((await pay.coachPayReport('2023-09-01', '2023-09-30')).coaches.find(c => c.coachEmail === KEY).coach, 'Former coach');

  // One security log line, with counts only.
  const logged = sqlite.prepare("SELECT * FROM security_events WHERE action='coach_records_deleted'").all();
  assert.equal(logged.length, 1); assert.equal(logged[0].actor, 'system');
  assert.equal(logged[0].target, `finished:1 in-progress:0 deleted:${summary.deleted} anonymized:${summary.anonymized}`);
  const names = {people: {}, you: [], approvals: {}, waitlist: {}, orders: {}, waivers: {}, wrestlers: {}, requests: {}, curricula: {}, coaches: {}};
  const shown = securityLog.describeSecurityEvent(logged[0], names);
  assert.equal(shown.who, 'The site'); assert.match(shown.title, /records deleted after 3 years/);
  assert.match(shown.detail, /^1 former coach done · \d+ records deleted · \d+ records kept without the coach’s name$/);
  const former = securityLog.describeSecurityEvent({actor: KEY, action: 'coach_access_revoked', target: KEY, created_at: now}, names);
  assert.equal(former.detail, 'A former coach'); assert.equal(former.who, 'A former coach');

  // Coaches no longer lists Rae; Max still shows when his records go.
  const listed = (await get(staff, '/api/staff', 'owner')).body.removedForGood;
  assert.ok(!listed.some(g => g.email === OLD)); assert.equal(listed.find(g => g.email === NEW).keepUntil, retention.keepUntil(newRemoved));
}

// ---------- Running it again changes nothing ----------
{
  const before = dumpAll();
  assert.deepEqual({...await retention.cleanupRemovedCoaches()}, {due: 1, finished: 0, inProgress: 0, deleted: 0, anonymized: 0});
  assert.deepEqual(dumpAll(), before, 'idempotent: same rows, no new log line');
  // The day after Max's date he is cleaned too.
  const max = await retention.cleanupRemovedCoaches({today: addDays(retention.keepUntil(newRemoved), 1)});
  assert.equal(max.finished, 1); assert.deepEqual(everywhere(NEW), []); assert.deepEqual(everywhere('Max Ortiz'), []);
  await unchanged('after both coaches');
}

// ---------- A restored backup cannot bring the records back ----------
{
  assert.equal(backupLib.validBackup(beforeFile), true);
  assert.equal(beforeFile.records.removed_coaches.find(t => t.id === 'rae-tomb').email, OLD, 'the file was made before the cleanup');
  { const older = JSON.parse(JSON.stringify(beforeFile)); delete older.records.removed_coaches; assert.equal(backupLib.validBackup(older), true, 'a file from before #212 still restores'); }
  const preview = await get(backups, '/api/backups?mode=preview', 'owner');
  const r = await post(backups, '/api/backups', {action: 'restore', fingerprint: preview.body.fingerprint, backup: beforeFile}, 'owner');
  assert.equal(r.status, 200);
  assert.ok(r.body.restored.coach_time_entries > 0 && r.body.restored.coach_profiles > 0, 'the file did put deleted rows back');
  // ...and the restore cleaned them again straight away, keeping the removed_coaches rows as they were.
  assert.deepEqual(everywhere(OLD), []); assert.deepEqual(everywhere('Rae Quinn'), []);
  assert.equal(one("SELECT email FROM removed_coaches WHERE id='rae-tomb'").email, null, 'restoring never puts a cleared email back');
  // Max (cleaned above on a simulated later date) is not due yet by today's real date, so his rows stay restored until
  // the first daily run after his date.
  assert.ok(everywhere(NEW).length > 0);
  await retention.cleanupRemovedCoaches({today: addDays(retention.keepUntil(newRemoved), 1)});
  assert.deepEqual(everywhere(NEW), []); assert.deepEqual(everywhere('Max Ortiz'), []);
  assert.equal(one("SELECT coach_email FROM coach_openings WHERE id='rae-booked'").coach_email, KEY);
  await unchanged('after a restore');
  // A database rebuilt from the old file alone (the Deploy backup imported into a new database) has removed_coaches as
  // the file had it, so the next daily run cleans it. Simulated by putting Rae's rows back the way the file has them.
  run("UPDATE removed_coaches SET email=?,name='Rae Quinn',cleaned_at=NULL WHERE id='rae-tomb'", OLD);
  run('INSERT INTO coach_profiles(email,display_name,bio,specialties,phone,photo_key,updated_at,updated_by) VALUES (?,?,?,?,?,NULL,?,?)', OLD, 'Rae Quinn', '', '[]', '', now, 'owner-uuid');
  assert.equal((await retention.cleanupRemovedCoaches()).finished, 1); assert.deepEqual(everywhere(OLD), []);
}

// ---------- A coach who is back on Coaches is never cleaned ----------
{
  const email = 'back.coach@example.test';
  await tombOf('back-tomb', email, 'Back Coach', '2020-01-01');
  run("INSERT INTO staff_access(email,name,programs,active,updated_at) VALUES (?,'Back Coach','[]',1,?)", email, now);
  run('INSERT INTO coach_profiles(email,display_name,bio,specialties,phone,photo_key,updated_at,updated_by) VALUES (?,?,?,?,?,NULL,?,?)', email, 'Back Coach', '', '[]', '', now, 'owner-uuid');
  await retention.cleanupRemovedCoaches();
  assert.equal(count('SELECT count(*) FROM coach_profiles WHERE email=?', email), 1);
  assert.equal(one("SELECT email FROM removed_coaches WHERE id='back-tomb'").email, email);
  run('DELETE FROM staff_access WHERE email=?', email); run("DELETE FROM removed_coaches WHERE id='back-tomb'"); run('DELETE FROM coach_profiles WHERE email=?', email);
}

// ---------- Batches: a big cleanup is spread over several runs ----------
{
  const email = 'busy.coach@example.test', uid = 'busy-uuid';
  await tombOf('busy-tomb', email, 'Busy Coach', '2020-01-01');
  for (let i = 0; i < 60; i++) run(`INSERT INTO coach_time_entries(id,user_id,coach_email,coach_name,work_date,duty,source,clock_in,clock_out,history,revision,created_at)
    VALUES (?,?,?,'Busy Coach','2020-01-02','assistant','hand','2020-01-02T22:00:00.000Z','2020-01-02T23:00:00.000Z','[]',1,?)`, 'busy-' + i, uid, email, now);
  for (let i = 0; i < 40; i++) run('INSERT INTO attendance VALUES (?,?,?,?,?,?,?,?,?)', 'busy-att-' + i, 'practice:Intermediate:2020-01-02:18:00', '2020-01-02', 'kid-' + i, 'w', 'Kid', 'Member', now, uid);
  const left = () => count('SELECT count(*) FROM coach_time_entries WHERE coach_email=?', email) + count('SELECT count(*) FROM attendance WHERE checked_in_by=?', uid);
  let runs = 0, last;
  do {
    const before = left();
    last = await retention.cleanupRemovedCoaches({batch: 5, maxStatements: 24});
    runs++;
    assert.ok(before - left() <= 24 * 5, 'never more than a run’s worth of rows');
    if (last.inProgress) assert.equal(one("SELECT cleaned_at FROM removed_coaches WHERE id='busy-tomb'").cleaned_at, null, 'not marked done while rows are left');
  } while (last.inProgress && runs < 50);
  assert.ok(runs >= 2 && runs < 10, 'took several runs: ' + runs);
  assert.equal(last.finished, 1); assert.equal(left(), 0);
  assert.equal(count("SELECT count(*) FROM attendance WHERE checked_in_by='former-coach-busy-tomb'"), 40, 'every check-in kept, without the coach');
  assert.deepEqual({...await retention.cleanupRemovedCoaches({batch: 5, maxStatements: 24})}, {due: 2, finished: 0, inProgress: 0, deleted: 0, anonymized: 0}, 'and then nothing more to do (Rae and this coach are due)');
  assert.ok(one("SELECT cleaned_at FROM removed_coaches WHERE id='busy-tomb'").cleaned_at);
  const logs = sqlite.prepare("SELECT target FROM security_events WHERE action='coach_records_deleted'").all().map(r => r.target);
  assert.ok(logs.some(t => t.startsWith('finished:0 in-progress:1')), 'runs that stop early say there is more to do');
  assert.ok(logs.every(t => !t.includes('@')), 'no email in the log');
  assert.deepEqual(everywhere(email), []);
}

console.log('Passed: removal date recorded and shown as "Records kept until"; a coach removed 3 years and a day ago is cleaned and 3 years minus a day kept; coach-only records deleted; shared lessons, payments, approved hours, check-ins and the security log kept as "Former coach"; family payments, the books, lesson pay and approved hours unchanged; idempotent; restored backups cleaned again; returning coaches untouched; done in batches.');
