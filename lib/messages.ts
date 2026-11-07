// Announcements and family messages (issue #72). Families read them in their account (/inbox); each is also emailed
// once an email provider is configured (lib/email.ts). Links in emails use appOrigin(), never a hard-coded host.
import {env} from 'cloudflare:workers';
import {appOrigin} from './account-auth';
import {academyToday} from './public-schedule';
import {PROGRAM_ON} from './transfers';
import {programDetails} from './program-names';
import {sendEmailsDetailed} from './email';
import {familyNotices, markNoticeRead} from './notify';
import {jsonChunks, keysetPage, type SortCol} from './paging';
import {familyMatch} from './family-search';

export type Audience = {type: 'all'} | {type: 'program'; program: string} | {type: 'event'; eventId: string};
const at = () => new Date().toISOString();
export const footer = () => `\n\n—\nSavage Wrestling Academy\nRead and reply in your family account: ${appOrigin()}/inbox`;
// A private message is emailed as a notice with a link; the message itself stays in the account.
export const messageNotice = () => ({subject: 'New message from Savage Wrestling Academy', text: 'You have a new message from the academy.' + footer()});

async function academyState(): Promise<any> {
  const row = await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload: string}>();
  return row ? JSON.parse(row.payload) : {};
}

// Families who receive an announcement, worked out when it is sent.
export async function resolveAudience(a: any): Promise<{label: string; families: {userId: string; email: string}[]} | {error: string}> {
  const today = academyToday();
  if (a?.type === 'all') {
    const rows = (await env.DB!.prepare('SELECT user_id AS userId,email FROM family_accounts ORDER BY email').all<{userId: string; email: string}>()).results;
    return {label: 'All families', families: rows};
  }
  if (a?.type === 'program' && programDetails[a.program]) {
    // Members today (paid membership in force, by the program on today's date) and active scholarships.
    const rows = (await env.DB!.prepare(`SELECT DISTINCT f.user_id AS userId,f.email FROM family_accounts f WHERE f.user_id IN (
        SELECT orders.user_id FROM orders WHERE orders.status='paid' AND orders.kind IN ('annual','monthly') AND orders.term_start<=? AND orders.term_end>=? AND ${PROGRAM_ON}=?
        UNION SELECT user_id FROM scholarship_awards WHERE status='active' AND program=? AND user_id IS NOT NULL) ORDER BY f.email`)
      .bind(today, today, today, a.program, a.program).all<{userId: string; email: string}>()).results;
    return {label: programDetails[a.program].name + ' members', families: rows};
  }
  if (a?.type === 'event' && typeof a.eventId === 'string') {
    const e = (await academyState()).events?.find((x: any) => x.id === a.eventId);
    if (!e) return {error: 'Choose an event.'};
    const rows = (await env.DB!.prepare("SELECT DISTINCT f.user_id AS userId,f.email FROM family_accounts f JOIN orders o ON o.user_id=f.user_id WHERE o.kind='event' AND o.item_id=? AND o.status='paid' ORDER BY f.email")
      .bind(a.eventId).all<{userId: string; email: string}>()).results;
    return {label: 'Registered for ' + e.name, families: rows};
  }
  return {error: 'Choose who receives this announcement.'};
}

const cleanText = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '';

export async function sendAnnouncement(ownerId: string, input: any) {
  const subject = cleanText(input?.subject, 150), body = cleanText(input?.body, 10000);
  if (subject.length < 3) return {status: 400, error: 'Add a subject.'};
  if (body.length < 3) return {status: 400, error: 'Write the announcement.'};
  const audience = await resolveAudience(input.audience);
  if ('error' in audience) return {status: 400, error: audience.error};
  if (!audience.families.length) return {status: 409, error: 'No families match this audience yet.'};
  const id = crypto.randomUUID(), sentAt = at();
  const results = await sendEmailsDetailed(audience.families.map(f => ({to: f.email, subject: subject, text: body + footer()})));
  // Recipients go in a few hundred per statement (issue #46), all in one transaction with the announcement.
  const recipients = audience.families.map((f, i) => ({userId: f.userId, email: f.email, status: results[i].status, reason: results[i].reason}));
  await env.DB!.batch([
    env.DB!.prepare('INSERT INTO announcements(id,subject,body,audience,audience_label,sent_by,sent_at,recipients) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, subject, body, JSON.stringify(input.audience), audience.label, ownerId, sentAt, audience.families.length),
    ...jsonChunks(recipients).map(part => env.DB!.prepare(`INSERT INTO announcement_recipients(announcement_id,user_id,email,read_at,email_status,email_error)
      SELECT ?,json_extract(value,'$.userId'),json_extract(value,'$.email'),NULL,json_extract(value,'$.status'),json_extract(value,'$.reason') FROM json_each(?)`).bind(id, JSON.stringify(part))),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'announcement_sent', `${id} ${audience.families.length}`, sentAt)
  ]);
  return {status: 200, id, recipients: audience.families.length, emailed: results.filter(r => r.status === 'sent').length};
}

