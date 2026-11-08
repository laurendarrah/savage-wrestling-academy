// What each Stripe webhook outcome (lib/stripe-webhook.ts) means, in plain words, for the owner's pages: the security
// log, the Payment attempts list on /payments and the hourly alert email (issue #271). No dependencies.

// A message the site refused, and what to do about it.
export const REJECTIONS: Record<string, string> = {
  'rejected:malformed': 'The message was not readable.',
  'rejected:unknown-order': 'It named an order the site does not have.',
  'rejected:session-mismatch': 'It did not match the order’s checkout.',
  'rejected:mode-mismatch': 'Test and live payments were mixed up.',
  'rejected:amount-mismatch': 'The amount paid did not match the price.',
  'rejected:duplicate-payment-refund-needed': 'The same purchase was paid twice. Refund one payment in Stripe.',
  'rejected:no-subscription': 'The monthly plan was missing from Stripe.',
  'rejected:payment-beyond-term-refund-needed': 'A payment came after all 12 were made. Refund it in Stripe.',
  'rejected:refund-amount': 'The refund was for more than was paid.',
};

const OUTCOMES: Record<string, string> = {
  paid: 'Paid.',
  'paid-over-capacity': 'Paid, but over the seat limit. Refund one family or make room.',
  'awaiting-payment': 'Checkout finished; Stripe is still collecting the payment.',
  expired: 'The family did not finish paying in time. Nothing was charged.',
  'payment-failed': 'The payment failed at Stripe. Nothing was charged.',
  'installment-failed': 'A monthly payment failed. Stripe retries the card.',
  'installment-refunded': 'One monthly payment was refunded.',
  'installment-partial-refund': 'Part of one monthly payment was refunded.',
  'partial-refund': 'Partly refunded.',
  refunded: 'Refunded in full.',
  'subscription-completed': 'All 12 monthly payments were made; the plan ended.',
  'subscription-canceled': 'The monthly plan was canceled before 12 payments.',
};

// The latest Stripe outcome for an order, as a sentence. `status` is the order's own status, for orders Stripe never
// reported on (a checkout the family abandoned, or one still open).
export function outcomeWords(outcome: string | null | undefined, status: string) {
  if (outcome) {
    if (OUTCOMES[outcome]) return OUTCOMES[outcome];
    const m = /^installment-(\d+)-of-(\d+)$/.exec(outcome);
    if (m) return `Monthly payment ${m[1]} of ${m[2]} received.`;
    if (outcome.startsWith('rejected:')) return 'Refused: ' + (REJECTIONS[outcome] ?? 'Stripe sent a payment message the site could not match.');
    if (outcome.startsWith('ignored:')) return 'A Stripe message that changed nothing.';
    return outcome;
  }
  return {pending: 'Checkout opened; no answer from Stripe yet. If it is more than an hour old, the family did not finish.',
    expired: 'The checkout closed without a payment. Nothing was charged.', canceled: 'Checkout canceled before payment, or replaced by a newer one.',
    paid: 'Paid.', refunded: 'Refunded.'}[status] ?? status;
}

// The attempt's state in one or two words, for a badge.
export function attemptState(outcome: string | null | undefined, status: string): 'paid' | 'refunded' | 'rejected' | 'failed' | 'open' | 'closed' {
  if (outcome?.startsWith('rejected:')) return 'rejected';
  if (status === 'paid') return 'paid';
  if (status === 'refunded') return 'refunded';
  if (outcome === 'payment-failed' || outcome === 'installment-failed') return 'failed';
  return status === 'pending' ? 'open' : 'closed';
}
