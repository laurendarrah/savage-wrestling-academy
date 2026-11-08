// Wrestler view (issue #76): one wrestler's upcoming sessions, entry pass and anything that blocks booking,
// for a parent to open on a phone. Entitlement follows the roster's rules (lib/roster.ts), using this wrestler's
// own orders and scholarships, so a session listed here is one the wrestler will appear on the roster for.
import {env} from 'cloudflare:workers';
import {sessionsOn, academyState} from './roster';
import {familyPasses} from './passes';
import {cardStatus, reviewFor} from './usaw';
import {currentWaiver, signatureFor} from './waivers';
import {currentVersion} from './documents';
import {academyToday} from './public-schedule';
import {programOn} from './transfers';

// dueCents: booked to pay cash at the academy and not paid yet (issue #248); shown as "Pay at the academy: $40.00 due".
type Upcoming = {date: string; start: string | null; end: string | null; title: string; type: string; why: string; dueCents?: number};
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export async function upcomingFor(userId: string, wrestlerId: string, from: string, days = 21): Promise<Upcoming[]> {
  const to = addDays(from, days - 1);
  const orders = (await env.DB!.prepare("SELECT id,kind,program,item_id,dates,term_start,term_end,pricing FROM orders WHERE user_id=? AND wrestler_id=? AND status='paid'")
    .bind(userId, wrestlerId).all<any>()).results.map(o => ({...o, dates: JSON.parse(o.dates || '[]') as string[]}));
  const scholarships = (await env.DB!.prepare("SELECT program,accepted_at FROM scholarship_awards WHERE status='active' AND user_id=? AND wrestler_id=? AND accepted_at IS NOT NULL")
    .bind(userId, wrestlerId).all<{program: string; accepted_at: string}>()).results;
  const transfers = (await env.DB!.prepare('SELECT t.order_id,t.from_program,t.effective_date,t.created_at FROM membership_transfers t JOIN orders o ON o.id=t.order_id WHERE o.user_id=? AND o.wrestler_id=?')
    .bind(userId, wrestlerId).all<any>()).results;
  const cash = (await env.DB!.prepare("SELECT kind,program,item_id,session_date,amount_cents FROM cash_bookings WHERE user_id=? AND wrestler_id=? AND status='due' AND session_date>=? AND session_date<=?")
    .bind(userId, wrestlerId, from, to).all<{kind: string; program: string | null; item_id: string; session_date: string; amount_cents: number}>()).results;
  const nothing = !orders.length && !scholarships.length && !cash.length;
  const out: Upcoming[] = [];
  if (!nothing) {
    const state = await academyState();
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
        const owed = !why && cash.find(c => c.session_date === d && (s.type === 'practice' ? c.kind === 'walkin' && c.program === s.program : s.type === 'live' && c.kind === 'live' && c.item_id === s.key.split(':')[1]));
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

export async function wrestlerView(userId: string, wrestlerId: string) {
  const row = await env.DB!.prepare('SELECT payload FROM family_accounts WHERE user_id=?').bind(userId).first<{payload: string}>();
  const w = row ? (JSON.parse(row.payload).wrestlers || []).find((x: any) => x.id === wrestlerId) : null;
  if (!w) return null;
  const today = academyToday(), monthStart = today.slice(0, 8) + '01';
  const pass = (await familyPasses(userId)).find(p => p.wrestlerId === wrestlerId) ?? null;
  const waiver = await currentWaiver(), consent = await currentVersion('parent_consent');
  const attended = await env.DB!.prepare('SELECT count(*) AS n FROM attendance WHERE user_id=? AND wrestler_id=? AND session_date>=?').bind(userId, wrestlerId, monthStart).first<{n: number}>();
  return {
    id: w.id, name: w.name, grade: w.grade, pass: pass?.code ?? null,
    upcoming: await upcomingFor(userId, wrestlerId, today),
    card: cardStatus(w, await reviewFor(userId, wrestlerId), today),
    waiverNeeded: waiver ? !(await signatureFor(waiver.id, userId, wrestlerId, w.name)) : false,
    // The Parent Consent Form (issue #195), needed only once the owner publishes it.
    consentNeeded: consent ? !(await signatureFor(consent.id, userId, wrestlerId, w.name)) : false,
    checkInsThisMonth: attended?.n ?? 0
  };
}