// A message in a family's private thread with the academy. Emails carry a notice and a link, not the message itself.
export async function postMessage(userId: string, senderRole: 'owner' | 'family', text: unknown) {
  const body = cleanText(text, 5000);
  if (!body) return {status: 400, error: 'Write a message.'};
  const fam = await env.DB!.prepare('SELECT email FROM family_accounts WHERE user_id=?').bind(userId).first<{email: string}>();
  if (!fam) return {status: 404, error: 'Family account not found.'};
  const [sent] = senderRole === 'owner'
    ? await sendEmailsDetailed([{to: fam.email, ...messageNotice()}])
    : [{status: 'skipped' as const, reason: null}];
  await env.DB!.prepare('INSERT INTO family_messages(id,user_id,sender_role,body,created_at,read_at,email_status,email_error) VALUES (?,?,?,?,?,NULL,?,?)')
    .bind(crypto.randomUUID(), userId, senderRole, body, at(), sent.status, sent.reason).run();
  return {status: 200};
}

// Paging (issue #46). Lists of messages come newest first, a page at a time; a conversation shows its latest
// messages, oldest at the top, with earlier ones a tap away. Unread counts are counted in the database, so they cover
// every message, not just the ones on screen.
export const INBOX_PAGE = 50, THREAD_PAGE = 100;
const NEWEST: SortCol[] = [{expr: 'created_at', desc: true}, {expr: 'id', desc: true}];

// A family's (or, for the owner, any family's) private conversation: the latest messages, in time order, and a cursor
// for the ones before them.
async function threadPage(userId: string, cursor?: unknown, limit = THREAD_PAGE) {
  const page = await keysetPage<any>({select: 'id,sender_role,body,created_at,read_at,email_status', from: 'FROM family_messages', where: 'user_id=?', args: [userId],
    cols: NEWEST, keyOf: m => [m.created_at, m.id], cursor, limit});
  return {rows: page.rows.reverse(), earlier: page.next};
}
export async function announcementsPage(userId: string, cursor?: unknown, limit = INBOX_PAGE) {
  const page = await keysetPage<any>({select: 'a.id,a.subject,a.body,a.sent_at,r.read_at', from: 'FROM announcement_recipients r JOIN announcements a ON a.id=r.announcement_id', where: 'r.user_id=?',
    args: [userId], cols: [{expr: 'a.sent_at', desc: true}, {expr: 'a.id', desc: true}], keyOf: a => [a.sent_at, a.id], cursor, limit});
  return {announcements: page.rows.map(a => ({id: a.id, subject: a.subject, body: a.body, sentAt: a.sent_at, read: !!a.read_at})), announcementsNext: page.next};
}
const familyThread = (rows: any[]) => rows.map(m => ({id: m.id, from: m.sender_role === 'owner' ? 'academy' : 'you', body: m.body, at: m.created_at}));
export async function familyThreadPage(userId: string, cursor?: unknown) {
  const t = await threadPage(userId, cursor);
  return {thread: familyThread(t.rows), threadEarlier: t.earlier};
}
export async function unreadCount(userId: string) {
  const r = await env.DB!.prepare(`SELECT (SELECT count(*) FROM notifications WHERE user_id=?1 AND read_at IS NULL)
      + (SELECT count(*) FROM announcement_recipients WHERE user_id=?1 AND read_at IS NULL)
      + (SELECT count(*) FROM family_messages WHERE user_id=?1 AND sender_role='owner' AND read_at IS NULL) AS n`).bind(userId).first<{n: number}>();
  return Number(r?.n ?? 0);
}

export async function familyInbox(userId: string) {
  const [notices, ann, thread, unread] = await Promise.all([familyNotices(userId), announcementsPage(userId), familyThreadPage(userId), unreadCount(userId)]);
  return {...notices, ...ann, ...thread, unread};
}

