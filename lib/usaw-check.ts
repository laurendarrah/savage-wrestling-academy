// Automatic USA Wrestling card check (issue #202). Decides what a lookup on USA Wrestling's public verify page
// (lib/usaw-lookup.ts) means for one wrestler, records it, and verifies the card when it is safe to.
//
// - Active athlete membership, the name matches and the card's season is the current one: the card is verified, as a
//   usaw_reviews row with reviewed_by 'usaw-lookup'. It counts exactly like the owner's "Verified", is pinned to the
//   number and expiry like every review, so it stops applying when the family changes either.
// - Anything else never verifies. Not active, not found or someone else's name: the family is told. USA Wrestling
//   unavailable: nothing changes and the card waits for the owner's check, as before.
// - Booking rules are unchanged: an unverified card on file still books, and only the owner marks a card not valid.
// - A family's own check, and the check after they save, only run for a card that is on file and not yet checked by
//   the academy. After the owner rejects a card, changes wait for the owner (issue #97); the owner can run the check.
// - At most a few real lookups per family per hour, and one per card number and season per day (cached).
import {env} from 'cloudflare:workers';
import {cardSeason, cardStatus, reviewFor, LOOKUP_REVIEWER, type CardWrestler} from './usaw';
import {lookUpCard, lookupId, namesMatch, type LookupResult, type LookupStatus} from './usaw-lookup';
import {rateLimited} from './rate-limit';
import {academyToday} from './public-schedule';

export {LOOKUP_REVIEWER};
export type Outcome = 'verified' | 'inactive' | 'not_found' | 'mismatch' | 'season' | 'unavailable';
export type CheckTrigger = 'save' | 'family' | 'owner';
export type CheckResult = {outcome: Outcome; checkedAt: string; cached: boolean} | {outcome: 'limited' | 'skipped'; reason: string};
export type LookupRow = {number: string; expires: string; season: string; status: LookupStatus; outcome: Outcome; card_name: string | null; card_state: string | null; checked_at: string};

export const CACHE_HOURS = 24;
export const FAMILY_LOOKUPS_PER_HOUR = 5;
export const OWNER_LOOKUPS_PER_HOUR = 30;
export const ADDRESS_LOOKUPS_PER_HOUR = 40;
export const SITE_LOOKUPS_PER_HOUR = 120;

// What a lookup means for this wrestler's card.
export function outcomeFor(result: LookupResult, wrestlerName: string, expires: string, season: string): Outcome {
  if (result.status === 'unavailable') return 'unavailable';
  if (result.status === 'not_found') return 'not_found';
  if (!result.name || !namesMatch(wrestlerName, result.name)) return 'mismatch';
  if (result.status === 'inactive') return 'inactive';
  // USA Wrestling shows no date. An active card is good through August 31 of the current season, so it verifies
  // only the card the family entered for that season.
  return expires === season ? 'verified' : 'season';
}

// The cached answer for a card number and season, if one is less than a day old. 'unavailable' is never cached.
async function cached(number: string, season: string): Promise<LookupResult & {checked_at: string} | null> {
  const since = new Date(Date.now() - CACHE_HOURS * 3600e3).toISOString();
  const row = await env.DB!.prepare("SELECT status,card_name,card_state,checked_at FROM usaw_lookups WHERE number=? AND season=? AND status<>'unavailable' AND checked_at>=? ORDER BY checked_at DESC LIMIT 1")
    .bind(number, season, since).first<{status: LookupStatus; card_name: string | null; card_state: string | null; checked_at: string}>();
  return row ? {status: row.status, name: row.card_name ?? undefined, state: row.card_state ?? undefined, checked_at: row.checked_at} : null;
}

