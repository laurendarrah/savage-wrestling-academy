// Owner payments (issue #62): every payment with totals and CSV export, plus recording and voiding offline payments.
import {env} from 'cloudflare:workers';
import {ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {listPayments, paymentsCsv, previewOffline, recordOffline, voidOffline} from '../../../lib/offline-payments';
import {rateLimited} from '../../../lib/rate-limit';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  const q = new URL(request.url).searchParams;
  if (q.get('families') === '1') {
    const rows = (await env.DB!.prepare('SELECT user_id,email,payload FROM family_accounts ORDER BY email LIMIT 2000').all<{user_id: string; email: string; payload: string}>()).results;
    return reply({families: rows.map(r => { const p = JSON.parse(r.payload); return {userId: r.user_id, email: r.email, parentName: p.parentName || '', wrestlers: (p.wrestlers || []).map((w: any) => ({id: w.id, name: w.name, grade: w.grade}))}; })});
  }
  const data = await listPayments({from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, status: q.get('status') ?? undefined, kind: q.get('kind') ?? undefined, source: q.get('source') ?? undefined});
  if (q.get('format') === 'csv') {
    auth.headers.set('Content-Type', 'text/csv; charset=utf-8');
    auth.headers.set('Content-Disposition', `attachment; filename="savage-payments-${new Date().toISOString().slice(0, 10)}.csv"`);
    return new Response(paymentsCsv(data.payments), {headers: auth.headers});
  }
  return reply(data);
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
  return reply({error: 'Unknown action.'}, 400);
}