export async function markRead(userId: string, input: any) {
  // "Mark all as read" on the Messages page (issue #132): every notice, announcement and academy reply for this family only.
  if (input?.all === true) {
    const now = at();
    await env.DB!.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').bind(now, userId).run();
    await env.DB!.prepare('UPDATE announcement_recipients SET read_at=? WHERE user_id=? AND read_at IS NULL').bind(now, userId).run();
    await env.DB!.prepare("UPDATE family_messages SET read_at=? WHERE user_id=? AND sender_role='owner' AND read_at IS NULL").bind(now, userId).run();
    return;
  }
  if (input?.noticeId) await markNoticeRead(userId, input.noticeId);
  if (input?.announcementId) await env.DB!.prepare('UPDATE announcement_recipients SET read_at=? WHERE announcement_id=? AND user_id=? AND read_at IS NULL').bind(at(), String(input.announcementId), userId).run();
  if (input?.thread) await env.DB!.prepare("UPDATE family_messages SET read_at=? WHERE user_id=? AND sender_role='owner' AND read_at IS NULL").bind(at(), userId).run();
}

export const SENT_PAGE = 25, FAMILY_PAGE = 30;
// Sent announcements, newest first, a page at a time.
export async function sentPage(cursor?: unknown, limit = SENT_PAGE) {
  const page = await keysetPage<any>({select: `a.id,a.subject,a.audience_label,a.sent_at,a.recipients,
      (SELECT count(*) FROM announcement_recipients r WHERE r.announcement_id=a.id AND r.read_at IS NOT NULL) AS opened,
      (SELECT count(*) FROM announcement_recipients r WHERE r.announcement_id=a.id AND r.email_status='sent') AS emailed,
      (SELECT count(*) FROM announcement_recipients r WHERE r.announcement_id=a.id AND r.email_status='failed') AS failed`,
    from: 'FROM announcements a', cols: [{expr: 'a.sent_at', desc: true}, {expr: 'a.id', desc: true}], keyOf: a => [a.sent_at, a.id], cursor, limit});
  return {sent: page.rows, sentNext: page.next};
}
// Families for the owner's conversations: latest conversation first, then families with none by email. The search runs
// over every family in the database; the list comes a page at a time with the number of matches.
const FAMILY_COLS: SortCol[] = [{expr: '(x.last IS NULL)'}, {expr: "COALESCE(x.last,'')", desc: true}, {expr: 'x.email'}, {expr: 'x.user_id'}];
export async function familiesPage(q?: unknown, cursor?: unknown, limit = FAMILY_PAGE) {
  const m = familyMatch(q), where = m ? ' WHERE ' + m.sql : '';
  const [page, count] = await Promise.all([keysetPage<any>({select: 'x.*', from: `FROM (SELECT f.user_id,f.email,f.payload,
        (SELECT count(*) FROM family_messages m WHERE m.user_id=f.user_id AND m.sender_role='family' AND m.read_at IS NULL) AS unread,
        (SELECT max(created_at) FROM family_messages m WHERE m.user_id=f.user_id) AS last
      FROM family_accounts f${where}) x`, args: m?.args, cols: FAMILY_COLS, keyOf: f => [f.last === null ? 1 : 0, f.last ?? '', f.email, f.user_id], cursor, limit}),
    env.DB!.prepare(`SELECT count(*) AS n FROM family_accounts f${where}`).bind(...(m?.args ?? [])).first<{n: number}>()]);
  return {families: page.rows.map(f => { const p = JSON.parse(f.payload || '{}'); return {userId: f.user_id, email: f.email, parentName: p.parentName || '', wrestlers: (p.wrestlers || []).map((w: any) => w.name), unread: f.unread, last: f.last}; }),
    familiesNext: page.next, familiesMatched: Number(count?.n ?? 0)};
}

export async function ownerMessages(q?: unknown) {
  const [sent, families, state] = await Promise.all([sentPage(), familiesPage(q), academyState()]);
  return {
    ...sent, ...families,
    events: (state.events ?? []).filter((e: any) => !e.archived).map((e: any) => ({id: e.id, name: e.name})),
    programs: Object.entries(programDetails).map(([id, d]) => ({id, name: d.name}))
  };
}

// A family's conversation for the owner: the latest messages, with a cursor for earlier ones. Opening it marks the
// family's messages read.
export async function ownerThread(userId: string, cursor?: unknown) {
  if (!cursor) await env.DB!.prepare("UPDATE family_messages SET read_at=? WHERE user_id=? AND sender_role='family' AND read_at IS NULL").bind(at(), userId).run();
  const t = await threadPage(userId, cursor);
  return {thread: t.rows.map(m => ({id: m.id, from: m.sender_role, body: m.body, at: m.created_at, read: !!m.read_at, emailStatus: m.email_status})), earlier: t.earlier};
}
