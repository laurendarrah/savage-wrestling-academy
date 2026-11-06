// Health check for an uptime monitor (issue #107). Public; reveals nothing private.
import {env} from 'cloudflare:workers';
import {health} from '../../../lib/site-health';
export const dynamic = 'force-dynamic';
export async function GET() {
  const h = await health(env.DB);
  return Response.json(h, {status: h.ok ? 200 : 503, headers: {'Cache-Control': 'no-store'}});
}
