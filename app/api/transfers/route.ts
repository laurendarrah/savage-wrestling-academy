// Owner program transfers (issue #74).
import {ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {activeMemberships, transferMembership} from '../../../lib/transfers';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';
export const GET = withApi(GET_); async function GET_(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in and authenticator verification required.'}, 403, auth.headers);
  return accountReply(await activeMemberships(), 200, auth.headers);
}
export const POST = withApi(POST_); async function POST_(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 2048) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  const r = await transferMembership(auth.owner.userId, input);
  return r.status === 200 ? reply({ok: true, ...(await activeMemberships())}) : reply({error: r.error}, r.status);
}
