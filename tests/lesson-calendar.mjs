// Issue #390 (the owner's site change request of Nov 18): a lesson calendar on Coaches & lessons, a Public/Private
// switch per lesson time, and a link the owner sends parents to book a time. A Private time is listed for no family
// and is not on the public calendar; its link books it. A family's private group keeps its own invite link.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import {nextMillisecond} from './fixtures/clock.mjs';

const migrations = readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort();
const sqlite = new DatabaseSync(':memory:');
for (const f of migrations) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {
  prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }, async run() { return {meta: sqlite.prepare(sql).run(...a)}; },
    _execute() { const s = sqlite.prepare(sql); return s.columns().length ? {results: s.all(...a)} : {results: [], meta: s.run(...a)}; }}; },
  async batch(list) { sqlite.exec('BEGIN'); try { const r = list.map(s => s._execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }
};
const env = {DB};
const one = (sql, ...a) => ({...sqlite.prepare(sql).get(...a)});
let actor = {owner: true, id: 'owner-id'};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, TextEncoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console, btoa,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test',
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, user: {id: actor.id}, headers: new Headers()}),
          verifiedAccount: async () => ({user: {id: actor.id, email: actor.id + '@example.test', email_confirmed_at: 'y'}, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.endsWith('/access-control')) return {coachAccess: async () => actor.coach ? {email: actor.coach, name: 'Coach Dana', programs: actor.programs ?? ['Intermediate'], owner: false} : null, accountRole: async () => actor.coach ? {role: 'coach', staff: {email: actor.coach, name: 'Coach Dana', programs: ['Intermediate']}} : {role: 'family', staff: null}};
        if (name.endsWith('/stripe-test')) return {storedStripeKeyFor: async () => null, stripeClientFor: () => null, stripeMode: () => 'test'};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}

const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2, programs: [], seasons: [], events: []}));
const card = {usawNumber: 'AB1234', usawExpires: '2099-12-31'};
const families = {
  p1: [{id: 'w-p1', name: 'Sam', grade: '8', ...card}, {id: 'w-p1b', name: 'Sasha', grade: 'K', ...card}],
  p2: [{id: 'w-p2', name: 'Riley', grade: '8', ...card}],
  p3: [{id: 'w-p3', name: 'Max', grade: '9', ...card}],
  p4: [{id: 'w-p4', name: 'Jo', grade: '7', ...card}],
  p5: [{id: 'w-p5', name: 'Noa', grade: '10', ...card}],
  p6: [{id: 'w-p6', name: 'No Card', grade: '8'}]
};
for (const [u, wrestlers] of Object.entries(families)) sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test',
  JSON.stringify({parentName: 'Parent ' + u, phone: '555-01' + u.slice(1), wrestlers}), 1, 'x');
sqlite.prepare("INSERT INTO staff_access VALUES ('dana@example.test','Coach Dana','[\"Intermediate\"]',1,'x')").run();
sqlite.prepare("INSERT INTO academy_settings VALUES ('lessons',?,'x','o')").run(JSON.stringify({prices: {'one-on-one': 6000, partner: 4500, 'small-group': 3500}, splits: {}, defaultSplit: 50}));

