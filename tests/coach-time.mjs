// Issue #193: coach timesheets. Pay math in integer cents (#197 Q1 rates, Q4 scheduled practice time only), the
// month-end submit rule (Q5, academy time), flags, coach corrections, voiding, the owner's audited corrections and
// approval, the month's file (hours and lesson shares, neutral wording for Q6), owner-only access, and the page scripts.
// Runs the real routes and libraries against a database built from every migration (tests/accounts.mjs).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {load, request, sqlite, users, levels} from './accounts.mjs';

const T = load('lib/coach-time.ts'), S = load('lib/coach-timesheets.ts');
const staff = load('app/api/staff/route.ts'), api = load('app/api/coach-time/route.ts'), owner = load('app/api/timesheets/route.ts');
const pages = load('lib/protected-page.ts');
const reply = async r => ({status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text(), headers: r.headers});
const post = (route, path, body, who) => route.POST(request(path, 'POST', body, who)).then(reply);
const get = (route, path, who) => route.GET(request(path, 'GET', null, who)).then(reply);
// Values made inside the test sandbox are compared by content.
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);
const row = (sql, ...a) => sqlite.prepare(sql).get(...a);
const at = s => new Date(s);
const totp = id => [{id, status: 'verified', factor_type: 'totp'}];
for (const [k, email] of [['dana', 'dana.coach@example.test'], ['lee', 'lee.coach@example.test']]) { users[k] = {id: k + '-uuid', email, email_confirmed_at: '2026-10-15', factors: totp(k + '-f')}; levels[k] = 'aal2'; }

