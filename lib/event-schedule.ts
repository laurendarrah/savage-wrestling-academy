// Start and end times for each day of a camp, clinic or event (issue #189). They live in academy_state.payload as
// events[].schedule: [{date, start, end}], one entry per timed day. A day with no entry, or an event saved before times
// existed, has no time yet and is shown as "Time to be announced". Times are New York time, "HH:MM", 24-hour.
export type EventSession = {date: string; start: string; end: string};
export type EventDay = {date: string; start: string | null; end: string | null};

const time = (t: unknown): t is string => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

// Every entry is one of the event's own dates, at most once, with a start before its end. Days may be left out.
export function validEventSchedule(dates: unknown, schedule: unknown): schedule is EventSession[] {
  if (!Array.isArray(dates) || !Array.isArray(schedule) || schedule.length > dates.length) return false;
  const left = new Set(dates);
  return schedule.every(s => !!s && typeof s === 'object' && !Array.isArray(s) && Object.keys(s).every(k => k === 'date' || k === 'start' || k === 'end')
    && typeof s.date === 'string' && left.delete(s.date) && time(s.start) && time(s.end) && s.start < s.end);
}

// The timed days that families and staff see, sorted by date. A damaged schedule shows no times rather than wrong ones.
export function eventSessions(dates: string[], schedule: unknown): EventSession[] {
  if (schedule === undefined || !validEventSchedule(dates, schedule)) return [];
  return schedule.map(({date, start, end}) => ({date, start, end})).sort((a, b) => a.date.localeCompare(b.date));
}

// One row per event day, with its time or nulls when the time is still to be announced.
export function eventDays(dates: string[], schedule: unknown): EventDay[] {
  const timed = new Map(eventSessions(dates, schedule).map(s => [s.date, s]));
  return [...dates].sort().map(date => ({date, start: timed.get(date)?.start ?? null, end: timed.get(date)?.end ?? null}));
}
