// Pay cash at the academy (issue #248, decided by Lauren on November 7). A family booking a walk-in or an extra practice
// (Friday Night Live and the like, added to the decision the same day) can choose to pay cash at the academy instead of
// paying online. The booking uses exactly the same checks and price as online checkout (lib/quotes.ts); the amount due is
// worked out on the server when the booking is made and never comes from the browser.
//
// - A booking is 'due' until the coach or the owner taps Cash received. That writes an ordinary offline payment to orders
//   (source 'offline', method cash, the same row lib/offline-payments.ts writes) and links it here, so it counts as paid
//   everywhere orders are read: rosters, the family page, Payments and its spreadsheet, and Income and expenses. The
//   booking itself is never counted as money.
// - The unique index on dedupe_key (shared with orders' own) allows one open booking per wrestler, session and date, and
//   the order insert reuses the order dedupe key, so cash is recorded once and can't sit beside an online payment.
// - Voiding that payment on Payments (owner only, lib/offline-payments.ts) puts the booking back to 'due'.
// - The family can cancel before the session starts; the owner can cancel any unpaid booking, and the family is told.
// - No no-show fees and no blocking repeat no-shows: not decided (#248).
import {env} from 'cloudflare:workers';
import {quoteMembership, quoteBooking} from './quotes';
import {academyToday} from './public-schedule';
import {academyMinutes} from './lessons';
import {notify, noticePaymentRecorded, quietly} from './notify';
import {dayTime, academyDayStart} from './datetime';
import {academyState, sessionsOn, canSee, cashKey, type Scope} from './roster';
import {collectorNameSql, type Collector} from './collectors';
export type {Collector} from './collectors';

export const CASH_KINDS = ['walkin', 'live'] as const;
export type CashKind = typeof CASH_KINDS[number];
export type CashRow = {
  id: string; user_id: string; email: string; wrestler_id: string; wrestler_name: string; kind: CashKind; program: string | null; item_id: string; item_label: string;
  session_date: string; start_time: string | null; end_time: string | null; base_cents: number; discount_cents: number; amount_cents: number; pricing: string;
  dedupe_key: string; status: 'due' | 'paid' | 'canceled'; order_id: string | null; created_at: string; updated_at: string;
  canceled_at: string | null; canceled_by: string | null; cancel_reason: string | null;
};
type Result = {status: number; error?: string; extra?: Record<string, unknown>; [k: string]: unknown};

