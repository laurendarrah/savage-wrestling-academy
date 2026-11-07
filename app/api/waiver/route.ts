// Family document signing (issues #69, #195): the waiver, and with ?kind=parent_consent the Parent Consent Form.
import {strongAccount, accountReply, sameOrigin} from '../../../lib/account-auth';
import {rateLimited} from '../../../lib/rate-limit';
import {familyWaivers} from '../../../lib/waivers';
import {DOCUMENTS, isKind, myDocuments, signDocument, type Kind} from '../../../lib/documents';
export const dynamic = 'force-dynamic';

async function family(request: Request) {
  const auth = await strongAccount(request);
  if (!auth.user?.email_confirmed_at) return {auth, error: accountReply({error: 'Sign-in required.'}, 401, auth.headers)};
  if (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong) return {auth, error: accountReply({error: 'Authenticator verification required.'}, 403, auth.headers)};
  return {auth, error: null};
}
// Only documents families sign. Without a kind it is the waiver, as before issue #195.
const familyKind = (k: unknown): Kind | null => k === undefined || k === null || k === '' ? 'waiver' : isKind(k) && DOCUMENTS[k].signer === 'parent' ? k : null;

export async function GET(request: Request) {
  const {auth, error} = await family(request);
  if (error) return error;
  const kind = familyKind(new URL(request.url).searchParams.get('kind'));
  if (!kind) return accountReply({error: 'Choose a family document.'}, 400, auth.headers);
  return accountReply(kind === 'waiver' ? await familyWaivers(auth.user!.id) : await myDocuments(kind, auth.user!.id), 200, auth.headers);
}

export async function POST(request: Request) {
  const {auth, error} = await family(request);
  if (error) return error;
  const reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 120000) return reply({error: 'Signature is too large. Clear it and sign again.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  const kind = familyKind(input?.kind);
  if (!kind) return reply({error: 'Choose a family document.'}, 400);
  if (await rateLimited(request, 'waiver:' + auth.user!.id, 30)) return reply({error: 'Too many attempts. Please wait a minute.'}, 429);
  const r = await signDocument(kind, {id: auth.user!.id, email: auth.user!.email!}, input);
  return r.status === 200 ? reply({ok: true, id: r.id}) : reply({error: r.error}, r.status);
}
