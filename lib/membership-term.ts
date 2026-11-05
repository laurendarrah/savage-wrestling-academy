// Membership date arithmetic shared by Stripe webhooks and offline payments. No dependencies.

// A 12-month term runs through the day before the same calendar date a year later.
// A February 29 start ends on February 28, because March 1 of the next year is "the same date" rolled over.
export function membershipTerm(start: string) {
  const [y, m, d] = start.split('-').map(Number);
  const end = new Date(Date.UTC(y + 1, m - 1, d) - 86400000).toISOString().slice(0, 10);
  return {start, end};
}

// Last day covered after n monthly payments starting on `start` (n < 12). The 12th payment covers the full term.
export function paidThroughAfter(start: string, n: number) {
  const [y, m, d] = start.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const next = new Date(Date.UTC(y, m - 1 + n, Math.min(d, last)));
  return new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
}
