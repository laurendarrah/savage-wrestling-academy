// Lesson formats with the owner's prices and the coach openings still open to book (issue #70).
// Signed-in families and the owner (for recording offline lesson payments) can read it.
import {strongAccount, ownerIdentity, accountReply} from '../../../lib/account-auth';
import {privateFormats, academyToday} from '../../../lib/public-schedule';
import {lessonSettings, openLessons} from '../../../lib/lessons';
import {checkoutKinds} from '../../../lib/checkout-config';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const owner = await ownerIdentity(request);
  let headers = owner.headers;
  if (!owner.owner) {
    const auth = await strongAccount(request);
    headers = auth.headers;
    if (!auth.user?.email_confirmed_at) return accountReply({error: 'Sign-in required.'}, 401, headers);
    if (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong) return accountReply({error: 'Authenticator verification required.'}, 403, headers);
  }
  const {prices} = await lessonSettings();
  const formats = privateFormats.map(f => ({...f, cents: typeof prices[f.id] === 'number' ? prices[f.id] : null}));
  // Families get an opaque coach key for filtering, never the coach's email address (issue #97).
  const key = async (email: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email)))).slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
  const openings = await Promise.all((await openLessons(academyToday())).map(async ({coachEmail, ...o}) => ({...o, coachKey: await key(coachEmail)})));
  return accountReply({formats, openings, paymentsOpen: checkoutKinds().has('lesson')}, 200, headers);
}
