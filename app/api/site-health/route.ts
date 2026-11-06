// Owner view of recent server errors (issue #107).
import {env} from 'cloudflare:workers';
import {ownerIdentity, accountReply} from '../../../lib/account-auth';
import {recentErrors, health} from '../../../lib/site-health';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in and authenticator verification required.'}, 403, auth.headers);
  return accountReply({...(await recentErrors(env.DB!)), health: await health(env.DB)}, 200, auth.headers);
}
