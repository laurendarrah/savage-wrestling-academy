// Owner view of family data requests (issue #113).
import {ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {ownerRequests, resolveRequest} from '../../../lib/data-requests';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in and authenticator verification required.'}, 403, auth.headers);
  const requests = await ownerRequests();
  return accountReply({requests, open: requests.filter(r => r.status === 'open').length}, 200, auth.headers);
}
export async function POST(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 4096) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  const r = input?.action === 'resolve' ? await resolveRequest(auth.owner.userId, input.id, input.resolution) : {status: 400, error: 'Unknown action.'};
  return r.status === 200 ? reply({ok: true, requests: await ownerRequests()}) : reply({error: (r as any).error}, r.status);
}
