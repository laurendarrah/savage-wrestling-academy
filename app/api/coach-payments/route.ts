// Payments to coaches (issue #370), owner only: every coach's balance and the payments recorded, recording a payment
// and deleting one entered by mistake, and what each coach was paid in a year (issue #400). The rules are in
// lib/coach-payments.ts.
import {ownerIdentity, sameOrigin, accountReply} from '../../../lib/account-auth';
import {payroll, addPayment, deletePayment, yearTotals, yearCsv} from '../../../lib/coach-payments';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';

export const GET = withApi(GET_); async function GET_(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in required.'}, 403, auth.headers);
  // ?year=YYYY: what each coach was paid that year, for the 1099s (issue #400); with format=csv, as a spreadsheet.
  const q = new URL(request.url).searchParams, year = await yearTotals(q.get('year'));
  if (q.get('format') === 'csv') {
    auth.headers.set('Content-Type', 'text/csv; charset=utf-8');
    auth.headers.set('Content-Disposition', `attachment; filename="savage-coach-payments-${year.year}.csv"`);
    return new Response('\ufeff' + yearCsv(year), {headers: auth.headers});
  }
  return accountReply({...(await payroll()), year}, 200, auth.headers);
}

export const POST = withApi(POST_); async function POST_(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 10000) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  const ownerId = auth.user!.id;
  const r = input?.action === 'add' ? await addPayment(ownerId, input) : input?.action === 'delete' ? await deletePayment(ownerId, input) : null;
  if (!r) return reply({error: 'Unknown action.'}, 400);
  if (r.status !== 200) return reply({error: r.error}, r.status);
  // The reply carries the balances as they now stand, so the page never shows a figure from before the change.
  return reply({ok: true, payment: r.payment, ...(await payroll())});
}
