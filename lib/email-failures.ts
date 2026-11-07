// Emails that didn't send (issue #35). Announcements, private message notices and automatic notices each record
// whether their email went out (email_status) and, if not, why (email_error). The owner sees the failures from the
// last 30 days on /messages, with the family, when, what and why in plain words, and can send them again. Families
// still have every message in their account, so a failed email never loses the message itself.
import {env} from 'cloudflare:workers';
import {emailConfigured, failureWords, sendEmailsDetailed, type EmailResult, type Outgoing} from './email';
import {footer as inboxFooter, messageNotice} from './messages';
import {footer as noticeFooter} from './notify';

export type FailedKind = 'announcement' | 'message' | 'notice';
export const FAILED_DAYS = 30;
const LIST_LIMIT = 200, RETRY_LIMIT = 100;

const since = (now = Date.now()) => new Date(now - FAILED_DAYS * 86400000).toISOString();
// One row per email that didn't send. Only the owner's own messages are emailed, so family replies never appear.
const FAILED = `SELECT 'announcement' AS kind, r.announcement_id AS id, r.user_id AS userId, r.email AS email, a.sent_at AS at, 'Announcement: ' || a.subject AS what, r.email_error AS reason
    FROM announcement_recipients r JOIN announcements a ON a.id=r.announcement_id WHERE r.email_status='failed' AND a.sent_at>=?1
  UNION ALL SELECT 'message', m.id, m.user_id, f.email, m.created_at, 'Notice of a private message from the academy', m.email_error
    FROM family_messages m LEFT JOIN family_accounts f ON f.user_id=m.user_id WHERE m.email_status='failed' AND m.sender_role='owner' AND m.created_at>=?1
  UNION ALL SELECT 'notice', n.id, n.user_id, n.email, n.created_at, n.subject, n.email_error
    FROM notifications n WHERE n.email_status='failed' AND n.created_at>=?1`;

export async function failedEmailCount() {
  return (await env.DB!.prepare(`SELECT count(*) AS n FROM (${FAILED})`).bind(since()).first<{n: number}>())?.n ?? 0;
}

