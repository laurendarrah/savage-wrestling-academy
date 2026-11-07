// Owner view of recent server errors (issue #107), problem alerts (#47) and family emails that didn't send (#35).
import {env} from 'cloudflare:workers';
import {ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {recentErrors, health} from '../../../lib/site-health';
import {alertStatus, sendTestAlert} from '../../../lib/owner-alerts';
import {failedEmailCount} from '../../../lib/email-failures';
import {emailConfigured, failureWords} from '../../../lib/email';
import {rateLimited} from '../../../lib/rate-limit';
import {securityEvent} from '../../../lib/security-events';
export const dynamic = 'force-dynamic';
const OWNER_ONLY = 'Owner sign-in and authenticator verification required.';
const EMAIL_OFF = 'Email isn’t set up yet, so no test alert was sent. Try again once email is set up.';
const TEST_ALERTS_PER_HOUR = 3;
export async function GET(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: OWNER_ONLY}, 403, auth.headers);
  return accountReply({...(await recentErrors(env.DB!)), health: await health(env.DB), alerts: await alertStatus(env.DB!), failedEmails: await failedEmailCount()}, 200, auth.headers);
}

// Send a test alert (issue #263): one email to the owner address through the owner-alert path, so the owner can check
// alerts arrive. Owner only, 3 an hour, and each send is in the security log. It does not touch the real alerts'
// once-an-hour marker. With email not set up nothing is sent, counted or logged.
export async function POST(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: OWNER_ONLY}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 1024) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (input?.action !== 'test-alert') return reply({error: 'Unknown action.'}, 400);
  // Checked before the rate limit, so a site without email never uses up the owner's tries.
  if (!emailConfigured()) return reply({status: 'off', error: EMAIL_OFF}, 409);
  if (await rateLimited(request, 'test-alert:' + auth.owner.userId, TEST_ALERTS_PER_HOUR, {windowMinutes: 60}))
    return reply({error: `You can send ${TEST_ALERTS_PER_HOUR} test alerts an hour. Please try again later.`}, 429);
  const result = await sendTestAlert();
  if (result.status === 'off') return reply({status: 'off', error: EMAIL_OFF}, 409);
  await securityEvent(auth.owner.userId, 'owner_test_alert', result.status === 'sent' ? 'sent' : 'failed:' + result.reason);
  if (result.status === 'sent') return reply({status: 'sent', to: result.to, message: `Sent to ${result.to}. It can take a few minutes to arrive; if it doesn’t, check the spam folder.`});
  return reply({status: 'failed', reason: result.reason, error: 'The test alert didn’t send. ' + failureWords(result.reason)}, 502);
}
