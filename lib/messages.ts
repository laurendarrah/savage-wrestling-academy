// Announcements and family messages (issue #72). Families read them in their account (/inbox); each is also emailed
// once an email provider is configured (lib/email.ts). Links in emails use appOrigin(), never a hard-coded host.
import {env} from 'cloudflare:workers';
import {appOrigin} from './account-auth';
import {academyToday} from './public-schedule';
import {PROGRAM_ON} from './transfers';
import {programDetails} from './program-names';
import {sendEmails} from './email';

export type Audience = {type: 'all'} | {type: 'program'; program: string} | {type: 'event'; eventId: string};
const at = () => new Date().toISOString();
const footer = () => `\n\n—\nSavage Wrestling Academy\nRead and reply in your family account: ${appOrigin()}/inbox`;

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
  const statuses = await sendEmails(audience.families.map(f => ({to: f.email, subject: subject, text: body + footer()})));
  await env.DB!.batch([
    env.DB!.prepare('INSERT INTO announcements(id,subject,body,audience,audience_label,sent_by,sent_at,recipients) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, subject, body, JSON.stringify(input.audience), audience.label, ownerId, sentAt, audience.families.length),
    ...audience.families.map((f, i) => env.DB!.prepare('INSERT INTO announcement_recipients(announcement_id,user_id,email,read_at,email_status) VALUES (?,?,?,NULL,?)').bind(id, f.userId, f.email, statuses[i])),
    env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), ownerId, 'announcement_sent', `${id} ${audience.families.length}`, sentAt)
  ]);
  return {status: 200, id, recipients: audience.families.length, emailed: statuses.filter(s => s === 'sent').length};
}

// A message in a family's private thread with the academy. Emails carry a notice and a link, not the message itself.
export async function postMessage(userId: string, senderRole: 'owner' | 'family', text: unknown) {
  const body = cleanText(text, 5000);
  if (!body) return {status: 400, error: 'Write a message.'};
  const fam = await env.DB!.prepare('SELECT email FROM family_accounts WHERE user_id=?').bind(userId).first<{email: string}>();
  if (!fam) return {status: 404, error: 'Family account not found.'};
  const [status] = senderRole === 'owner'
    ? await sendEmails([{to: fam.email, subject: 'New message from Savage Wrestling Academy', text: 'You have a new message from the academy.' + footer()}])
    : ['skipped' as const];
  await env.DB!.prepare('INSERT INTO family_messages(id,user_id,sender_role,body,created_at,read_at,email_status) VALUES (?,?,?,?,?,NULL,?)')
    .bind(crypto.randomUUID(), userId, senderRole, body, at(), status).run();
  return {status: 200};
}

export async function familyInbox(userId: string) {
  const ann = (await env.DB!.prepare('SELECT a.id,a.subject,a.body,a.sent_at,r.read_at FROM announcement_recipients r JOIN announcements a ON a.id=r.announcement_id WHERE r.user_id=? ORDER BY a.sent_at DESC LIMIT 200')
    .bind(userId).all<any>()).results;
  const thread = (await env.DB!.prepare('SELECT id,sender_role,body,created_at,read_at FROM family_messages WHERE user_id=? ORDER BY created_at,id LIMIT 500').bind(userId).all<any>()).results;
  return {
    announcements: ann.map(a => ({id: a.id, subject: a.subject, body: a.body, sentAt: a.sent_at, read: !!a.read_at})),
    thread: thread.map(m => ({id: m.id, from: m.sender_role === 'owner' ? 'academy' : 'you', body: m.body, at: m.created_at})),
    unread: ann.filter(a => !a.read_at).length + thread.filter(m => m.sender_role === 'owner' && !m.read_at).length
  };
}

export async function markRead(userId: string, input: any) {
  if (input?.announcementId) await env.DB!.prepare('UPDATE announcement_recipients SET read_at=? WHERE announcement_id=? AND user_id=? AND read_at IS NULL').bind(at(), String(input.announcementId), userId).run();
  if (input?.thread) await env.DB!.prepare("UPDATE family_messages SET read_at=? WHERE user_id=? AND sender_role='owner' AND read_at IS NULL").bind(at(), userId).run();
}

export async function ownerMessages() {
  const sent = (await env.DB!.prepare(`SELECT a.id,a.subject,a.audience_label,a.sent_at,a.recipients,
      (SELECT count(*) FROM announcement_recipients r WHERE r.announcement_id=a.id AND r.read_at IS NOT NULL) AS opened,
      (SELECT count(*) FROM announcement_recipients r WHERE r.announcement_id=a.id AND r.email_status='sent') AS emailed
    FROM announcements a ORDER BY a.sent_at DESC LIMIT 100`).all<any>()).results;
  const families = (await env.DB!.prepare(`SELECT f.user_id,f.email,f.payload,
      (SELECT count(*) FROM family_messages m WHERE m.user_id=f.user_id AND m.sender_role='family' AND m.read_at IS NULL) AS unread,
      (SELECT max(created_at) FROM family_messages m WHERE m.user_id=f.user_id) AS last
    FROM family_accounts f ORDER BY last IS NULL, last DESC, f.email LIMIT 2000`).all<any>()).results;
  const state = await academyState();
  return {
    sent,
    families: families.map(f => { const p = JSON.parse(f.payload || '{}'); return {userId: f.user_id, email: f.email, parentName: p.parentName || '', wrestlers: (p.wrestlers || []).map((w: any) => w.name), unread: f.unread, last: f.last}; }),
    events: (state.events ?? []).filter((e: any) => !e.archived).map((e: any) => ({id: e.id, name: e.name})),
    programs: Object.entries(programDetails).map(([id, d]) => ({id, name: d.name}))
  };
}

export async function ownerThread(userId: string) {
  await env.DB!.prepare("UPDATE family_messages SET read_at=? WHERE user_id=? AND sender_role='family' AND read_at IS NULL").bind(at(), userId).run();
  return (await env.DB!.prepare('SELECT id,sender_role,body,created_at,read_at,email_status FROM family_messages WHERE user_id=? ORDER BY created_at,id LIMIT 500').bind(userId).all<any>()).results
    .map(m => ({id: m.id, from: m.sender_role, body: m.body, at: m.created_at, read: !!m.read_at, emailStatus: m.email_status}));
}
