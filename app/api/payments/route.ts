// Owner payments (issue #62): every payment with totals and CSV export, plus recording and voiding offline payments, and
// the walk-ins and extra practices booked to pay cash at the academy that are still unpaid (issue #248).
import {ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {allPayments, listPayments, paymentsCsv, previewOffline, recordOffline, voidOffline} from '../../../lib/offline-payments';
import {rateLimited} from '../../../lib/rate-limit';
import {findFamilies} from '../../../lib/family-search';
import {pageSize} from '../../../lib/paging';
import {unpaidCashBookings, receiveCash, cancelByOwner} from '../../../lib/cash-bookings';
import {ownerCollector} from '../../../lib/collectors';
import {paymentAttempts, paymentAttention} from '../../../lib/payment-attempts';
export const dynamic = 'force-dynamic';
const FAMILY_PICKER = 50;

export async function GET(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  const q = new URL(request.url).searchParams;
  // The family picker searches every family; it lists the first 50 matches and says when there are more (issue #46).
  if (q.get('families') === '1') {
    const found = await findFamilies(q.get('q'), FAMILY_PICKER);
    return reply({more: found.more, families: found.rows.map(r => { const p = JSON.parse(r.payload); return {userId: r.user_id, email: r.email, parentName: p.parentName || '', wrestlers: (p.wrestlers || []).map((w: any) => ({id: w.id, name: w.name, grade: w.grade}))}; })});
  }
  // Walk-ins and extra practices booked to pay cash at the academy and not paid yet (issue #248), to follow up or cancel.
  if (q.get('cash') === 'due') return reply(await unpaidCashBookings());
  // Issue #271: monthly memberships whose latest payment failed, and every online payment attempt with Stripe's last word.
  if (q.get('attention') === '1') return reply(await paymentAttention());
  if (q.get('attempts') === '1') return reply(await paymentAttempts({q: q.get('q'), days: q.get('days') === 'all' ? 36500 : 90}));
  const filters = {from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, status: q.get('status') ?? undefined, kind: q.get('kind') ?? undefined, source: q.get('source') ?? undefined,
    collector: q.get('collector') ?? undefined};
  // The spreadsheet has every matching payment, read in batches.
  if (q.get('format') === 'csv') {
    const rows = [];
    for await (const batch of allPayments(filters)) rows.push(...batch);
    auth.headers.set('Content-Type', 'text/csv; charset=utf-8');
    auth.headers.set('Content-Disposition', `attachment; filename="savage-payments-${new Date().toISOString().slice(0, 10)}.csv"`);
    return new Response(paymentsCsv(rows), {headers: auth.headers});
  }
  return reply(await listPayments(filters, {cursor: q.get('cursor'), limit: pageSize(q.get('limit'), 100, 500)}));
}

export async function POST(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 4096) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (await rateLimited(request, 'payments:' + auth.owner.userId, 60)) return reply({error: 'Too many changes. Please wait a minute.'}, 429);
  if (input?.action === 'preview') {
    const q = await previewOffline(input);
    if (!q.ok) return reply({error: q.error}, q.status);
    if (!q.charge) return reply({error: 'This item has no price set.'}, 400);
    return reply({item: q.charge.itemLabel, wrestler: q.wrestler.name, listCents: q.charge.baseCents, suggestedCents: q.charge.amountCents, dates: q.charge.dates});
  }
  if (input?.action === 'record') {
    const r = await recordOffline(input, auth.owner.userId);
    return r.status === 200 ? reply({ok: true, orderId: r.orderId}) : reply({error: r.error}, r.status);
  }
  if (input?.action === 'void') {
    if (typeof input.orderId !== 'string') return reply({error: 'Choose a payment.'}, 400);
    const r = await voidOffline(input.orderId, auth.owner.userId, input.reason);
    return r.status === 200 ? reply({ok: true}) : reply({error: r.error}, r.status);
  }
  if (input?.action === 'cash-received') {
    const r = await receiveCash(input.bookingId, ownerCollector(auth.owner.userId), {role: 'owner'});
    return r.status === 200 ? reply({ok: true, orderId: r.orderId}) : reply({error: r.error}, r.status);
  }
  if (input?.action === 'cash-cancel') {
    const r = await cancelByOwner(auth.owner.userId, input.bookingId, input.reason);
    return r.status === 200 ? reply({ok: true}) : reply({error: r.error}, r.status);
  }
  return reply({error: 'Unknown action.'}, 400);
}
