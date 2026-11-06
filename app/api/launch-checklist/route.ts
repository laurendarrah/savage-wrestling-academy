// Owner launch checklist (issue #123): what is ready and what is left, from the real records and settings.
import {env} from 'cloudflare:workers';
import {ownerIdentity, accountReply} from '../../../lib/account-auth';
import {launchChecklist} from '../../../lib/launch-checklist';
import {academyToday} from '../../../lib/public-schedule';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in and authenticator verification required.'}, 403, auth.headers);
  return accountReply(await launchChecklist(env.DB!, env as never, academyToday()), 200, auth.headers);
}