export async function checkCard(request: Request, input: {userId: string; wrestler: CardWrestler; trigger: CheckTrigger; actorId: string}, lookup = lookUpCard): Promise<CheckResult> {
  const {userId, wrestler: w, trigger, actorId} = input;
  const today = academyToday(), review = await reviewFor(userId, w.id), s = cardStatus(w, review, today);
  if (s.state === 'missing') return {outcome: 'skipped', reason: 'Add the card number and the card’s season first.'};
  if (s.state === 'expired') return {outcome: 'skipped', reason: 'This card has expired. Renew it, then choose the new season.'};
  if (trigger !== 'owner') {
    if (s.state === 'verified') return {outcome: 'skipped', reason: 'This card is already verified.'};
    if (s.state !== 'current') return {outcome: 'skipped', reason: 'The academy will check this card.'};
  }
  const season = cardSeason(today).end, number = lookupId(s.number);
  let result: LookupResult | null = await cached(number, season), fromCache = !!result;
  if (!result) {
    // Real lookups only: a family's own (checks and saves together), the owner's, every address, and the whole site.
    const who = trigger === 'owner' ? 'usaw-lookup:owner-' + actorId : 'usaw-lookup:' + userId;
    const limit = trigger === 'owner' ? OWNER_LOOKUPS_PER_HOUR : FAMILY_LOOKUPS_PER_HOUR;
    if (await rateLimited(request, who, limit, {windowMinutes: 60, ipLimit: ADDRESS_LOOKUPS_PER_HOUR}) ||
        await rateLimited(request, 'usaw-lookup-site:all', SITE_LOOKUPS_PER_HOUR, {windowMinutes: 60, ipLimit: null}))
      return {outcome: 'limited', reason: 'Several cards were checked in the last hour. Try again later; the academy can also check it.'};
    result = await lookup(number);
  }
  const outcome = outcomeFor(result, w.name, s.expires, season), at = new Date().toISOString();
  const checkedAt = fromCache && 'checked_at' in result ? String(result.checked_at) : at;
  const keepName = result.status === 'active' || result.status === 'inactive';
  const writes = [env.DB!.prepare(`INSERT INTO usaw_lookups(user_id,wrestler_id,number,expires,season,status,outcome,card_name,card_state,checked_at) VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,wrestler_id) DO UPDATE SET number=excluded.number,expires=excluded.expires,season=excluded.season,status=excluded.status,outcome=excluded.outcome,card_name=excluded.card_name,card_state=excluded.card_state,checked_at=excluded.checked_at`)
    .bind(userId, w.id, number, s.expires, season, result.status, outcome, keepName ? result.name ?? null : null, keepName ? result.state ?? null : null, checkedAt)];
  if (outcome === 'verified') {
    writes.push(env.DB!.prepare(`INSERT INTO usaw_reviews(user_id,wrestler_id,number,expires,status,note,reviewed_by,reviewed_at) VALUES (?,?,?,?,'valid','',?,?)
      ON CONFLICT(user_id,wrestler_id) DO UPDATE SET number=excluded.number,expires=excluded.expires,status=excluded.status,note=excluded.note,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at`)
      .bind(userId, w.id, s.number, s.expires, LOOKUP_REVIEWER, at));
    writes.push(env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), actorId, 'usaw_card_lookup_verified', `${userId}/${w.id}`, at));
  } else if (outcome !== 'unavailable') {
    // A newer answer that is not "active and matching" takes back an earlier automatic verification of this same card.
    // The owner's own review is never touched.
    writes.push(env.DB!.prepare("DELETE FROM usaw_reviews WHERE user_id=? AND wrestler_id=? AND reviewed_by=? AND number=? AND expires=?").bind(userId, w.id, LOOKUP_REVIEWER, s.number, s.expires));
  }
  await env.DB!.batch(writes);
  return {outcome, checkedAt, cached: fromCache};
}

// The latest lookup for a wrestler, only while it is still about the card on file.
export function lookupView(w: CardWrestler, row: LookupRow | null | undefined) {
  if (!row || row.number !== lookupId(w.usawNumber || '') || row.expires !== (w.usawExpires || '')) return null;
  return row;
}

export async function lookupsFor(userId: string): Promise<Map<string, LookupRow>> {
  const rows = (await env.DB!.prepare('SELECT wrestler_id,number,expires,season,status,outcome,card_name,card_state,checked_at FROM usaw_lookups WHERE user_id=?').bind(userId).all<LookupRow & {wrestler_id: string}>()).results;
  return new Map(rows.map(r => [r.wrestler_id, r]));
}

// The family's view of the latest lookup: what happened and when, never the name on someone else's card.
export const familyLookup = (row: LookupRow | null) => row ? {outcome: row.outcome, checkedAt: row.checked_at} : null;

// Retention (issue #274): a lookup that found someone else's card ('mismatch') holds a stranger's name, and one that
// found no card ('not_found') says nothing useful once its one-day cache window has passed. The daily job removes
// both after CACHE_HOURS; verified, inactive and season answers stay as the record of the check.
export async function purgeStaleLookups(now = new Date()) {
  const before = new Date(now.getTime() - CACHE_HOURS * 3600e3).toISOString();
  const r = await env.DB!.prepare("DELETE FROM usaw_lookups WHERE outcome IN ('mismatch','not_found') AND checked_at<?").bind(before).run();
  return Number(r.meta?.changes ?? (r as any).changes ?? 0);
}

// Checks the wrestlers whose card number or season changed in a family save. Never fails the save.
export async function checkChangedCards(request: Request, userId: string, before: {wrestlers?: CardWrestler[]} | null, after: {wrestlers: CardWrestler[]}) {
  const old = new Map((before?.wrestlers || []).map(w => [w.id, lookupId(w.usawNumber || '') + '|' + (w.usawExpires || '')]));
  const changed = after.wrestlers.filter(w => w.usawNumber && old.get(w.id) !== lookupId(w.usawNumber) + '|' + (w.usawExpires || '')).slice(0, 3);
  const out: Record<string, string> = {};
  await Promise.all(changed.map(async w => {
    // A card with nothing to check (no season chosen, expired, or waiting for the academy) is left out.
    try { const r = await checkCard(request, {userId, wrestler: w, trigger: 'save', actorId: userId}); if (r.outcome !== 'skipped') out[w.id] = r.outcome; }
    catch { out[w.id] = 'unavailable'; }
  }));
  return out;
}
