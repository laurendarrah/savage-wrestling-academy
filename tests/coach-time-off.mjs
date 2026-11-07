// Issue #193: coach time off. A coach asks with dates and a reason; only the owner decides. On approval (#197 Q7):
// A. it stays on the coach's time history, B. only the other coaches in the same programs are told (never other
// programs, never the reason), C. the coach's practices and lessons in those dates are listed for cover. Nothing is
// cancelled. Runs the real routes against a database built from every migration (tests/accounts.mjs).
import assert from 'node:assert/strict';
import {load, request, sqlite, users, levels} from './accounts.mjs';

const staff = load('app/api/staff/route.ts'), api = load('app/api/coach-time/route.ts'), owner = load('app/api/timesheets/route.ts');
const reply = async r => ({status: r.status, body: await r.json()});
const post = (route, path, body, who) => route.POST(request(path, 'POST', body, who)).then(reply);
const get = (route, path, who) => route.GET(request(path, 'GET', null, who)).then(reply);
const all = (sql, ...a) => sqlite.prepare(sql).all(...a);
const ny = k => new Date(Date.now() + k * 864e5).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const totp = id => [{id, status: 'verified', factor_type: 'totp'}];
const people = {dana: 'dana.coach@example.test', lee: 'lee.coach@example.test', sam: 'sam.coach@example.test', kim: 'kim.coach@example.test'};
for (const [k, email] of Object.entries(people)) { users[k] = {id: k + '-uuid', email, email_confirmed_at: '2026-10-15', factors: totp(k + '-f')}; levels[k] = 'aal2'; }

// Dana and Kim coach SWA Intermediate, Lee coaches SWA Development and SWA Intermediate, Sam only SWA Advance. The owner
// coaches SWA Intermediate too. Kim's access was removed.
const every = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const state = {programs: [{id: 'Elementary'}, {id: 'Intermediate'}, {id: 'Advanced'}],
  seasons: [['Elementary', '17:00', '18:00'], ['Intermediate', '18:00', '19:30'], ['Advanced', '19:30', '21:00']].map(([program, start, end]) => ({program, start: ny(-60), end: ny(400), weekly: every.map(day => ({day, start, end})), excludedDates: []}))};
sqlite.prepare("INSERT OR REPLACE INTO academy_state(id,payload,revision,updated_by,updated_at) VALUES ('academy',?,1,'owner','x')").run(JSON.stringify(state));
for (const [who, name, programs] of [['dana', 'Coach Dana', ['Intermediate']], ['lee', 'Coach Lee', ['Elementary', 'Intermediate']], ['sam', 'Coach Sam', ['Advanced']], ['kim', 'Coach Kim', ['Intermediate']]])
  assert.equal((await post(staff, '/api/staff', {action: 'grant', email: people[who], name, programs}, 'owner')).status, 200);
assert.equal((await post(staff, '/api/staff', {action: 'revoke', email: people.kim}, 'owner')).status, 200);
assert.equal((await post(staff, '/api/staff', {action: 'self', name: 'Justin', programs: ['Intermediate']}, 'owner')).status, 200);

