// The Worker entry point on the academy's own Cloudflare account (issue #119).
import handler from "vinext/server/fetch-handler";
import { recordError } from "../lib/site-health";

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
};