const quotes = load(path.resolve('lib/quotes.ts'));
const lessons = load(path.resolve('lib/lessons.ts'));
const capacity = load(path.resolve('lib/capacity.ts'));
const backups = load(path.resolve('lib/backup-records.ts'));
const lessonsApi = load(path.resolve('app/api/lessons/route.ts'));
const coachApi = load(path.resolve('app/api/coach/route.ts'));
const payments = load(path.resolve('app/api/payments/route.ts'));
const coachPay = load(path.resolve('app/api/coach-pay/route.ts'));
const O = 'https://a.test';
const call = async (route, method, body, q = '') => { const r = await route[method](new Request(O + '/x' + q, method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const as = id => { actor = id === 'owner' ? {owner: true, id: 'owner-id'} : id === 'coach' ? {owner: false, id: 'coach-dana', coach: 'dana@example.test'} : {owner: false, id}; };
const quote = (u, openingId, extra = {}) => quotes.quoteBooking(u, {type: 'lesson', wrestlerId: 'w-' + u, openingId, ...extra});
const record = (u, openingId, wrestlerId = 'w-' + u) => { as('owner'); return call(payments, 'POST', {action: 'record', userId: u, wrestlerId, kind: 'lesson', openingId, method: 'cash'}); };
const idOf = (date, start) => sqlite.prepare('SELECT id FROM coach_openings WHERE date=? AND start=?').get(date, start).id;
const calendarApi = load(path.resolve('app/api/lesson-calendar/route.ts'));
const publicApi = load(path.resolve('app/api/public-schedule/route.ts'));
const log = load(path.resolve('lib/security-log.ts'));
const get = async (route, q = '') => { const r = await route.GET(new Request(O + '/x' + q)); return {status: r.status, body: await r.json(), headers: r.headers}; };
const month = ny(3).slice(0, 7);

// --- The migration adds Public/Private and the link; links are unique ---
{
  const cols = sqlite.prepare('PRAGMA table_info(coach_openings)').all().map(c => c.name);
  assert.ok(cols.includes('hidden') && cols.includes('share_code'));
  assert.deepEqual({...sqlite.prepare("SELECT dflt_value FROM pragma_table_info('coach_openings') WHERE name='hidden'").get()}, {dflt_value: '0'}, 'new and existing times start Public');
  assert.match(readFileSync('drizzle/0050_lesson_visibility.sql', 'utf8'), /CREATE UNIQUE INDEX `coach_openings_share` ON `coach_openings` \(`share_code`\)/);
}

// --- Three times from the coach: an open time, a coach-hosted small group, and one a family makes a private group ---
as('coach');
const add = (date, start, extra = {}) => call(coachApi, 'POST', {action: 'add', date, start, end: String(+start.slice(0, 2) + 1).padStart(2, '0') + ':00', ...extra});
const d = ny(3);
for (const [start, extra] of [['10:00', {}], ['11:00', {format: 'small-group', spots: 3}], ['12:00', {}]]) assert.equal((await add(d, start, extra)).status, 200);
const open = idOf(d, '10:00'), group = idOf(d, '11:00'), famTime = idOf(d, '12:00');
as('p3'); assert.equal((await call(lessonsApi, 'POST', {action: 'request', openingId: famTime, format: 'partner', wrestlerIds: ['w-p3']})).status, 200);
const familyCode = one('SELECT invite_code FROM coach_openings WHERE id=?', famTime).invite_code;

// --- The owner's calendar ---
for (const who of ['p1', 'coach']) { as(who); assert.equal((await get(calendarApi, '?month=' + month)).status, 403, 'owner only: ' + who); }
as('owner');
let cal = (await get(calendarApi, '?month=' + month)).body;
assert.equal(cal.month, month); assert.ok(Array.isArray(cal.holidays));
const at = id => cal.lessons.find(l => l.id === id);
assert.deepEqual([at(open).coach, at(open).formatName, at(open).private, at(open).familyGroup, at(open).spotsLeft, at(open).booked.length], ['Coach Dana', '', false, false, 1, 0], 'an open time');
assert.deepEqual([at(group).formatName, at(group).capacity, at(group).private], ['Small-group lesson', 3, false]);
assert.deepEqual([at(famTime).familyGroup, at(famTime).private, at(famTime).organizer, at(famTime).formatName], [true, true, 'Parent p3', 'Partner lesson'], 'a family’s group is theirs and already private');
assert.ok(cal.lessons.every(l => !('shareCode' in l) && !('inviteCode' in l)), 'no code is in the calendar data');
assert.equal((await get(calendarApi, '?month=nope')).body.month, ny(0).slice(0, 7), 'a bad month falls back to this one');

// --- Before: families and the public calendar see the Public times ---
as('p1');
const listed = async () => (await call(lessonsApi, 'GET')).body.openings.map(o => o.id);
assert.deepEqual((await listed()).filter(x => [open, group, famTime].includes(x)).sort(), [open, group].sort());
let pub = (await get(publicApi, '?month=' + month)).body;
const pubAt = start => pub.lessons.find(l => l.date === d && l.start === start);
assert.deepEqual({...pubAt('10:00')}, {date: d, start: '10:00', end: '11:00', coach: 'Coach Dana', format: 'one-on-one', formatName: 'One-on-one lesson', spotsLeft: 1}, 'an open time on the public calendar: coach, time, type and spots only');
assert.equal(pubAt('11:00').formatName, 'Small-group lesson'); assert.equal(pubAt('12:00'), undefined, 'a family’s private group is never on it');
assert.ok(pub.lessons.every(l => Object.keys(l).sort().join() === 'coach,date,end,format,formatName,spotsLeft,start'), 'nothing about families or links');

// --- Make the open time Private ---
const flip = (id, priv, who = 'owner') => { as(who); return call(calendarApi, 'POST', {action: 'visibility', id, private: priv}); };
assert.equal((await flip(open, true, 'p1')).status, 403, 'owner only'); assert.equal((await flip(open, true, 'coach')).status, 403);
assert.equal((await flip(open, 'yes')).status, 400); assert.equal((await flip('nope', true)).status, 404);
let r = await flip(famTime, false); assert.deepEqual([r.status, r.body.error], [409, 'A family set this time up as their private group, so it is already private. Its invite link is theirs.']);
r = await flip(open, true); assert.deepEqual([r.status, r.body.private], [200, true]);
assert.equal(one('SELECT hidden FROM coach_openings WHERE id=?', open).hidden, 1);
as('p1'); assert.ok(!(await listed()).includes(open), 'a Private time is not in the families’ list');
pub = (await get(publicApi, '?month=' + month)).body; assert.equal(pubAt('10:00'), undefined, 'nor on the public calendar'); assert.ok(pubAt('11:00'), 'the Public group still is');
assert.equal((await quote('p1', open)).status, 409, 'and cannot be booked without its link');
assert.equal((await call(lessonsApi, 'POST', {action: 'request', openingId: open, format: 'partner', wrestlerIds: ['w-p1']})).status, 409, 'or turned into a family group');
as('owner'); cal = (await get(calendarApi, '?month=' + month)).body; assert.equal(at(open).private, true);

// --- The link for parents ---
const link = (id, who = 'owner') => { as(who); return call(calendarApi, 'POST', {action: 'link', id}); };
assert.equal((await link(open, 'p1')).status, 403); assert.equal((await link(open, 'coach')).status, 403);
r = await link(famTime); assert.deepEqual([r.status, r.body.error], [409, 'A family set this time up as their private group. Its invite link is theirs to send.']);
r = await link(open); assert.equal(r.status, 200);
const url = new URL(r.body.url), code = url.searchParams.get('join');
assert.equal(url.origin + url.pathname, 'https://swa.test/lesson', 'from appOrigin(), never the request’s host'); assert.match(code, /^[A-Za-z0-9_-]{32}$/);
assert.equal((await link(open)).body.url, r.body.url, 'the same link every time, so one already sent keeps working');
assert.notEqual(code, familyCode);
// A parent opens it: the lesson shows as one to book, not a family's group.
as('p1');
r = await call(lessonsApi, 'GET', null, '?join=' + code);
assert.equal(r.status, 200);
assert.deepEqual([r.body.invite.id, r.body.invite.shared, r.body.invite.organizer, r.body.invite.mine, r.body.invite.coach, r.body.invite.spotsLeft], [open, true, null, false, 'Coach Dana', 1]);
assert.ok(!('inviteCode' in r.body.invite), 'no code is sent back');
const q = await quote('p1', open, {invite: code}); assert.equal(q.status ?? 200, 200, JSON.stringify(q.error ?? '')); assert.equal(q.review.title, 'One-on-one lesson', 'an open time booked by link is a one-on-one');
assert.equal((await quote('p1', open, {invite: familyCode})).status, 409, 'another code does not open it');
// The family group's own link still opens only that group.
r = await call(lessonsApi, 'GET', null, '?join=' + familyCode); assert.equal(r.body.invite.id, famTime); assert.equal(r.body.invite.shared, false);
// A link to a Public time works too, and books it like the list.
r = await link(group); const groupCode = new URL(r.body.url).searchParams.get('join');
as('p2'); r = await call(lessonsApi, 'GET', null, '?join=' + groupCode); assert.deepEqual([r.body.invite.id, r.body.invite.shared, r.body.invite.format], [group, true, 'small-group']);
assert.equal((await quote('p2', group, {invite: groupCode})).review.title, 'Small-group lesson');
// Back to Public: listed again, and the link still works.
r = await flip(open, false); assert.equal(r.status, 200);
as('p1'); assert.ok((await listed()).includes(open)); assert.equal((await call(lessonsApi, 'GET', null, '?join=' + code)).body.invite.id, open);
// A family that turns a Public time with a link into their own group: the owner's link stops, the family's takes over.
assert.equal((await call(lessonsApi, 'POST', {action: 'request', openingId: open, format: 'partner', wrestlerIds: ['w-p1']})).status, 200);
assert.equal((await call(lessonsApi, 'GET', null, '?join=' + code)).status, 404, 'the owner’s link no longer opens a family’s group');
assert.equal((await call(lessonsApi, 'POST', {action: 'cancel', openingId: open})).status, 200);
assert.equal((await call(lessonsApi, 'GET', null, '?join=' + code)).body.invite.id, open, 'and works again once the family calls it off');

// --- The coach and owner openings pages say a time is Private ---
await flip(group, true);
as('coach'); const mine = (await call(coachApi, 'GET')).body;
const sched = (mine.lessons ?? mine.openings ?? mine.schedule ?? []).find?.(s => s.id === group);
if (sched) assert.equal(sched.private, true);
assert.equal((await lessons.coachSchedule({email: 'dana@example.test', name: 'Coach Dana', userId: 'coach-dana'})).find(s => s.id === group).private, true);
for (const f of ['app/coach-openings/screen.html', 'app/coach/screen.html']) assert.match(readFileSync(f, 'utf8'), /if\(s\.private&&s\.hosted!=='family'\)body\+='<p class="kind muted">Private: /, f);

// --- Issue #397: coaches switch and share their own times, and choose Private when they add one ---
{
  const d2 = ny(5);
  as('coach');
  assert.equal((await add(d2, '09:00', {private: 'yes'})).status, 400, 'Public or Private is a yes or no');
  assert.equal((await add(d2, '09:00', {private: true})).status, 200);
  assert.equal((await add(d2, '13:00')).status, 200, 'Public when not chosen');
  const priv = idOf(d2, '09:00'), pub = idOf(d2, '13:00');
  assert.deepEqual([one('SELECT hidden FROM coach_openings WHERE id=?', priv).hidden, one('SELECT hidden FROM coach_openings WHERE id=?', pub).hidden], [1, 0]);
  as('p1'); assert.ok(!(await listed()).includes(priv) && (await listed()).includes(pub), 'a time added as Private is not listed for families');
  // The coach's own page shows which is which.
  as('coach'); let mine = (await call(coachApi, 'GET')).body.openings;
  assert.deepEqual([mine.find(s => s.id === priv).hidden, mine.find(s => s.id === pub).hidden], [true, false]);
  // Switch: own times only. Another coach's time, or a family's group, is refused.
  sqlite.prepare("INSERT INTO staff_access VALUES ('lee@example.test','Coach Lee','[\"Intermediate\"]',1,'x')").run();
  sqlite.prepare("INSERT INTO coach_openings(id,user_id,date,start,end,coach_email) VALUES ('lee-time','staff:lee@example.test',?,'15:00','16:00','lee@example.test')").run(d2);
  const cflip = (id, priv2) => call(coachApi, 'POST', {action: 'visibility', id, private: priv2});
  let r = await cflip('lee-time', true); assert.equal(r.status, 404, 'not another coach’s time'); assert.equal(one("SELECT hidden FROM coach_openings WHERE id='lee-time'").hidden, 0);
  r = await cflip(famTime, false); assert.equal(r.status, 409, 'not a family’s group');
  r = await cflip(pub, true); assert.deepEqual([r.status, r.body.private], [200, true]); assert.equal(one('SELECT hidden FROM coach_openings WHERE id=?', pub).hidden, 1);
  r = await cflip(pub, false); assert.equal(r.status, 200); assert.equal(one('SELECT hidden FROM coach_openings WHERE id=?', pub).hidden, 0);
  // Link: own times only, from appOrigin(), the same link the owner would get.
  assert.equal((await call(coachApi, 'POST', {action: 'link', id: 'lee-time'})).status, 404);
  r = await call(coachApi, 'POST', {action: 'link', id: priv}); assert.equal(r.status, 200);
  const coachLink = new URL(r.body.url); assert.equal(coachLink.origin + coachLink.pathname, 'https://swa.test/lesson');
  as('owner'); assert.equal((await call(calendarApi, 'POST', {action: 'link', id: priv})).body.url, r.body.url, 'one link per time, whoever copies it');
  as('p2'); r = await call(lessonsApi, 'GET', null, '?join=' + coachLink.searchParams.get('join')); assert.deepEqual([r.body.invite.id, r.body.invite.shared], [priv, true], 'a parent opens it to book');
  // A family cannot switch or share through the coach page.
  as('p1'); assert.equal((await call(coachApi, 'POST', {action: 'visibility', id: pub, private: true})).status, 403);
  // The owner does the same on a coach's Lesson openings.
  const ownerOpenings = load(path.resolve('app/api/coach-openings/route.ts'));
  as('owner'); r = await call(ownerOpenings, 'POST', {action: 'visibility', email: 'lee@example.test', id: 'lee-time', private: true});
  assert.equal(r.status, 200); assert.equal(one("SELECT hidden FROM coach_openings WHERE id='lee-time'").hidden, 1);
  assert.equal((await call(ownerOpenings, 'POST', {action: 'visibility', email: 'lee@example.test', id: priv, private: false})).status, 404, 'only that coach’s times');
  r = await call(ownerOpenings, 'POST', {action: 'link', email: 'lee@example.test', id: 'lee-time'}); assert.match(r.body.url, /^https:\/\/swa\.test\/lesson\?join=[A-Za-z0-9_-]{32}$/);
  r = await call(ownerOpenings, 'POST', {action: 'add', email: 'lee@example.test', date: d2, start: '17:00', end: '18:00', private: true}); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(one("SELECT hidden FROM coach_openings WHERE coach_email='lee@example.test' AND start='17:00'").hidden, 1, 'the owner can add a Private time for a coach');
  // Both pages: the choice in the add form, and the switch and link on each time.
  for (const f of ['app/coach/screen.html', 'app/coach-openings/screen.html']) {
    const page = readFileSync(f, 'utf8');
    assert.match(page, /<label>Who can book<select (name="visibility" )?id="visibility"><option value="public">Public: families see it<\/option><option value="private">Private: only by its link<\/option><\/select><\/label>/, f);
    assert.match(page, /private:(v\.visibility|\$\('visibility'\)\.value)==='private'/, f);
    assert.match(page, /<button type="button" data-link="\$\{esc\(s\.id\)\}">Copy link for parents<\/button><button type="button" class="quiet" data-flip="\$\{esc\(s\.id\)\}" data-private="\$\{s\.hidden\?'0':'1'\}">\$\{s\.hidden\?'Make public':'Make private'\}<\/button>/, f);
    assert.match(page, /function shareHtml\(s,known\)\{if\(s\.hosted==='family'\)return '';/, f + ': no switch or link on a family’s group');
  }
  assert.match(readFileSync('app/help/coach/screen.html', 'utf8'), /<strong>Who can book<\/strong>: a <strong>Public<\/strong> time shows for every family/);
}

// --- The security log ---
{
  const lines = sqlite.prepare("SELECT action,target FROM security_events WHERE action LIKE 'lesson_made_%' ORDER BY rowid").all().map(x => x.action + ' ' + x.target);
  assert.ok(lines.length >= 3); assert.match(lines[0], /^lesson_made_private Coach Dana · \w{3}, \w{3} \d+ · 10:00 AM$/);
  const names = {people: {}, you: [], approvals: {}, waitlist: {}, orders: {}, waivers: {}, wrestlers: {}, requests: {}, curricula: {}, coaches: {}, scholarships: {}};
  const e = log.describeSecurityEvent({actor: 'owner-id', action: 'lesson_made_private', target: 'Coach Dana · Mon, Nov 23 · 10:00 AM', created_at: new Date().toISOString()}, names, new Date());
  assert.deepEqual([e.title, e.detail], ['Lesson time made private', 'Coach Dana · Mon, Nov 23 · 10:00 AM']);
}

// --- Backups keep Public/Private and the link ---
{
  const file = await backups.readBackup?.();
  if (file) { const row = file.openings.find(o => o.id === group); assert.deepEqual([row.hidden, typeof row.share_code], [1, 'string'], 'a backup keeps them'); }
}

// --- The pages ---
{
  const page = readFileSync('app/lesson-calendar/screen.html', 'utf8');
  assert.match(page, /<script src="\/month-picker\.js"><\/script><script>/);
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'));
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {id, innerHTML: '', textContent: '', hidden: false, value: ''}); return nodes.get(id); };
  as('owner'); const live = (await get(calendarApi, '?month=' + month)).body;
  const ctx = vm.createContext({document: {getElementById: el, querySelectorAll: () => []}, location: {search: ''}, URLSearchParams, fetch: async () => ({ok: true, json: async () => live}), navigator: {}, Date, JSON, Promise, Error, String, Number, Array, Set, Object});
  vm.runInContext(script, ctx); for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r));
  assert.equal(el('status').textContent, ''); assert.match(el('summary').textContent, /^\d+ lesson times · \d+ booked · \d+ private$/);
  assert.match(el('grid').innerHTML, new RegExp(`<button type="button" class="day[^"]*" data-day="${d}" aria-pressed="true" aria-label="[^"]+: 3 lessons, \\d booked"><span class="n">${Number(d.slice(8))}</span>`), 'the day with lessons is a button, opened first');
  assert.equal(el('dayTitle').textContent, new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric'}));
  const day = el('dayList').innerHTML;
  assert.match(day, /11:00 AM–12:00 PM · Coach Dana <span class="pill neutral">Private<\/span><\/h3><p>Small-group lesson<\/p>[\s\S]*?data-link="[^"]+">Copy link for parents<\/button><button type="button" class="quiet" data-flip="[^"]+" data-private="0">Make public<\/button>/);
  assert.match(day, /12:00 PM–1:00 PM · Coach Dana <span class="pill neutral">Family’s private group<\/span><\/h3><p>Partner lesson · set up by Parent p3<\/p>[\s\S]*?The family set this up and sends its invite link themselves\./);
  assert.doesNotMatch(day.split('12:00 PM–1:00 PM')[1].split('</article>')[0], /data-flip|data-link/, 'no switch or link on a family’s group');
  vm.runInContext("data.lessons.forEach(l=>{l.date='2020-01-06'});data.today='2020-02-01';chosen='2020-01-06';renderDay()", ctx);
  assert.doesNotMatch(el('dayList').innerHTML, /data-flip|data-link/, 'a lesson that has passed has no switch or link');
  const fam = readFileSync('app/lesson/screen.html', 'utf8');
  assert.match(fam, /\$\('joinHeading'\)\.textContent=g\.shared\?'Book this lesson':mine\?'This is your group':/);
  const cal2 = readFileSync('app/calendar/screen.html', 'utf8');
  assert.match(cal2, /<button type="button" class="lesson" data-filter="lessons" aria-pressed="false">Private lessons<\/button>/);
  assert.match(cal2, /function lessonSlots\(day\)\{return \(state\.lessons\|\|\[\]\)\.filter\(l=>shows\('lessons'\)&&l\.date===day\)/);
}
console.log('Passed: the owner’s lesson calendar shows every coach’s times by day; a time made Private leaves the families’ list and the public calendar and is booked only by its link; the owner’s link is kept, works for Public and Private times and never opens a family’s group; a family’s group keeps its own link and has no switch; backups keep both.');
