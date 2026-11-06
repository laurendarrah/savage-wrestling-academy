import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { recordError } from "../lib/site-health";

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    // Record server errors for the owner's site health page (issue #107) without delaying the response.
    const db = (env as Cloudflare.Env & {DB?: D1Database}).DB;
    return runWithConnectorBinding(binding, async () => {
      try {
        const response = await handler.fetch(request, env, ctx);
        if (response.status >= 500) ctx.waitUntil(recordError(db, request, response.status, response.statusText || 'Server error'));
        return response;
      } catch (error) {
        ctx.waitUntil(recordError(db, request, 500, error instanceof Error ? error.message : String(error)));
        throw error;
      }
    });
  },
};
