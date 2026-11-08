import vinext from "vinext";
import { defineConfig, type Plugin } from "vite";
import { WORKSPACE_SCRIPT, workspaceScript } from "./scripts/workspace-script.mjs";

// The academy's Cloudflare Worker and its D1 database (issue #119). Locally the database is a throwaway Miniflare
// copy; the deploy job sets WORKER_NAME and D1_DATABASE_ID for the academy's real account.
const LOCAL_DATABASE_ID = "00000000-0000-4000-8000-000000000000";
const workerConfig = {
  name: process.env.WORKER_NAME || "savage-wrestling-academy",
  main: "./build/worker.ts",
  compatibility_date: "2026-05-15",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: [{
    binding: "DB",
    database_name: process.env.D1_DATABASE_NAME || "savage-wrestling-academy",
    database_id: process.env.D1_DATABASE_ID || LOCAL_DATABASE_ID,
    // Relative to the project root. The Cloudflare Vite plugin rewrites it relative to the generated
    // dist/server/wrangler.json, which Wrangler reads when applying migrations (issue #228).
    migrations_dir: "drizzle",
  }],
  // Daily reminders at 7:41 AM New York time in winter (8:41 AM in summer): 12:41 UTC.
  triggers: { crons: ["41 12 * * *"] },
  observability: { enabled: true },
};

// The owner workspace's typed modules (lib/workspace/), bundled into /portal-workspace.js for app/portal.html (issue #45):
// built fresh on each request in development, and written next to the other static files in the build.
function ownerWorkspaceScript(): Plugin {
  return {
    name: "swa-owner-workspace-script",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/" + WORKSPACE_SCRIPT) return next();
        workspaceScript().then(code => {
          res.setHeader("Content-Type", "text/javascript; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(code);
        }, next);
      });
    },
    async generateBundle() {
      if (this.environment.name !== "client") return;
      this.emitFile({ type: "asset", fileName: WORKSPACE_SCRIPT, source: await workspaceScript() });
    },
  };
}

export default defineConfig(async () => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";
  // Keep Wrangler and Miniflare state project-local.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    // The build id /api/health reports (issue #274): the commit the Deploy workflow built, "dev" locally.
    define: { __BUILD_ID__: JSON.stringify((process.env.BUILD_ID || process.env.GITHUB_SHA || "dev").slice(0, 12)) },
    plugins: [
      ownerWorkspaceScript(),
      vinext(),
      cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] }, inspectorPort: false, config: workerConfig }),
    ],
  };
});
