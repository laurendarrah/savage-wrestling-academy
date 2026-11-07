// Family data requests (issue #113). A family can download everything the academy holds about them, and ask for their
// account to be closed. The owner records how each closure request was handled. What is deleted on closure is the
// owner's decision (payment records and signed waivers may need to be kept), so nothing is deleted automatically.
import {env} from 'cloudflare:workers';

const all = async (sql: string, ...args: unknown[]) => (await env.DB!.prepare(sql).bind(...args).all<any>()).results;
const parse = (v: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return v; } };

// Everything about one family, as a single file. Other families, staff notes about the business and secrets
// (pass tokens, Stripe ids) are left out.
export async function familyExport(userId: string) {
  const fam = await env.DB!.prepare('SELECT email,payload,updated_at FROM family_accounts WHERE user_id=?').bind(userId).first<{email: string; payload: string; updated_at: string}>();
  if (!fam) return null;
  const orders = (await all(`SELECT id,kind,program,item_label,dates,wrestler_name,amount_cents,discount_cents,status,source,created_at,paid_at,term_start,term_end FROM orders WHERE user_id=? ORDER BY created_at`, userId))
    .map(o => ({...o, dates: parse(o.dates)}));
  return {
    exportedAt: new Date().toISOString(),
    academy: 'Savage Wrestling Academy',
    account: {email: fam.email, profileUpdatedAt: fam.updated_at},
    profile: JSON.parse(fam.payload),
    payments: orders,
    subscriptions: await all('SELECT s.status,s.payments_made,s.payments_total,s.term_start,s.term_end,s.paid_through FROM subscriptions s JOIN orders o ON o.id=s.order_id WHERE o.user_id=?', userId),
    attendance: await all('SELECT session_date,session_key,wrestler_name,checked_in_at FROM attendance WHERE user_id=? ORDER BY session_date', userId),
    usaWrestlingCardReviews: await all('SELECT wrestler_id,number,expires,status,note,reviewed_at FROM usaw_reviews WHERE user_id=?', userId),
    // The latest check on USA Wrestling's verify page (issue #202). The name USA Wrestling showed is included only when it
    // matched this wrestler, so a mistyped number never reveals someone else's name.
    usaWrestlingCardChecks: await all("SELECT wrestler_id,number,expires,season,status,outcome,CASE WHEN outcome IN ('verified','inactive','season') THEN card_name END AS card_name,CASE WHEN outcome IN ('verified','inactive','season') THEN card_state END AS card_state,checked_at FROM usaw_lookups WHERE user_id=?", userId),
    waiverSignatures: await all('SELECT s.wrestler_name,s.signer,s.signed_at,v.title,v.published_at FROM waiver_signatures s JOIN waiver_versions v ON v.id=s.version_id WHERE s.user_id=? ORDER BY s.signed_at', userId),
    advanceApprovals: await all("SELECT wrestler_name,grade,program,status,created_at,updated_at FROM program_approvals WHERE user_id=?", userId),
    approvalMessages: await all("SELECT m.sender_role,m.body,m.created_at FROM approval_messages m JOIN program_approvals a ON a.id=m.approval_id WHERE a.user_id=? ORDER BY m.created_at", userId),
    scholarships: await all('SELECT wrestler_name,program,status,signer,accepted_at,ended_at FROM scholarship_awards WHERE user_id=?', userId),
    waitlists: await all('SELECT event_id,option,wrestler_name,status,created_at,offered_at,offer_expires_at,closed_at FROM waitlist_entries WHERE user_id=?', userId),
    bookingExceptions: await all('SELECT wrestler_id,rule,starts_on,ends_on,reason,created_at,revoked_at FROM booking_exceptions WHERE user_id=?', userId),
    messagesWithTheAcademy: await all("SELECT sender_role,body,created_at FROM family_messages WHERE user_id=? ORDER BY created_at", userId),
    announcementsReceived: await all('SELECT a.subject,a.body,a.sent_at,r.read_at FROM announcement_recipients r JOIN announcements a ON a.id=r.announcement_id WHERE r.user_id=? ORDER BY a.sent_at', userId),
    notices: await all('SELECT kind,subject,body,created_at,read_at FROM notifications WHERE user_id=? ORDER BY created_at', userId),
    requests: await all('SELECT kind,note,status,created_at,resolved_at,resolution FROM data_requests WHERE user_id=? ORDER BY created_at', userId),
  };
}

export async function requestClosure(user: {id: string; email: string}, note: unknown) {
  const open = await env.DB!.prepare("SELECT 1 FROM data_requests WHERE user_id=? AND kind='close' AND status='open'").bind(user.id).first();
  if (open) return {status: 409, error: 'Your request is already with the academy. They will contact you.'};
  const at = new Date().toISOString();
  await env.DB!.batch([
    env.DB!.prepare("INSERT INTO data_requests(id,user_id,email,kind,note,status,created_at) VALUES (?,?,?,'close',?,'open',?)").bind(crypto.randomUUID(), user.id, user.email, typeof note === 'string' ? note.trim().slice(0, 1000) : '', at),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), user.id, 'account_closure_requested', user.id, at)
  ]);
  return {status: 200};
}

export async function familyRequests(userId: string) {
  return all('SELECT kind,status,created_at,resolved_at,resolution FROM data_requests WHERE user_id=? ORDER BY created_at DESC', userId);
}

export async function ownerRequests() {
  const rows = await all("SELECT r.*,f.payload AS family FROM data_requests r LEFT JOIN family_accounts f ON f.user_id=r.user_id ORDER BY r.status='open' DESC, r.created_at DESC LIMIT 200");
  return rows.map(r => { const p = r.family ? JSON.parse(r.family) : {}; return {id: r.id, userId: r.user_id, email: r.email, parentName: p.parentName ?? '', wrestlers: (p.wrestlers ?? []).map((w: any) => w.name), kind: r.kind, note: r.note, status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at, resolution: r.resolution}; });
}

export async function resolveRequest(ownerId: string, id: unknown, resolution: unknown) {
  const text = typeof resolution === 'string' ? resolution.trim().slice(0, 1000) : '';
  if (typeof id !== 'string') return {status: 400, error: 'Choose a request.'};
  if (text.length < 3) return {status: 400, error: 'Write what was done, for example "Profile removed; payment records kept for tax purposes."'};
  const at = new Date().toISOString();
  const r = await env.DB!.prepare("UPDATE data_requests SET status='handled',resolved_at=?,resolved_by=?,resolution=? WHERE id=? AND status='open'").bind(at, ownerId, text, id).run();
  if (!Number(r.meta?.changes ?? (r as any).changes ?? 0)) return {status: 404, error: 'Open request not found.'};
  await env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'data_request_handled', id, at).run();
  return {status: 200};
}
