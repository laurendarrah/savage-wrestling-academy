// The signed-in family's own orders (issue #21). Read-only. Abandoned and canceled checkouts are hidden.
import {env} from 'cloudflare:workers';
import {strongAccount, accountReply} from '../../../lib/account-auth';
import {checkoutKinds} from '../../../lib/checkout-config';
import {familyCashBookings} from '../../../lib/cash-bookings';
export const dynamic = 'force-dynamic';

// paid_in_cash: paid in cash at the academy (issue #250). The family sees that it was paid in cash, never which coach took it.
const FIELDS = 'o.id,o.kind,o.program,o.item_id,o.item_label,o.wrestler_id,o.wrestler_name,o.dates,o.base_cents,o.discount_cents,o.amount_cents,o.currency,o.status,o.created_at,o.paid_at,o.term_start,o.term_end,'
  + "CASE WHEN o.source='offline' AND json_extract(o.pricing,'$.method')='cash' THEN 1 ELSE 0 END AS paid_in_cash,"
  + 's.payments_made,s.payments_total,s.status AS subscription_status,s.term_end AS membership_end,s.paid_through';
const FROM = 'FROM orders o LEFT JOIN subscriptions s ON s.order_id=o.id';

export async function GET(request: Request) {
  const auth = await strongAccount(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.user?.email_confirmed_at) return reply({error: 'Sign-in required.'}, 401);
  if (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong) return reply({error: 'Authenticator verification required.'}, 403);
  const one = new URL(request.url).searchParams.get('order');
  if (one !== null) {
    if (!/^[0-9a-f-]{36}$/.test(one)) return reply({error: 'Order not found.'}, 404);
    const row = await env.DB!.prepare(`SELECT ${FIELDS} ${FROM} WHERE o.id=? AND o.user_id=?`).bind(one, auth.user.id).first<Record<string, unknown>>();
    return row ? reply({order: {...row, dates: JSON.parse(String(row.dates))}}) : reply({error: 'Order not found.'}, 404);
  }
  const rows = await env.DB!.prepare(`SELECT ${FIELDS} ${FROM} WHERE o.user_id=? AND o.status IN ('pending','paid','refunded') ORDER BY o.created_at DESC`).bind(auth.user.id).all<Record<string, unknown>>();
  // Walk-ins and extra practices booked to pay cash at the academy and not paid yet (issue #248).
  return reply({orders: rows.results.map(r => ({...r, dates: JSON.parse(String(r.dates))})), checkoutOpen: checkoutKinds().size > 0, cashBookings: await familyCashBookings(auth.user.id)});
}