// ---------- Pure rules ----------
{
  // Academy time, across daylight saving: 6 PM is 22:00 UTC in October and 23:00 UTC in November.
  assert.equal(T.academyInstant('2026-10-15', '18:00'), Date.parse('2026-10-15T22:00:00Z'));
  assert.equal(T.academyInstant('2026-11-02', '18:00'), Date.parse('2026-11-02T23:00:00Z'));
  assert.equal(T.academyInstant('2027-03-14', '12:00'), Date.parse('2027-03-14T16:00:00Z'), 'the day clocks go forward');
  assert.equal(T.academyClock('2026-11-03T00:40:00Z'), '19:40');
  // Q5: a month can be sent on or after its last day.
  assert.equal(T.lastDayOf('2028-02'), '2028-02-29'); assert.equal(T.lastDayOf('2026-11'), '2026-11-30');
  assert.equal(T.canSubmitMonth('2026-11', '2026-11-29'), false); assert.equal(T.canSubmitMonth('2026-11', '2026-11-30'), true); assert.equal(T.canSubmitMonth('2026-11', '2026-12-04'), true);
  assert.equal(T.handDateAllowed('2026-10-01', '2026-11-07'), true); assert.equal(T.handDateAllowed('2026-09-30', '2026-11-07'), false); assert.equal(T.handDateAllowed('2026-11-08', '2026-11-07'), false);
  // Q1: one place for the rates.
  deq({...T.PRACTICE_RATES}, {head: 4000, assistant: 3000});

  const base = {id: 'x', user_id: 'u', coach_email: 'c@x', coach_name: 'C', work_date: '2026-11-02', session_key: 'practice:Intermediate:2026-11-02:18:00', session_title: 'SWA Intermediate',
    session_start: '18:00', session_end: '19:30', duty: 'head', source: 'clock', clock_in: '2026-11-02T22:50:00.000Z', clock_out: '2026-11-03T00:40:00.000Z', fixed_in: null, fixed_out: null,
    coach_note: null, submitted_at: null, owner_minutes: null, owner_duty: null, owner_note: null, approved_at: null, approved_by: null, approved_minutes: null, approved_duty: null,
    approved_rate_cents: null, approved_cents: null, voided_at: null, voided_by: null, void_reason: null, history: '[]', revision: 1, created_at: 'x'};
  const e = o => ({...base, ...o});
  // Q4: 5:50 PM to 7:40 PM on a 6:00 to 7:30 practice pays the 90 practice minutes only, and flags nothing (within 15).
  assert.equal(T.scheduledMinutes(e()), 90); assert.equal(T.shiftAmount(e()), 6000); assert.equal(T.shiftAmount(e({duty: 'assistant'})), 4500);
  deq(T.shiftFlags(e()), []);
  // Late in and early out pay only the overlap, in whole minutes and whole cents.
  const late = e({clock_in: '2026-11-02T23:20:00.000Z', clock_out: '2026-11-03T00:30:00.000Z'});
  assert.equal(T.scheduledMinutes(late), 70); assert.equal(T.shiftAmount(late), 4667, '70 min at $40 is $46.67'); assert.equal(T.shiftAmount({...late, duty: 'assistant'}), 3500);
  assert.ok(Number.isInteger(T.amountCents(37, 4000)) && T.amountCents(37, 4000) === 2467);
  deq(T.shiftFlags(late), ['Clocked in 20 min after SWA Intermediate started.']);
  // Far outside the practice: flagged, never paid.
  const long = e({clock_in: '2026-11-02T22:30:00.000Z', clock_out: '2026-11-03T01:10:00.000Z'});
  assert.equal(T.scheduledMinutes(long), 90, 'early and late time is not paid');
  deq(T.shiftFlags(long), ['Clocked in 30 min before SWA Intermediate started.', 'Clocked out 40 min after SWA Intermediate ended.', 'Clocked 2 h 40 min, 1 h 10 min longer than the practice. Only the practice time is paid.']);
  // Exactly 15 minutes either side is not flagged.
  deq(T.shiftFlags(e({clock_in: '2026-11-02T22:45:00.000Z', clock_out: '2026-11-03T00:45:00.000Z'})), []);
  deq(T.shiftFlags(e({clock_in: '2026-11-02T22:45:00.000Z', clock_out: '2026-11-03T00:46:00.000Z'})), ['Clocked out 16 min after SWA Intermediate ended.', 'Clocked 2 h 1 min, 31 min longer than the practice. Only the practice time is paid.']);
  // No practice pays nothing until the owner sets it; the owner's minutes and role replace the computed ones.
  const none = e({session_key: null, session_title: null, session_start: null, session_end: null});
  assert.equal(T.paidMinutes(none), 0); assert.match(T.shiftFlags(none)[0], /No scheduled practice/);
  assert.equal(T.shiftAmount({...none, owner_minutes: 45, owner_duty: 'assistant'}), 2250);
  // Open, hand-added, coach-fixed, back-to-back and time-off flags. Void pays nothing.
  assert.match(T.shiftFlags(e({clock_out: null}))[0], /Still clocked in/); assert.equal(T.paidMinutes(e({clock_out: null})), 0);
  assert.match(T.shiftFlags(e({source: 'hand', coach_note: 'Phone died'}))[0], /Added by hand, not clocked: Phone died/);
  const fixed = e({fixed_in: '2026-11-02T23:00:00.000Z', fixed_out: '2026-11-03T00:00:00.000Z', coach_note: 'Left early, sick'});
  assert.equal(T.scheduledMinutes(fixed), 60); assert.match(T.shiftFlags(fixed)[0], /Times changed by the coach \(clocked 5:50 PM–7:40 PM\): Left early, sick/);
  const elementary = e({session_key: 'practice:Elementary:2026-11-02:17:00', session_title: 'SWA Development', session_start: '17:00', session_end: '18:00', clock_in: '2026-11-02T21:55:00.000Z', clock_out: '2026-11-03T00:30:00.000Z'});
  const sessions = [{key: 'practice:Intermediate:2026-11-02:18:00', type: 'practice', title: 'SWA Intermediate', program: 'Intermediate', date: '2026-11-02', start: '18:00', end: '19:30'}];
  assert.ok(T.shiftFlags(elementary, {sessions}).some(f => /^Ran into SWA Intermediate at 6:00 PM\. Only SWA Development is paid/.test(f)), 'back to back');
  assert.equal(T.scheduledMinutes(elementary), 60);
  assert.ok(T.shiftFlags(e(), {timeOff: [{start_date: '2026-11-01', end_date: '2026-11-03'}]}).includes('This day is in the coach’s approved time off.'));
  assert.equal(T.shiftAmount(e({voided_at: 'x'})), 0); deq(T.shiftFlags(e({voided_at: 'x'})), []);
  // Approval freezes the amount: a later change to the computed time does not move an approved shift.
  assert.equal(T.shiftAmount(e({approved_at: 'x', approved_minutes: 80, approved_cents: 5333, approved_rate_cents: 4000, clock_out: '2026-11-03T00:00:00.000Z'})), 5333);
}

// ---------- Setup: a schedule with back-to-back practices every day, and three coaches ----------
const every = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const state = {programs: [{id: 'Elementary', name: 'SWA Development'}, {id: 'Intermediate', name: 'SWA Intermediate'}, {id: 'Advanced', name: 'SWA Advance'}],
  seasons: [['Elementary', '17:00', '18:00'], ['Intermediate', '18:00', '19:30'], ['Advanced', '19:30', '21:00']].map(([program, start, end]) => ({program, start: '2026-01-01', end: '2028-12-31', weekly: every.map(day => ({day, start, end})), excludedDates: []})),
  extraPractices: [{id: 'fnl', name: 'Friday Night Live', dates: ['2026-11-06'], enabled: true, start: '16:00', end: '17:00', memberCents: 1000, nonMemberCents: 2000}]};
sqlite.prepare("INSERT OR REPLACE INTO academy_state(id,payload,revision,updated_by,updated_at) VALUES ('academy',?,1,'owner','x')").run(JSON.stringify(state));
for (const [email, name, programs] of [['dana.coach@example.test', 'Coach Dana', ['Intermediate']], ['lee.coach@example.test', 'Coach Lee', ['Elementary', 'Intermediate']]])
  assert.equal((await post(staff, '/api/staff', {action: 'grant', email, name, programs}, 'owner')).status, 200);
