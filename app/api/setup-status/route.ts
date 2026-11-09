// Owner setup progress (issue #298). Public and read-only, like /api/health: each launch-checklist step as done or not,
// whether Stripe keys are saved, the Stripe mode and which purchase types are open. Nothing private (lib/setup-status.ts).
import {env} from 'cloudflare:workers';
import {setupStatus} from '../../../lib/setup-status';
import {academyToday} from '../../../lib/public-schedule';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';
export const GET = withApi(GET_); async function GET_() {
  return Response.json(await setupStatus(env.DB!, env as never, academyToday()), {headers: {'Cache-Control': 'no-store'}});
}
