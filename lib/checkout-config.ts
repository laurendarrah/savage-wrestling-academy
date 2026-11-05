// Which purchase types can be paid online. Kept free of the Stripe SDK so review pages can read it cheaply.
import {env} from 'cloudflare:workers';

// Monthly memberships need Stripe subscriptions with a fixed 12-payment end and wait on the
// membership terms decision (issue #20), so they are not listed here yet.
export const ONLINE_KINDS = ['walkin', 'annual', 'event', 'live'] as const;

type Env = Cloudflare.Env & {CHECKOUT_KINDS?: string; STRIPE_TEST_WEBHOOK_SECRET?: string; STRIPE_LIVE_WEBHOOK_SECRET?: string; STRIPE_MODE?: string};

// Test mode unless STRIPE_MODE is exactly "live" (issue #26). Live keys are only accepted in live mode.
export type StripeMode = 'test' | 'live';
export function stripeMode(): StripeMode {
  return (env as Env).STRIPE_MODE === 'live' ? 'live' : 'test';
}
export function webhookSecret(mode: StripeMode): string | null {
  const e = env as Env;
  return (mode === 'live' ? e.STRIPE_LIVE_WEBHOOK_SECRET : e.STRIPE_TEST_WEBHOOK_SECRET) || null;
}

// Online checkout is off unless CHECKOUT_KINDS lists the purchase types to open, for example
// "walkin,event,live". Nothing opens without the webhook secret for the current mode, because paid status
// comes only from webhooks.
export function checkoutKinds(): ReadonlySet<string> {
  const e = env as Env;
  if (!webhookSecret(stripeMode())) return new Set();
  const wanted = (e.CHECKOUT_KINDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return new Set(wanted.filter(k => (ONLINE_KINDS as readonly string[]).includes(k)));
}
