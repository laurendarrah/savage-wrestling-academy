// A family books a walk-in or an extra practice to pay cash at the academy, or cancels one before it starts (issue #248).
// The amount due comes from lib/quotes.ts on the server; any amount the browser sends is ignored.
import {strongAccount, accountReply, sameOrigin} from '../../../lib/account-auth';
import {bookCash, cancelByFamily, familyCashBookings} from '../../../lib/cash-bookings';
import {rateLimited} from '../../../lib/rate-limit';
export const dynamic = 'force-dynamic';

async function family(request: Request) {
  const auth = await strongAccount(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.user?.email_confirmed_at || !auth.user.email) return {auth, reply, error: reply({error: 'Sign-in required.'}, 401)};
  if (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong) return {auth, reply, error: reply({error: 'Authenticator verification required.'}, 403)};
  return {auth, reply, error: null};
}

export async function GET(request: Request) {
  const {auth, reply, error} = await family(request);
  if (error) return error;
  return reply({bookings: await familyCashBookings(auth.user!.id)});
}

export async function POST(request: Request) {
  const {auth, reply, error} = await family(request);
  if (error) return error;
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  if (Number(request.headers.get('content-length') ?? 0) > 2048) return reply({error: 'Request too large.'}, 413);
  const raw = await request.text();
  if (raw.length > 2048) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (await rateLimited(request, 'cash-booking:' + auth.user!.id, 20)) return reply({error: 'Too many attempts. Please wait a minute.'}, 429);
  if (input?.action === 'book') {
    const r = await bookCash({id: auth.user!.id, email: auth.user!.email!}, input);
    return r.status === 200 ? reply({ok: true, booking: r.booking}) : reply({error: r.error, ...(r.extra ?? {})}, r.status);
  }
  if (input?.action === 'cancel') {
    const r = await cancelByFamily(auth.user!.id, input.id);
    return r.status === 200 ? reply({ok: true, bookings: await familyCashBookings(auth.user!.id)}) : reply({error: r.error}, r.status);
  }
  return reply({error: 'Unknown action.'}, 400);
}
