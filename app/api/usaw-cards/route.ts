// Owner review of USA Wrestling cards (issue #68). Lists every wrestler's card and lets the owner mark a card
// verified or not valid after checking it with USA Wrestling. A review applies only to the number and date it was made for.
import {env} from 'cloudflare:workers';
import {ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {academyToday} from '../../../lib/public-schedule';
import {listCards, setReview, clearReview, cardStatus, cardRenewal, cardsPage, lookupDisagreement, CARD_RENEWAL_DAYS, type CardRow} from '../../../lib/usaw';
import {noticeCardRejected, quietly} from '../../../lib/notify';
import {checkCard} from '../../../lib/usaw-check';
import {rosterFor} from '../../../lib/roster';
import {pageSize, PAGE_SIZE} from '../../../lib/paging';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';

const validDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;

// The wrestlers on today's roster whose card stops their check-in (issue #271), as "family/wrestler" keys.
async function blockedToday(today: string) {
  const keys = new Set<string>();
  try { for (const s of await rosterFor(today, {role: 'owner'})) for (const e of s.entries) if (e.checkInBlocked) keys.add(`${e.userId}/${e.wrestlerId}`); } catch {}
  return keys;
}

export const GET = withApi(GET_); async function GET_(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  const q = new URL(request.url).searchParams, today = academyToday(), date = q.get('date') || today;
  if (!validDate(date)) return reply({error: 'Choose a valid date.'}, 400);
  const cards: CardRow[] = await listCards(date), stuck = await blockedToday(today);
  for (const c of cards) c.blocksToday = stuck.has(`${c.userId}/${c.wrestlerId}`);
  // Counts cover every wrestler; the list comes a page at a time, filtered here (issue #46).
  // The season summary is about today, whatever date the owner checks cards on (issue #131). renewalDays is the
  // renewal-list window (issue #210).
  return reply({today, date, ...cardsPage(cards, {show: q.get('show'), q: q.get('q'), cursor: q.get('cursor'), onDate: date, limit: pageSize(q.get('limit'), PAGE_SIZE, 500)}),
    renewal: cardRenewal(cards, today), renewalDays: CARD_RENEWAL_DAYS});
}

export const POST = withApi(POST_); async function POST_(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 2048) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (!['valid', 'invalid', 'clear', 'lookup'].includes(input?.status) || typeof input.userId !== 'string' || typeof input.wrestlerId !== 'string')
    return reply({error: 'Choose a wrestler and a review.'}, 400);
  const row = await env.DB!.prepare('SELECT payload FROM family_accounts WHERE user_id=?').bind(input.userId).first<{payload: string}>();
  const w = row ? (JSON.parse(row.payload).wrestlers || []).find((x: any) => x.id === input.wrestlerId) : null;
  if (!w) return reply({error: 'Wrestler not found.'}, 404);
  if (input.status === 'clear') { await clearReview(input.userId, input.wrestlerId, auth.owner.userId); return reply({ok: true}); }
  const s = cardStatus(w, null, academyToday());
  if (s.state === 'missing') return reply({error: 'This wrestler has no card number and expiration date on file to review.'}, 409);
  // The review is pinned to the card the owner saw; if the family has since changed it, ask the owner to reload.
  if (input.number !== s.number || input.expires !== s.expires) return reply({error: 'The family changed this card since the page loaded. Reload and check it again.'}, 409);
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) : '';
  if (input.status === 'invalid' && !note) return reply({error: 'Add a short reason the family will see, for example "number not found".'}, 400);
  // "Check with USA Wrestling" (issue #202): one card, on the owner's tap. It verifies the card when it is active and the
  // name matches; anything else leaves the owner's decision to the owner.
  if (input.status === 'lookup') {
    const result = await checkCard(request, {userId: input.userId, wrestler: w, trigger: 'owner', actorId: auth.owner.userId});
    if ('reason' in result) return reply({error: result.reason}, result.outcome === 'limited' ? 429 : 409);
    return reply({ok: true, outcome: result.outcome, cached: result.cached, checkedAt: result.checkedAt});
  }
  // Marking a card verified against what USA Wrestling showed (issue #271) needs a note saying why, kept with the review.
  if (input.status === 'valid') {
    const d = await lookupDisagreement(input.userId, input.wrestlerId, s.number, s.expires);
    if (d && !note) return reply({error: `USA Wrestling showed that ${d.words}. To mark this card verified anyway, add a note saying why, for example "checked the card in person".`, lookupOutcome: d.outcome}, 400);
  }
  await setReview(input.userId, input.wrestlerId, s.number, s.expires, input.status, note, auth.owner.userId);
  if (input.status === 'invalid') await quietly(() => noticeCardRejected(input.userId, input.wrestlerId, note));
  return reply({ok: true});
}
