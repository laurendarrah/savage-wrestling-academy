// U.S. federal holidays, actual and observed, shown on the calendars as a label only (issue #189). A holiday never adds
// or removes a practice: practices are cancelled only through the owner's days off (Schedules). Which holidays should
// cancel practice is an open question for the owner (#197, question 19).
// Same list and rules as federalHolidays() in app/portal.html (the owner's semester planner); tests/holidays.mjs checks
// that the two agree.
export type Holiday = {date: string; name: string};

export function federalHolidays(year: number): Holiday[] {
  const out: Holiday[] = [];
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const at = (month: number, day: number) => new Date(Date.UTC(year, month, day));
  const add = (name: string, d: Date, fixed = false) => {
    out.push({date: key(d), name});
    // A fixed-date holiday on a weekend is observed on the Friday before or the Monday after.
    const wd = d.getUTCDay();
    if (fixed && (wd === 0 || wd === 6)) out.push({date: key(new Date(d.getTime() + (wd === 6 ? -1 : 1) * 864e5)), name: name + ' (observed)'});
  };
  const nth = (month: number, weekday: number, n: number) => at(month, 1 + (weekday - at(month, 1).getUTCDay() + 7) % 7 + 7 * (n - 1));
  add('New Year’s Day', at(0, 1), true);
  add('Martin Luther King Jr. Day', nth(0, 1, 3));
  add('Washington’s Birthday', nth(1, 1, 3));
  const lastOfMay = at(4, 31);
  add('Memorial Day', at(4, 31 - (lastOfMay.getUTCDay() + 6) % 7));
  add('Juneteenth', at(5, 19), true);
  add('Independence Day', at(6, 4), true);
  add('Labor Day', nth(8, 1, 1));
  add('Columbus Day', nth(9, 1, 2));
  add('Veterans Day', at(10, 11), true);
  add('Thanksgiving Day', nth(10, 4, 4));
  add('Christmas Day', at(11, 25), true);
  return out;
}

// Holidays in one month ("YYYY-MM"), date order. Includes a New Year's Day observed on December 31.
export function holidaysInMonth(month: string): Holiday[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const year = Number(month.slice(0, 4));
  return [year - 1, year, year + 1].flatMap(federalHolidays).filter(h => h.date.startsWith(month + '-'))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
