// Real roster and check-in (issue #22). Owner: any date, every session. Coach: today, assigned program practices only.
import {ownerIdentity, strongAccount, accountReply, sameOrigin} from '../../../lib/account-auth';
import {accountRole} from '../../../lib/access-control';
import {academyToday} from '../../../lib/public-schedule';
import {rosterFor, checkIn, undoCheckIn, validDate, type Scope} from '../../../lib/roster';
import {scanCheckIn} from '../../../lib/passes';
import {academyMinutes} from '../../../lib/lessons';
export const dynamic = 'force-dynamic';

async function staff(request: Request): Promise<{scope: Scope | null; actor: string | null; headers: Headers; mfa: boolean}> {
  const owner = await ownerIdentity(request);
  if (owner.owner) return {scope: {role: 'owner'}, actor: owner.owner.userId, headers: owner.headers, mfa: false};
  const auth = await strongAccount(request), access = await accountRole(auth.user);
  if (access.role === 'coach' && access.staff) {
    if (!auth.strong) return {scope: null, actor: null, headers: auth.headers, mfa: true};
    return {scope: {role: 'coach', programs: access.staff.programs}, actor: auth.user!.id, headers: auth.headers, mfa: false};
  }
  return {scope: null, actor: null, headers: auth.headers, mfa: !!owner.mfaRequired};
}

export async function GET(request: Request) {
  const s = await staff(request), reply = (b: unknown, st = 200) => accountReply(b, st, s.headers);
  if (!s.scope) return reply({error: s.mfa ? 'Authenticator verification required.' : 'Staff access required.'}, 403);
  const today = academyToday(), date = new URL(request.url).searchParams.get('date') || today;
  if (!validDate(date)) return reply({error: 'Choose a valid date.'}, 400);
  if (s.scope.role === 'coach' && date !== today) return reply({error: 'Coaches can open today\'s roster only.'}, 403);
  return reply({date, today, role: s.scope.role, sessions: await rosterFor(date, s.scope)});
}

export async function POST(request: Request) {
  const s = await staff(request), reply = (b: unknown, st = 200) => accountReply(b, st, s.headers);
  if (!s.scope || !s.actor) return reply({error: s.mfa ? 'Authenticator verification required.' : 'Staff access required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 1024) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  // QR pass scan (issue #71): same roster and permission rules as a manual check-in.
  if (input?.action === 'scan') {
    if (!validDate(input.date) || typeof input.code !== 'string' || input.code.length > 100) return reply({error: 'Scan a pass.'}, 400);
    if (s.scope.role === 'coach' && input.date !== academyToday()) return reply({error: 'Coaches can check in for today only.'}, 403);
    const r: any = await scanCheckIn(input.date, input.code, s.scope, s.actor, input.date === academyToday() ? academyMinutes() : 0, input.sessionKey);
    if (r.status !== 200) return reply({error: r.error}, r.status);
    const {status, ...result} = r;
    return reply({ok: true, scan: result, sessions: await rosterFor(input.date, s.scope)});
  }
  const ids = [input?.sessionKey, input?.userId, input?.wrestlerId];
  if (!['checkin', 'undo'].includes(input?.action) || !validDate(input?.date) || !ids.every(v => typeof v === 'string' && v.length > 0 && v.length <= 200))
    return reply({error: 'Choose a wrestler and session.'}, 400);
  if (s.scope.role === 'coach' && input.date !== academyToday()) return reply({error: 'Coaches can check in for today only.'}, 403);
  const result = input.action === 'checkin'
    ? await checkIn(input.date, input.sessionKey, input.userId, input.wrestlerId, s.scope, s.actor)
    : await undoCheckIn(input.date, input.sessionKey, input.userId, input.wrestlerId, s.scope);
  if (result.status !== 200) return reply({error: result.error}, result.status);
  return reply({ok: true, sessions: await rosterFor(input.date, s.scope)});
}
