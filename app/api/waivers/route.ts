// Owner waiver settings (issue #69): publish the approved text as a new version, retire it, and see who has signed.
import {ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {ownerWaivers, publishWaiver, retireWaiver} from '../../../lib/waivers';
import {dailyReminders, quietly} from '../../../lib/notify';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in and authenticator verification required.'}, 403, auth.headers);
  return accountReply(await ownerWaivers(), 200, auth.headers);
}

export async function POST(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 80000) return reply({error: 'Waiver text is too long.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  const r = input?.action === 'publish' ? await publishWaiver(input.title, input.body, auth.owner.userId)
    : input?.action === 'retire' ? await retireWaiver(auth.owner.userId) : {status: 400, error: 'Choose publish or retire.'};
  if (r.status === 200 && input.action === 'publish') await quietly(() => dailyReminders(true));
  return r.status === 200 ? reply({ok: true}) : reply({error: (r as any).error}, r.status);
}
