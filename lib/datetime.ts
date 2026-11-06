// How dates and times read everywhere a person sees them (issue #127). Academy time is New York time.
//   weekday, date and time: "Mon, Nov 9 · 3:00 PM"
//   date alone:             "Nov 9, 2026"  (or "Mon, Nov 9" where the year is obvious)
//   time alone:             "3:00 PM"
// Calendar dates are "YYYY-MM-DD" strings and clock times "HH:MM" strings, both already in academy time.
// Instants are ISO timestamps or Date objects and are converted to New York time.

export const ACADEMY_TIME_ZONE = 'America/New_York';

// Some ICU versions put a narrow no-break space before AM/PM; families should always see a plain space.
const plain = (s: string) => s.replace(/[  ]/g, ' ');
const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', options);
const noon = (ymd: string) => new Date(ymd + 'T12:00:00Z');
const isDay = (ymd: unknown): ymd is string => typeof ymd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ymd) && !Number.isNaN(noon(ymd).getTime());
const toDate = (at: string | number | Date) => at instanceof Date ? at : new Date(at);

// "15:00" -> "3:00 PM". Anything that is not a clock time comes back unchanged.
export function clockTime(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? ''));
  if (!m) return String(hhmm ?? '');
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

// "15:00", "16:00" -> "3:00 PM–4:00 PM".
export function clockRange(start: string | null | undefined, end: string | null | undefined): string {
  return end ? `${clockTime(start)}–${clockTime(end)}` : clockTime(start);
}

// "2026-11-09" -> "Mon, Nov 9".
export function dayDate(ymd: string): string {
  return isDay(ymd) ? fmt({timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric'}).format(noon(ymd)) : String(ymd ?? '');
}

// "2026-11-09" -> "Nov 9, 2026".
export function fullDate(ymd: string): string {
  return isDay(ymd) ? fmt({timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'}).format(noon(ymd)) : String(ymd ?? '');
}

// "2026-11-09", "15:00" -> "Mon, Nov 9 · 3:00 PM".
export function dayTime(ymd: string, hhmm?: string | null): string {
  return hhmm ? `${dayDate(ymd)} · ${clockTime(hhmm)}` : dayDate(ymd);
}

// The academy's calendar date for an instant, as "YYYY-MM-DD".
export function academyDay(at: string | number | Date): string {
  return new Intl.DateTimeFormat('en-CA', {timeZone: ACADEMY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'}).format(toDate(at));
}

// An instant -> "Mon, Nov 9 · 3:00 PM" in New York time. The year is added when it is not the current year.
export function when(at: string | number | Date, now: Date = new Date()): string {
  const d = toDate(at);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = academyDay(d).slice(0, 4) === academyDay(now).slice(0, 4);
  const day = fmt({timeZone: ACADEMY_TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : {year: 'numeric'})}).format(d);
  const time = fmt({timeZone: ACADEMY_TIME_ZONE, hour: 'numeric', minute: '2-digit'}).format(d);
  return plain(`${day} · ${time}`);
}

// An instant -> "Nov 9, 2026", the New York calendar date.
export function whenDate(at: string | number | Date): string {
  const d = toDate(at);
  return Number.isNaN(d.getTime()) ? '' : fullDate(academyDay(d));
}
