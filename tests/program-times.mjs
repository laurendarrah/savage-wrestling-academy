// Issue #180: program cards on the welcome page say when each program practises, from the published practices.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html = readFileSync('app/welcome/screen.html', 'utf8');
const code = ['const clock', 'const DAY', 'function span', 'function weeklyTimes'].map(k => { const i = html.indexOf(k); return html.slice(i, html.indexOf('\n', i)); });
const body = html.slice(html.indexOf('function weeklyTimes'), html.indexOf('function programCard'));
const {weeklyTimes} = new Function(code[0] + ';' + code[1] + ';' + code[2] + ';' + body + ';return {weeklyTimes}')();
const pr = (program, date, start, end) => ({program, date, start, end});
const nov = {practices: [pr('Advanced', '2026-11-10', '19:30', '21:00'), pr('Advanced', '2026-11-12', '19:30', '21:00'), pr('Advanced', '2026-11-15', '10:00', '12:00'),
  pr('Elementary', '2026-11-09', '18:00', '19:30'), pr('Elementary', '2026-11-11', '18:00', '19:30'), pr('Elementary', '2026-11-13', '18:00', '19:30'), pr('Elementary', '2026-11-02', '17:00', '18:00')]};
assert.deepEqual(weeklyTimes('Advanced', [nov], '2026-11-06'), ['Tue & Thu · 7:30–9:00 PM', 'Sun · 10:00 AM–12:00 PM'], 'Monday-first order, AM and PM spelled out when they differ');
assert.deepEqual(weeklyTimes('Elementary', [nov], '2026-11-06'), ['Mon, Wed & Fri · 6:00–7:30 PM'], 'past practices are ignored');
assert.deepEqual(weeklyTimes('Intermediate', [nov], '2026-11-06'), [], 'no practices, no line');
console.log('program-times ok');
