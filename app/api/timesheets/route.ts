// Owner review of coach hours and time off (issue #193), owner only. The month by coach with flags, corrections with
// a reason, voiding, approval, the month's file (hours and amounts, with lesson shares), and time-off decisions.
import {ownerIdentity, sameOrigin, accountReply} from '../../../lib/account-auth';
import {ownerMonth, ownerCorrect, ownerVoid, approveMonth, unapproveMonth, monthCsv} from '../../../lib/coach-timesheets';
import {ownerTimeOff, decideTimeOff} from '../../../lib/coach-time-off';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';

export const GET = withApi(GET_); async function GET_(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  const q = new URL(request.url).searchParams;
  if (q.get('format') === 'csv') {
    const r = await monthCsv(q.get('month'));
    if (r.status !== 200) return reply({error: r.error}, r.status);
    auth.headers.set('Content-Type', 'text/csv; charset=utf-8');
    auth.headers.set('Content-Disposition', `attachment; filename="savage-coach-hours-${r.month}.csv"`);
    return new Response('﻿' + (r.csv as string), {headers: auth.headers});
  }
  const r = await ownerMonth(q.get('month'), q.get('coach'));
  if (r.status !== 200) return reply({error: r.error}, r.status);
  return reply({...r, status: undefined, timeOff: await ownerTimeOff()});
}

export const POST = withApi(POST_); async function POST_(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 40000) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  const ownerId = auth.user!.id;
  const actions: Record<string, () => Promise<{status: number; error?: string}>> = {
    correct: () => ownerCorrect(ownerId, input), void: () => ownerVoid(ownerId, input), approve: () => approveMonth(ownerId, input),
    unapprove: () => unapproveMonth(ownerId, input), 'time-off': () => decideTimeOff(ownerId, input)
  };
  const run = typeof input?.action === 'string' && Object.hasOwn(actions, input.action) ? actions[input.action] : null;
  if (!run) return reply({error: 'Unknown action.'}, 400);
  const r = await run();
  return r.status === 200 ? reply({ok: true, ...r, status: undefined}) : reply({error: r.error}, r.status);
}
