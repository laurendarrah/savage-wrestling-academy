// USA Wrestling card rules (issue #68, decision #67): a wrestler cannot book anything unless a USA Wrestling card
// on file is valid on every session date. A missing card is treated like an expired one. The owner can mark a card
// not valid after checking it; that review applies only while the number and expiration still match.
import {env} from 'cloudflare:workers';
import {USAW_NUMBER} from './family-records';
import {exceptionFor} from './exceptions';

export type CardWrestler = {id: string; name: string; usawNumber?: string; usawExpires?: string};
export type Review = {number: string; expires: string; status: 'valid' | 'invalid'; note: string; reviewed_at: string} | null;
export type CardStatus = {state: 'missing' | 'expired' | 'invalid' | 'current' | 'verified'; number: string; expires: string; note: string};

const longDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric'});

export function cardStatus(w: CardWrestler, review: Review, onDate: string): CardStatus {
  const number = (w.usawNumber || '').trim().toUpperCase(), expires = w.usawExpires || '';
  if (!number || !USAW_NUMBER.test(number) || !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return {state: 'missing', number, expires, note: ''};
  const matches = !!review && review.number === number && review.expires === expires;
  if (matches && review!.status === 'invalid') return {state: 'invalid', number, expires, note: review!.note};
  if (expires < onDate) return {state: 'expired', number, expires, note: ''};
  return {state: matches && review!.status === 'valid' ? 'verified' : 'current', number, expires, note: ''};
}

export async function reviewFor(userId: string, wrestlerId: string): Promise<Review> {
  return await env.DB!.prepare('SELECT number,expires,status,note,reviewed_at FROM usaw_reviews WHERE user_id=? AND wrestler_id=?')
    .bind(userId, wrestlerId).first<NonNullable<Review>>() ?? null;
}

// The message a family sees when booking is refused, or null when the card covers every date.
export async function cardProblem(userId: string, w: CardWrestler, dates: string[]): Promise<string | null> {
  // The owner can allow bookings for set dates despite the card (issue #89).
  if (await exceptionFor(userId, w.id, 'usaw', dates)) return null;
  const last = [...dates].sort().at(-1)!;
  const s = cardStatus(w, await reviewFor(userId, w.id), last);
  const fix = 'Update it in your family account before booking.';
  if (s.state === 'missing') return `${w.name} needs a current USA Wrestling card on file to book. Add the card number and expiration date in your family account.`;
  if (s.state === 'invalid') return `The academy could not verify ${w.name}'s USA Wrestling card${s.note ? ` (${s.note})` : ''}. ${fix}`;
  if (s.state === 'expired') return dates.length > 1 || last !== dates[0]
    ? `${w.name}'s USA Wrestling card expires ${longDate(s.expires)}, before this session ends on ${longDate(last)}. ${fix}`
    : `${w.name}'s USA Wrestling card expired on ${longDate(s.expires)}. ${fix}`;
  return null;
}

export async function setReview(userId: string, wrestlerId: string, number: string, expires: string, status: 'valid' | 'invalid', note: string, ownerId: string) {
  const at = new Date().toISOString();
  await env.DB!.batch([
    env.DB!.prepare(`INSERT INTO usaw_reviews(user_id,wrestler_id,number,expires,status,note,reviewed_by,reviewed_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id,wrestler_id) DO UPDATE SET number=excluded.number,expires=excluded.expires,status=excluded.status,note=excluded.note,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at`)
      .bind(userId, wrestlerId, number, expires, status, note, ownerId, at),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'usaw_card_' + status, `${userId}/${wrestlerId}`, at)
  ]);
}

// Every wrestler in every family with card status on a date, for the owner's card review page.
export async function listCards(onDate: string) {
  const families = (await env.DB!.prepare('SELECT user_id,email,payload FROM family_accounts ORDER BY email LIMIT 2000').all<{user_id: string; email: string; payload: string}>()).results;
  const reviews = (await env.DB!.prepare('SELECT user_id,wrestler_id,number,expires,status,note,reviewed_at FROM usaw_reviews').all<NonNullable<Review> & {user_id: string; wrestler_id: string}>()).results;
  const byKey = new Map(reviews.map(r => [r.user_id + '/' + r.wrestler_id, r]));
  return families.flatMap(f => {
    const p = JSON.parse(f.payload || '{}');
    return (p.wrestlers || []).map((w: CardWrestler & {grade: string}) => {
      const review = byKey.get(f.user_id + '/' + w.id) ?? null, status = cardStatus(w, review, onDate);
      return {userId: f.user_id, email: f.email, parentName: p.parentName || '', phone: p.phone || '', wrestlerId: w.id, wrestler: w.name, grade: w.grade,
        ...status, reviewedAt: review && review.number === status.number && review.expires === status.expires ? review.reviewed_at : null};
    });
  });
}

export async function clearReview(userId: string, wrestlerId: string, ownerId: string) {
  const at = new Date().toISOString();
  await env.DB!.batch([
    env.DB!.prepare('DELETE FROM usaw_reviews WHERE user_id=? AND wrestler_id=?').bind(userId, wrestlerId),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'usaw_card_review_cleared', `${userId}/${wrestlerId}`, at)
  ]);
}
