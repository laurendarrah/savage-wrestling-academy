// Coach contract signing (issue #195, decision Q17 on #197): a coach reads the contract in force, draws a signature and
// keeps the signed copy. Signing changes nothing a coach can do on the site; whether an unsigned contract should block
// coaching duties is not decided. The owner, who may also coach (issue #190), does not sign one.
import {strongAccount, accountReply, sameOrigin} from '../../../lib/account-auth';
import {coachAccess} from '../../../lib/access-control';
import {rateLimited} from '../../../lib/rate-limit';
import {myDocuments, signDocument} from '../../../lib/documents';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';

async function coach(request: Request) {
  const auth = await strongAccount(request);
  return {auth, staff: await coachAccess(auth.user, auth.strong)};
}

export const GET = withApi(GET_); async function GET_(request: Request) {
  const {auth, staff} = await coach(request);
  if (!staff) return accountReply({error: 'Coach access and authenticator verification required.'}, 403, auth.headers);
  if (staff.owner) return accountReply({kind: 'coach_contract', owner: true, document: null, consent: '', exceptions: {}, signatures: []}, 200, auth.headers);
  return accountReply(await myDocuments('coach_contract', auth.user!.id), 200, auth.headers);
}

export const POST = withApi(POST_); async function POST_(request: Request) {
  const {auth, staff} = await coach(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!staff) return reply({error: 'Coach access and authenticator verification required.'}, 403);
  if (staff.owner) return reply({error: 'The owner does not sign a coach contract.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 120000) return reply({error: 'Signature is too large. Clear it and sign again.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (await rateLimited(request, 'contract:' + auth.user!.id, 30)) return reply({error: 'Too many attempts. Please wait a minute.'}, 429);
  const r = await signDocument('coach_contract', {id: auth.user!.id, email: auth.user!.email!}, input);
  return r.status === 200 ? reply({ok: true, id: r.id}) : reply({error: r.error}, r.status);
}
