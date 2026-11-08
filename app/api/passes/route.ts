// QR entry passes (issue #71). Families read and replace their wrestlers' passes; the owner can revoke any pass.
import {strongAccount, ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {familyPasses, revokePass} from '../../../lib/passes';
import {familyProfile} from '../../../lib/program-approval';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';

async function family(request: Request) {
  const auth = await strongAccount(request);
  if (!auth.user?.email_confirmed_at) return {auth, error: accountReply({error: 'Sign-in required.'}, 401, auth.headers)};
  if (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong) return {auth, error: accountReply({error: 'Authenticator verification required.'}, 403, auth.headers)};
  return {auth, error: null};
}

export const GET = withApi(GET_); async function GET_(request: Request) {
  const {auth, error} = await family(request);
  if (error) return error;
  return accountReply({passes: await familyPasses(auth.user!.id)}, 200, auth.headers);
}

export const POST = withApi(POST_); async function POST_(request: Request) {
  const owner = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, owner.headers);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 1024) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (input?.action === 'revoke' && owner.owner) {
    if (typeof input.userId !== 'string' || typeof input.wrestlerId !== 'string') return reply({error: 'Choose a wrestler.'}, 400);
    await revokePass(input.userId, input.wrestlerId, owner.owner.userId);
    return reply({ok: true});
  }
  const {auth, error} = await family(request);
  if (error) return error;
  if (input?.action !== 'replace' || typeof input.wrestlerId !== 'string') return reply({error: 'Choose a wrestler.'}, 400);
  if (!(await familyProfile(auth.user!.id))?.wrestlers.some(w => w.id === input.wrestlerId)) return reply({error: 'Wrestler not found.'}, 404);
  await revokePass(auth.user!.id, input.wrestlerId, auth.user!.id);
  return accountReply({ok: true, passes: await familyPasses(auth.user!.id)}, 200, auth.headers);
}
