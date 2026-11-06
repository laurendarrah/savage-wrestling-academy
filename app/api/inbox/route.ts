// Family inbox (issue #72): announcements and the private thread with the academy.
import {strongAccount, accountReply, sameOrigin} from '../../../lib/account-auth';
import {familyInbox, markRead, postMessage} from '../../../lib/messages';
import {dailyReminders, quietly} from '../../../lib/notify';
import {rateLimited} from '../../../lib/rate-limit';
export const dynamic = 'force-dynamic';
async function family(request: Request) {
  const auth = await strongAccount(request);
  if (!auth.user?.email_confirmed_at) return {auth, error: accountReply({error: 'Sign-in required.'}, 401, auth.headers)};
  if (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong) return {auth, error: accountReply({error: 'Authenticator verification required.'}, 403, auth.headers)};
  return {auth, error: null};
}
export async function GET(request: Request) {
  const {auth, error} = await family(request);
  if (error) return error;
  await quietly(() => dailyReminders());
  return accountReply(await familyInbox(auth.user!.id), 200, auth.headers);
}
export async function POST(request: Request) {
  const {auth, error} = await family(request);
  if (error) return error;
  const reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 12000) return reply({error: 'Message is too long.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (input?.action === 'read') { await markRead(auth.user!.id, input); return reply(await familyInbox(auth.user!.id)); }
  if (input?.action === 'reply') {
    if (await rateLimited(request, 'inbox:' + auth.user!.id, 20)) return reply({error: 'Too many messages. Please wait a minute.'}, 429);
    const r = await postMessage(auth.user!.id, 'family', input.body);
    return r.status === 200 ? reply(await familyInbox(auth.user!.id)) : reply({error: r.error}, r.status);
  }
  return reply({error: 'Unknown action.'}, 400);
}
