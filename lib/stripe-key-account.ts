// Which Stripe account a restricted key belongs to (issues #255, #308, #310). Stripe's current dashboard offers no
// permission for reading the account itself, so a correct key can be refused that one read. A refusal (403) already
// proves Stripe recognized the key: an unknown key gets 401 and is never accepted. The Balance read is then tried only
// as a courtesy check and never blocks (on Nov 13 a correct key was refused it too). The account id comes from Stripe's
// refusal when it names one, else from the STRIPE_ACCOUNT_ID setting. 'needs-setting' means neither was available.
import {ACCOUNT_ID, stripeAccountName, type StripeAccountInfo} from './stripe-test';

type Client = {accounts: {retrieve: (id: null) => Promise<unknown>}; balance: {retrieve: () => Promise<unknown>}};

export function refusedRead(err: unknown): boolean {
  const e = (err ?? {}) as {type?: unknown; statusCode?: unknown};
  return e.type === 'StripePermissionError' || Number(e.statusCode) === 403;
}

export async function keyAccount(client: Client, setting: string | null): Promise<StripeAccountInfo | 'needs-setting'> {
  try {
    const account = await client.accounts.retrieve(null) as {id?: unknown};
    if (typeof account?.id !== 'string' || !ACCOUNT_ID.test(account.id)) throw Error('Unexpected account.');
    return {id: account.id, name: stripeAccountName(account)};
  } catch (err) {
    if (!refusedRead(err)) throw err;
    try { await client.balance.retrieve(); } catch (balanceErr) { if (!refusedRead(balanceErr)) throw balanceErr; }
    const named = String((err as {message?: unknown}).message ?? '').match(/\bacct_[A-Za-z0-9]{8,64}\b/)?.[0];
    if (named) return {id: named, name: ''};
    return setting ? {id: setting, name: ''} : 'needs-setting';
  }
}

export const NEEDS_ACCOUNT_SETTING = 'The key works, but Stripe won’t tell the site which account it belongs to. In Stripe, find the account ID (it starts acct_) under Settings → Business → Account details, or in the dashboard’s web address. Ask whoever maintains the site to save it as STRIPE_ACCOUNT_ID in Cloudflare (as a Secret), then choose Verify again.';
