import vinext from "vinext";
import { defineConfig } from "vite";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";

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
    // Relative to the generated dist/server/wrangler.json, which Wrangler reads when applying migrations.
    migrations_dir: "../../drizzle",
  }],
  observability: { enabled: true },
};

const managedLinux = readExecutionProfile() === "managed-linux";

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
    server: managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {},
    plugins: [
      vinext(),
      cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] }, inspectorPort: false, config: workerConfig }),
    ],
  };
});
