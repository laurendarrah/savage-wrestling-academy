// Lesson formats with the owner's prices and the coach openings still open to book (issue #70).
// Signed-in families and the owner (for recording offline lesson payments) can read it.
import {strongAccount, ownerIdentity, accountReply} from '../../../lib/account-auth';
import {privateFormats, academyToday} from '../../../lib/public-schedule';
import {lessonSettings, openLessons} from '../../../lib/lessons';
import {checkoutKinds} from '../../../lib/checkout-config';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const owner = await ownerIdentity(request);
  if (!owner.owner) {
    const auth = await strongAccount(request);
    if (!auth.user?.email_confirmed_at) return accountReply({error: 'Sign-in required.'}, 401, auth.headers);
    if (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong) return accountReply({error: 'Authenticator verification required.'}, 403, auth.headers);
  }
  const {prices} = await lessonSettings();
  const formats = privateFormats.map(f => ({...f, cents: typeof prices[f.id] === 'number' ? prices[f.id] : null}));
  return accountReply({formats, openings: await openLessons(academyToday()), paymentsOpen: checkoutKinds().has('lesson')}, 200, owner.headers);
}
