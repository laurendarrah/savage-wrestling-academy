// Watching the morning reminders (issue #274). The reminders run from the Cron Trigger (build/worker.ts). Until this
// change the first family, inbox or roster request of the day also ran them inline, which made that one page load
// carry the whole job. Now a request only *checks*: from the Worker's fetch(), in ctx.waitUntil, never awaited by the
// request, once per isolate per day, and only after REMINDER_DEADLINE_HOUR New York time. If that day's run is
// missing by then, the miss is recorded for the owner's alert and the reminders are run from here as the fallback,
// behind the same per-day marker dailyReminders() keeps (so two isolates never both send).
import {ACADEMY_TIME_ZONE, academyDay} from './datetime';
import {dailyReminders} from './notify';
import {recordError} from './site-health';

export const REMINDER_DEADLINE_HOUR = 10;
export const REMINDER_MARKER = 'reminders:';
// The scheduled jobs record a missed morning under this path; lib/owner-alerts.ts names it in the alert email.
export const MISSED_RUN_PATH = '/daily-reminders-missed';
type DB = D1Database | undefined;

// "YYYY-MM-DD" of the last day the reminders ran, and when, from the per-day marker. Null when they never ran.
export async function lastReminderRun(db: DB): Promise<{day: string; at: string} | null> {
  if (!db) return null;
  const row = await db.prepare('SELECT id, updated_at FROM academy_settings WHERE id LIKE ? ORDER BY id DESC LIMIT 1').bind(REMINDER_MARKER + '%').first<{id: string; updated_at: string}>();
  return row ? {day: row.id.slice(REMINDER_MARKER.length), at: row.updated_at} : null;
}

const hourInNewYork = (now: Date) => Number(new Intl.DateTimeFormat('en-US', {timeZone: ACADEMY_TIME_ZONE, hour: '2-digit', hourCycle: 'h23'}).format(now));

// One check per isolate per day, so busy mornings cost one query, not one per request.
let checkedDay = '';
export function resetReminderWatch() { checkedDay = ''; }

export type WatchResult = 'early' | 'checked' | 'done' | 'ran' | 'failed';
export async function reminderWatch(db: DB, now = new Date(), run: (force?: boolean, today?: string) => Promise<number> = dailyReminders): Promise<WatchResult> {
  if (!db) return 'early';
  const today = academyDay(now);
  if (today === checkedDay) return 'checked';
  if (hourInNewYork(now) < REMINDER_DEADLINE_HOUR) return 'early';
  checkedDay = today;
  try {
    if (await db.prepare('SELECT 1 FROM academy_settings WHERE id=?').bind(REMINDER_MARKER + today).first()) return 'done';
    // The owner hears about the miss (through the hourly alert) whether or not the fallback below succeeds.
    await recordError(db, new Request('https://scheduled.invalid' + MISSED_RUN_PATH), 500, `The morning reminders had not run by ${REMINDER_DEADLINE_HOUR} AM New York; run from a page visit instead`);
    await run(false, today);
    return 'ran';
  } catch (error) {
    await recordError(db, new Request('https://scheduled.invalid/daily-reminders'), 500, error instanceof Error ? error.message : String(error));
    return 'failed';
  }
}
