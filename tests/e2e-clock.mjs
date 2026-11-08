// Issue #287: the browser walkthrough's clock. Today's practice always starts at least 40 minutes after the walkthrough
// starts and ends by 11:59 PM New York; when no such practice fits, the walkthrough waits for the new day instead of
// starting a run that would cross midnight.
import assert from 'node:assert/strict';
import {plan, nyMinutes, nyDay, clockTime, hhmm, MARGIN, FNL} from '../scripts/e2e/clock.mjs';

const at = (h, m = 0) => h * 60 + m;

// Daytime and early evening: the usual 6:00–7:30 PM practice.
assert.deepEqual(plan(at(0, 10)), {wait: 0, practice: {start: '18:00', end: '19:30', label: '6:00 PM–7:30 PM'}}, '12:10 AM');
assert.deepEqual(plan(at(10)), {wait: 0, practice: {start: '18:00', end: '19:30', label: '6:00 PM–7:30 PM'}}, '10 AM');
assert.deepEqual(plan(at(17, 20)).practice, {start: '18:00', end: '19:30', label: '6:00 PM–7:30 PM'}, '5:20 PM: 6 PM is still 40 minutes away');

// Later: the practice moves so that it still starts 40 minutes from now, and never runs past 11:59 PM.
assert.equal(MARGIN, 40);
assert.deepEqual(plan(at(17, 21)).practice, {start: '18:01', end: '19:31', label: '6:01 PM–7:31 PM'}, '5:21 PM');
assert.deepEqual(plan(at(21)).practice, {start: '21:40', end: '23:10', label: '9:40 PM–11:10 PM'}, '9 PM');
assert.deepEqual(plan(at(23)).practice, {start: '23:40', end: '23:59', label: '11:40 PM–11:59 PM'}, '11 PM: cut short at 11:59 PM');
assert.deepEqual(plan(at(23, 18)), {wait: 0, practice: {start: '23:58', end: '23:59', label: '11:58 PM–11:59 PM'}}, '11:18 PM: the last practice that fits');
for (const [h, m] of [[17, 21], [21, 0], [23, 0], [23, 18]]) {
  const p = plan(at(h, m)).practice;
  assert.ok(p.start < p.end && p.end <= '23:59', `${h}:${m} keeps start < end <= 23:59`);
  assert.ok(+p.start.slice(0, 2) * 60 + +p.start.slice(3) >= at(h, m) + MARGIN, `${h}:${m} starts at least ${MARGIN} minutes later`);
}

// The last 42 minutes of the day: nothing fits, so wait for the new day (and a minute into it).
assert.deepEqual(plan(at(23, 19)), {wait: 42, practice: null}, '11:19 PM waits 42 minutes');
assert.deepEqual(plan(at(23, 45)), {wait: 16, practice: null}, '11:45 PM waits 16 minutes');
assert.deepEqual(plan(at(23, 59)), {wait: 2, practice: null}, '11:59 PM waits 2 minutes');
for (let m = 0; m < 1440; m++) {
  const p = plan(m);
  if (p.wait) assert.ok(m + p.wait >= 1440 && m + p.wait <= 1441, `${hhmm(m)}: the wait ends in the first minute of the new day`);
  else assert.ok(p.practice.start < p.practice.end, `${hhmm(m)}: a real practice`);
}

// New York time from an instant: on Nov 7, 2026 (standard time) 04:30Z is 11:30 PM the day before.
const late = new Date('2026-11-08T04:30:00Z');
assert.equal(nyMinutes(late), at(23, 30)); assert.equal(nyDay(late), '2026-11-07'); assert.equal(nyDay(late, 2), '2026-11-09');
const summer = new Date('2026-07-01T03:10:00Z');
assert.equal(nyMinutes(summer), at(23, 10), 'daylight time'); assert.equal(nyDay(summer), '2026-06-30');
assert.equal(clockTime('00:05'), '12:05 AM'); assert.equal(clockTime('12:00'), '12:00 PM'); assert.equal(clockTime('23:59'), '11:59 PM');
assert.equal(hhmm(at(9, 5)), '09:05');

// Friday Night Live keeps a fixed time; its label is what the clock card shows.
assert.deepEqual(FNL, {start: '16:00', end: '17:00', label: '4:00 PM–5:00 PM'});
assert.equal(`${clockTime(FNL.start)}–${clockTime(FNL.end)}`, FNL.label);

console.log('e2e-clock: ok');
