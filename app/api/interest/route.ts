// "Tell the academy I want this" (#273): a signed-in family asks for a membership or a lesson while that purchase type
// is closed for online payment. GET gives the academy's contact line; POST sends the request to the owner's inbox as a
// message in the family's own conversation (lib/interest.ts), once per item per day.
import {strongAccount, accountReply, sameOrigin} from '../../../lib/account-auth';
import {academyContact, tellAcademy} from '../../../lib/interest';
import {rateLimited} from '../../../lib/rate-limit';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';

async function family(request: Request) {
  const auth = await strongAccount(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.user?.email_confirmed_at) return {auth, reply, error: reply({error: 'Sign-in required.'}, 401)};
  if (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong) return {auth, reply, error: reply({error: 'Authenticator verification required.'}, 403)};
  return {auth, reply, error: null};
}

export const GET = withApi(GET_); async function GET_(request: Request) {
  const {reply, error} = await family(request);
  if (error) return error;
  return reply({contact: await academyContact()});
}

export const POST = withApi(POST_); async function POST_(request: Request) {
  const {auth, reply, error} = await family(request);
  if (error) return error;
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 2048) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (await rateLimited(request, 'interest:' + auth.user!.id, 10)) return reply({error: 'Too many requests. Please wait a minute.'}, 429);
  const r = await tellAcademy(auth.user!.id, input);
  return r.status === 200 ? reply({ok: true, message: r.message, contact: r.contact}) : reply({error: r.error}, r.status);
}
