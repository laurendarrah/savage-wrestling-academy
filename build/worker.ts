// The Worker entry point on the academy's own Cloudflare account (issue #119).
import handler from "vinext/server/fetch-handler";
import { recordError } from "../lib/site-health";
import { dailyReminders } from "../lib/notify";
import { cleanupRemovedCoaches } from "../lib/coach-retention";
import { alertOwner } from "../lib/owner-alerts";
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
  // Afterwards the owner is alerted about a failed run, or about errors held back by the hourly alert limit (#47).
  async scheduled(_event: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    const db = (env as Cloudflare.Env & { DB?: D1Database }).DB;
    ctx.waitUntil(dailyReminders()
      .catch((error) => recordError(db, new Request("https://scheduled.invalid/daily-reminders"), 500, error instanceof Error ? error.message : String(error)))
      .then(() => cleanupRemovedCoaches())
      .catch((error) => recordError(db, new Request("https://scheduled.invalid/coach-retention"), 500, error instanceof Error ? error.message : String(error)))
      .then(() => alertOwner(db)));
  },
};