const dana = {email: 'dana.coach@example.test', name: 'Coach Dana', programs: ['Intermediate']};

// ---------- Owner only ----------
{
  for (const who of ['', 'alice', 'dana']) {
    assert.equal((await get(owner, '/api/timesheets', who)).status, 403, 'review is owner only: ' + who);
    assert.equal((await get(owner, '/api/timesheets?format=csv&month=2026-11', who)).status, 403, 'file is owner only: ' + who);
    assert.equal((await post(owner, '/api/timesheets', {action: 'approve', coach: 'dana.coach@example.test', month: '2026-11', shifts: []}, who)).status, 403);
  }
  assert.equal((await get(api, '/api/coach-time', 'alice')).status, 403, 'families have no timesheet');
  assert.equal((await get(owner, '/api/timesheets', 'owner')).status, 200);
  const page = await pages.ownerPage(request('/timesheets', 'GET', null, 'dana'), '<p>x</p>');
  assert.equal(page.status, 303, 'a coach is sent away from the owner page');
  assert.equal((await api.POST(request('/api/coach-time', 'POST', {action: 'clock-in', duty: 'head'}, 'dana', 'https://evil.test'))).status, 403, 'same origin only');
  assert.equal((await owner.POST(request('/api/timesheets', 'POST', {action: 'void'}, 'owner', 'https://evil.test'))).status, 403, 'same origin only');
}

// ---------- Clocking in and out today, through the routes ----------
{
  let r = await get(api, '/api/coach-time', 'dana');
  assert.equal(r.status, 200);
  const today = r.body.today;
  deq(r.body.choices.map(c => c.key).filter(k => !k.startsWith('live:')), [`practice:Intermediate:${today}:18:00`], 'only the coach’s own programs (plus any extra practice that day)');
  assert.equal(r.body.lastDuty, null); assert.equal(r.body.open, null); deq(r.body.rates.map(x => x.centsPerHour), [4000, 3000]);
  assert.equal((await post(api, '/api/coach-time', {action: 'clock-in', duty: 'boss'}, 'dana')).status, 400);
  assert.equal((await post(api, '/api/coach-time', {action: 'clock-in', duty: 'head', session: `practice:Advanced:${today}:19:30`}, 'dana')).status, 409, 'not another program’s practice');
  r = await post(api, '/api/coach-time', {action: 'clock-in', duty: 'head', session: `practice:Intermediate:${today}:18:00`}, 'dana');
  assert.equal(r.status, 200);
  assert.equal((await post(api, '/api/coach-time', {action: 'clock-in', duty: 'head'}, 'dana')).status, 409, 'one open shift at a time');
  r = await get(api, '/api/coach-time', 'dana');
  assert.equal(r.body.open.session.title, 'SWA Intermediate'); assert.equal(r.body.lastDuty, 'head'); assert.equal(r.body.canSubmit, false);
  await new Promise(res => setTimeout(res, 5));
  assert.equal((await post(api, '/api/coach-time', {action: 'clock-out', id: r.body.open.id}, 'lee')).status, 409, 'not someone else’s shift');
  assert.equal((await post(api, '/api/coach-time', {action: 'clock-out', id: r.body.open.id}, 'dana')).status, 200);
  assert.equal((await get(api, '/api/coach-time', 'dana')).body.open, null);
  // Removing that test punch: it stays on record, void.
  const shift = (await get(api, '/api/coach-time', 'dana')).body.shifts[0];
  assert.equal((await post(api, '/api/coach-time', {action: 'remove', id: shift.id, revision: shift.revision, reason: 'Test punch'}, 'dana')).status, 200);
  assert.equal(row('SELECT void_reason FROM coach_time_entries WHERE id=?', shift.id).void_reason, 'Test punch');
  assert.equal(row("SELECT count(*) AS n FROM security_events WHERE action IN ('coach_clock_in','coach_clock_out','coach_shift_removed')").n, 3);
}

