// USA Wrestling card rules (issue #68, decision #67): a wrestler cannot book anything unless a USA Wrestling card
// on file is valid on every session date. A missing card is treated like an expired one. The owner can mark a card
// not valid after checking it; that review applies only while the number and expiration still match.
import {env} from 'cloudflare:workers';
import {USAW_NUMBER} from './family-records';
import {exceptionFor} from './exceptions';
import {fullDate} from './datetime';

export type CardWrestler = {id: string; name: string; usawNumber?: string; usawExpires?: string};
export type Review = {number: string; expires: string; status: 'valid' | 'invalid'; note: string; reviewed_at: string; reviewed_by?: string} | null;
export type CardStatus = {state: 'missing' | 'expired' | 'invalid' | 'recheck' | 'current' | 'verified'; number: string; expires: string; note: string};

const longDate = fullDate;
// reviewed_by on a verification made by the automatic USA Wrestling lookup (issue #202, lib/usaw-check.ts).
export const LOOKUP_REVIEWER = 'usaw-lookup';
// Who verified or rejected a card on file: the USA Wrestling lookup or the owner. Null when no review applies.
export const reviewSource = (review: Review, s: CardStatus) =>
  review && review.number === s.number && review.expires === s.expires && (s.state === 'verified' || s.state === 'invalid')
    ? {verifiedBy: review.reviewed_by === LOOKUP_REVIEWER ? 'usaw-lookup' as const : 'owner' as const, verifiedAt: review.reviewed_at} : {verifiedBy: null, verifiedAt: null};

// USA Wrestling membership seasons (issue #131). The membership year runs September 1 to August 31, and every card
// expires on August 31 of its membership year, whatever month it was bought. New-season cards usually open in
// mid-August, so from August 1 a family can also choose the next season.
export type CardSeason = {start: string; end: string; label: string};

// "2027-08-31" -> "2026–27 season".
export function seasonLabel(end: string): string {
  const y = Number(end.slice(0, 4));
  return `${y - 1}–${String(y).slice(-2)} season`;
}

// The season a date falls in: September or later belongs to the season ending next August 31.
export function cardSeason(onDate: string): CardSeason {
  const y = Number(onDate.slice(0, 4)), m = Number(onDate.slice(5, 7)), endYear = m >= 9 ? y + 1 : y;
  const end = `${endYear}-08-31`;
  return {start: `${endYear - 1}-09-01`, end, label: seasonLabel(end)};
}

export const isSeasonEnd = (date: string | undefined | null) => typeof date === 'string' && /^\d{4}-08-31$/.test(date);

// The seasons a family can choose on a date: the current one, plus the next one from August 1 on.
export function seasonOptions(today: string): {expires: string; label: string}[] {
  const now = cardSeason(today), list = [{expires: now.end, label: now.label}];
  if (today.slice(5, 7) === '08') { const next = cardSeason(`${Number(now.end.slice(0, 4))}-09-01`); list.push({expires: next.end, label: next.label}); }
  return list;
}

// A card joins the owner's renewal list, and the family gets its "card expires soon" reminder, this many days before
// it expires (decision Q13 in #197, issue #210). The cards page, the family page and the daily reminders all use it.
export const CARD_RENEWAL_DAYS = 30;
// The last day of the renewal window that starts today: a card expiring on or before it is due for renewal.
export const renewalDue = (today: string) => new Date(Date.parse(today + 'T12:00:00Z') + CARD_RENEWAL_DAYS * 86400000).toISOString().slice(0, 10);

// Summary for the owner's cards page. Inside the renewal window before August 31 (from August 1 with 30 days): how many
// cards still end this August 31, so the wrestler has not renewed for the new season yet. The rest of the year: how
// many cards end with the current season. `august` keeps its name for the page; it means the window is open.
export function cardRenewal(cards: {number?: string; expires?: string}[], today: string) {
  const season = cardSeason(today), august = renewalDue(today) >= season.end;
  const count = cards.filter(c => c.number && c.expires === season.end).length;
  const next = cardSeason(`${season.end.slice(0, 4)}-09-01`);
  return {august, ends: season.end, count,
    label: august ? `Not yet renewed for ${next.label.replace(' season', '')}` : `Cards expire ${longDate(season.end)}`};
}

