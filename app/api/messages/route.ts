// Owner announcements and family threads (issue #72).
import {ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {ownerMessages, ownerThread, sendAnnouncement, postMessage, resolveAudience} from '../../../lib/messages';
import {emailConfigured} from '../../../lib/email';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in and authenticator verification required.'}, 403, auth.headers);
  const family = new URL(request.url).searchParams.get('family');
  if (family) return accountReply({thread: await ownerThread(family)}, 200, auth.headers);
  return accountReply({...(await ownerMessages()), emailOn: emailConfigured()}, 200, auth.headers);
}
export async function POST(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 24000) return reply({error: 'Message is too long.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (input?.action === 'preview') {
    const a = await resolveAudience(input.audience);
    return 'error' in a ? reply({error: a.error}, 400) : reply({label: a.label, count: a.families.length});
  }
  if (input?.action === 'announce') {
    const r = await sendAnnouncement(auth.owner.userId, input);
    return r.status === 200 ? reply(r) : reply({error: r.error}, r.status);
  }
  if (input?.action === 'message') {
    if (typeof input.userId !== 'string') return reply({error: 'Choose a family.'}, 400);
    const r = await postMessage(input.userId, 'owner', input.body);
    return r.status === 200 ? reply({ok: true, thread: await ownerThread(input.userId)}) : reply({error: r.error}, r.status);
  }
  return reply({error: 'Unknown action.'}, 400);
}