// ---------- A November, with set times ----------
let ids = {};
{
  const ok = r => { assert.equal(r.status, 200, r.error); return r; };
  ids.mon = ok(await S.clockIn(dana, 'dana-uuid', {duty: 'head', session: 'practice:Intermediate:2026-11-02:18:00'}, at('2026-11-02T22:50:00Z'))).id;
  ok(await S.clockOut(dana, 'dana-uuid', {id: ids.mon}, at('2026-11-03T00:40:00Z')));
  ids.tue = ok(await S.clockIn(dana, 'dana-uuid', {duty: 'assistant', session: 'practice:Intermediate:2026-11-03:18:00'}, at('2026-11-03T22:30:00Z'))).id;
  ok(await S.clockOut(dana, 'dana-uuid', {id: ids.tue}, at('2026-11-04T00:30:00Z')));
  // Friday Night Live is an extra practice any coach can clock in for.
  ids.fri = ok(await S.clockIn(dana, 'dana-uuid', {duty: 'head', session: 'live:fnl:2026-11-06'}, at('2026-11-06T20:55:00Z'))).id;
  ok(await S.clockOut(dana, 'dana-uuid', {id: ids.fri}, at('2026-11-06T22:00:00Z')));
  // Forgot to clock in: added by hand, with a reason, not in the future, not overlapping.
  const hand = {date: '2026-11-04', session: null, duty: 'head', in: '10:00', out: '12:00', reason: 'Camp setup, phone died'};
  assert.equal((await S.addShift(dana, 'dana-uuid', {...hand, reason: ''}, at('2026-11-07T15:00:00Z'))).status, 400);
  assert.equal((await S.addShift(dana, 'dana-uuid', {...hand, date: '2026-09-30'}, at('2026-11-07T15:00:00Z'))).status, 400, 'only this month and last');
  assert.equal((await S.addShift(dana, 'dana-uuid', {...hand, date: '2026-11-07', in: '11:00', out: '23:00'}, at('2026-11-07T15:00:00Z'))).status, 400, 'not in the future');
  assert.equal((await S.addShift(dana, 'dana-uuid', {...hand, session: 'practice:Elementary:2026-11-04:17:00'}, at('2026-11-07T15:00:00Z'))).status, 409, 'not another program');
  ids.hand = ok(await S.addShift(dana, 'dana-uuid', hand, at('2026-11-07T15:00:00Z'))).id;
  assert.equal((await S.addShift(dana, 'dana-uuid', {...hand, in: '11:00', out: '13:00'}, at('2026-11-07T15:00:00Z'))).status, 409, 'overlap refused');
  ids.dup = ok(await S.addShift(dana, 'dana-uuid', {...hand, in: '14:00', out: '15:00', reason: 'Entered twice by mistake'}, at('2026-11-07T15:00:00Z'))).id;

  // The coach fixes their own times, with a reason; the punches stay.
  let m = await S.coachMonth(dana, '2026-11', at('2026-11-20T15:00:00Z'));
  const mon = m.shifts.find(s => s.id === ids.mon);
  assert.equal(mon.paidMinutes, 90); assert.equal(mon.amountCents, 6000);
  assert.equal((await S.fixTimes(dana, 'dana-uuid', {id: ids.mon, revision: mon.revision, in: '18:00', out: '19:00', reason: ''}, at('2026-11-20T15:00:00Z'))).status, 400, 'reason required');
  assert.equal((await S.fixTimes(dana, 'dana-uuid', {id: ids.mon, revision: mon.revision + 5, in: '18:00', out: '19:00', reason: 'Left at seven'}, at('2026-11-20T15:00:00Z'))).status, 409, 'stale page');
  assert.equal((await S.fixTimes(dana, 'dana-uuid', {id: ids.mon, revision: mon.revision, in: '19:00', out: '18:00', reason: 'Left at seven'}, at('2026-11-20T15:00:00Z'))).status, 400);
  ok(await S.fixTimes(dana, 'dana-uuid', {id: ids.mon, revision: mon.revision, in: '18:00', out: '19:00', reason: 'Left at seven'}, at('2026-11-20T15:00:00Z')));
  const fixed = row('SELECT clock_in,clock_out,fixed_in,fixed_out,history FROM coach_time_entries WHERE id=?', ids.mon);
  assert.equal(fixed.clock_in, '2026-11-02T22:50:00.000Z', 'the original punch is kept'); assert.equal(fixed.fixed_out, '2026-11-03T00:00:00.000Z');
  assert.match(fixed.history, /"changed times","from":"17:50–19:40","to":"18:00–19:00","note":"Left at seven"/);
  m = await S.coachMonth(dana, '2026-11', at('2026-11-20T15:00:00Z'));
  const view = id => m.shifts.find(s => s.id === id);
  assert.equal(view(ids.mon).paidMinutes, 60); assert.equal(view(ids.mon).amountCents, 4000);
  assert.equal(view(ids.tue).paidMinutes, 90); assert.equal(view(ids.tue).amountCents, 4500, 'assistant rate');
  assert.ok(view(ids.tue).flags.some(f => /30 min before/.test(f)), 'early punch flagged');
  assert.equal(view(ids.fri).paidMinutes, 60); assert.equal(view(ids.fri).session.title, 'Friday Night Live');
  assert.equal(view(ids.hand).paidMinutes, 0, 'no practice: not paid automatically'); assert.ok(view(ids.hand).flags.some(f => /Added by hand/.test(f)));
  assert.equal(m.totals.amountCents, 4000 + 4500 + 4000); assert.equal(m.canSubmit, false, 'not before the last day');
  assert.ok(m.totals.breakdown.some(b => b.label === 'SWA Intermediate' && b.duty === 'Assistant coach' && b.minutes === 90));

  // Q5: send the whole month on or after its last day, in academy time.
  assert.equal((await S.submitMonth(dana, 'dana-uuid', {month: '2026-11'}, at('2026-11-29T15:00:00Z'))).status, 409);
  const early = await S.submitMonth(dana, 'dana-uuid', {month: '2026-11'}, at('2026-11-30T04:30:00Z'));
  assert.equal(early.status, 409, '11:30 PM on Nov 29 in New York is still too early'); assert.match(early.error, /from Nov 30, 2026/);
  // An open shift blocks sending.
  ids.open = ok(await S.clockIn(dana, 'dana-uuid', {duty: 'head', session: 'practice:Intermediate:2026-11-30:18:00'}, at('2026-11-30T22:55:00Z'))).id;
  assert.match((await S.submitMonth(dana, 'dana-uuid', {month: '2026-11'}, at('2026-11-30T23:00:00Z'))).error, /Clock out first/);
  ok(await S.clockOut(dana, 'dana-uuid', {id: ids.open}, at('2026-12-01T00:30:00Z')));
  const sent = ok(await S.submitMonth(dana, 'dana-uuid', {month: '2026-11'}, at('2026-12-01T00:31:00Z')));
  assert.equal(sent.sent, 6, 'the removed test punch is not sent');
  assert.equal((await S.submitMonth(dana, 'dana-uuid', {month: '2026-11'}, at('2026-12-01T00:32:00Z'))).status, 409, 'nothing new to send');
  m = await S.coachMonth(dana, '2026-11', at('2026-12-01T12:00:00Z'));
  assert.equal(m.state, 'submitted');
  assert.match((await S.fixTimes(dana, 'dana-uuid', {id: ids.mon, revision: view(ids.mon).revision + 1, in: '18:00', out: '19:30', reason: 'x y z'}, at('2026-12-01T12:00:00Z'))).error, /already sent/);
}

