import html from './screen.html?raw';
import {ownerIdentity, strongAccount} from '../../lib/account-auth';
import {accountRole} from '../../lib/access-control';
import {markOwnerShell} from '../../lib/owner-shell';
export const dynamic = 'force-dynamic';
// Owner, or an active coach, with a verified authenticator.
export async function GET(request: Request) {
  const owner = await ownerIdentity(request);
  if (!owner.owner) {
    const auth = await strongAccount(request), access = await accountRole(auth.user);
    if (access.role !== 'coach') {
      owner.headers.set('Location', owner.mfaRequired ? '/security' : '/login');
      return new Response(null, {status: 303, headers: owner.headers});
    }
    if (!auth.strong) { auth.headers.set('Location', '/security'); return new Response(null, {status: 303, headers: auth.headers}); }
    auth.headers.set('Content-Type', 'text/html; charset=utf-8');
    return new Response(html, {headers: auth.headers});
  }
  owner.headers.set('Content-Type', 'text/html; charset=utf-8');
  markOwnerShell(owner.headers);
  return new Response(html, {headers: owner.headers});
}
