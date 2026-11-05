// Owner waitlists (issue #73): see who is waiting for each full event, offer a seat, remove an entry.
import {ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {ownerWaitlists, offerSeat, removeEntry} from '../../../lib/waitlist';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in and authenticator verification required.'}, 403, auth.headers);
  return accountReply({events: await ownerWaitlists()}, 200, auth.headers);
}
export async function POST(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 1024) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  const r = input?.action === 'offer' ? await offerSeat(auth.owner.userId, input.id, input.hours, input.autoNext)
    : input?.action === 'remove' ? await removeEntry(auth.owner.userId, input.id) : {status: 400, error: 'Choose offer or remove.'};
  return r.status === 200 ? reply({ok: true, events: await ownerWaitlists()}) : reply({error: (r as any).error}, r.status);
}
