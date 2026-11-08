// A coach's own hours and time off (issue #193): clock in and out, see and correct the month, send it, ask for time off.
// Coaches, and the owner once they have added themselves as a coach, with the same authenticator rule as coach home.
import {strongAccount, sameOrigin, accountReply} from '../../../lib/account-auth';
import {coachAccess} from '../../../lib/access-control';
import {coachMonth, choicesFor, clockIn, clockOut, fixTimes, addShift, removeShift, submitMonth} from '../../../lib/coach-timesheets';
import {myTimeOff, coachNotices, requestTimeOff, withdrawTimeOff} from '../../../lib/coach-time-off';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';

async function coach(request: Request) { const auth = await strongAccount(request); return {auth, staff: await coachAccess(auth.user, auth.strong)}; }

export const GET = withApi(GET_); async function GET_(request: Request) {
  const {auth, staff} = await coach(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!staff) return reply({error: 'Coach access and authenticator verification required.'}, 403);
  const q = new URL(request.url).searchParams;
  if (q.has('date')) { const r = await choicesFor(staff, q.get('date')); return r.status === 200 ? reply(r) : reply({error: r.error}, r.status); }
  const month = await coachMonth(staff, q.get('month'));
  return reply({...month, name: staff.name, owner: staff.owner, timeOffRequests: await myTimeOff(staff.email), ...(await coachNotices(staff.email))});
}

export const POST = withApi(POST_); async function POST_(request: Request) {
  const {auth, staff} = await coach(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!staff) return reply({error: 'Coach access and authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 4096) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  const userId = auth.user!.id;
  const actions: Record<string, () => Promise<{status: number; error?: string}>> = {
    'clock-in': () => clockIn(staff, userId, input), 'clock-out': () => clockOut(staff, userId, input), fix: () => fixTimes(staff, userId, input),
    add: () => addShift(staff, userId, input), remove: () => removeShift(staff, userId, input), submit: () => submitMonth(staff, userId, input),
    'time-off': () => requestTimeOff(staff, userId, input), 'time-off-withdraw': () => withdrawTimeOff(staff, userId, input)
  };
  const run = typeof input?.action === 'string' && Object.hasOwn(actions, input.action) ? actions[input.action] : null;
  if (!run) return reply({error: 'Unknown action.'}, 400);
  const r = await run();
  return r.status === 200 ? reply({ok: true, ...r, status: undefined}) : reply({error: r.error}, r.status);
}
