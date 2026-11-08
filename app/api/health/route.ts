// Health check for an uptime monitor (issue #107). Public; reveals nothing private: whether the database answers, the
// build, when the scheduled run last ran, and which services are set up (yes or no, never a value; issue #274).
import {env} from 'cloudflare:workers';
import {health} from '../../../lib/site-health';
export const dynamic = 'force-dynamic';
declare const __BUILD_ID__: string | undefined;
export const buildId = () => { try { return typeof __BUILD_ID__ === 'string' && __BUILD_ID__ ? __BUILD_ID__ : 'dev'; } catch { return 'dev'; } };
export async function GET() {
  const h = await health(env.DB, env as never, buildId());
  return Response.json(h, {status: h.ok ? 200 : 503, headers: {'Cache-Control': 'no-store'}});
}