export function cardStatus(w: CardWrestler, review: Review, onDate: string): CardStatus {
  const number = (w.usawNumber || '').trim().toUpperCase(), expires = w.usawExpires || '';
  if (!number || !USAW_NUMBER.test(number) || !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return {state: 'missing', number, expires, note: ''};
  const same = (a: string, b: string) => a.replace(/[\s-]/g, '') === b.replace(/[\s-]/g, '');
  const matches = !!review && same(review.number, number) && review.expires === expires;
  if (matches && review!.status === 'invalid') return {state: 'invalid', number, expires, note: review!.note};
  // After the academy rejects a card, any change waits for the academy to check it again (issue #97).
  if (review && review.status === 'invalid') return {state: 'recheck', number, expires, note: review.note};
  if (expires < onDate) return {state: 'expired', number, expires, note: ''};
  return {state: matches && review!.status === 'valid' ? 'verified' : 'current', number, expires, note: ''};
}

export async function reviewFor(userId: string, wrestlerId: string): Promise<Review> {
  return await env.DB!.prepare('SELECT number,expires,status,note,reviewed_at,reviewed_by FROM usaw_reviews WHERE user_id=? AND wrestler_id=?')
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
  if (s.state === 'recheck') return `${w.name}'s updated USA Wrestling card is waiting for the academy to check it. Booking opens once it is verified.`;
  if (s.state === 'expired') return dates.length > 1 || last !== dates[0]
    ? `${w.name}'s USA Wrestling card expires ${longDate(s.expires)}, before this session ends on ${longDate(last)}. ${fix}`
    : `${w.name}'s USA Wrestling card expired on ${longDate(s.expires)}. ${fix}`;
  return null;
}

// One answer to "is this wrestler's card verified on this date, and how" (issue #202), for pages and for later rules
// such as a check-in rule. verified is true only for the card on file, current on that date, verified by the owner or
// by the USA Wrestling lookup (verifiedBy 'owner' or 'usaw-lookup'). A missing, expired, rejected or changed card is
// never verified. For many wrestlers at once, load reviews in one query and use cardStatus(...).state === 'verified'.
export async function cardVerification(userId: string, w: CardWrestler, onDate: string) {
  const review = await reviewFor(userId, w.id), status = cardStatus(w, review, onDate);
  return {...status, verified: status.state === 'verified', ...reviewSource(review, status)};
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
  const reviews = (await env.DB!.prepare('SELECT user_id,wrestler_id,number,expires,status,note,reviewed_at,reviewed_by FROM usaw_reviews').all<NonNullable<Review> & {user_id: string; wrestler_id: string}>()).results;
  const byKey = new Map(reviews.map(r => [r.user_id + '/' + r.wrestler_id, r]));
  // The latest automatic check on USA Wrestling (issue #202), shown to the owner while it is about the card on file.
  type Lookup = {user_id: string; wrestler_id: string; number: string; expires: string; status: string; outcome: string; card_name: string | null; card_state: string | null; checked_at: string};
  const lookups = new Map((await env.DB!.prepare('SELECT user_id,wrestler_id,number,expires,status,outcome,card_name,card_state,checked_at FROM usaw_lookups').all<Lookup>()).results
    .map(r => [r.user_id + '/' + r.wrestler_id, r]));
  return families.flatMap(f => {
    const p = JSON.parse(f.payload || '{}');
    return (p.wrestlers || []).map((w: CardWrestler & {grade: string}) => {
      const review = byKey.get(f.user_id + '/' + w.id) ?? null, status = cardStatus(w, review, onDate), l = lookups.get(f.user_id + '/' + w.id);
      const lookup = l && l.number === status.number.replace(/[\s-]/g, '') && l.expires === status.expires
        ? {status: l.status, outcome: l.outcome, name: l.card_name, state: l.card_state, checkedAt: l.checked_at} : null;
      return {userId: f.user_id, email: f.email, parentName: p.parentName || '', phone: p.phone || '', wrestlerId: w.id, wrestler: w.name, grade: w.grade,
        ...status, reviewedAt: review && review.number === status.number && review.expires === status.expires ? review.reviewed_at : null,
        ...reviewSource(review, status), lookup};
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