const now = () => new Date().toISOString();
export const dollars = (c: number) => '$' + (c / 100).toFixed(2);
const toMinutes = (t: string | null) => { const m = /^(\d{2}):(\d{2})$/.exec(t ?? ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
const changes = (r: any) => Number(r?.meta?.changes ?? r?.changes ?? 0);

// A family may cancel until the session starts (New York time).
export function beforeStart(b: Pick<CashRow, 'session_date' | 'start_time'>, today = academyToday(), minutes = academyMinutes()) {
  return b.session_date > today || (b.session_date === today && toMinutes(b.start_time) > minutes);
}

// What a family, a coach or the owner is shown for a booking. "Pay at the academy: $40.00 due" is the family's wording.
export function cashView(b: CashRow, today = academyToday(), minutes = academyMinutes()) {
  return {id: b.id, kind: b.kind, program: b.program, itemId: b.item_id, item: b.item_label, date: b.session_date, start: b.start_time, end: b.end_time,
    wrestlerId: b.wrestler_id, wrestler: b.wrestler_name, amountCents: b.amount_cents, status: b.status, orderId: b.order_id,
    label: b.status === 'due' ? `Pay at the academy: ${dollars(b.amount_cents)} due` : b.status === 'paid' ? 'Paid at the academy' : 'Canceled',
    cancellable: b.status === 'due' && beforeStart(b, today, minutes), past: b.session_date < today};
}

// Book a walk-in (source 'membership', plan 'walkin', from /register) or an extra practice (source 'booking', type
// 'live', from /book) to pay cash at the academy. Every booking check runs in lib/quotes.ts, as for online checkout.
export async function bookCash(user: {id: string; email: string}, input: any): Promise<Result> {
  if (!input || typeof input !== 'object') return {status: 400, error: 'Choose a walk-in or an extra practice.'};
  // Only the fields the quote needs are passed on. Team codes are for monthly memberships only, so none is sent.
  const quote = input.source === 'membership' && input.plan === 'walkin'
    ? await quoteMembership(user.id, {wrestlerId: input.wrestlerId, program: input.program, plan: 'walkin', date: input.date, practiceId: input.practiceId})
    : input.source === 'booking' && input.type === 'live'
      ? await quoteBooking(user.id, {type: 'live', wrestlerId: input.wrestlerId, id: input.id, date: input.date})
      : null;
  if (!quote) return {status: 400, error: 'Paying cash at the academy is for walk-ins and extra practices.'};
  if (!quote.ok) return {status: quote.status, error: quote.error, extra: quote.extra};
  const charge = quote.charge;
  if (!charge || !(CASH_KINDS as readonly string[]).includes(charge.kind) || charge.dates.length !== 1)
    return {status: 409, error: 'This has no price set yet, so it can’t be booked here. Contact the academy.'};
  const r: any = quote.review, slot = charge.kind === 'walkin' ? r.practice : r;
  const id = crypto.randomUUID(), at = now(), date = charge.dates[0];
  const family = await env.DB!.prepare('SELECT email FROM family_accounts WHERE user_id=?').bind(user.id).first<{email: string}>();
  const email = family?.email || user.email;
  let inserted;
  try {
    inserted = await env.DB!.prepare(`INSERT INTO cash_bookings(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,session_date,start_time,end_time,base_cents,discount_cents,amount_cents,pricing,dedupe_key,status,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'due',?,? WHERE NOT EXISTS (SELECT 1 FROM orders WHERE dedupe_key=? AND status IN ('pending','paid'))`)
      .bind(id, user.id, email, quote.wrestler.id, quote.wrestler.name, charge.kind, charge.program, charge.itemId, charge.itemLabel, date,
        slot?.start ?? null, slot?.end ?? null, charge.baseCents, charge.discountCents, charge.amountCents, JSON.stringify(charge.pricing), charge.dedupeKey, at, at, charge.dedupeKey).run();
  } catch {
    return {status: 409, error: `${quote.wrestler.name} is already booked for this to pay at the academy. See your family account.`};
  }
  if (!changes(inserted)) return {status: 409, error: 'This is already paid, or an online payment for it was started. Check your family account.'};
  const b = (await env.DB!.prepare('SELECT * FROM cash_bookings WHERE id=?').bind(id).first<CashRow>())!;
  await quietly(() => notify([{userId: user.id, email, kind: 'cash_booking', dedupeKey: `cash-booked:${id}`, link: '/family#purchaseHistory',
    subject: `Booked: ${b.item_label}`,
    body: `${b.wrestler_name} is booked for ${b.item_label}, ${dayTime(b.session_date, b.start_time)}. Pay at the academy: ${dollars(b.amount_cents)} due, in cash at the practice. To cancel, use your family account before the practice starts.`}]));
  return {status: 200, booking: cashView(b)};
}

// The family's unpaid bookings, soonest first.
export async function familyCashBookings(userId: string) {
  const rows = (await env.DB!.prepare("SELECT * FROM cash_bookings WHERE user_id=? AND status='due' ORDER BY session_date,start_time,id").bind(userId).all<CashRow>()).results;
  const today = academyToday(), minutes = academyMinutes();
  return rows.map(b => cashView(b, today, minutes));
}

// An open booking for the same wrestler, session and date (online checkout refuses to start while one is due).
export async function cashBookingDue(dedupeKey: string) {
  return !!(await env.DB!.prepare("SELECT 1 FROM cash_bookings WHERE dedupe_key=? AND status='due'").bind(dedupeKey).first());
}

export async function cancelByFamily(userId: string, bookingId: unknown): Promise<Result> {
  if (typeof bookingId !== 'string') return {status: 400, error: 'Choose a booking.'};
  const b = await env.DB!.prepare('SELECT * FROM cash_bookings WHERE id=? AND user_id=?').bind(bookingId, userId).first<CashRow>();
  if (!b) return {status: 404, error: 'Booking not found.'};
  if (b.status === 'paid') return {status: 409, error: 'This is already paid. Ask the academy if you need a refund.'};
  if (b.status === 'canceled') return {status: 409, error: 'This booking is already canceled.'};
  if (!beforeStart(b)) return {status: 409, error: 'This practice has already started, so it can’t be canceled here. Contact the academy.'};
  const at = now();
  const r = await env.DB!.prepare("UPDATE cash_bookings SET status='canceled',canceled_at=?,canceled_by=?,cancel_reason='Canceled by the family',updated_at=? WHERE id=? AND status='due'")
    .bind(at, userId, at, b.id).run();
  return changes(r) ? {status: 200} : {status: 409, error: 'This booking changed. Refresh the page.'};
}

// The owner cancels an unpaid booking: nothing is charged, the spot is freed and the family gets a notice.
export async function cancelByOwner(ownerId: string, bookingId: unknown, reason: unknown): Promise<Result> {
  if (typeof bookingId !== 'string') return {status: 400, error: 'Choose a booking.'};
  const b = await env.DB!.prepare('SELECT * FROM cash_bookings WHERE id=?').bind(bookingId).first<CashRow>();
  if (!b) return {status: 404, error: 'Booking not found.'};
  if (b.status !== 'due') return {status: 409, error: b.status === 'paid' ? 'Cash for this booking is already recorded. To undo it, void the payment.' : 'This booking is already canceled.'};
  const at = now(), why = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
  const r = await env.DB!.prepare("UPDATE cash_bookings SET status='canceled',canceled_at=?,canceled_by=?,cancel_reason=?,updated_at=? WHERE id=? AND status='due'")
    .bind(at, ownerId, why || 'Canceled by the academy', at, b.id).run();
  if (!changes(r)) return {status: 409, error: 'This booking changed. Refresh the page.'};
  await env.DB!.prepare("INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,'cash_booking_canceled',?,?)").bind(crypto.randomUUID(), ownerId, b.id, at).run();
  await quietly(() => notify([{userId: b.user_id, email: b.email, kind: 'cash_booking_canceled', dedupeKey: `cash-canceled:${b.id}`, link: '/family#purchaseHistory',
    subject: `Booking canceled: ${b.item_label}`,
    body: `The academy canceled ${b.wrestler_name}'s booking for ${b.item_label}, ${dayTime(b.session_date, b.start_time)}. Nothing was charged and nothing is owed.${why ? ` Note from the academy: ${why}` : ''}`}]));
  return {status: 200};
}

// Cash received at the door. Coaches: today's practices in their own programs and today's extra practices (Friday Night
// Live and the like, issue #250), exactly the sessions their check-in list shows (canSee in lib/roster.ts). The owner: any
// booking. The payment is written from the booking row itself, so its amount is the one the server worked out at
// booking. The order, the link and the security log entry are one transaction, and the order dedupe key makes a second
// tap, a second device or an earlier payment for the same session fail instead of counting twice. Who collected it is
// kept on the payment (lib/collectors.ts).
export async function receiveCash(bookingId: unknown, by: Collector, scope: Scope, today = academyToday()): Promise<Result> {
  if (typeof bookingId !== 'string') return {status: 400, error: 'Choose a booking.'};
  const b = await env.DB!.prepare('SELECT * FROM cash_bookings WHERE id=?').bind(bookingId).first<CashRow>();
  if (!b) return {status: 404, error: 'Booking not found.'};
  if (scope.role === 'coach' && !(b.session_date === today && await coachSees(b, scope, today)))
    return {status: 403, error: 'Coaches record cash for today’s practices in their own programs and today’s extra practices. Ask the owner to record this one.'};
  if (b.status === 'paid') return {status: 409, error: 'Cash for this booking is already recorded.'};
  if (b.status === 'canceled') return {status: 409, error: 'This booking was canceled, so there is nothing to collect.'};
  const id = crypto.randomUUID(), at = now();
  const pricing = {...JSON.parse(b.pricing || '{}'), method: 'cash', note: 'Paid at the academy', recordedBy: by.id, collectedBy: by.name, collectedByEmail: by.email, collectedAt: at,
    listedCents: b.amount_cents, cashBookingId: b.id};
  let res;
  try {
    res = await env.DB!.batch([
      env.DB!.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
        SELECT ?,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,json_array(session_date),base_cents,discount_cents,amount_cents,'usd',?,?,'paid',dedupe_key,0,?,?,?,NULL,NULL,'offline'
        FROM cash_bookings WHERE id=? AND status='due'`)
        .bind(id, JSON.stringify(pricing), JSON.stringify({offline: true, cashBooking: b.id, recordedBy: by.id, at}), at, at, at, b.id),
      env.DB!.prepare("UPDATE cash_bookings SET status='paid',order_id=?,updated_at=? WHERE id=? AND status='due' AND EXISTS (SELECT 1 FROM orders WHERE id=?)").bind(id, at, b.id, id),
      env.DB!.prepare("INSERT INTO security_events(id,actor,action,target,created_at) SELECT ?,?,'cash_received',?,? WHERE EXISTS (SELECT 1 FROM orders WHERE id=?)")
        .bind(crypto.randomUUID(), by.id, `${id} ${b.kind} ${b.amount_cents}`, at, id)
    ]);
  } catch {
    return {status: 409, error: `${b.wrestler_name} already has a payment for this session. Nothing was recorded. Check Payments.`};
  }
  if (!changes(res[0])) return {status: 409, error: 'Cash for this booking is already recorded.'};
  await quietly(() => noticePaymentRecorded(id));
  return {status: 200, orderId: id};
}

// A session on the coach's check-in list today (canSee) is the one this booking is for.
async function coachSees(b: CashRow, scope: Scope, today: string) {
  return sessionsOn(await academyState(), today).some(s => canSee(scope, s) && cashKey(s) === `${b.kind}|${b.item_id}`);
}

// Unpaid bookings for the owner to follow up or cancel: earlier sessions first, then today and later. With them, the
// bookings collected in the last RECENT_DAYS days, newest first, each with who collected it and when (issue #250).
export const RECENT_DAYS = 14;
export async function unpaidCashBookings(limit = 500, today = academyToday()) {
  const rows = (await env.DB!.prepare(`SELECT b.*,f.payload AS family FROM cash_bookings b LEFT JOIN family_accounts f ON f.user_id=b.user_id
    WHERE b.status='due' ORDER BY b.session_date,b.start_time,b.id LIMIT ?`).bind(limit + 1).all<CashRow & {family: string | null}>()).results;
  const minutes = academyMinutes();
  const total = await env.DB!.prepare("SELECT count(*) AS n,COALESCE(sum(amount_cents),0) AS cents FROM cash_bookings WHERE status='due'").first<{n: number; cents: number}>();
  return {more: rows.length > limit, count: Number(total?.n ?? 0), dueCents: Number(total?.cents ?? 0), bookings: rows.slice(0, limit).map(b => {
    let f: any = {}; try { f = b.family ? JSON.parse(b.family) : {}; } catch { /* shown without the parent's details */ }
    return {...cashView(b, today, minutes), parent: f.parentName || '', phone: f.phone || '', email: b.email};
  }), collected: await collectedCashBookings(today)};
}

// Bookings paid at the academy today and the RECENT_DAYS - 1 days before (New York days, by when the cash was received),
// newest first.
export async function collectedCashBookings(today = academyToday(), limit = 200) {
  const since = academyDayStart(new Date(Date.parse(today + 'T12:00:00Z') - (RECENT_DAYS - 1) * 864e5).toISOString().slice(0, 10));
  const rows = (await env.DB!.prepare(`SELECT b.*,o.paid_at,json_extract(o.pricing,'$.method') AS method,${collectorNameSql('o')} AS collected_by FROM cash_bookings b JOIN orders o ON o.id=b.order_id
    WHERE b.status='paid' AND o.status='paid' AND o.paid_at>=? ORDER BY o.paid_at DESC,b.id LIMIT ?`).bind(since, limit).all<CashRow & {paid_at: string; method: string | null; collected_by: string | null}>()).results;
  return rows.map(b => ({...cashView(b, today), method: b.method ?? 'cash', collectedBy: b.collected_by, collectedAt: b.paid_at}));
}
