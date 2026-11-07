// The Worker entry point on the academy's own Cloudflare account (issue #119).
import handler from "vinext/server/fetch-handler";
import { recordError } from "../lib/site-health";
import { dailyReminders } from "../lib/notify";
import { cleanupRemovedCoaches } from "../lib/coach-retention";
import { alertOwner } from "../lib/owner-alerts";
import { recordStripeFees } from "../lib/stripe-fees";
import { clearStaleStaging } from "../lib/backup-records";
import { decorateResponse } from "../lib/page-chrome";

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    // Record server errors for the owner's site health page (issue #107) without delaying the response, then email the
    // owner about them, at most once an hour (issue #47).
    const db = (env as Cloudflare.Env & { DB?: D1Database }).DB;
    try {
      const response = await handler.fetch(request, env, ctx);
      if (response.status >= 500) ctx.waitUntil(recordError(db, request, response.status, response.statusText || "Server error").then(() => alertOwner(db)));
      // One look on every page (issue #129): shared stylesheet, icons and top bar.
      return await decorateResponse(request, response);
    } catch (error) {
      ctx.waitUntil(recordError(db, request, 500, error instanceof Error ? error.message : String(error)).then(() => alertOwner(db)));
      throw error;
    }
  },
  // Daily reminders (card expiring or expired, waiver to sign) on a schedule (Cron Trigger in vite.config.ts). The
  // first family or roster visit of the day still triggers them as a fallback; a per-day record stops a second send.
  // Then the records of coaches removed permanently more than 3 years ago are deleted or anonymized (issue #212; safe
  // to repeat, and a large cleanup carries on the next day).
  // Alongside them, the run reads Stripe's card fees for payments that don't have one yet (issue #42); it only reads from
  // Stripe, and a payment whose fee can't be read yet is tried again the next day.
  // It also removes restore uploads from the Backups page that were never finished (issue #221).
  // Afterwards the owner is alerted about a failed run, or about errors held back by the hourly alert limit (#47).
  async scheduled(_event: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    const db = (env as Cloudflare.Env & { DB?: D1Database }).DB;
    const failed = (job: string) => (error: unknown) => recordError(db, new Request(`https://scheduled.invalid/${job}`), 500, error instanceof Error ? error.message : String(error));
    ctx.waitUntil(Promise.all([
      dailyReminders().catch(failed("daily-reminders"))
        .then(() => cleanupRemovedCoaches()).catch(failed("coach-retention")),
      recordStripeFees().then((run) => { if (run.error) throw new Error(`${run.failed} card fee(s) not read: ${run.error}`); }).catch(failed("stripe-fees")),
      clearStaleStaging().catch(failed("restore-staging")),
    ]).then(() => alertOwner(db)));
  },
};
