// A coach opens their invite link (issue #190). "check" says who the invite is for and whether it still works, and
// who is signed in; "accept" grants coach access to the signed-in person if the invite is open and for their email.
// The token travels in the request body, never in a URL. With no token, the signed-in person's own open invite is
// used: email confirmation and sign-in bring a new coach back to /coach-join without the link.
import {verifiedAccount, strongAccount, accountReply, sameOrigin} from '../../../lib/account-auth';
import {findInvite, acceptInvite, inviteStatus, validToken} from '../../../lib/coach-invites';
import {rateLimited} from '../../../lib/rate-limit';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!sameOrigin(request)) return accountReply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return accountReply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 1024) return accountReply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return accountReply({error: 'Invalid request.'}, 400); }
  const token = input?.token === undefined || input?.token === null || input?.token === '' ? null : input.token;
  if (token !== null && !validToken(token)) return accountReply({error: 'This invite link isn’t complete. Copy the whole link from the academy.'}, 404);
  // Without a link, the counter is the signed-in person's own (issue #274), never one shared by everyone on the site.
  const mine = async () => { const {user} = await verifiedAccount(request); return user ? 'user:' + user.id : 'ip:' + (request.headers.get('cf-connecting-ip') ?? 'unknown'); };
  if (await rateLimited(request, 'coach-invite:' + (token ?? await mine()), 20)) return accountReply({error: 'Too many tries. Please wait a minute.'}, 429);
  if (input?.action === 'check') {
    const auth = await verifiedAccount(request), user = auth.user?.email_confirmed_at ? auth.user : null;
    const row = await findInvite(token, user?.email ?? null);
    const invite = row ? {name: row.name, email: row.email, programs: JSON.parse(row.programs), expiresAt: row.expires_at, status: inviteStatus(row)} : null;
    return accountReply({invite, signedIn: user ? {email: user.email, matches: !!row && row.email === user.email!.toLowerCase()} : null}, token && !row ? 404 : 200, auth.headers);
  }
  if (input?.action === 'accept') {
    const auth = await strongAccount(request);
    const r = await acceptInvite(auth.user, token);
    if (r.status !== 200) return accountReply({error: r.error}, r.status, auth.headers);
    // Coaches need an authenticator: set it up (or enter a code) first, then coach home.
    return accountReply({ok: true, name: r.name, redirect: auth.strong ? '/coach' : '/security'}, 200, auth.headers);
  }
  return accountReply({error: 'Unknown action.'}, 400);
}
