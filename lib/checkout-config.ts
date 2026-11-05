// Which purchase types can be paid online. Kept free of the Stripe SDK so review pages can read it cheaply.
import {env} from 'cloudflare:workers';

// Monthly memberships need Stripe subscriptions with a fixed 12-payment end and wait on the
// membership terms decision (issue #20), so they are not listed here yet.
export const ONLINE_KINDS = ['walkin', 'annual', 'event', 'live'] as const;

type Env = Cloudflare.Env & {CHECKOUT_KINDS?: string; STRIPE_TEST_WEBHOOK_SECRET?: string};

// Online checkout is off unless CHECKOUT_KINDS lists the purchase types to open, for example
// "walkin,event,live". Nothing opens without a webhook secret, because paid status comes only from webhooks.
export function checkoutKinds(): ReadonlySet<string> {
  const e = env as Env;
  if (!e.STRIPE_TEST_WEBHOOK_SECRET) return new Set();
  const wanted = (e.CHECKOUT_KINDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return new Set(wanted.filter(k => (ONLINE_KINDS as readonly string[]).includes(k)));
}
