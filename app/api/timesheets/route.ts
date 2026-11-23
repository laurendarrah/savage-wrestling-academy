// Owner review of coach hours and time off (issue #193), owner only. A pay period (#399) by coach with flags, corrections
// with a reason, removing a shift (the coach is emailed), approval, the period's file (hours and amounts, with lesson
// shares), and time-off decisions. ?period=YYYY-MM-1 or -2; ?month=YYYY-MM shows a whole month (the dashboard's counts).
import {ownerIdentity, sameOrigin, accountReply} from '../../../lib/account-auth';
import {ownerPeriod, ownerCorrect, ownerRemove, approvePeriod, unapprovePeriod, periodCsv} from '../../../lib/coach-timesheets';
import {ownerTimeOff, decideTimeOff} from '../../../lib/coach-time-off';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';

export const GET = withApi(GET_); async function GET_(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in required.'}, 403);
  const q = new URL(request.url).searchParams;
  if (q.get('format') === 'csv') {
    const r = await periodCsv(q.get('period') ?? q.get('month'));
    if (r.status !== 200) return reply({error: r.error}, r.status);
    auth.headers.set('Content-Type', 'text/csv; charset=utf-8');
    auth.headers.set('Content-Disposition', `attachment; filename="savage-coach-hours-${r.period}.csv"`);
    return new Response('﻿' + (r.csv as string), {headers: auth.headers});
  }
  const r = await ownerPeriod(q.get('period') ?? q.get('month'), q.get('coach'));
  if (r.status !== 200) return reply({error: r.error}, r.status);
  return reply({...r, status: undefined, timeOff: await ownerTimeOff()});
}

export const POST = withApi(POST_); async function POST_(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 40000) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  const ownerId = auth.user!.id;
  const actions: Record<string, () => Promise<{status: number; error?: string}>> = {
    correct: () => ownerCorrect(ownerId, input), remove: () => ownerRemove(ownerId, input), approve: () => approvePeriod(ownerId, input),
    unapprove: () => unapprovePeriod(ownerId, input), 'time-off': () => decideTimeOff(ownerId, input)
  };
  const run = typeof input?.action === 'string' && Object.hasOwn(actions, input.action) ? actions[input.action] : null;
  if (!run) return reply({error: 'Unknown action.'}, 400);
  const r = await run();
  return r.status === 200 ? reply({ok: true, ...r, status: undefined}) : reply({error: r.error}, r.status);
}
