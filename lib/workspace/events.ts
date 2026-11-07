// Camps, clinics and events in the owner workspace (issue #45). Each day may have a start and end time (issue #189);
// a day without one is "Time to be announced". An event archives itself after its last day, by the New York date.
// The server checks what is saved with validState() (lib/academy-validation.ts) and validEventSchedule()
// (lib/event-schedule.ts).
import {clockTime, fullDate} from '../datetime';
import type {AcademyEvent, Checked, EventSession, FormList, FormValues} from './types';

export const EVENT_TYPES = ['Camp', 'Clinic', 'Event'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const realDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d)) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;

export function eventDates(e: Pick<AcademyEvent, 'dates'>): string[] {
  return Array.isArray(e.dates) ? e.dates : [];
}

export function eventSession(e: Pick<AcademyEvent, 'schedule'> | null | undefined, date: string): EventSession | undefined {
  return (Array.isArray(e?.schedule) ? e.schedule as (EventSession | null)[] : []).find(s => s && s.date === date) ?? undefined;
}

// "9:00 AM–12:00 PM", or "Time to be announced".
export function eventTimeLabel(e: Pick<AcademyEvent, 'schedule'>, date: string): string {
  const s = eventSession(e, date);
  return s ? clockTime(s.start) + '–' + clockTime(s.end) : 'Time to be announced';
}

// "Dec 28, 2026 · Time to be announced", one line per day in date order.
export function eventDayLines(e: Pick<AcademyEvent, 'dates' | 'schedule'>): string[] {
  return [...eventDates(e)].sort().map(d => fullDate(d) + ' · ' + eventTimeLabel(e, d));
}

// "Dec 28, 2026 · Dec 29, 2026", or the date in words an older event was saved with.
export function eventDateLabel(e: Pick<AcademyEvent, 'dates' | 'date'>): string {
  return eventDates(e).length ? eventDates(e).map(fullDate).join(' · ') : e.date || 'Dates need updating';
}

export function eventEnded(e: Pick<AcademyEvent, 'dates'>, today: string): boolean {
  const dates = eventDates(e);
  return dates.length > 0 && [...dates].sort().at(-1)! < today;
}

export function isEventArchived(e: Pick<AcademyEvent, 'dates' | 'archived'>, today: string): boolean {
  return !!e.archived || eventEnded(e, today);
}

export type EventFormDay = {date: string; start: string; end: string};

// The editor's days with their times: one row per camp day, or the single clinic or event date.
export function eventFormDays(fields: FormList, camp: boolean, form: FormValues): EventFormDay[] {
  if (!camp) return [{date: String(form.singleDate ?? ''), start: String(form.singleStart ?? ''), end: String(form.singleEnd ?? '')}];
  const starts = fields.getAll('campStart'), ends = fields.getAll('campEnd');
  return fields.getAll('campDate').map((date, i) => ({date: String(date), start: String(starts[i] ?? ''), end: String(ends[i] ?? '')}));
}

// Both times or neither for each day, the end after the start. null when a day is half filled in or backwards.
export function eventFormSchedule(days: EventFormDay[]): EventSession[] | null {
  const out: EventSession[] = [];
  for (const d of days) {
    if (!d.start && !d.end) continue;
    if (!TIME.test(d.start) || !TIME.test(d.end) || d.end <= d.start) return null;
    out.push({date: d.date, start: d.start, end: d.end});
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export const EVENT_FORM_ERROR = 'Enter a title, valid prices and capacity. Camps need at least two different dates; clinics need exactly one date.';
export const EVENT_TIME_ERROR = 'Give each day both a start and an end time, with the end after the start. Or leave both blank to show “Time to be announced”.';

// The event editor: a title, a known type, two or more different real dates for a camp and one otherwise, prices from
// $0 to $10,000 kept to the cent, and room for 1 to 100,000. Editing keeps the event's id and archive state.
export function eventFromForm(form: FormValues, fields: FormList, saved: AcademyEvent | undefined, newId: () => string = () => crypto.randomUUID()): Checked<AcademyEvent> {
  const v = form as Record<string, string>, camp = v.type === 'Camp', days = eventFormDays(fields, camp, form), dates = days.map(d => d.date).sort();
  const price = Number(v.price), slots = Number(v.slots), day = camp && v.singleDays === 'on' ? Number(v.day) : null;
  if (!v.name.trim() || !EVENT_TYPES.includes(v.type) || dates.length < (camp ? 2 : 1) || dates.length > 366 || new Set(dates).size !== dates.length || dates.some(d => !realDate(d))
    || !Number.isFinite(price) || price < 0 || price > 10000 || !Number.isInteger(slots) || slots < 1 || slots > 100000 || day !== null && (!Number.isFinite(day) || day < 0 || day > 10000))
    return {error: EVENT_FORM_ERROR};
  const schedule = eventFormSchedule(days);
  if (!schedule) return {error: EVENT_TIME_ERROR};
  return {value: {archived: saved?.archived ?? false, archivedAt: saved?.archivedAt ?? null, id: saved?.id || newId(), name: v.name.trim(), gradeRange: (v.gradeRange ?? '').trim(),
    description: (v.description ?? '').trim(), type: v.type, dates, schedule, date: eventDateLabel({dates}), price: Math.round(price * 100) / 100, day: day === null ? null : Math.round(day * 100) / 100, slots}};
}
