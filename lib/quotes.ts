// Server-side prices for every purchasable item. The registration and booking review screens and
// Stripe checkout all use these functions, so a family is always charged exactly what they reviewed.
// The browser never supplies an amount.
import {env} from 'cloudflare:workers';
import {teamCodeDiscount} from './academy-validation';
import {familyProfile, checkCompetitionAccess, requiresApproval} from './program-approval';
import {registrationCatalog} from './registration-catalog';
import {hasScholarship} from './scholarships';
import {fridayLiveSchedule} from './friday-live';
import {publicSchedule, academyToday} from './public-schedule';
import {eventSlots, seatsLeft} from './capacity';
import {cardProblem} from './usaw';
import {waiverProblem} from './waivers';

export type ChargeKind = 'walkin' | 'annual' | 'monthly' | 'event' | 'live';
export type Charge = {
  kind: ChargeKind;
  program: string | null;
  itemId: string;
  itemLabel: string;
  dates: string[];
  baseCents: number;
  discountCents: number;
  amountCents: number;
  pricing: Record<string, unknown>;
  dedupeKey: string;
};
export type Quote =
  | {ok: true; review: Record<string, unknown>; charge: Charge | null; wrestler: {id: string; name: string}}
  | {ok: false; status: number; error: string; extra?: Record<string, unknown>};

export type QuoteOptions = {checkoutKinds?: ReadonlySet<string>};
// The review wording depends on whether this kind of purchase can be paid online yet.
const tail = (opts: QuoteOptions | undefined, kind: ChargeKind | null) =>
  kind && opts?.checkoutKinds?.has(kind)
    ? ' Continue to secure checkout to complete registration.'
    : ' Review only; no payment, enrollment, or reservation has been completed.';
const fail = (status: number, error: string, extra?: Record<string, unknown>): Quote => ({ok: false, status, error, ...(extra ? {extra} : {})});

async function academyState(): Promise<any> {
  const row = await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload: string}>();
  return row ? JSON.parse(row.payload) : {};
}

// A wrestler counts as a member when they hold an active scholarship or a paid membership whose term covers today.
export async function paidMembership(userId: string, wrestlerId: string, today: string, program?: string) {
  const row = await env.DB!.prepare(
    `SELECT id, kind, program, term_start, term_end FROM orders
     WHERE user_id=? AND wrestler_id=? AND status='paid' AND kind IN ('annual','monthly')
       AND term_start<=? AND term_end>=? ${program ? 'AND program=?' : ''}
     ORDER BY term_end DESC LIMIT 1`
  ).bind(...[userId, wrestlerId, today, today, ...(program ? [program] : [])]).first<{id: string; kind: string; program: string; term_start: string; term_end: string}>();
  return row ?? null;
}
export async function isMember(userId: string, wrestlerId: string, today: string) {
  return (await hasScholarship(userId, wrestlerId)) || !!(await paidMembership(userId, wrestlerId, today));
}

