// Wrestler view (issue #76): one wrestler's upcoming sessions, entry pass and anything that blocks booking,
// for a parent to open on a phone. Entitlement follows the roster's rules (lib/roster.ts), using this wrestler's
// own orders and scholarships, so a session listed here is one the wrestler will appear on the roster for.
// Everything is read in one D1 batch (issue #274; it used to be up to 18 queries in a row).
import {env} from 'cloudflare:workers';
import {sessionsOn} from './roster';
import {familyPasses, PASS_PREFIX} from './passes';
import {cardStatus, type Review} from './usaw';
import {LIVE_SIGNATURE, SIGNATURE_JOIN, CARRIED_NAME, signatureCounts, type DocumentVersion} from './documents';
import {academyToday} from './public-schedule';
import {programOn} from './transfers';

// dueCents: booked to pay cash at the academy and not paid yet (issue #248); shown as "Pay at the academy: $40.00 due".
type Upcoming = {date: string; start: string | null; end: string | null; title: string; type: string; why: string; dueCents?: number};
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

type CashDue = {kind: string; program: string | null; item_id: string; session_date: string; amount_cents: number; dates: string; days: string[]};
type Reads = {orders: any[]; scholarships: {program: string; accepted_at: string}[]; transfers: any[]; cash: CashDue[]; state: any};
// The wrestler's unpaid cash bookings touching the window. A camp booked to pay cash covers each of its days (#273), so a
// booking whose first day has passed can still be due; `days` is that list (older rows carry only the session date).
const cashDueSql = () => env.DB!.prepare("SELECT kind,program,item_id,session_date,amount_cents,dates FROM cash_bookings WHERE user_id=? AND wrestler_id=? AND status='due' AND session_date<=? AND (session_date>=? OR EXISTS (SELECT 1 FROM json_each(cash_bookings.dates) WHERE value>=?))");
const cashDueRows = (rows: unknown[]): CashDue[] => (rows as any[]).map(c => { let days: string[] = []; try { days = JSON.parse(c.dates || '[]'); } catch {} return {...c, days: days.length ? days : [c.session_date]}; });
// The wrestler's orders, scholarships, transfers, cash bookings and the academy's schedule, in one batch.
async function readUpcoming(userId: string, wrestlerId: string, from: string, to: string): Promise<Reads> {
  const [orders, scholarships, transfers, cash, state] = await env.DB!.batch([
    env.DB!.prepare("SELECT id,kind,program,item_id,dates,term_start,term_end,pricing FROM orders WHERE user_id=? AND wrestler_id=? AND status='paid'").bind(userId, wrestlerId),
    env.DB!.prepare("SELECT program,accepted_at FROM scholarship_awards WHERE status='active' AND user_id=? AND wrestler_id=? AND accepted_at IS NOT NULL").bind(userId, wrestlerId),
    env.DB!.prepare('SELECT t.order_id,t.from_program,t.effective_date,t.created_at FROM membership_transfers t JOIN orders o ON o.id=t.order_id WHERE o.user_id=? AND o.wrestler_id=?').bind(userId, wrestlerId),
    cashDueSql().bind(userId, wrestlerId, to, from, from),
    env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'"),
  ]);
  const row = (state.results as {payload: string}[])[0];
  return {orders: (orders.results as any[]).map(o => ({...o, dates: JSON.parse(o.dates || '[]') as string[]})), scholarships: scholarships.results as Reads['scholarships'],
    transfers: transfers.results as any[], state: row ? JSON.parse(row.payload) : {}, cash: cashDueRows(cash.results)};
}

export function upcomingFrom(r: Reads, from: string, to: string): Upcoming[] {
  const {orders, scholarships, transfers, cash, state} = r;
  const out: Upcoming[] = [];
  if (orders.length || scholarships.length || cash.length) {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      for (const s of sessionsOn(state, d)) {
        let why = '';
        if (s.type === 'practice') {
          if (orders.some(o => (o.kind === 'annual' || o.kind === 'monthly') && programOn(o, transfers, d) === s.program && o.term_start <= d && o.term_end >= d)) why = 'Membership';
          // By program and date, as the roster does (issue #272): a moved practice time keeps the walk-in.
          else if (orders.some(o => o.kind === 'walkin' && o.program === s.program && o.dates.includes(d))) why = 'Walk-in';
          else if (scholarships.some(a => a.program === s.program && a.accepted_at.slice(0, 10) <= d)) why = 'Scholarship';
        } else {
          const id = s.key.split(':')[1];
          if (orders.some(o => o.kind === s.type && o.item_id === id && o.dates.includes(d))) why = s.type === 'live' ? 'Paid' : 'Registered';
        }
        const owed = !why && cash.find(c => c.days.includes(d) && (s.type === 'practice' ? c.kind === 'walkin' && c.program === s.program : c.kind === s.type && c.item_id === s.key.split(':')[1]));
        if (owed) out.push({date: d, start: s.start, end: s.end, title: s.title, type: s.type, why: 'Pay at the academy', dueCents: owed.amount_cents});
        else if (why) out.push({date: d, start: s.start, end: s.end, title: s.title, type: s.type, why});
      }
    }
  }
  for (const o of orders.filter(o => o.kind === 'lesson' && o.dates[0] >= from && o.dates[0] <= to)) {
    const p = JSON.parse(o.pricing || '{}');
    out.push({date: o.dates[0], start: p.start ?? null, end: p.end ?? null, title: `${p.formatName ?? 'Private lesson'} with ${p.coachName ?? 'a coach'}`, type: 'lesson', why: 'Paid'});
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '99').localeCompare(b.start ?? '99'));
}

