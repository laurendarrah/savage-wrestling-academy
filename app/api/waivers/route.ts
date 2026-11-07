// Owner document settings (issues #69, #195): publish the approved text as a new version, retire it, and see who has
// signed. Without a kind it is the waiver; ?kind= (or "kind" when posting) chooses the Parent Consent Form or the coach
// contract.
import {ownerIdentity, accountReply, sameOrigin, OWNER_EMAIL} from '../../../lib/account-auth';
import {DOCUMENTS, isKind, ownerDocuments, publishDocument, retireDocument, type Kind} from '../../../lib/documents';
import {dailyReminders, quietly} from '../../../lib/notify';
export const dynamic = 'force-dynamic';
const kindOf = (k: unknown): Kind | null => k === undefined || k === null || k === '' ? 'waiver' : isKind(k) ? k : null;

export async function GET(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in and authenticator verification required.'}, 403, auth.headers);
  const kind = kindOf(new URL(request.url).searchParams.get('kind'));
  if (!kind) return accountReply({error: 'Choose a document.'}, 400, auth.headers);
  // The owner may also coach (issue #190) but does not sign a contract with the academy.
  return accountReply(await ownerDocuments(kind, OWNER_EMAIL ?? ''), 200, auth.headers);
}

export async function POST(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 80000) return reply({error: 'The text is too long.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  const kind = kindOf(input?.kind);
  if (!kind) return reply({error: 'Choose a document.'}, 400);
  const r = input?.action === 'publish' ? await publishDocument(kind, input.title, input.body, auth.owner.userId)
    : input?.action === 'retire' ? await retireDocument(kind, auth.owner.userId) : {status: 400, error: 'Choose publish or retire.'};
  // Families hear about a new family document at once (the daily reminder, sent now); coaches see a to-do on coach home.
  if (r.status === 200 && input.action === 'publish' && DOCUMENTS[kind].signer === 'parent') await quietly(() => dailyReminders(true));
  return r.status === 200 ? reply({ok: true}) : reply({error: (r as any).error}, r.status);
}