// Who each email was for: the family account (parent name and sign-in email, as on the other owner pages), or the
// coach for a coach's lesson notice.
export async function failedEmails() {
  const rows = (await env.DB!.prepare(`SELECT * FROM (${FAILED}) ORDER BY at DESC, id LIMIT ${LIST_LIMIT}`).bind(since()).all<any>()).results;
  const ids = [...new Set(rows.map(r => r.userId).filter(Boolean))];
  const families = new Map((ids.length ? (await env.DB!.prepare("SELECT user_id AS userId, email, json_extract(payload,'$.parentName') AS parentName FROM family_accounts WHERE user_id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(ids)).all<any>()).results : []).map(f => [f.userId, f]));
  const coachEmails = [...new Set(rows.filter(r => !r.userId).map(r => r.email))];
  const coaches = new Map((coachEmails.length ? (await env.DB!.prepare('SELECT email, name FROM staff_access WHERE email IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(coachEmails)).all<any>()).results : []).map(c => [c.email, c.name]));
  return rows.map(r => {
    const family = r.userId ? families.get(r.userId) : null;
    return {
      kind: r.kind as FailedKind, id: r.id as string, userId: (r.userId ?? null) as string | null, at: r.at as string, what: r.what as string,
      to: r.userId ? {name: family?.parentName || family?.email || 'A family account that was closed', email: family?.email ?? r.email ?? '', coach: false}
        : {name: coaches.get(r.email) || 'Coach', email: r.email as string, coach: true},
      reason: failureWords(r.reason)
    };
  });
}

type Job = {mail: Outgoing; claim: D1PreparedStatement; finish: (r: EmailResult) => D1PreparedStatement};
const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

// Rebuilds the email from what was saved, and the statements that claim it (so a double click sends once) and record
// the new result. Notices go out with a link to the family's Messages page (or the coach page), where they are kept.
async function job(ref: any): Promise<Job | null> {
  const id = text(ref?.id, 100), db = env.DB!;
  if (!id) return null;
  const finish = (table: string, where: string, binds: unknown[]) => (r: EmailResult) =>
    db.prepare(`UPDATE ${table} SET email_status=?, email_error=CASE WHEN ?='sent' THEN NULL ELSE COALESCE(?, email_error) END WHERE ${where} AND email_status='retrying'`)
      .bind(r.status === 'sent' ? 'sent' : 'failed', r.status, r.reason, ...binds);
  const claim = (table: string, where: string, binds: unknown[]) => db.prepare(`UPDATE ${table} SET email_status='retrying' WHERE ${where} AND email_status='failed'`).bind(...binds);
  if (ref.kind === 'announcement') {
    const userId = text(ref.userId, 200);
    if (!userId) return null;
    const row = await db.prepare("SELECT r.email, a.subject, a.body FROM announcement_recipients r JOIN announcements a ON a.id=r.announcement_id WHERE r.announcement_id=? AND r.user_id=? AND r.email_status='failed'")
      .bind(id, userId).first<{email: string; subject: string; body: string}>();
    if (!row) return null;
    const where = 'announcement_id=? AND user_id=?';
    return {mail: {to: row.email, subject: row.subject, text: row.body + inboxFooter()}, claim: claim('announcement_recipients', where, [id, userId]), finish: finish('announcement_recipients', where, [id, userId])};
  }
  if (ref.kind === 'message') {
    const row = await db.prepare("SELECT f.email FROM family_messages m JOIN family_accounts f ON f.user_id=m.user_id WHERE m.id=? AND m.sender_role='owner' AND m.email_status='failed'")
      .bind(id).first<{email: string}>();
    if (!row) return null;
    return {mail: {to: row.email, ...messageNotice()}, claim: claim('family_messages', 'id=?', [id]), finish: finish('family_messages', 'id=?', [id])};
  }
  if (ref.kind === 'notice') {
    const row = await db.prepare("SELECT user_id, email, subject, body FROM notifications WHERE id=? AND email_status='failed'").bind(id).first<{user_id: string | null; email: string; subject: string; body: string}>();
    if (!row) return null;
    return {mail: {to: row.email, subject: row.subject, text: row.body + noticeFooter(row.user_id ? '/inbox' : '/coach')}, claim: claim('notifications', 'id=?', [id]), finish: finish('notifications', 'id=?', [id])};
  }
  return null;
}

export async function retryFailedEmails(refs: unknown, actor: string) {
  if (!Array.isArray(refs) || !refs.length) return {status: 400, error: 'Choose the emails to send again.'};
  if (refs.length > RETRY_LIMIT) return {status: 400, error: `Send at most ${RETRY_LIMIT} at a time.`};
  if (!emailConfigured()) return {status: 409, error: "Email isn't set up yet, so nothing can be sent. Families still see everything on the Messages page of their account."};
  const jobs: Job[] = [];
  for (const ref of refs) { const j = await job(ref); if (j) jobs.push(j); }
  if (!jobs.length) return {status: 409, error: 'These emails already went out or are no longer waiting to be sent.'};
  const claims = await env.DB!.batch(jobs.map(j => j.claim));
  const mine = jobs.filter((_, i) => Number((claims[i] as any)?.meta?.changes ?? 0) === 1);
  if (!mine.length) return {status: 409, error: 'These emails are already being sent.'};
  const results = await sendEmailsDetailed(mine.map(j => j.mail));
  const sent = results.filter(r => r.status === 'sent').length;
  await env.DB!.batch([...mine.map((j, i) => j.finish(results[i])),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), actor, 'emails_resent', `${sent} of ${mine.length} sent`, new Date().toISOString())]);
  return {status: 200, sent, failed: mine.length - sent};
}