export async function upcomingFor(userId: string, wrestlerId: string, from: string, days = 21): Promise<Upcoming[]> {
  const to = addDays(from, days - 1);
  return upcomingFrom(await readUpcoming(userId, wrestlerId, from, to), from, to);
}

export async function wrestlerView(userId: string, wrestlerId: string) {
  const today = academyToday(), monthStart = today.slice(0, 8) + '01', to = addDays(today, 20);
  // First batch: the family record, this wrestler's card review and check-ins, the documents in force and their
  // signatures for this wrestler (judged below with lib/documents.ts's rule), and the upcoming reads.
  const [family, review, attended, versions, signatures, orders, scholarships, transfers, cash, state, passRow] = await env.DB!.batch([
    env.DB!.prepare('SELECT payload FROM family_accounts WHERE user_id=?').bind(userId),
    env.DB!.prepare('SELECT number,expires,status,note,reviewed_at,reviewed_by FROM usaw_reviews WHERE user_id=? AND wrestler_id=?').bind(userId, wrestlerId),
    env.DB!.prepare('SELECT count(*) AS n FROM attendance WHERE user_id=? AND wrestler_id=? AND session_date>=?').bind(userId, wrestlerId, monthStart),
    env.DB!.prepare("SELECT * FROM waiver_versions v WHERE kind IN ('waiver','parent_consent') AND published_at=(SELECT max(published_at) FROM waiver_versions w WHERE w.kind=v.kind) ORDER BY kind, id DESC"),
    env.DB!.prepare(`SELECT s.id,s.version_id,s.signer,s.signed_at,s.wrestler_id,s.wrestler_name,${CARRIED_NAME} FROM waiver_signatures s ${SIGNATURE_JOIN} WHERE s.user_id=? AND s.wrestler_id=? AND ${LIVE_SIGNATURE} ORDER BY s.signed_at DESC`).bind(userId, wrestlerId),
    env.DB!.prepare("SELECT id,kind,program,item_id,dates,term_start,term_end,pricing FROM orders WHERE user_id=? AND wrestler_id=? AND status='paid'").bind(userId, wrestlerId),
    env.DB!.prepare("SELECT program,accepted_at FROM scholarship_awards WHERE status='active' AND user_id=? AND wrestler_id=? AND accepted_at IS NOT NULL").bind(userId, wrestlerId),
    env.DB!.prepare('SELECT t.order_id,t.from_program,t.effective_date,t.created_at FROM membership_transfers t JOIN orders o ON o.id=t.order_id WHERE o.user_id=? AND o.wrestler_id=?').bind(userId, wrestlerId),
    cashDueSql().bind(userId, wrestlerId, to, today, today),
    env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'"),
    env.DB!.prepare('SELECT token FROM wrestler_passes WHERE user_id=? AND wrestler_id=? AND revoked_at IS NULL').bind(userId, wrestlerId),
  ]);
  const row = (family.results as {payload: string}[])[0];
  const kids = row ? JSON.parse(row.payload).wrestlers || [] : [], w = kids.find((x: any) => x.id === wrestlerId);
  if (!w) return null;
  // The latest version of each kind, as currentVersion() in lib/documents.ts: in force unless retired.
  const current = (kind: string) => { const v = (versions.results as DocumentVersion[]).find(x => x.kind === kind); return v && !v.retired_at ? v : null; };
  const waiver = current('waiver'), consent = current('parent_consent');
  // A signature counts for this wrestler by id and name, or by a name the owner carried it over to (#278), exactly as
  // signatureFor() in lib/documents.ts decides.
  const signed = (v: DocumentVersion | null) => !!v && (signatures.results as any[]).some(s => s.version_id === v.id && signatureCounts(s, {id: wrestlerId, name: w.name}, kids));
  const stateRow = (state.results as {payload: string}[])[0];
  const reads: Reads = {orders: (orders.results as any[]).map(o => ({...o, dates: JSON.parse(o.dates || '[]') as string[]})), scholarships: scholarships.results as Reads['scholarships'],
    transfers: transfers.results as any[], cash: cashDueRows(cash.results), state: stateRow ? JSON.parse(stateRow.payload) : {}};
  // The entry pass: read with the rest; only a wrestler with no pass yet goes through familyPasses(), which makes one.
  const token = (passRow.results as {token: string}[])[0]?.token;
  const pass = token ? PASS_PREFIX + token : (await familyPasses(userId)).find(p => p.wrestlerId === wrestlerId)?.code ?? null;
  return {
    id: w.id, name: w.name, grade: w.grade, pass,
    upcoming: upcomingFrom(reads, today, to),
    card: cardStatus(w, ((review.results as NonNullable<Review>[])[0] ?? null), today),
    waiverNeeded: waiver ? !signed(waiver) : false,
    // The Parent Consent Form (issue #195), needed only once the owner publishes it.
    consentNeeded: consent ? !signed(consent) : false,
    checkInsThisMonth: Number((attended.results as {n: number}[])[0]?.n ?? 0)
  };
}
