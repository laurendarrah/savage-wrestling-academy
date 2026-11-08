// Membership date arithmetic shared by Stripe webhooks and offline payments. No dependencies.

// A 12-month term runs through the day before the same calendar date a year later.
// A February 29 start ends on February 28, because March 1 of the next year is "the same date" rolled over.
export function membershipTerm(start: string) {
  const [y, m, d] = start.split('-').map(Number);
  const end = new Date(Date.UTC(y + 1, m - 1, d) - 86400000).toISOString().slice(0, 10);
  return {start, end};
}

// Last day covered after n monthly payments starting on `start` (n < 12): the next billing day itself (issue #271).
// Stripe charges during that day, so the member is still on the roster on billing-day morning, before the payment's
// notice arrives. The 12th payment covers the full term (membershipTerm).
export function paidThroughAfter(start: string, n: number) {
  const [y, m, d] = start.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

// A failed monthly payment (issue #271): the wrestler stays on the roster for GRACE_DAYS after the paid-through day
// while Stripe retries the card, never past the membership's own end. Once the payment goes through, access runs to the
// new paid-through day; if Stripe gives up and cancels the subscription, access ends on the paid-through day.
export const GRACE_DAYS = 7;
export function graceEnd(paidThrough: string, termEnd: string) {
  const until = new Date(Date.parse(paidThrough + 'T12:00:00Z') + GRACE_DAYS * 86400000).toISOString().slice(0, 10);
  return until < termEnd ? until : termEnd;
}
