// The signed-in family's own orders (issue #21). Read-only. Abandoned and canceled checkouts are hidden.
import {env} from 'cloudflare:workers';
import {strongAccount, accountReply} from '../../../lib/account-auth';
import {checkoutKinds} from '../../../lib/checkout-config';
export const dynamic = 'force-dynamic';

const FIELDS = 'id,kind,program,item_label,wrestler_id,wrestler_name,dates,base_cents,discount_cents,amount_cents,currency,status,created_at,paid_at,term_start,term_end';

export async function GET(request: Request) {
  const auth = await strongAccount(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.user?.email_confirmed_at) return reply({error: 'Sign-in required.'}, 401);
  if (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong) return reply({error: 'Authenticator verification required.'}, 403);
  const one = new URL(request.url).searchParams.get('order');
  if (one !== null) {
    if (!/^[0-9a-f-]{36}$/.test(one)) return reply({error: 'Order not found.'}, 404);
    const row = await env.DB!.prepare(`SELECT ${FIELDS} FROM orders WHERE id=? AND user_id=?`).bind(one, auth.user.id).first<Record<string, unknown>>();
    return row ? reply({order: {...row, dates: JSON.parse(String(row.dates))}}) : reply({error: 'Order not found.'}, 404);
  }
  const rows = await env.DB!.prepare(`SELECT ${FIELDS} FROM orders WHERE user_id=? AND status IN ('pending','paid','refunded') ORDER BY created_at DESC LIMIT 200`).bind(auth.user.id).all<Record<string, unknown>>();
  return reply({orders: rows.results.map(r => ({...r, dates: JSON.parse(String(r.dates))})), checkoutOpen: checkoutKinds().size > 0});
}
