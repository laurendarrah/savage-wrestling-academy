// Owner books (issue #194): income and expenses by month and year, CSV export, and the owner's own entries.
// Card and offline payments are read from orders (lib/financials.ts); only expenses and other income are written here.
import {env} from 'cloudflare:workers';
import {ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {academyToday, cleanEntry, ledgerCsv, ledgerLines, ledgerReport, periodBounds, validMonth} from '../../../lib/financials';
import {rateLimited} from '../../../lib/rate-limit';
export const dynamic = 'force-dynamic';

const OWNER_ONLY = 'Owner sign-in and authenticator verification required.';

export async function GET(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: OWNER_ONLY}, 403);
  const q = new URL(request.url).searchParams;
  if (q.get('format') === 'csv') {
    const period = periodBounds(q);
    if (!period) return reply({error: 'Choose a month or a year.'}, 400);
    auth.headers.set('Content-Type', 'text/csv; charset=utf-8');
    auth.headers.set('Content-Disposition', `attachment; filename="savage-income-expenses-${period.label}.csv"`);
    return new Response(ledgerCsv(await ledgerLines(period.from, period.to)), {headers: auth.headers});
  }
  const month = q.get('month') ?? academyToday().slice(0, 7);
  if (!validMonth(month)) return reply({error: 'Choose a month.'}, 400);
  return reply(await ledgerReport(month));
}

export async function POST(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: OWNER_ONLY}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 4096) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (await rateLimited(request, 'financials:' + auth.owner.userId, 60)) return reply({error: 'Too many changes. Please wait a minute.'}, 429);
  const action = input?.action, actor = auth.owner.userId, at = new Date().toISOString();
  if (!['add', 'edit', 'delete'].includes(action)) return reply({error: 'Unknown action.'}, 400);
  const log = (what: string, id: string, detail: string) => env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) SELECT ?,?,?,?,? WHERE changes()=1')
    .bind(crypto.randomUUID(), actor, 'ledger_entry_' + what, `${id} ${detail}`.trim(), at);

  if (action === 'add') {
    const c = cleanEntry(input);
    if ('error' in c) return reply({error: c.error}, 400);
    const e = c.entry, id = crypto.randomUUID();
    await env.DB!.batch([
      env.DB!.prepare(`INSERT INTO financial_entries(id,kind,entry_date,amount_cents,category,note,receipt,revision,created_at,created_by,updated_at,updated_by)
        VALUES (?,?,?,?,?,?,?,1,?,?,?,?)`).bind(id, e.kind, e.date, e.amountCents, e.category, e.note, e.receipt, at, actor, at, actor),
      log('added', id, `${e.kind} ${e.amountCents}`)]);
    return reply({ok: true, id, revision: 1});
  }

  // Edits and deletes name the revision the owner saw, so a change made in another tab is never overwritten.
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(input.id) || !Number.isSafeInteger(input.revision) || input.revision < 1)
    return reply({error: 'Choose an entry.'}, 400);
  if (action === 'edit') {
    const c = cleanEntry(input);
    if ('error' in c) return reply({error: c.error}, 400);
    const e = c.entry;
    const [saved] = await env.DB!.batch([
      env.DB!.prepare(`UPDATE financial_entries SET kind=?,entry_date=?,amount_cents=?,category=?,note=?,receipt=?,revision=revision+1,updated_at=?,updated_by=?
        WHERE id=? AND revision=? AND deleted_at IS NULL RETURNING revision`).bind(e.kind, e.date, e.amountCents, e.category, e.note, e.receipt, at, actor, input.id, input.revision),
      log('edited', input.id, `${e.kind} ${e.amountCents}`)]);
    const row = saved.results[0] as {revision: number} | undefined;
    return row ? reply({ok: true, id: input.id, revision: row.revision}) : reply({error: 'This entry was changed or deleted somewhere else. Refresh to see it.'}, 409);
  }
  const [gone] = await env.DB!.batch([
    env.DB!.prepare('UPDATE financial_entries SET deleted_at=?,deleted_by=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=? AND deleted_at IS NULL RETURNING id')
      .bind(at, actor, at, actor, input.id, input.revision),
    log('deleted', input.id, '')]);
  return gone.results.length ? reply({ok: true}) : reply({error: 'This entry was changed or deleted somewhere else. Refresh to see it.'}, 409);
}