// Memberships and walk-ins for the three programs. Mirrors the original /api/registration review rules.
export async function quoteMembership(userId: string, input: any, opts?: QuoteOptions): Promise<Quote> {
  if (!input || typeof input.wrestlerId !== 'string' || !['Elementary', 'Intermediate', 'Advanced'].includes(input.program) || !['monthly', 'annual', 'walkin'].includes(input.plan))
    return fail(400, 'Choose a saved wrestler, program, and plan.');
  const profile = await familyProfile(userId), w = profile?.wrestlers.find(w => w.id === input.wrestlerId);
  if (!w) return fail(404, 'Saved wrestler not found in your family account.');
  const blocked = await checkCompetitionAccess(userId, input.program, w);
  if (blocked) return fail(403, blocked, {approvalRequired: requiresApproval(input.program, w)});
  if (await hasScholarship(userId, w.id, input.program))
    return fail(409, 'This wrestler already has an active scholarship in this program. Regular scheduled practices are included. View the scholarship in your family account.');
  const today = academyToday();
  const date = typeof input.date === 'string' ? input.date : '';
  if (input.plan === 'walkin' && (!/^\d{4}-(0[1-9]|1[0-2])-\d\d$/.test(date) || date < today)) return fail(400, 'Choose an upcoming scheduled practice.');
  const state = await academyState();
  const catalog = registrationCatalog(state, input.plan === 'walkin' ? date.slice(0, 7) : today.slice(0, 7), today);
  const p = catalog.programs.find((p: any) => p.id === input.program);
  if (!p) return fail(409, 'This program is no longer available. Refresh your options.');
  const practice = input.plan === 'walkin' ? catalog.practices.find(s => s.program === input.program && s.date === date && s.id === input.practiceId) : null;
  if (input.plan === 'walkin' && !practice) return fail(409, 'This practice changed or is unavailable. Refresh the schedule.');
  const membership = input.plan !== 'walkin';
  if (membership && await paidMembership(userId, w.id, today, p.id))
    return fail(409, 'This wrestler already has an active paid membership in this program. View it in your family account.');
  // Decision #67: no booking without a USA Wrestling card valid on the session date (membership: purchase date).
  const card = await cardProblem(userId, w, [input.plan === 'walkin' ? date : today]);
  if (card) return fail(403, card, {usawRequired: true});
  const waiver = await waiverProblem(userId, w);
  if (waiver) return fail(403, waiver, {waiverRequired: true});
  const baseCents = input.plan === 'walkin' ? p.walkInCents : input.plan === 'annual' ? p.annualCents : p.monthlyCents;
  const pricing = teamCodeDiscount(state.teamCodes ?? [], input.teamCode, p.id, input.plan, baseCents);
  if ('error' in pricing) return fail(400, pricing.error);
  const review = {
    wrestlerName: w.name, grade: w.grade, programName: p.name, programId: p.id, plan: input.plan, baseCents,
    cents: pricing.cents, discount: pricing.discount, practice,
    termMonths: membership ? 12 : null, paymentCount: input.plan === 'monthly' ? 12 : 1,
    totalCents: pricing.cents === null ? null : pricing.cents * (input.plan === 'monthly' ? 12 : 1),
    renewal: membership ? 'manual' : null, termsStatus: membership ? 'draft' : null, termsUrl: membership ? '/membership-terms' : null
  };
  let charge: Charge | null = null;
  if (baseCents !== null && pricing.cents !== null) {
    const kind: ChargeKind = input.plan;
    charge = {
      kind, program: p.id,
      itemId: kind === 'walkin' ? String(practice!.id) : p.id,
      itemLabel: kind === 'walkin' ? `${p.name} walk-in` : kind === 'annual' ? `${p.name}: 12-month membership, paid upfront` : `${p.name}: 12-month membership, monthly payment`,
      dates: kind === 'walkin' ? [date] : [],
      baseCents, discountCents: baseCents - pricing.cents, amountCents: pricing.cents,
      pricing: {plan: kind, teamCode: input.teamCode ? String(input.teamCode).trim().toUpperCase() : null, discount: pricing.discount ?? null},
      dedupeKey: [userId, w.id, kind, p.id, kind === 'walkin' ? date : today].join('|')
    };
  }
  return {ok: true, review, charge, wrestler: {id: w.id, name: w.name}};
}

