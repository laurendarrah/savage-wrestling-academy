// Hours and minutes for every duration on the coach pages (issue #223): "3 h 44 min", "2 h", "45 min", never "224 min".
// Loaded before each page's own script (coach home, /coach-time, /timesheets) and by the clock card (coach-clock.js).
// The server's flags use the same rule, hoursText() in lib/coach-time.ts; tests/coach-polish.mjs checks they agree.
function hoursText(minutes) {
  const m = Math.max(0, Math.floor(Number(minutes) || 0)), h = Math.floor(m / 60), r = m % 60;
  return h && r ? h + ' h ' + r + ' min' : h ? h + ' h' : r + ' min';
}
