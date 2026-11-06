// Owner review of USA Wrestling cards (issue #68). Lists every wrestler's card and lets the owner mark a card
// verified or not valid after checking it with USA Wrestling. A review applies only to the number and date it was made for.
import {env} from 'cloudflare:workers';
import {ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {academyToday} from '../../../lib/public-schedule';
import {listCards, setReview, clearReview, cardStatus, cardRenewal} from '../../../lib/usaw';
import {noticeCardRejected, quietly} from '../../../lib/notify';
export const dynamic = 'force-dynamic';

const validDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;

export async function GET(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  const q = new URL(request.url).searchParams, today = academyToday(), date = q.get('date') || today;
  if (!validDate(date)) return reply({error: 'Choose a valid date.'}, 400);
  const cards = await listCards(date);
  // The season summary is about today, whatever date the owner checks cards on (issue #131).
  return reply({today, date, cards, renewal: cardRenewal(cards, today)});
}

export async function POST(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 2048) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (!['valid', 'invalid', 'clear'].includes(input?.status) || typeof input.userId !== 'string' || typeof input.wrestlerId !== 'string')
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
  await setReview(input.userId, input.wrestlerId, s.number, s.expires, input.status, note, auth.owner.userId);
  if (input.status === 'invalid') await quietly(() => noticeCardRejected(input.userId, input.wrestlerId, note));
  return reply({ok: true});
}