// Dana's lessons in the dates: one booked and paid, one open.
const [d1, d2, d3] = [ny(20), ny(21), ny(22)];
sqlite.prepare("INSERT INTO coach_openings(id,user_id,date,start,end,coach_email) VALUES ('op-a','dana-uuid',?,'16:00','17:00',?),('op-b','dana-uuid',?,'16:00','17:00',?),('op-c','dana-uuid',?,'16:00','17:00',?)").run(d2, people.dana, d3, people.dana, ny(40), people.dana);
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source)
  VALUES ('L-a','alice-uuid','alice@example.test','w','Sam','lesson','op-a','Lesson',?,6000,0,6000,'usd',?,'{}','paid','k-a',0,'t','t','t','stripe')`).run(JSON.stringify([d2]), JSON.stringify({coachEmail: people.dana, start: '16:00'}));

// ---------- Asking ----------
const ask = (body, who = 'dana') => post(api, '/api/coach-time', {action: 'time-off', ...body}, who);
assert.equal((await ask({start: d1, end: d3, reason: 'Wedding'}, 'alice')).status, 403, 'families cannot ask');
assert.equal((await ask({start: d3, end: d1, reason: 'Wedding'})).status, 400, 'last day before first');
assert.equal((await ask({start: d1, end: d3, reason: ''})).status, 400, 'reason required');
assert.equal((await ask({start: ny(-40), end: ny(-39), reason: 'Long ago'})).status, 400, 'at most a month back');
assert.equal((await ask({start: '2026-02-30', end: d3, reason: 'Wedding'})).status, 400);
let r = await ask({start: d1, end: d3, reason: 'Family wedding out of state'});
assert.equal(r.status, 200);
const reqId = r.body.id;
assert.equal((await ask({start: d2, end: ny(25), reason: 'More'})).status, 409, 'overlaps a request already waiting');
r = await get(api, '/api/coach-time', 'dana');
assert.equal(r.body.timeOffRequests[0].status, 'pending'); assert.equal(r.body.timeOffRequests[0].reason, 'Family wedding out of state');
assert.equal((await get(api, '/api/coach-time', 'lee')).body.timeOffRequests.length, 0, 'coaches see only their own requests');

// ---------- Only the owner decides ----------
const rev = () => sqlite.prepare('SELECT revision FROM coach_time_off WHERE id=?').get(reqId).revision;
for (const who of ['dana', 'lee', 'alice']) assert.equal((await post(owner, '/api/timesheets', {action: 'time-off', id: reqId, revision: rev(), decision: 'approve'}, who)).status, 403, who);
r = await get(owner, '/api/timesheets', 'owner');
const pending = r.body.timeOff.pending.find(x => x.id === reqId);
assert.equal(pending.reason, 'Family wedding out of state', 'the owner sees the reason');
assert.equal(pending.cover.practices.length, 3, 'what would need cover is shown before deciding');
assert.equal(all('SELECT * FROM notifications').length, 0, 'nobody is told while it is waiting');
assert.equal((await post(owner, '/api/timesheets', {action: 'time-off', id: reqId, revision: rev() + 1, decision: 'approve'}, 'owner')).status, 409, 'stale page');
assert.equal((await post(owner, '/api/timesheets', {action: 'time-off', id: reqId, revision: rev(), decision: 'maybe'}, 'owner')).status, 400);

// ---------- Approval: A, B and C ----------
r = await post(owner, '/api/timesheets', {action: 'time-off', id: reqId, revision: rev(), decision: 'approve', note: 'Enjoy it'}, 'owner');
assert.equal(r.status, 200); assert.equal(r.body.told, 1, 'one other active coach shares a program');
const notes = all('SELECT email,kind,subject,body,user_id FROM notifications ORDER BY kind,email');
// B: Lee (shares SWA Intermediate) is told. Sam (SWA Advance only), Kim (removed) and the owner (who approved it) are not.
assert.deepEqual(notes.map(n => [n.email, n.kind]), [[people.dana, 'coach_time_off_approved'], [people.lee, 'coach_time_off_team']]);
const team = notes.find(n => n.kind === 'coach_time_off_team');
assert.match(team.subject, /^Coach Dana is away /); assert.match(team.body, /You both coach SWA Intermediate\./); assert.match(team.body, /nothing on the schedule changes/);
assert.doesNotMatch(team.body + team.subject, /wedding/i, 'the reason stays private');
assert.match(notes.find(n => n.email === people.dana).body, /is approved\. The academy will arrange cover.*Note from the academy: Enjoy it/);
assert.ok(notes.every(n => n.user_id === null));
// Coaches read their notices on their hours page; other coaches see nothing.
assert.match((await get(api, '/api/coach-time', 'lee')).body.notices[0].subject, /^Coach Dana is away/);
assert.equal((await get(api, '/api/coach-time', 'sam')).body.notices.length, 0);
assert.equal(all("SELECT * FROM security_events WHERE action='coach_time_off_approved'").length, 1);
assert.equal(JSON.parse(sqlite.prepare('SELECT programs FROM coach_time_off WHERE id=?').get(reqId).programs)[0], 'Intermediate', 'programs kept with the approval');
// C: the owner's page lists Dana's practices and lessons in the dates. Nothing is cancelled.
r = await get(owner, '/api/timesheets', 'owner');
const approved = r.body.timeOff.approved.find(x => x.id === reqId);
assert.deepEqual(approved.cover.practices.map(p => [p.date, p.title, p.time]), [d1, d2, d3].map(d => [d, 'SWA Intermediate', '6:00 PM–7:30 PM']), 'only her programs');
assert.deepEqual(approved.cover.lessons.map(l => [l.date, l.booked]), [[d2, 1], [d3, 0]], 'her lessons in the dates, with bookings');
assert.equal(all('SELECT * FROM coach_openings').length, 3, 'lessons are not cancelled'); assert.equal(all("SELECT * FROM orders WHERE status='paid'").length, 1);
// A: kept on the coach's history, on her hours page and the owner's month.
const month = d2.slice(0, 7);
r = await get(api, '/api/coach-time?month=' + month, 'dana');
assert.ok(r.body.timeOff.some(t => t.start === d1 && t.end === d3), 'on her month');
assert.equal(r.body.timeOffRequests[0].status, 'approved');
r = await get(owner, '/api/timesheets?month=' + month, 'owner');
assert.ok(r.body.coaches.find(c => c.email === people.dana).timeOff.length === 1, 'on the owner’s month for her, even with no shifts');
// Re-deciding is refused; notices are sent once.
assert.equal((await post(owner, '/api/timesheets', {action: 'time-off', id: reqId, revision: rev(), decision: 'decline'}, 'owner')).status, 409);
assert.equal(all('SELECT * FROM notifications').length, 2);

// ---------- Decline and withdraw ----------
r = await ask({start: ny(60), end: ny(60), reason: 'Doctor'}, 'lee');
const leeReq = r.body.id;
r = await post(owner, '/api/timesheets', {action: 'time-off', id: leeReq, revision: 1, decision: 'decline', note: 'Tournament weekend'}, 'owner');
assert.equal(r.status, 200); assert.equal(r.body.told, 0);
assert.deepEqual(all("SELECT email,kind FROM notifications WHERE dedupe_key LIKE ?", '%' + leeReq + '%').map(n => [n.email, n.kind]), [[people.lee, 'coach_time_off_declined']], 'a decline tells only the coach');
r = await ask({start: ny(70), end: ny(71), reason: 'Trip'}, 'sam');
assert.equal((await post(api, '/api/coach-time', {action: 'time-off-withdraw', id: r.body.id, revision: 1}, 'dana')).status, 409, 'not someone else’s');
assert.equal((await post(api, '/api/coach-time', {action: 'time-off-withdraw', id: r.body.id, revision: 1}, 'sam')).status, 200);
assert.equal((await post(api, '/api/coach-time', {action: 'time-off-withdraw', id: r.body.id, revision: 2}, 'sam')).status, 409, 'only while waiting');
assert.equal((await ask({start: ny(70), end: ny(71), reason: 'Trip again'}, 'sam')).status, 200, 'withdrawn dates can be asked again');

// ---------- A shift on an approved day off is flagged for the owner ----------
{
  const S = load('lib/coach-timesheets.ts');
  const dana = {email: people.dana, name: 'Coach Dana', programs: ['Intermediate']};
  const day = d2, inAt = new Date(Date.parse(day + 'T23:00:00Z'));
  // Clocking in is never blocked by time off; the owner sees it.
  const c = await S.clockIn(dana, 'dana-uuid', {duty: 'head', session: `practice:Intermediate:${day}:18:00`}, inAt);
  assert.equal(c.status, 200);
  const m = await S.coachMonth(dana, day.slice(0, 7), inAt);
  assert.ok(m.open.flags !== undefined);
  r = await get(owner, '/api/timesheets?month=' + day.slice(0, 7) + '&coach=' + encodeURIComponent(people.dana), 'owner');
  assert.ok(r.body.coaches[0].shifts[0].flags.includes('This day is in the coach’s approved time off.'));
}
console.log('Coach time off tests passed: requests with dates and a private reason, overlap and date checks, owner-only decisions, approval tells only active coaches who share a program (not other programs, not the owner, not the reason), the coach is told the decision, cover lists the coach’s practices and lessons without cancelling anything, approval stays on the coach’s and owner’s month, declines and withdrawals, and shifts on days off are flagged.');
