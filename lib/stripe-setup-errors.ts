// Why a Stripe key could not be verified or saved on Online payment setup (issue #300), in plain words the owner can
// act on. Never repeats the key or any part of it: Stripe's own message quotes the key, so only permission names
// (rak_…) are taken from it.
export type KeyMode = 'test' | 'live';

export function stripeSetupError(err: unknown, mode: KeyMode): string {
  const e = (err ?? {}) as {type?: unknown; statusCode?: unknown; message?: unknown};
  const type = typeof e.type === 'string' ? e.type : '', status = Number(e.statusCode) || 0;
  const message = typeof e.message === 'string' ? e.message : '';
  const where = mode === 'test'
    ? 'in the academy’s own Stripe account with Test mode on (not a sandbox)'
    : 'in the academy’s own Stripe account with Test mode off';
  if (message === 'Secure storage is not configured.')
    return 'The key is fine, but the site can’t store it safely: its STRIPE_CONFIG_ENCRYPTION_KEY setting is missing or not valid. Ask whoever maintains the site to set it in Cloudflare, then try again.';
  if (type === 'StripeAuthenticationError' || status === 401)
    return `Stripe didn’t recognize this key. In Stripe, ${where}, open Developers → API keys, reveal the key, copy all of it and try again. A deleted or rolled key stops working.`;
  if (type === 'StripePermissionError' || status === 403) {
    const names = [...new Set(message.match(/\brak_[a-z0-9_]+\b/g) ?? [])].slice(0, 5);
    return names.length
      ? `This key is missing a permission Stripe needs: ${names.join(', ')}. In Stripe, edit the key, give it that permission (Read is enough), save, and choose Verify again.`
      : 'This key isn’t allowed to read the account details. In Stripe, edit the key, give it read access to the account, save, and choose Verify again.';
  }
  if (type === 'StripeConnectionError' || type === 'StripeAPIError' || type === 'StripeRateLimitError' || status === 429 || status >= 500)
    return 'Stripe couldn’t be reached just now. Wait a minute and choose Verify again.';
  return mode === 'test'
    ? 'The test connection could not be verified or saved. Check that the key is active and permits reading account details. No key details are returned.'
    : 'The live connection could not be verified or saved. Check that the key is active, belongs to the academy account, and permits reading account details. No key details are returned.';
}
