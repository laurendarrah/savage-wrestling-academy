// Semesters, practices, days off, months and holidays in the owner workspace (issue #45). Calendar dates are
// "YYYY-MM-DD" and months "YYYY-MM", in academy (New York) time. A practice comes from the latest saved semester for
// its program that covers the date, as on the server (registrationCatalog() in lib/registration-catalog.ts).
// Holidays are a label only (lib/holidays.ts): they never add or remove a practice.
import {academyDay, clockTime, fullDate} from '../datetime';
import {federalHolidays, holidaysInMonth} from '../holidays';
import type {Checked, FormList, FormValues, Season, WeeklySlot} from './types';

// "15:00" -> "3:00 PM"; "2026-11-09" -> "Nov 9, 2026" (lib/datetime.ts).
export {clockTime, fullDate, federalHolidays, holidaysInMonth};

// Practice days in the order the planner lists them.
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const SUNDAY_FIRST = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (key: unknown): key is string => typeof key === 'string' && MONTH.test(key);

// Today's date at the academy.
export function academyToday(now: Date = new Date()): string {
  return academyDay(now);
}

// A Date's own calendar date, in the time zone it was made in.
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function weekdayOf(date: string): string | undefined {
  return SUNDAY_FIRST[new Date(date + 'T12:00:00Z').getUTCDay()];
}

// "2026-12", 1 -> "2027-01".
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

// The days of a month and how many blank cells come before the first, with weeks starting on Monday (the owner
// calendar and the holiday planner) or Sunday (the additional-practice date picker).
export function monthGrid(key: string, weekStart: 'monday' | 'sunday' = 'monday'): {lead: number; dates: string[]} {
  const [y, m] = key.split('-').map(Number), first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {lead: weekStart === 'monday' ? (first + 6) % 7 : first, dates: Array.from({length: count}, (_, i) => key + '-' + String(i + 1).padStart(2, '0'))};
}

// U.S. federal holidays on a date, actual and observed.
export function holidayNamesOn(date: string): string[] {
  const year = Number(date.slice(0, 4));
  return [year - 1, year, year + 1].flatMap(federalHolidays).filter(h => h.date === date).map(h => h.name);
}

// The latest saved semester for this program that covers the date.
export function seasonOn(seasons: readonly Season[], program: string, date: string): Season | undefined {
  return [...seasons].reverse().find(s => s.program === program && date >= s.start && date <= s.end);
}

// The program's practice on a date, if its semester has one that weekday and the date isn't a day off.
export function practiceSlot(seasons: readonly Season[], program: string, date: string): {start: string; end: string; label: string} | null {
  const s = seasonOn(seasons, program, date);
  if (!s || (s.excludedDates || []).includes(date)) return null;
  const w = s.weekly.find(w => w.day === weekdayOf(date));
  return w ? {start: w.start, end: w.end, label: clockTime(w.start) + '–' + clockTime(w.end)} : null;
}

// One line per practice day: "Monday · 6:00 PM–7:30 PM". Very old semesters kept their times in words.
export function seasonTimeLines(season: Season): string[] {
  return Array.isArray(season.weekly)
    ? season.weekly.map(slot => `${slot.day ?? ''} · ${clockTime(slot.start)}–${clockTime(slot.end)}`)
    : [`${season.days ?? ''} · ${season.time ?? ''}–${season.until ?? ''}`];
}

// ---------- The semester planner ----------

// The month the holiday planner shows: the one the owner moved to, else the semester's first month, else this month.
export function plannerMonthShown(chosen: string, start: string, today: string): string | undefined {
  return [isMonth(chosen) ? chosen : '', start.slice(0, 7), today.slice(0, 7)].find(isMonth);
}

// Days off stay inside the semester.
export function daysOffWithin(dates: Iterable<string>, start: string, end: string): string[] {
  return [...dates].filter(date => date >= start && date <= end);
}

// The semester form: at least one practice day, the end on or after the start, and each day's end after its start.
// form is the form's fields; fields gives each day's start_<Day> and end_<Day>.
export function seasonFromForm(form: FormValues, fields: FormList): Checked<Season> {
  const days = fields.getAll('selectedDays') as string[];
  if (!days.length) return {error: 'Select at least one practice day.'};
  const {season, start, end, program} = form as Record<string, string>;
  if (end < start) return {error: 'Semester end date must follow the first practice date.'};
  const weekly = days.map(day => ({day, start: fields.get('start_' + day), end: fields.get('end_' + day)})) as WeeklySlot[];
  for (const slot of weekly) if (!slot.start || !slot.end || slot.end <= slot.start) return {error: slot.day + ': end time must follow start time.'};
  const daysOff: string[] = JSON.parse(form.exceptions || '[]');
  return {value: {season, start, end, program, excludedDates: daysOffWithin(daysOff, start, end), weekly}};
}
