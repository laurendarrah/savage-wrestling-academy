// What the connected Stripe key can and can't do (issue #315). On Nov 13 a restricted key connected fine but every
// card checkout failed, and nothing said why. checkKey() tries each thing the site needs with the saved key and
// reports, in plain words, what works and which Stripe permission is missing. stripeReason() turns one Stripe error
// into a short reason for the owner's Site health page. Neither ever returns the key or any part of it: Stripe's own
// messages quote the key, so only permission names (rak_…) are taken from them.
export type KeyCheck = {id: string; label: string; needed: 'payments' | 'memberships' | 'fees'; ok: boolean; problem: string};

type StripeError = {type?: unknown; statusCode?: unknown; code?: unknown; message?: unknown; param?: unknown};
const info = (err: unknown) => {
  const e = (err ?? {}) as StripeError;
  return {type: typeof e.type === 'string' ? e.type : '', status: Number(e.statusCode) || 0, code: typeof e.code === 'string' ? e.code : '',
    // The name of the request field Stripe rejected (for example expires_at): a field path, never a value.
    param: typeof e.param === 'string' && /^[A-Za-z0-9_.\[\]]{1,80}$/.test(e.param) ? e.param : '',
    names: [...new Set((typeof e.message === 'string' ? e.message : '').match(/\brak_[a-z0-9_]+\b/g) ?? [])].slice(0, 6)};
};

/** Why Stripe refused, for Site health. Never includes the key, an account id or any customer detail. */
export function stripeReason(err: unknown): string {
  const e = info(err);
  if (e.type === 'StripePermissionError' || e.status === 403)
    return e.names.length ? `the saved key is missing a Stripe permission (${e.names.join(', ')})` : 'the saved key is missing a Stripe permission';
  if (e.type === 'StripeAuthenticationError' || e.status === 401) return 'Stripe no longer recognizes the saved key (deleted or rolled)';
  if (e.type === 'StripeConnectionError' || e.type === 'StripeAPIError' || e.status >= 500) return 'Stripe could not be reached';
  if (e.type === 'StripeRateLimitError' || e.status === 429) return 'Stripe was busy (rate limit)';
  if (e.type === 'StripeInvalidRequestError' || e.status === 400) { const why = [e.code, e.param && `field ${e.param}`].filter(Boolean).join(', '); return `Stripe did not accept the request${why ? ` (${why})` : ''}`; }
  return 'an unexpected error';
}

type Client = {
  checkout: {sessions: {create: (p: any) => Promise<{id: string}>; expire: (id: string) => Promise<unknown>}};
  subscriptions: {retrieve: (id: string) => Promise<unknown>; update: (id: string, p: any) => Promise<unknown>};
  invoices: {list: (p: any) => Promise<unknown>};
  paymentIntents: {list: (p: any) => Promise<unknown>};
  charges: {list: (p: any) => Promise<unknown>};
  balance: {retrieve: () => Promise<unknown>};
};

const problem = (err: unknown, permission: string) => {
  const e = info(err);
  if (e.type === 'StripePermissionError' || e.status === 403)
    return `Missing permission. In Stripe, edit the key and set ${permission}${e.names.length ? ` (Stripe calls it ${e.names.join(', ')})` : ''}.`;
  return `Couldn’t check: ${stripeReason(err)}.`;
};
// A made-up id: Stripe answers "no such subscription" (404) when the key may do this, and 403 when it may not.
const NO_SUCH = 'sub_swa_permission_check';
const missing = (err: unknown) => { const e = info(err); return e.status === 404 || e.code === 'resource_missing'; };

export async function checkKey(client: Client, origin: string): Promise<KeyCheck[]> {
  const out: KeyCheck[] = [];
  const run = async (id: string, label: string, needed: KeyCheck['needed'], permission: string, probe: () => Promise<unknown>, okIfMissing = false) => {
    try { await probe(); out.push({id, label, needed, ok: true, problem: ''}); }
    catch (err) { out.push(okIfMissing && missing(err) ? {id, label, needed, ok: true, problem: ''} : {id, label, needed, ok: false, problem: problem(err, permission)}); }
  };
  // The real thing, shaped exactly like a walk-in checkout, then expired at once so it can never be paid.
  await run('checkout', 'Start a card payment', 'payments', 'Checkout Sessions to Write', async () => {
    const session = await client.checkout.sessions.create({mode: 'payment', client_reference_id: 'swa-key-check',
      success_url: `${origin}/payment-setup`, cancel_url: `${origin}/payment-setup`, expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      line_items: [{quantity: 1, price_data: {currency: 'usd', unit_amount: 100, product_data: {name: 'Connection check (never charged)'}}}],
      payment_intent_data: {metadata: {swa_key_check: '1'}}, metadata: {swa_key_check: '1'}});
    await client.checkout.sessions.expire(session.id);
  });
  await run('subscription-read', 'Read a membership’s payments', 'memberships', 'Subscriptions to Write', () => client.subscriptions.retrieve(NO_SUCH), true);
  await run('subscription-write', 'Stop or change a membership', 'memberships', 'Subscriptions to Write', () => client.subscriptions.update(NO_SUCH, {metadata: {swa_key_check: '1'}}), true);
  await run('invoices', 'Read membership invoices', 'memberships', 'Invoices to Read', () => client.invoices.list({limit: 1}));
  await run('payment-intents', 'Read card payments (for fees)', 'fees', 'PaymentIntents to Read', () => client.paymentIntents.list({limit: 1}));
  await run('charges', 'Read charges and refunds (for fees)', 'fees', 'Charges and Refunds to Read', () => client.charges.list({limit: 1}));
  await run('balance', 'Read card fees', 'fees', 'Balance to Read', () => client.balance.retrieve());
  return out;
}

export function keyCheckSummary(checks: KeyCheck[]): string {
  const bad = (n: KeyCheck['needed']) => checks.some(c => c.needed === n && !c.ok);
  if (!checks.some(c => !c.ok)) return 'This key can do everything the site needs.';
  if (bad('payments')) return 'This key can’t start card payments, so families can’t pay online until it’s fixed.';
  if (bad('memberships')) return 'Single purchases work. Memberships need the permissions marked below.';
  return 'Payments work. Card fees won’t reach Income & expenses until the permissions marked below are added.';
}
