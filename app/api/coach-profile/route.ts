// Coach profiles (issue #190). A coach reads and saves their own profile. The owner reads and saves any coach's
// (?email= / "email" in the body), or their own once they coach. Phone numbers stay on these owner and coach pages.
import {env} from 'cloudflare:workers';
import {strongAccount, ownerIdentity, accountReply, sameOrigin, OWNER_EMAIL} from '../../../lib/account-auth';
import {coachAccess} from '../../../lib/access-control';
import {cleanProfile, profileView, saveProfile, LIMITS} from '../../../lib/coach-profile';
export const dynamic = 'force-dynamic';

// Whose profile this request may touch: the coach's own, or for the owner any coach on /staff (or themselves).
async function target(request: Request, asked: unknown) {
  const owner = await ownerIdentity(request);
  if (owner.owner) {
    const email = typeof asked === 'string' && asked.trim() ? asked.trim().toLowerCase() : OWNER_EMAIL;
    const staff = await env.DB!.prepare('SELECT email,name FROM staff_access WHERE email=?').bind(email).first<{email: string; name: string}>();
    if (!staff && email !== OWNER_EMAIL) return {headers: owner.headers, error: accountReply({error: 'Coach not found.'}, 404, owner.headers)};
    return {headers: owner.headers, email, name: staff?.name ?? 'Owner', actor: owner.user!.id, byOwner: email !== OWNER_EMAIL};
  }
  const auth = await strongAccount(request), staff = await coachAccess(auth.user, auth.strong);
  if (!staff) return {headers: auth.headers, error: accountReply({error: 'Coach access and authenticator verification required.'}, 403, auth.headers)};
  if (typeof asked === 'string' && asked.trim() && asked.trim().toLowerCase() !== staff.email) return {headers: auth.headers, error: accountReply({error: 'You can only change your own profile.'}, 403, auth.headers)};
  return {headers: auth.headers, email: staff.email, name: staff.name, actor: auth.user!.id, byOwner: false};
}

export async function GET(request: Request) {
  const t = await target(request, new URL(request.url).searchParams.get('email'));
  if (t.error) return t.error;
  return accountReply({email: t.email, byOwner: t.byOwner, limits: LIMITS, profile: await profileView(t.email!, t.name!)}, 200, t.headers);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return accountReply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return accountReply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 6000) return accountReply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return accountReply({error: 'Invalid request.'}, 400); }
  const t = await target(request, input?.email);
  if (t.error) return t.error;
  const clean = cleanProfile(input);
  if ('error' in clean) return accountReply({error: clean.error}, 400, t.headers);
  await saveProfile(t.email!, clean.profile, t.actor!);
  return accountReply({ok: true, profile: await profileView(t.email!, t.name!)}, 200, t.headers);
}