// Camps, clinics, events, Friday Night Live and private lessons. Mirrors the original /api/booking-review rules,
// with one change: a paid membership now qualifies for member pricing, not only an active scholarship.
export async function quoteBooking(userId: string, input: any, opts?: QuoteOptions): Promise<Quote> {
  if (!input || typeof input.wrestlerId !== 'string' || !['lesson', 'event', 'live'].includes(input.type)) return fail(400, 'Choose a saved wrestler and offering.');
  const family = await familyProfile(userId), w = family?.wrestlers.find(w => w.id === input.wrestlerId);
  if (!w) return fail(404, 'Saved wrestler not found in your account.');
  const today = academyToday();
  const member = await isMember(userId, w.id, today);
  const state = await academyState();
  const catalog = publicSchedule(state, today.slice(0, 7), today);
  const wrestler = {id: w.id, name: w.name};
  if (input.type === 'live') {
    if (typeof input.date !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(input.date) || input.date < today) return fail(400, 'Choose an upcoming practice date.');
    const session = fridayLiveSchedule(state, input.date.slice(0, 7), today).find(s => s.date === input.date && s.id === input.id);
    if (!session) return fail(409, 'This practice is no longer available on that date.');
    const card = await cardProblem(userId, w, [session.date]);
    if (card) return fail(403, card, {usawRequired: true});
    const waiver = await waiverProblem(userId, w);
    if (waiver) return fail(403, waiver, {waiverRequired: true});
    const cents = member ? session.memberCents : session.nonMemberCents;
    const review = {
      type: 'live', title: session.name, wrestler: w.name, dates: [session.date], start: session.start, end: session.end,
      cents, memberEligible: member, memberCents: session.memberCents, nonMemberCents: session.nonMemberCents, includedInMembership: false, status: 'registration_review',
      message: (member ? 'Active membership verified. Member price applied for this separate practice.' : 'Separate purchase required for every wrestler, including members. Non-member price applies.') + tail(opts, 'live')
    };
    const charge: Charge | null = cents === null || cents === undefined ? null : {
      kind: 'live', program: null, itemId: String(session.id), itemLabel: `${session.name} on ${session.date}`, dates: [session.date],
      baseCents: session.nonMemberCents ?? cents, discountCents: (session.nonMemberCents ?? cents) - cents, amountCents: cents,
      pricing: {member, memberCents: session.memberCents, nonMemberCents: session.nonMemberCents},
      dedupeKey: [userId, w.id, 'live', session.id, session.date].join('|')
    };
    return {ok: true, review, charge, wrestler};
  }
  if (input.type === 'lesson') {
    const format = catalog.privateFormats.find(p => p.id === input.format);
    if (!format) return fail(400, 'Choose an available lesson format.');
    const card = await cardProblem(userId, w, [today]);
    if (card) return fail(403, card, {usawRequired: true});
    const waiver = await waiverProblem(userId, w);
    if (waiver) return fail(403, waiver, {waiverRequired: true});
    return {ok: true, wrestler, charge: null, review: {type: 'lesson', title: format.name, wrestler: w.name, cents: null, status: 'inquiry_review', message: 'Coach, date, availability, and price need academy confirmation. No lesson is reserved and no payment is taken.'}};
  }
  const event = catalog.events.find((e: any) => e.id === input.id);
  if (!event) return fail(409, 'This event is archived or no longer available.');
  if (event.full) return fail(409, 'This event is full. Contact the academy about its waitlist.');
  const option = input.option || 'full';
  if (option !== 'full' && (event.type !== 'Camp' || event.dayCents === null || !event.dates.includes(option) || option < today)) return fail(400, 'Choose an available camp day.');
  if (option === 'full' && event.dates[0] < today) return fail(409, 'This event has already started. Choose a future single camp day if offered, or contact the academy.');
  const eventDates = option === 'full' ? event.dates : [option];
  const card = await cardProblem(userId, w, eventDates);
  if (card) return fail(403, card, {usawRequired: true});
  const waiver = await waiverProblem(userId, w);
  if (waiver) return fail(403, waiver, {waiverRequired: true});
  const slots = eventSlots(state, event.id);
  const left = slots === null ? null : await seatsLeft(event.id, eventDates, slots);
  if (left !== null && left <= 0) return fail(409, 'This event is full. Contact the academy about its waitlist.');
  const baseCents = option === 'full' ? event.cents : event.dayCents;
  const memberDiscount = member && event.type === 'Camp' && baseCents !== null ? Math.round(baseCents * .1) : 0;
  const review = {
    type: 'event', title: event.name, wrestler: w.name, dates: option === 'full' ? event.dates : [option], baseCents,
    cents: baseCents === null ? null : baseCents - memberDiscount, memberDiscountCents: memberDiscount, seatsLeft: left, status: 'registration_review',
    message: (memberDiscount ? 'Active membership verified. A 10% camp member discount is applied.' : 'Price shown is the full price for this event.') + tail(opts, baseCents === null ? null : 'event')
  };
  const charge: Charge | null = baseCents === null ? null : {
    kind: 'event', program: null, itemId: String(event.id), itemLabel: option === 'full' ? String(event.name) : `${event.name} on ${option}`,
    dates: option === 'full' ? event.dates : [option], baseCents, discountCents: memberDiscount, amountCents: baseCents - memberDiscount,
    pricing: {member, option, eventType: event.type, slots}, dedupeKey: [userId, w.id, 'event', event.id, option].join('|')
  };
  return {ok: true, review, charge, wrestler};
}
