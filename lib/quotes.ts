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
import {dayDate, dayTime} from './datetime';
import {waiverProblem} from './waivers';
import {lessonOpening, lessonSettings, lessonHolders, mayJoin} from './lessons';
import {settleOffers, activeOffer} from './waitlist';
import {PROGRAM_ON} from './transfers';

export type ChargeKind = 'walkin' | 'annual' | 'monthly' | 'event' | 'live' | 'lesson';
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

// ownerRecording: the owner is recording a payment taken at the academy, so a private lesson group needs no invite code.
export type QuoteOptions = {checkoutKinds?: ReadonlySet<string>; ownerRecording?: boolean};
// The review wording depends on whether this kind of purchase can be paid online yet.
const tail = (opts: QuoteOptions | undefined, kind: ChargeKind | null) =>
  kind && opts?.checkoutKinds?.has(kind)
    ? ' Continue to secure checkout to complete registration.'
    : ' Online payment isn’t open yet. To book, pay the academy; your spot is confirmed once the academy records your payment.';
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
       AND term_start<=? AND term_end>=? ${program ? `AND ${PROGRAM_ON}=?` : ''}
     ORDER BY term_end DESC LIMIT 1`
  ).bind(...[userId, wrestlerId, today, today, ...(program ? [today, program] : [])]).first<{id: string; kind: string; program: string; term_start: string; term_end: string}>();
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
  const waiver = await waiverProblem(userId, w, [input.plan === 'walkin' ? date : today]);
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
    const waiver = await waiverProblem(userId, w, [session.date]);
    if (waiver) return fail(403, waiver, {waiverRequired: true});
    const cents = member ? session.memberCents : session.nonMemberCents;
    const review = {
      type: 'live', title: session.name, wrestler: w.name, dates: [session.date], start: session.start, end: session.end,
      cents, memberEligible: member, memberCents: session.memberCents, nonMemberCents: session.nonMemberCents, includedInMembership: false, status: 'registration_review',
      message: (member ? 'Your membership is active, so the member price applies to this extra practice.' : 'Extra practices are a separate purchase for every wrestler, including members. The non-member price applies.') + tail(opts, 'live')
    };
    const charge: Charge | null = cents === null || cents === undefined ? null : {
      kind: 'live', program: null, itemId: String(session.id), itemLabel: `${session.name} on ${dayDate(session.date)}`, dates: [session.date],
      baseCents: session.nonMemberCents ?? cents, discountCents: (session.nonMemberCents ?? cents) - cents, amountCents: cents,
      pricing: {member, memberCents: session.memberCents, nonMemberCents: session.nonMemberCents},
      dedupeKey: [userId, w.id, 'live', session.id, session.date].join('|')
    };
    return {ok: true, review, charge, wrestler};
  }
  if (input.type === 'lesson') {
    // Without a chosen opening this is an inquiry, as before. With one, it is a booking for this one wrestler at the
    // owner's per-wrestler price (issues #70, #177).
    if (input.openingId === undefined || input.openingId === null || input.openingId === '') {
      const format = catalog.privateFormats.find(p => p.id === input.format);
      if (!format) return fail(400, 'Choose an available lesson format.');
      const card = await cardProblem(userId, w, [today]);
      if (card) return fail(403, card, {usawRequired: true});
      const waiver = await waiverProblem(userId, w, [today]);
      if (waiver) return fail(403, waiver, {waiverRequired: true});
      return {ok: true, wrestler, charge: null, review: {type: 'lesson', title: format.name, wrestler: w.name, cents: null, status: 'inquiry_review', message: 'The academy will confirm the coach, date and price with you. Nothing is reserved or charged yet.'}};
    }
    const opening = await lessonOpening(input.openingId, today);
    // A private group is only for its organiser, families with its invite link, and the owner recording a payment.
    // Anyone else is told the same as for a time that does not exist.
    if (!opening || (!opts?.ownerRecording && !mayJoin(opening, userId, input.invite))) return fail(409, 'This lesson time is no longer available. Choose another time.');
    // An ordinary open time is a one-on-one; a partner or small group on it starts with a family's request.
    const format = catalog.privateFormats.find(p => p.id === (opening.format ?? 'one-on-one'))!;
    if (input.format !== undefined && input.format !== null && input.format !== '' && input.format !== format.id)
      return fail(409, opening.format ? `This time is a ${format.name.toLowerCase()}.` : 'To book a partner or small-group lesson at this time, ask for a private group first.');
    const card = await cardProblem(userId, w, [opening.date]);
    if (card) return fail(403, card, {usawRequired: true});
    const waiver = await waiverProblem(userId, w, [opening.date]);
    if (waiver) return fail(403, waiver, {waiverRequired: true});
    const price = (await lessonSettings()).prices[format.id];
    if (typeof price !== 'number') return fail(409, `${format.name}s are not open for online booking yet. Contact the academy to arrange one.`);
    const holders = (await lessonHolders([opening.id])).get(opening.id)!;
    if (holders.some(h => h.userId === userId && h.wrestlerId === w.id)) return fail(409, `${w.name} is already booked into this lesson. Check your family account.`);
    const left = await seatsLeft(opening.id, [opening.date], opening.capacity, 'lesson', {userId, wrestlerId: w.id});
    if (left <= 0) return fail(409, opening.capacity > 1 ? 'This lesson is full. Choose another time.' : 'Another family just booked this lesson time. Choose another time.');
    const group = opening.closed ? 'family' : opening.capacity > 1 ? 'coach' : null;
    const label = `${format.name} with ${opening.coach}, ${dayTime(opening.date, opening.start)}`;
    const review = {type: 'lesson', title: format.name, wrestler: w.name, coach: opening.coach, dates: [opening.date], start: opening.start, end: opening.end, cents: price, perWrestler: true,
      capacity: opening.capacity, spotsLeft: left, group, status: 'registration_review',
      // With lesson checkout closed, the lesson page itself says how to pay, so the review adds nothing.
      message: opts?.checkoutKinds?.has('lesson') ? 'Once you continue to checkout, this spot is held for you for 30 minutes while you pay.' : ''};
    const charge: Charge = {
      kind: 'lesson', program: null, itemId: opening.id, itemLabel: label, dates: [opening.date], baseCents: price, discountCents: 0, amountCents: price,
      pricing: {format: format.id, formatName: format.name, coachEmail: opening.coachEmail, coachName: opening.coach, start: opening.start, end: opening.end, slots: opening.capacity, group, perWrestler: true},
      dedupeKey: [userId, w.id, 'lesson', opening.id].join('|')
    };
    return {ok: true, review, charge, wrestler};
  }
  const event = catalog.events.find((e: any) => e.id === input.id);
  if (!event) return fail(409, 'This event is archived or no longer available.');
  // Waitlist (issue #73): a family holding an offer from the owner may book even though the event looks full.
  await settleOffers(event.id);
  const held = await activeOffer(event.id, userId, w.id);
  const fullError = () => fail(409, 'This event is full. Join the waitlist and the academy can offer you a seat if one opens.', {waitlist: true, eventId: event.id});
  const option = input.option || 'full';
  if (option !== 'full' && (event.type !== 'Camp' || event.dayCents === null || !event.dates.includes(option) || option < today)) return fail(400, 'Choose an available camp day.');
  if (option === 'full' && event.dates[0] < today) return fail(409, 'This event has already started. Choose a future single camp day if offered, or contact the academy.');
  const eventDates = option === 'full' ? event.dates : [option];
  // An offer only covers the days it was made for (issue #97): an offer for one camp day cannot book the whole camp.
  const offerDates: string[] = held ? JSON.parse(held.dates) : [];
  const offer = held && eventDates.every((d: string) => offerDates.includes(d)) ? held : null;
  if (event.full && !offer) return fullError();
  if (offer) {
    const since = new Date(Date.now() - 35 * 60000).toISOString();
    const other = await env.DB!.prepare("SELECT 1 FROM orders WHERE user_id=? AND wrestler_id=? AND kind='event' AND item_id=? AND (status='paid' OR (status='pending' AND created_at>=?)) AND dedupe_key<>? LIMIT 1")
      .bind(userId, w.id, event.id, since, [userId, w.id, 'event', event.id, option].join('|')).first();
    if (other) return fail(409, 'This wrestler is already registered for this event, or a payment for it is in progress. Check your family account.');
  }
  const card = await cardProblem(userId, w, eventDates);
  if (card) return fail(403, card, {usawRequired: true});
  const waiver = await waiverProblem(userId, w, eventDates);
  if (waiver) return fail(403, waiver, {waiverRequired: true});
  const slots = eventSlots(state, event.id);
  const left = slots === null ? null : await seatsLeft(event.id, eventDates, slots, 'event', {userId, wrestlerId: w.id});
  if (left !== null && left <= 0 && !offer) return fullError();
  const baseCents = option === 'full' ? event.cents : event.dayCents;
  const memberDiscount = member && event.type === 'Camp' && baseCents !== null ? Math.round(baseCents * .1) : 0;
  const review = {
    type: 'event', title: event.name, wrestler: w.name, dates: option === 'full' ? event.dates : [option], baseCents,
    cents: baseCents === null ? null : baseCents - memberDiscount, memberDiscountCents: memberDiscount, seatsLeft: left, status: 'registration_review', offerExpiresAt: offer?.offer_expires_at ?? null,
    message: (memberDiscount ? 'Your membership is active, so the 10% member discount for camps is applied.' : 'The price shown is the full price for this event.') + tail(opts, baseCents === null ? null : 'event')
  };
  const charge: Charge | null = baseCents === null ? null : {
    kind: 'event', program: null, itemId: String(event.id), itemLabel: option === 'full' ? String(event.name) : `${event.name} on ${dayDate(option)}`,
    dates: option === 'full' ? event.dates : [option], baseCents, discountCents: memberDiscount, amountCents: baseCents - memberDiscount,
    // A seat offered from the waitlist is the owner's decision, so it is not limited again at checkout.
    pricing: {member, option, eventType: event.type, slots: offer ? null : slots, ...(offer ? {waitlistOffer: offer.id} : {})}, dedupeKey: [userId, w.id, 'event', event.id, option].join('|')
  };
  return {ok: true, review, charge, wrestler};
}
