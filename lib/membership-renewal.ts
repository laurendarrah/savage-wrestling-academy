// What a family is told about a monthly membership's automatic renewal (decided Nov 13, 2026 on #2, issue #314).
// New York's automatic-renewal law (GBL §527-a) asks for three things, all written here so they always agree:
// - before payment, next to the consent tick on /register: what the membership includes, the monthly price, that it
//   renews and charges every month on the same day until canceled, and how and when to cancel (renewalDisclosure);
// - after sign-up, an acknowledgment the family can keep, by email and in their Messages (membershipAcknowledgment,
//   sent once per membership by lib/notify.ts from the verified webhook);
// - online cancellation, from the family account (lib/memberships.ts).
// Plain text only: pages escape it, emails send it as it is. Dates and prices come from the server, never the browser.
import {fullDate} from './datetime';

const dollars = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');

// "the 14th of each month", with the rule for a day some months don't have: Stripe bills on that month's last day.
export function billingDay(start: string) {
  const day = Number(start.slice(8, 10));
  return `the ${ordinal(day)} of each month` + (day > 28 ? ', or the last day of a shorter month' : '');
}

export type RenewalFacts = {wrestler: string; program: string; cents: number; start: string};

// The terms in short, shown beside "I agree" before the family pays. `start` is today: the first charge.
export function renewalDisclosure(f: RenewalFacts) {
  return `${f.wrestler}’s ${f.program} membership includes every regular scheduled practice in ${f.program}. It costs ${dollars(f.cents)} a month. `
    + `It renews automatically: your card is charged ${dollars(f.cents)} today and again every month on ${billingDay(f.start)}, until you cancel. There is no contract and no end date. `
    + `You can cancel any time in your family account, or by email, by phone or in person. To stop the next charge, cancel before your next billing day; `
    + `${f.wrestler} keeps training until the end of the month you’ve already paid for. There is no partial refund and no fee for canceling.`;
}

export type AcknowledgmentFacts = RenewalFacts & {nextBilling: string; origin: string; email: string; address: string; discount?: string | null};

// The acknowledgment email after the first payment: the terms, the amount, how often, the deadline to stop the next
// charge and how to cancel. It also lands in the family's Messages, so they can find it again.
export function membershipAcknowledgment(f: AcknowledgmentFacts) {
  const price = dollars(f.cents);
  return {
    subject: `Your monthly membership for ${f.wrestler}: please keep this email`,
    body: [
      `This confirms ${f.wrestler}’s ${f.program} membership at Savage Wrestling Academy, which started on ${fullDate(f.start)}. Please keep this email for your records.`,
      `What it includes: every regular scheduled practice in ${f.program}. Friday Night Live, camps, clinics and private lessons are separate purchases.`,
      `Price: ${price} a month${f.discount ? ` (${f.discount})` : ''}. Your first payment of ${price} was charged on ${fullDate(f.start)}.`,
      `Automatic renewal: the membership is month to month, with no contract and no end date. It renews automatically and charges ${price} to the same card every month on ${billingDay(f.start)}, until you cancel. Your next payment is on ${fullDate(f.nextBilling)}.`,
      `How to cancel: any time, online in your family account (${f.origin}/family#memberships, then Cancel membership), or by email to ${f.email}, by phone, or in person at the academy, ${f.address}. To stop the next payment, cancel before ${fullDate(f.nextBilling)}, and before each later billing day after that. When you cancel, no more payments are taken and ${f.wrestler} can keep training through the end of the month already paid for. There is no partial refund and no fee for canceling.`,
      `If a payment fails: Stripe tries the card again, and ${f.wrestler} can keep training for 7 days after the paid month ends. If the payment still doesn’t go through, the membership pauses: nothing more is charged and ${f.wrestler} comes off the roster. To restart, choose Restart membership in your family account and pay with a working card. Payments start again from that day; missed months are not charged.`,
      `The full membership terms: ${f.origin}/membership-terms`
    ].join('\n\n')
  };
}
