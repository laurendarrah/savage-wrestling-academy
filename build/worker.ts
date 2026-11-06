// The Worker entry point on the academy's own Cloudflare account (issue #119).
import handler from "vinext/server/fetch-handler";
import { recordError } from "../lib/site-health";
import { dailyReminders } from "../lib/notify";

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    // Record server errors for the owner's site health page (issue #107) without delaying the response.
    const db = (env as Cloudflare.Env & { DB?: D1Database }).DB;
    try {
      const response = await handler.fetch(request, env, ctx);
      if (response.status >= 500) ctx.waitUntil(recordError(db, request, response.status, response.statusText || "Server error"));
      return response;
    } catch (error) {
      ctx.waitUntil(recordError(db, request, 500, error instanceof Error ? error.message : String(error)));
      throw error;
    }
  },
  // Daily reminders (card expiring or expired, waiver to sign) on a schedule (Cron Trigger in vite.config.ts). The
  // first family or roster visit of the day still triggers them as a fallback; a per-day record stops a second send.
  async scheduled(_event: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    const db = (env as Cloudflare.Env & { DB?: D1Database }).DB;
    ctx.waitUntil(dailyReminders().catch((error) => recordError(db, new Request("https://scheduled.invalid/daily-reminders"), 500, error instanceof Error ? error.message : String(error))));
  },
};
