// A family cancels its own monthly membership online (decided Nov 13, 2026 on #2, issue #314; NY GBL §527-a). Signed in,
// same origin, JSON, rate limited. Another family's membership is "not found". Rules in lib/memberships.ts.
import {strongAccount, accountReply, sameOrigin} from '../../../lib/account-auth';
import {cancelMembership} from '../../../lib/memberships';
import {rateLimited} from '../../../lib/rate-limit';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';

export const POST = withApi(POST_); async function POST_(request: Request) {
  const auth = await strongAccount(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.user?.email_confirmed_at || !auth.user.email) return reply({error: 'Sign-in required.'}, 401);
  if (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong) return reply({error: 'Authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  if (Number(request.headers.get('content-length') ?? 0) > 1024) return reply({error: 'Request too large.'}, 413);
  const raw = await request.text();
  if (raw.length > 1024) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (input?.action !== 'cancel') return reply({error: 'Unknown action.'}, 400);
  if (await rateLimited(request, 'membership-cancel:' + auth.user.id, 10)) return reply({error: 'Too many attempts. Please wait a minute.'}, 429);
  const r = await cancelMembership(input.orderId, {userId: auth.user.id, role: 'family'});
  return r.status === 200 ? reply({ok: true, endsOn: r.endsOn, wrestler: r.wrestler}) : reply({error: r.error}, r.status);
}
