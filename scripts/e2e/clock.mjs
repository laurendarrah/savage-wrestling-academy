// The walkthrough's clock (issue #287). Everything journey.mjs does with the time of day is decided here, once, from
// the New York clock the site uses, so the walkthrough passes at any time of day. Pure functions, tested in
// tests/e2e-clock.mjs; journey.mjs calls plan() with the minutes since midnight and reads the answer.
//
// Today's practice starts at least MARGIN minutes after the walkthrough starts, so Register still offers it when the
// family books it to pay cash (#273: a practice is not offered once it has started), and it ends by 11:59 PM, so it is
// still today's practice when the coach takes the cash (coaches can open today's roster only). In the last 42 minutes
// of the New York day no such practice exists, and a run that started then would cross midnight and lose "today"
// halfway through anyway, so plan() asks the walkthrough to wait for the new day first.
//
// Friday Night Live keeps a fixed clock time: the site books an extra practice and takes its cash by date, not time, and
// the clock-in step names the practice it clocks into, so Friday Night Live's time never has to move.

export const MARGIN = 40;
const DEFAULT_START = 18 * 60, LENGTH = 90, LAST = 23 * 60 + 59;
export const FNL = {start: '16:00', end: '17:00', label: '4:00 PM–5:00 PM'};

export const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// "18:00" -> "6:00 PM", as the site writes clock times.
export const clockTime = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const NY = 'America/New_York';
// Minutes since midnight in New York, and the New York calendar date k days from now, both for an instant.
export const nyMinutes = (now = new Date()) => { const [h, m] = new Intl.DateTimeFormat('en-GB', {timeZone: NY, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(now).split(':').map(Number); return h * 60 + m; };
export const nyDay = (now = new Date(), k = 0) => new Date(now.getTime() + k * 864e5).toLocaleDateString('en-CA', {timeZone: NY});

// The day's plan from the minutes since midnight: today's practice (6:00–7:30 PM, or later in the evening so that it
// still starts MARGIN minutes from now), or how many minutes to wait for the new day when no such practice fits.
export function plan(minutes) {
  const start = Math.max(DEFAULT_START, minutes + MARGIN);
  if (start >= LAST) return {wait: 1440 - minutes + 1, practice: null};
  const end = Math.min(start + LENGTH, LAST);
  return {wait: 0, practice: {start: hhmm(start), end: hhmm(end), label: `${clockTime(hhmm(start))}–${clockTime(hhmm(end))}`}};
}
