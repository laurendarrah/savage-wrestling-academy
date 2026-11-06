// A family's own data (issue #113): download everything, see and send closure requests.
import {strongAccount, accountReply, sameOrigin} from '../../../lib/account-auth';
import {familyExport, familyRequests, requestClosure} from '../../../lib/data-requests';
import {rateLimited} from '../../../lib/rate-limit';
export const dynamic = 'force-dynamic';
async function family(request: Request) {
  const auth = await strongAccount(request);
  if (!auth.user?.email_confirmed_at) return {auth, error: accountReply({error: 'Sign-in required.'}, 401, auth.headers)};
  if (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong) return {auth, error: accountReply({error: 'Authenticator verification required.'}, 403, auth.headers)};
  return {auth, error: null};
}
export async function GET(request: Request) {
  const {auth, error} = await family(request);
  if (error) return error;
  if (new URL(request.url).searchParams.get('format') !== 'download') return accountReply({requests: await familyRequests(auth.user!.id)}, 200, auth.headers);
  if (await rateLimited(request, 'my-data:' + auth.user!.id, 5)) return accountReply({error: 'Too many downloads. Please wait a minute.'}, 429, auth.headers);
  const data = await familyExport(auth.user!.id);
  if (!data) return accountReply({error: 'Save your family profile first.'}, 404, auth.headers);
  auth.headers.set('Content-Type', 'application/json; charset=utf-8');
  auth.headers.set('Content-Disposition', `attachment; filename="savage-family-data-${new Date().toISOString().slice(0, 10)}.json"`);
  return new Response(JSON.stringify(data, null, 2), {headers: auth.headers});
}
export async function POST(request: Request) {
  const {auth, error} = await family(request);
  if (error) return error;
  const reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 4096) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (input?.action !== 'close') return reply({error: 'Unknown request.'}, 400);
  if (await rateLimited(request, 'close-request:' + auth.user!.id, 5)) return reply({error: 'Too many attempts. Please wait a minute.'}, 429);
  const r = await requestClosure({id: auth.user!.id, email: auth.user!.email!}, input.note);
  return r.status === 200 ? reply({ok: true, requests: await familyRequests(auth.user!.id)}) : reply({error: r.error}, r.status);
}
