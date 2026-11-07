// The owner deletes a family account from Family accounts (issue #259). The rules are in lib/family-deletion.ts.
import {ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {deleteFamily} from '../../../lib/family-deletion';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 4096) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (input?.action !== 'delete') return reply({error: 'Unknown action.'}, 400);
  const r = await deleteFamily(auth.owner.userId, input);
  return r.status === 200 ? reply({ok: true, deleted: r.deleted, paymentsKept: r.kept}) : reply({error: r.error}, r.status);
}
