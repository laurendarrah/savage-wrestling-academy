// The owner's requests for changes to the site itself (issue #361, lib/site-requests.ts). Owner only.
import {ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {rateLimited} from '../../../lib/rate-limit';
import {emailConfigured} from '../../../lib/email';
import {listRequests, addRequest, resendRequest, markRequest, requestAddress} from '../../../lib/site-requests';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';
// emailReady: whether a new request will be emailed. The address itself never leaves the Worker.
const emailReady = () => !!requestAddress() && emailConfigured();
export const GET = withApi(GET_); async function GET_(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in required.'}, 403, auth.headers);
  return accountReply({requests: await listRequests(), emailReady: emailReady()}, 200, auth.headers);
}
export const POST = withApi(POST_); async function POST_(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 20000) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (await rateLimited(request, 'site-requests:' + auth.owner.userId, 20)) return reply({error: 'Too many tries. Wait a minute and try again.'}, 429);
  const by = auth.owner.userId;
  const r = input?.action === 'add' ? await addRequest(by, input)
    : input?.action === 'resend' ? await resendRequest(by, input.id)
    : input?.action === 'mark' ? await markRequest(by, input.id, input.done)
    : {status: 400, error: 'Unknown action.'};
  return r.status === 200 ? reply({ok: true, request: r.request ?? null, requests: r.requests ?? await listRequests(), emailReady: emailReady()}) : reply({error: r.error, ...(r.requests ? {requests: r.requests} : {})}, r.status);
}
