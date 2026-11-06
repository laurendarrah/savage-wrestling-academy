// Issue #127: one way to write dates and times everywhere a person reads them, in New York time.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const module = {exports: {}};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/datetime.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
  {module, exports: module.exports, Intl, Date, Number, String, Object});
const {clockTime, clockRange, dayDate, fullDate, dayTime, academyDay, when, whenDate} = module.exports;

// Time alone: 12-hour clock with AM/PM.
assert.equal(clockTime('15:00'), '3:00 PM');
assert.equal(clockTime('09:05'), '9:05 AM');
assert.equal(clockTime('00:30'), '12:30 AM');
assert.equal(clockTime('12:00'), '12:00 PM');
assert.equal(clockTime(''), '');
assert.equal(clockTime(undefined), '');
assert.equal(clockRange('15:00', '16:00'), '3:00 PM–4:00 PM');

// Date alone and weekday with date and time.
assert.equal(dayDate('2026-11-09'), 'Mon, Nov 9');
assert.equal(fullDate('2026-11-09'), 'Nov 9, 2026');
assert.equal(fullDate('2027-05-25'), 'May 25, 2027');
assert.equal(dayTime('2026-11-09', '15:00'), 'Mon, Nov 9 · 3:00 PM');
assert.equal(dayTime('2026-11-09'), 'Mon, Nov 9');
assert.equal(fullDate('not a date'), 'not a date', 'unknown text passes through untouched');

// Instants are shown in New York time, whatever the server's zone. 2026-11-06T19:13:33Z is 2:13 PM in New York (EST).
const now = new Date('2026-11-06T20:00:00Z');
assert.equal(when('2026-11-06T19:13:33.049Z', now), 'Fri, Nov 6 · 2:13 PM');
assert.equal(when('2026-07-04T16:00:00Z', now), 'Sat, Jul 4 · 12:00 PM', 'daylight saving time is applied');
assert.equal(when('2025-12-31T23:30:00Z', now), 'Wed, Dec 31, 2025 · 6:30 PM', 'an earlier year is spelled out');
assert.equal(when('nonsense', now), '');
assert.ok(!/[  ]/.test(when('2026-11-06T19:13:33Z', now)), 'plain spaces only');
// Late evening in New York is still the same New York day, although UTC has moved on.
assert.equal(academyDay('2026-11-07T03:30:00Z'), '2026-11-06');
assert.equal(whenDate('2026-11-07T03:30:00Z'), 'Nov 6, 2026');

console.log('Date and time format tests passed');
