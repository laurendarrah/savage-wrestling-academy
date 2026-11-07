// "Check my card" (issue #202): a family checks one of their own wrestlers' USA Wrestling cards on USA Wrestling's
// public verify page. Runs on the server; only the card number goes to USA Wrestling. Rate-limited and cached in
// lib/usaw-check.ts.
import {env} from 'cloudflare:workers';
import {strongAccount, accountReply, sameOrigin} from '../../../lib/account-auth';
import {academyToday} from '../../../lib/public-schedule';
import {cardStatus, reviewFor, reviewSource} from '../../../lib/usaw';
import {checkCard, familyLookup, lookupView, lookupsFor} from '../../../lib/usaw-check';
import {exceptionFor} from '../../../lib/exceptions';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await strongAccount(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.user?.email_confirmed_at) return reply({error: 'Sign-in required.'}, 401);
  if (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong) return reply({error: 'Authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 512) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (typeof input?.wrestlerId !== 'string') return reply({error: 'Choose a wrestler.'}, 400);
  // The wrestler always comes from this account's own saved profile.
  const row = await env.DB!.prepare('SELECT payload FROM family_accounts WHERE user_id=?').bind(auth.user.id).first<{payload: string}>();
  const w = row ? (JSON.parse(row.payload).wrestlers || []).find((x: any) => x.id === input.wrestlerId) : null;
  if (!w) return reply({error: 'Wrestler not found. Save your family profile first.'}, 404);
  const result = await checkCard(request, {userId: auth.user.id, wrestler: w, trigger: 'family', actorId: auth.user.id});
  if ('reason' in result) return reply({error: result.reason}, result.outcome === 'limited' ? 429 : 409);
  const today = academyToday(), review = await reviewFor(auth.user.id, w.id), s = cardStatus(w, review, today);
  const x = await exceptionFor(auth.user.id, w.id, 'usaw', [today]);
  const card = {...s, ...reviewSource(review, s), exceptionUntil: x?.endsOn ?? null, lookup: familyLookup(lookupView(w, (await lookupsFor(auth.user.id)).get(w.id)))};
  return reply({outcome: result.outcome, card});
}
