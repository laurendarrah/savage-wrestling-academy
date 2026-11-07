// The coach's month calendar on the practice-plans page (issue #191). It is built on the server from the same public
// schedule as the calendar and the coach home's week (lib/public-schedule.ts): the coach's own programs' practices,
// every extra practice, camp, clinic and event (with its day's time, or none yet), U.S. holidays as a label only, and
// today by the New York date. Each practice also says whether a plan is shared for it, so the page only draws the grid.
// Weeks start on Monday, as on the public calendar and the coach home.

// The parts of publicSchedule() (lib/public-schedule.ts) the calendar reads.
type Schedule = {programs: {id: string; name: string}[]; practices: {program: string; date: string; start: string; end: string}[];
  liveClasses: {name: string; date: string; start: string; end: string}[]; holidays: {date: string; name: string}[];
  events: {name: string; type: string; dates: string[]; schedule: {date: string; start: string; end: string}[]}[]};
export type CalendarItem = {kind: 'practice' | 'extra' | 'event'; title: string; start: string | null; end: string | null; program?: string; plan?: boolean};
export type CalendarDay = {date: string; today: boolean; holidays: string[]; items: CalendarItem[]};
export type CalendarMonth = {month: string; lead: number; days: CalendarDay[]};

const eventTitle = (name: string, type: string) => name.toLowerCase().includes(type.toLowerCase()) ? name : `${name} (${type.toLowerCase()})`;

// plans: the shared plans this coach can read (published, for a practice still on the schedule).
export function practiceMonth(schedule: Schedule, month: string, today: string, programs: string[], plans: {program: string; date: string}[]): CalendarMonth {
  const [year, mo] = month.split('-').map(Number), count = new Date(Date.UTC(year, mo, 0)).getUTCDate();
  const names = new Map(schedule.programs.map(p => [p.id, p.name]));
  const days: CalendarDay[] = [];
  for (let d = 1; d <= count; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const items: CalendarItem[] = [
      ...schedule.practices.filter(p => p.date === date && programs.includes(p.program)).map(p => ({kind: 'practice' as const, program: p.program, title: names.get(p.program) ?? p.program,
        start: p.start, end: p.end, plan: plans.some(x => x.program === p.program && x.date === date)})),
      ...schedule.liveClasses.filter(l => l.date === date).map(l => ({kind: 'extra' as const, title: `${l.name} (extra practice)`, start: l.start, end: l.end})),
      ...schedule.events.filter(e => e.dates.includes(date)).map(e => {
        const t = e.schedule.find(s => s.date === date);
        return {kind: 'event' as const, title: eventTitle(e.name, e.type), start: t?.start ?? null, end: t?.end ?? null};
      }),
    ].sort((a, b) => (a.start ?? '99').localeCompare(b.start ?? '99') || a.title.localeCompare(b.title));
    days.push({date, today: date === today, holidays: schedule.holidays.filter(h => h.date === date).map(h => h.name), items});
  }
  return {month, lead: (new Date(Date.UTC(year, mo - 1, 1)).getUTCDay() + 6) % 7, days};
}
