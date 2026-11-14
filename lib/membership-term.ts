// Membership date arithmetic shared by Stripe webhooks and offline payments. No dependencies.

// The year a membership paid upfront covered (no longer sold, #210; kept for a late event about one started before then).
// It runs through the day before the same calendar date a year later. A February 29 start ends on February 28, because
// March 1 of the next year is "the same date" rolled over.
export function membershipTerm(start: string) {
  const [y, m, d] = start.split('-').map(Number);
  const end = new Date(Date.UTC(y + 1, m - 1, d) - 86400000).toISOString().slice(0, 10);
  return {start, end};
}

// Month to month (decided Nov 13, 2026, #2): Stripe charges on the same day every month until the membership is
// canceled, with no last payment. The last day covered after n monthly payments starting on `start` is the next billing
// day itself (issue #271): Stripe charges during that day, so the member is still on the roster on billing-day morning,
// before the payment's notice arrives. A day the month doesn't have bills on its last day, as Stripe does.
export function paidThroughAfter(start: string, n: number) {
  const [y, m, d] = start.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
}

// A failed monthly payment (issue #271, 7 days decided Nov 13 on #2): the wrestler stays on the roster for GRACE_DAYS
// after the paid-through day while Stripe retries the card. Once the payment goes through, access runs to the new
// paid-through day; if Stripe gives up, the membership pauses (#313) and access ends on the paid-through day.
// termEnd is only set on a membership from the earlier 12-month plan, whose grace never ran past its end.
export const GRACE_DAYS = 7;
export function graceEnd(paidThrough: string, termEnd?: string | null) {
  const until = new Date(Date.parse(paidThrough + 'T12:00:00Z') + GRACE_DAYS * 86400000).toISOString().slice(0, 10);
  return termEnd && termEnd < until ? termEnd : until;
}
