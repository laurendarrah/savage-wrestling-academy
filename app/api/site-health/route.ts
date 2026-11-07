// Owner view of recent server errors (issue #107), problem alerts (#47) and family emails that didn't send (#35).
import {env} from 'cloudflare:workers';
import {ownerIdentity, accountReply} from '../../../lib/account-auth';
import {recentErrors, health} from '../../../lib/site-health';
import {alertStatus} from '../../../lib/owner-alerts';
import {failedEmailCount} from '../../../lib/email-failures';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in and authenticator verification required.'}, 403, auth.headers);
  return accountReply({...(await recentErrors(env.DB!)), health: await health(env.DB), alerts: await alertStatus(env.DB!), failedEmails: await failedEmailCount()}, 200, auth.headers);
}
