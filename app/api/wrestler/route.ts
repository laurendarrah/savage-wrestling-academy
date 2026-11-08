// Wrestler view data (issue #76) for the signed-in family's own wrestler.
import {strongAccount, accountReply} from '../../../lib/account-auth';
import {wrestlerView} from '../../../lib/wrestler-view';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';
export const GET = withApi(GET_); async function GET_(request: Request) {
  const auth = await strongAccount(request);
  if (!auth.user?.email_confirmed_at) return accountReply({error: 'Sign-in required.'}, 401, auth.headers);
  if (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong) return accountReply({error: 'Authenticator verification required.'}, 403, auth.headers);
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const view = /^[a-zA-Z0-9-]{1,80}$/.test(id) ? await wrestlerView(auth.user.id, id) : null;
  if (!view) return accountReply({error: 'Wrestler not found.'}, 404, auth.headers);
  return accountReply(view, 200, auth.headers);
}