// ---------- The owner's review: corrections with a reason, voiding, approval ----------
{
  // A paid lesson with Dana in November, so the file carries her lesson share (65% default, #197 Q2).
  sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source)
    VALUES ('L-1','alice-uuid','alice@example.test','w','Sam','lesson','op-1','Lesson','["2026-11-12"]',10000,0,10000,'usd',?,'{}','paid','k-l1',0,'t','t','t','stripe')`)
    .run(JSON.stringify({coachEmail: 'dana.coach@example.test', coachName: 'Coach Dana', formatName: 'One-on-one lesson', start: '16:00'}));
  let r = await get(owner, '/api/timesheets?month=2026-11', 'owner');
  assert.equal(r.status, 200);
  let c = r.body.coaches.find(x => x.email === 'dana.coach@example.test');
  assert.equal(c.state, 'submitted'); assert.equal(c.lessons.owedCents, 6500); assert.ok(c.totals.flagged >= 2);
  assert.ok(r.body.coaches.every(x => x.email !== 'lee.coach@example.test'), 'a coach with nothing this month is not listed');
  const s = id => c.shifts.find(x => x.id === id);
  // Correction: hours and minutes, role, and a reason; audited with before and after.
  const fix = {action: 'correct', id: ids.hand, revision: s(ids.hand).revision, hours: 1, minutes: 45, duty: 'assistant'};
  assert.equal((await post(owner, '/api/timesheets', {...fix, reason: ''}, 'owner')).status, 400, 'reason required');
  assert.equal((await post(owner, '/api/timesheets', {...fix, minutes: 60, reason: 'Camp setup'}, 'owner')).status, 400, 'minutes 0 to 59');
  assert.equal((await post(owner, '/api/timesheets', {...fix, reason: 'Camp setup'}, 'dana')).status, 403, 'coaches cannot correct');
  assert.equal((await post(owner, '/api/timesheets', {...fix, reason: 'Camp setup, agreed'}, 'owner')).status, 200);
  const ev = row("SELECT actor,target FROM security_events WHERE action='coach_shift_corrected'");
  assert.equal(ev.actor, 'owner-uuid'); assert.equal(ev.target, `${ids.hand} 0min head->105min assistant`);
  assert.match(row('SELECT history FROM coach_time_entries WHERE id=?', ids.hand).history, /"by":"owner","action":"corrected","from":"0 min Head coach","to":"1 h 45 min Assistant coach","note":"Camp setup, agreed"/);
  assert.equal((await post(owner, '/api/timesheets', {...fix, reason: 'Again'}, 'owner')).status, 409, 'stale revision refused');
  // Void a mistaken shift.
  r = await get(owner, '/api/timesheets?month=2026-11&coach=dana.coach@example.test', 'owner'); c = r.body.coaches[0];
  assert.equal((await post(owner, '/api/timesheets', {action: 'void', id: ids.dup, revision: s(ids.dup).revision, reason: ''}, 'owner')).status, 400);
  assert.equal((await post(owner, '/api/timesheets', {action: 'void', id: ids.dup, revision: s(ids.dup).revision, reason: 'Entered twice'}, 'owner')).status, 200);
  assert.equal(row("SELECT count(*) AS n FROM security_events WHERE action='coach_shift_voided'").n, 1);
  // Approve exactly what was reviewed.
  r = await get(owner, '/api/timesheets?month=2026-11&coach=dana.coach@example.test', 'owner'); c = r.body.coaches[0];
  const sentShifts = c.shifts.filter(x => x.status === 'submitted').map(x => ({id: x.id, revision: x.revision}));
  assert.equal(sentShifts.length, 5);
  assert.equal((await post(owner, '/api/timesheets', {action: 'approve', coach: c.email, month: '2026-11', shifts: sentShifts.slice(1)}, 'owner')).status, 409, 'every sent shift, or none');
  assert.equal((await post(owner, '/api/timesheets', {action: 'approve', coach: c.email, month: '2026-11', shifts: sentShifts.map(x => ({...x, revision: x.revision + 1}))}, 'owner')).status, 409, 'stale');
  r = await post(owner, '/api/timesheets', {action: 'approve', coach: c.email, month: '2026-11', shifts: sentShifts}, 'owner');
  assert.equal(r.status, 200); assert.equal(r.body.approved, 5);
  // 60 min head (4000) + 90 min assistant (4500) + 60 min head FNL (4000) + 105 min assistant (5250) + Nov 30 90 min head (6000).
  assert.equal(r.body.cents, 4000 + 4500 + 4000 + 5250 + 6000);
  const frozen = sqlite.prepare("SELECT approved_minutes,approved_duty,approved_rate_cents,approved_cents FROM coach_time_entries WHERE approved_at IS NOT NULL ORDER BY work_date,clock_in").all();
  assert.ok(frozen.every(f => Number.isInteger(f.approved_cents) && Number.isInteger(f.approved_rate_cents)), 'integer cents');
  deq(frozen.map(f => f.approved_cents), [4000, 4500, 5250, 4000, 6000]);
  assert.equal((await post(owner, '/api/timesheets', {action: 'correct', id: ids.mon, revision: 99, hours: 1, minutes: 0, duty: 'head', reason: 'x y z'}, 'owner')).status, 409);
  const approvedMon = row('SELECT revision FROM coach_time_entries WHERE id=?', ids.mon).revision;
  assert.match((await post(owner, '/api/timesheets', {action: 'correct', id: ids.mon, revision: approvedMon, hours: 1, minutes: 0, duty: 'head', reason: 'x y z'}, 'owner')).body.error, /Undo the month/);
  assert.match((await post(owner, '/api/timesheets', {action: 'void', id: ids.mon, revision: approvedMon, reason: 'x y z'}, 'owner')).body.error, /Undo the month/);
  // After approval the coach cannot add to that month by hand.
  assert.equal((await S.addShift(dana, 'dana-uuid', {date: '2026-11-25', session: null, duty: 'head', in: '10:00', out: '11:00', reason: 'Forgot'}, at('2026-12-02T15:00:00Z'))).status, 409);

  // The month's file: approved practice lines at the role's rate, the lesson share, a total. Neutral wording (Q6).
  const csv = await get(owner, '/api/timesheets?format=csv&month=2026-11', 'owner');
  assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/); assert.match(csv.headers.get('content-disposition'), /savage-coach-hours-2026-11\.csv/);
  const lines = csv.body.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Coach,Coach email,Month,Line,Date,Program or lesson,Role,Hours,Rate,Amount,Note');
  assert.equal(lines.filter(l => l.includes(',Practice,')).length, 5);
  assert.ok(lines.includes('Coach Dana,dana.coach@example.test,2026-11,Practice,2026-11-04,No scheduled practice,Assistant coach,1.75,30.00 per hour,52.50,"Camp setup, agreed"'));
  assert.ok(lines.includes('Coach Dana,dana.coach@example.test,2026-11,Private lessons,,"1 lesson, 100.00 kept from families",,,65% share,65.00,From the coach pay report'));
  assert.ok(lines.includes('Coach Dana,dana.coach@example.test,2026-11,Total,,,,6.75,,302.50,'), 'practice 237.50 plus lessons 65.00');
  assert.doesNotMatch(csv.body, /wage|salary|invoice|overtime|withhold|gross|payroll tax|employee|contractor/i, 'no employment wording');

  // Undo approval needs a reason, and puts the month back for review.
  assert.equal((await post(owner, '/api/timesheets', {action: 'unapprove', coach: c.email, month: '2026-11', reason: ''}, 'owner')).status, 400);
  r = await post(owner, '/api/timesheets', {action: 'unapprove', coach: c.email, month: '2026-11', reason: 'Wrong role on the 30th'}, 'owner');
  assert.equal(r.status, 200); assert.equal(r.body.reopened, 5);
  assert.equal(row("SELECT count(*) AS n FROM coach_time_entries WHERE approved_at IS NOT NULL").n, 0);
  const again = await get(owner, '/api/timesheets?format=csv&month=2026-11', 'owner');
  assert.match(again.body, /Total,,,,0\.00,,65\.00,5 practice shifts are not approved yet and not included/);
}

// ---------- Page scripts (inline JavaScript is not typechecked) ----------
const settle = () => new Promise(r => setImmediate(r));
function page(file, fetch, extra = {}) {
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, disabled: false, innerHTML: '', textContent: '', dataset: {}, style: {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => []}); return nodes.get(id); };
  const ctx = vm.createContext({document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, readyState: 'complete', head: {appendChild() {}}, createElement: () => ({})},
    location: {search: '', hash: ''}, fetch, confirm: () => true, URLSearchParams, Date, JSON, Promise, Error, Object, Array, Number, String, Set, Map, Math, console, window: {}, FormData: class {}, ...extra});
  // The page's shared scripts (public/*.js) run first, in page order, as in the browser.
  for (const [, src, code] of readFileSync(file, 'utf8').matchAll(/<script(?: src="\/([\w-]+\.js)")?>([\s\S]*?)<\/script>/g)) vm.runInContext(src ? readFileSync('public/' + src, 'utf8') : code, ctx);
  return {el, ctx};
}
const okJson = body => ({ok: true, status: 200, json: async () => body});
{
  // The clock card on coach home and the hours page.
  const home = readFileSync('app/coach/screen.html', 'utf8');
  assert.match(home, /<section id="clockCard" data-coach-clock aria-labelledby="clockCardTitle">/); assert.match(home, /<script src="\/coach-clock\.js"><\/script>/); assert.match(home, /href="\/coach-time"/);
  const ctx = vm.createContext({window: {}, document: {readyState: 'complete', querySelectorAll: () => [], getElementById: () => null}, Date, JSON, Math, Number, String, Array, Object, Error, Promise, Event: class {}});
  vm.runInContext(readFileSync('public/hours-text.js', 'utf8'), ctx); vm.runInContext(readFileSync('public/coach-clock.js', 'utf8'), ctx);
  const C = ctx.window.CoachClock;
  const closed = {monthLabel: 'November 2026', totals: {shifts: 2, minutes: 150}, open: null, suggested: 'practice:Intermediate:2026-11-02:18:00',
    choices: [{key: 'live:fnl:2026-11-02', title: 'Friday <Night> Live', start: '16:00', end: '17:00'}, {key: 'practice:Intermediate:2026-11-02:18:00', title: 'SWA Intermediate', start: '18:00', end: '19:30'}]};
  let h = C.html(closed, null);
  assert.ok(h.indexOf('SWA Intermediate') < h.indexOf('Friday'), 'the practice running now or next comes first');
  assert.match(h, /class="cc-big primary" data-cc="in" data-session="practice:Intermediate:2026-11-02:18:00">Clock in<small>SWA Intermediate · 6:00 PM–7:30 PM/);
  assert.match(h, /Friday &lt;Night&gt; Live/, 'escaped'); assert.match(h, /aria-pressed="false">Head coach/); assert.match(h, /Clock in without a practice/);
  assert.match(h, /November 2026: 2 shifts, 2 h 30 min paid so far/); assert.match(h, /href="\/coach-time"/);
  assert.match(C.html(closed, 'assistant'), /data-duty="assistant" aria-pressed="true"/);
  assert.match(C.html({...closed, choices: []}, 'head'), /Nothing is on the schedule for your programs today/);
  assert.doesNotMatch(C.html(closed, null, {link: false}), /href="\/coach-time"/);
  const open = {...closed, open: {id: 's1', clockIn: '2026-11-02T22:50:00Z', inTime: '17:50', dutyLabel: 'Head coach', session: {title: 'SWA Intermediate', start: '18:00', end: '19:30'}}};
  h = C.html(open, 'head', {now: Date.parse('2026-11-02T23:52:00Z')});
  assert.match(h, /<h2 id="clockTitle">On the clock<\/h2>/); assert.match(h, /Since 5:50 PM/); assert.match(h, /SWA Intermediate · 6:00 PM–7:30 PM · Head coach · 1 h 2 min so far/);
  assert.match(h, /data-cc="out" data-id="s1">Clock out/); assert.match(h, /Pay covers the scheduled practice time \(6:00 PM–7:30 PM\)/);
  assert.equal(C.action('in', {dataset: {session: 'k'}}, null).error, 'Choose Head coach or Assistant coach first.');
  deq(C.action('in', {dataset: {session: ''}}, 'head').body, {action: 'clock-in', duty: 'head', session: null});
  deq(C.action('out', {dataset: {id: 's1'}}, null).body, {action: 'clock-out', id: 's1'});
}
{
  // The coach's hours page renders the month from the real reply shape.
  const reply = await S.coachMonth(dana, '2026-11', at('2026-12-01T12:00:00Z'));
  const data = {...reply, name: 'Coach Dana', owner: false, timeOffRequests: [{id: 'o1', revision: 1, text: 'Dec 10, 2026 to Dec 12, 2026', status: 'pending', reason: 'Wedding <3', decisionNote: null}], notices: [{subject: 'Coach Lee is away', body: 'b', at: '2026-11-03T12:00:00Z'}]};
  const {el, ctx} = page('app/coach-time/screen.html', async () => okJson(data));
  await settle(); await settle();
  assert.equal(el('monthTitle').textContent, 'November 2026'); assert.equal(el('monthState').textContent, 'Sent to the academy. Waiting for approval.');
  assert.match(el('rates').textContent, /Head coach \$40\.00 an hour, Assistant coach \$30\.00 an hour/);
  assert.equal(el('submit').disabled, true); assert.equal(el('submitHelp').textContent, 'Nothing new to send.');
  assert.match(el('shifts').innerHTML, /Added by hand, not clocked/); assert.match(el('shifts').innerHTML, /Paid 1 h 45 min · \$52\.50 \(set by the academy: Camp setup, agreed\)/);
  assert.doesNotMatch(el('shifts').innerHTML, /data-fix=/, 'sent shifts cannot be changed by the coach');
  assert.match(el('offList').innerHTML, /Wedding &lt;3/); assert.match(el('offList').innerHTML, /data-withdraw="o1"/); assert.match(el('notices').innerHTML, /Coach Lee is away/);
  // Before the last day, the button explains when the month can be sent.
  ctx.d = {monthLabel: 'December 2026', canSubmit: false, submitOpensText: 'Dec 31, 2026', totals: {drafts: 2, open: 0, shifts: 2, submitted: 0}};
  assert.equal(vm.runInContext('submitHelp(d)', ctx), 'You can send December 2026 from Dec 31, 2026, its last day.');
  assert.equal(vm.runInContext('monthText(d)', ctx), '2 shifts not sent yet.');
  ctx.d.canSubmit = true; assert.match(vm.runInContext('submitHelp(d)', ctx), /^Sends every shift in December 2026/);
  ctx.s = {id: 'a"b', revision: 2, status: 'draft', date: '2026-12-01', session: null, dutyLabel: 'Head coach', inTime: '10:00', outTime: '11:00', paidMinutes: 0, amountCents: 0, flags: ['<b>x</b>']};
  const sh = vm.runInContext('shiftHtml(s)', ctx);
  assert.match(sh, /data-fix="a&quot;b" data-rev="2"/); assert.match(sh, /&lt;b&gt;x&lt;\/b&gt;/); assert.match(sh, /No scheduled practice · Head coach/);
}
{
  // The owner's page: approve sends exactly the sent shifts with their revisions; cover lists practices and lessons.
  const r = await get(owner, '/api/timesheets?month=2026-11', 'owner');
  const {el, ctx} = page('app/timesheets/screen.html', async () => okJson(r.body));
  await settle(); await settle();
  assert.equal(el('month').value, '2026-11'); assert.match(el('month').innerHTML, /<option value="2026-11" selected>November 2026<\/option>/); // the shared month picker (issue #232) assert.equal(el('csv').href, '/api/timesheets?format=csv&month=2026-11');
  assert.match(el('coaches').innerHTML, /data-approve="dana\.coach@example\.test">Approve Coach Dana’s November 2026 \(\$237\.50\)/);
  assert.match(el('coaches').innerHTML, /Private lessons: 1, share \$65\.00 at 65%/);
  assert.match(el('coaches').innerHTML, /data-correct=/); assert.match(el('coaches').innerHTML, /Void: Entered twice/);
  ctx.c = r.body.coaches[0];
  const body = vm.runInContext('approveBody(c,"2026-11")', ctx);
  assert.equal(body.action, 'approve'); assert.equal(body.shifts.length, 5); assert.ok(body.shifts.every(x => typeof x.revision === 'number'));
  ctx.cv = {practices: [{date: '2026-12-10', time: '6:00 PM–7:30 PM', title: 'SWA Intermediate'}], lessons: [{date: '2026-12-11', time: '4:00 PM–5:00 PM', booked: 1}, {date: '2026-12-12', time: '4:00 PM–5:00 PM', booked: 0}]};
  const cover = vm.runInContext('coverHtml(cv)', ctx);
  assert.match(cover, /Thu, Dec 10 · 6:00 PM–7:30 PM · SWA Intermediate practice/); assert.match(cover, /private lesson · 1 wrestler booked/); assert.match(cover, /\(open time\)/);
  assert.match(vm.runInContext('coverHtml({practices:[],lessons:[]})', ctx), /No practices or lessons/);
  ctx.s = {...ctx.c.shifts[0], status: 'approved'};
  assert.doesNotMatch(vm.runInContext('shiftHtml(s)', ctx), /data-correct|data-void/, 'approved shifts are changed only after undoing approval');
}
console.log('Coach timesheet tests passed: academy time across daylight saving, $40/$30 rates in one place, pay for scheduled practice time only in whole cents, flags (early, late, long, back to back, by hand, changed, open, time off), month sent only on or after its last day in New York time, coach fixes and removals with reasons, owner corrections audited before and after, voiding, approval of exactly the reviewed shifts with amounts frozen, undo with a reason, the month file with lesson shares and neutral wording, owner-only access, and the clock card and page scripts.');
