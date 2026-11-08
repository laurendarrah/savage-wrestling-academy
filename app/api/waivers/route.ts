// Owner document settings (issues #69, #195): publish the approved text as a new version, retire it, and see who has
// signed. Without a kind it is the waiver; ?kind= (or "kind" when posting) chooses the Parent Consent Form or the coach
// contract.
import {ownerIdentity, accountReply, sameOrigin, OWNER_EMAIL} from '../../../lib/account-auth';
import {DOCUMENTS, isKind, ownerDocuments, publishDocument, retireDocument, reissueSignature, carrySignature, signersPage, type Kind} from '../../../lib/documents';
import {pageSize, PAGE_SIZE} from '../../../lib/paging';
import {dailyReminders, noticeReissue, quietly} from '../../../lib/notify';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';
const kindOf = (k: unknown): Kind | null => k === undefined || k === null || k === '' ? 'waiver' : isKind(k) ? k : null;

export const GET = withApi(GET_); async function GET_(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in and authenticator verification required.'}, 403, auth.headers);
  const q = new URL(request.url).searchParams, kind = kindOf(q.get('kind'));
  if (!kind) return accountReply({error: 'Choose a document.'}, 400, auth.headers);
  // The owner may also coach (issue #190) but does not sign a contract with the academy.
  const all: any = await ownerDocuments(kind, OWNER_EMAIL ?? '');
  // Counts cover everyone; the list (wrestlers, or coaches for the contract) comes a page at a time (issue #46).
  const listKey = all.coaches ? 'coaches' : 'wrestlers', page = signersPage(all[listKey], {show: q.get('show'), q: q.get('q'), cursor: q.get('cursor'), limit: pageSize(q.get('limit'), PAGE_SIZE, 500)});
  return accountReply({...all, [listKey]: page.rows, next: page.next, matched: page.matched, totals: page.totals}, 200, auth.headers);
}

export const POST = withApi(POST_); async function POST_(request: Request) {
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
  // Ask one family or coach to sign again (issue #239): their signature stays as a record, marked replaced with the reason.
  if (input?.action === 'reissue') {
    const r = await reissueSignature(kind, input.signatureId, input.reason, auth.owner.userId);
    if (r.status !== 200) return reply({error: r.error}, r.status);
    await quietly(() => noticeReissue(kind, r.signature!, r.version!, r.reason!));
    return reply({ok: true});
  }
  // Carry a signature over to a wrestler's new name (issue #271), with the reason, when a rename did not carry it by itself.
  if (input?.action === 'carry') {
    const r = await carrySignature(kind, input.signatureId, input.reason, auth.owner.userId);
    return r.status === 200 ? reply({ok: true, wrestler: r.wrestler, from: r.from}) : reply({error: r.error}, r.status);
  }
  const r = input?.action === 'publish' ? await publishDocument(kind, input.title, input.body, auth.owner.userId)
    : input?.action === 'retire' ? await retireDocument(kind, auth.owner.userId) : {status: 400, error: 'Choose publish, retire, reissue or carry.'};
  // Families hear about a new family document at once (the daily reminder, sent now); coaches see a to-do on coach home.
  if (r.status === 200 && input.action === 'publish' && DOCUMENTS[kind].signer === 'parent') await quietly(() => dailyReminders(true));
  return r.status === 200 ? reply({ok: true}) : reply({error: (r as any).error}, r.status);
}
