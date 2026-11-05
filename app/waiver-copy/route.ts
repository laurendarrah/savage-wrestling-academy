// A signed waiver, for the owner or the family that signed it (issue #69).
import {ownerIdentity} from '../../lib/account-auth';
import {signedCopy, waiverCopyHtml} from '../../lib/waivers';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.user?.email_confirmed_at) return new Response('Sign-in required.', {status: 401, headers: auth.headers});
  if (auth.mfaRequired || (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong)) return new Response('Authenticator verification required.', {status: 403, headers: auth.headers});
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) return new Response('Waiver not found.', {status: 404, headers: auth.headers});
  const copy = await signedCopy(id, {userId: auth.user.id, owner: !!auth.owner});
  if (!copy) return new Response('Waiver not found.', {status: 404, headers: auth.headers});
  if ('error' in copy) return new Response(copy.error, {status: 409, headers: auth.headers});
  const nonce = crypto.randomUUID();
  auth.headers.set('Content-Type', 'text/html; charset=utf-8');
  auth.headers.set('Cache-Control', 'private, no-store');
  auth.headers.set('Referrer-Policy', 'no-referrer');
  auth.headers.set('X-Content-Type-Options', 'nosniff');
  auth.headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'; base-uri 'none'; frame-ancestors 'none'");
  return new Response(waiverCopyHtml(copy as any, nonce), {headers: auth.headers});
}
