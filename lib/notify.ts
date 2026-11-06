// Automatic notices (issue #105). A notice goes to the family's Messages inbox and, once an email provider is set
// (#87), by email. Coaches have no inbox, so their notices are email only. Each event has a dedupe key and is sent once,
// however many times the code that triggers it runs. Links use appOrigin(), never a hard-coded host.
import {env} from 'cloudflare:workers';
import {appOrigin} from './account-auth';
import {academyToday} from './public-schedule';
import {sendEmails} from './email';
import {currentWaiver} from './waivers';
import {dayTime, fullDate, when} from './datetime';

type Notice = {userId: string | null; email: string; kind: string; subject: string; body: string; dedupeKey: string; link?: string};

const footer = (link = '/inbox') => `\n\n—\nSavage Wrestling Academy\n${appOrigin()}${link}`;

// Saves each new notice and emails it. Notices already sent (same dedupe key) are skipped silently.
export async function notify(list: Notice[]) {
  const fresh: Notice[] = [];
  for (const n of list) {
    const seen = await env.DB!.prepare('SELECT 1 FROM notifications WHERE dedupe_key=?').bind(n.dedupeKey).first();
    if (!seen) fresh.push(n);
  }
  if (!fresh.length) return 0;
  const statuses = await sendEmails(fresh.map(n => ({to: n.email, subject: n.subject, text: n.body + footer(n.link)})));
  const at = new Date().toISOString();
  let saved = 0;
  for (let i = 0; i < fresh.length; i++) {
    const n = fresh[i];
    const r = await env.DB!.prepare('INSERT OR IGNORE INTO notifications(id,user_id,email,kind,subject,body,dedupe_key,created_at,read_at,email_status) VALUES (?,?,?,?,?,?,?,?,NULL,?)')
      .bind(crypto.randomUUID(), n.userId, n.email, n.kind, n.subject, n.body, n.dedupeKey, at, statuses[i]).run();
    saved += Number(r.meta?.changes ?? (r as any).changes ?? 0);
  }
  return saved;
}

async function family(userId: string) {
  const row = await env.DB!.prepare('SELECT email,payload FROM family_accounts WHERE user_id=?').bind(userId).first<{email: string; payload: string}>();
  return row ? {email: row.email, ...JSON.parse(row.payload)} : null;
}
const longDate = fullDate;

// Run a notice without letting a failure affect the caller.
export async function quietly(fn: () => Promise<unknown>) { try { await fn(); } catch (e) { console.error('notice failed', e); } }

// --- Events ---

export async function noticeWaitlistOffer(entryId: string) {
  const e = await env.DB!.prepare('SELECT * FROM waitlist_entries WHERE id=?').bind(entryId).first<any>();
  if (!e || e.status !== 'offered') return;
  const state = await env.DB!.prepare("SELECT payload FROM academy_state WHERE id='academy'").first<{payload: string}>();
  const event = (state ? JSON.parse(state.payload).events ?? [] : []).find((x: any) => x.id === e.event_id);
  await notify([{userId: e.user_id, email: e.email, kind: 'waitlist_offer', dedupeKey: `waitlist-offer:${e.id}:${e.offered_at}`, link: '/family#waitlist',
    subject: `A seat in ${event?.name ?? 'the event'} is held for ${e.wrestler_name}`,
    body: `Good news: a seat in ${event?.name ?? 'the event'} opened up and is held for ${e.wrestler_name} until ${when(e.offer_expires_at)}. Book it from your family account before then, or it goes to the next family on the waitlist.`}]);
}

export async function noticeApproval(approvalId: string, status: string) {
  const a = await env.DB!.prepare('SELECT * FROM program_approvals WHERE id=?').bind(approvalId).first<any>();
  const f = a ? await family(a.user_id) : null;
  if (!a || !f || !['approved', 'declined'].includes(status)) return;
  await notify([{userId: a.user_id, email: f.email, kind: 'approval_' + status, dedupeKey: `approval:${a.id}:${status}:${a.updated_at}`, link: '/register?program=Advanced',
    subject: status === 'approved' ? `${a.wrestler_name} is approved for SWA Advance` : `Update on ${a.wrestler_name}'s SWA Advance request`,
    body: status === 'approved' ? `${a.wrestler_name} is approved for SWA Advance. You can now register from your family account.`
      : `The academy has not approved ${a.wrestler_name} for SWA Advance at this time. You can talk it over with Justin in the private conversation on the registration page.`}]);
}

export async function noticeCardRejected(userId: string, wrestlerId: string, note: string) {
  const f = await family(userId), w = f?.wrestlers?.find((x: any) => x.id === wrestlerId);
  if (!f || !w) return;
  await notify([{userId, email: f.email, kind: 'card_rejected', dedupeKey: `card-rejected:${userId}:${wrestlerId}:${w.usawNumber}:${w.usawExpires}`, link: '/family#summary',
    subject: `Please check ${w.name}'s USA Wrestling card`,
    body: `The academy could not verify ${w.name}'s USA Wrestling card${note ? ` (${note})` : ''}. Booking is paused until the card is updated in your family account and checked by the academy.`}]);
}

// A payment the owner recorded (cash, check and similar). Online payments get Stripe's receipt.
export async function noticePaymentRecorded(orderId: string) {
  const o = await env.DB!.prepare('SELECT * FROM orders WHERE id=?').bind(orderId).first<any>();
  if (!o || o.status !== 'paid') return;
  await notify([{userId: o.user_id, email: o.email, kind: 'payment_recorded', dedupeKey: `payment:${o.id}`, link: '/family#purchaseHistory',
    subject: `Payment received: ${o.item_label}`,
    body: `The academy recorded your payment of $${(o.amount_cents / 100).toFixed(2)} for ${o.item_label} (${o.wrestler_name}). It now shows in your family account.`}]);
}

// A paid lesson: tell the coach (email) and confirm to the family.
export async function noticeLessonBooked(orderId: string) {
  const o = await env.DB!.prepare("SELECT * FROM orders WHERE id=? AND kind='lesson' AND status='paid'").bind(orderId).first<any>();
  if (!o) return;
  const p = JSON.parse(o.pricing || '{}'), date = JSON.parse(o.dates || '[]')[0];
  const coach = p.coachEmail ? await env.DB!.prepare('SELECT email,name FROM staff_access WHERE email=? AND active=1').bind(p.coachEmail).first<{email: string; name: string}>() : null;
  const list: Notice[] = [{userId: o.user_id, email: o.email, kind: 'lesson_booked', dedupeKey: `lesson-family:${o.id}`, link: '/wrestler?id=' + encodeURIComponent(o.wrestler_id),
    subject: `Lesson booked: ${o.item_label}`, body: `${o.wrestler_name}'s ${p.formatName ?? 'private lesson'} with ${p.coachName ?? 'the coach'} is booked for ${dayTime(date, p.start)}.`}];
  if (coach) list.push({userId: null, email: coach.email, kind: 'lesson_booked_coach', dedupeKey: `lesson-coach:${o.id}`, link: '/coach',
    subject: `New lesson: ${o.wrestler_name}, ${dayTime(date, p.start)}`,
    body: `${o.wrestler_name} booked a ${p.formatName ?? 'private lesson'} with you for ${dayTime(date, p.start)}.${p.partners ? ` Training partners: ${p.partners}.` : ''} Details are on your coach page.`});
  await notify(list);
}

export async function noticeTransfer(orderId: string, toProgramName: string, effective: string) {
  const o = await env.DB!.prepare('SELECT * FROM orders WHERE id=?').bind(orderId).first<any>();
  if (!o) return;
  await notify([{userId: o.user_id, email: o.email, kind: 'transfer', dedupeKey: `transfer:${o.id}:${toProgramName}:${effective}`, link: '/wrestler?id=' + encodeURIComponent(o.wrestler_id),
    subject: `${o.wrestler_name} moves to ${toProgramName}`,
    body: `${o.wrestler_name}'s membership moves to ${toProgramName} from ${longDate(effective)}. Practices from that date are in the wrestler view.`}]);
}

// --- Daily reminders ---
// Runs at most once per academy day: every morning from the Cron Trigger (build/worker.ts, #123), or on the first
// family or roster visit of the day if the schedule has not run yet. A per-day record stops a second send.
export async function dailyReminders(force = false) {
  const today = academyToday();
  if (!force) {
    const r = await env.DB!.prepare("INSERT OR IGNORE INTO academy_settings(id,payload,updated_at,updated_by) VALUES (?,'{}',?,'system')").bind('reminders:' + today, new Date().toISOString()).run();
    if (!Number(r.meta?.changes ?? (r as any).changes ?? 0)) return 0;
  }
  const soon = new Date(Date.parse(today + 'T12:00:00Z') + 30 * 86400000).toISOString().slice(0, 10);
  const families = (await env.DB!.prepare('SELECT user_id,email,payload FROM family_accounts').all<{user_id: string; email: string; payload: string}>()).results;
  const waiver = await currentWaiver();
  const signed = waiver ? new Set((await env.DB!.prepare('SELECT user_id,wrestler_id,wrestler_name FROM waiver_signatures WHERE version_id=?').bind(waiver.id).all<any>()).results
    .map(s => `${s.user_id}|${s.wrestler_id}|${String(s.wrestler_name).trim().toLowerCase()}`)) : new Set<string>();
  const list: Notice[] = [];
  for (const f of families) {
    for (const w of JSON.parse(f.payload).wrestlers ?? []) {
      const exp = w.usawExpires as string | undefined;
      if (w.usawNumber && exp && exp >= today && exp <= soon)
        list.push({userId: f.user_id, email: f.email, kind: 'card_expiring', dedupeKey: `card-soon:${f.user_id}:${w.id}:${exp}`, link: '/family#summary',
          subject: `${w.name}'s USA Wrestling card expires ${longDate(exp)}`,
          body: `${w.name}'s USA Wrestling card expires on ${longDate(exp)}. Renew it at usawmembership.com and update the new expiration date in your family account. Sessions after that date cannot be booked until then.`});
      if (w.usawNumber && exp && exp < today)
        list.push({userId: f.user_id, email: f.email, kind: 'card_expired', dedupeKey: `card-expired:${f.user_id}:${w.id}:${exp}`, link: '/family#summary',
          subject: `${w.name}'s USA Wrestling card has expired`,
          body: `${w.name}'s USA Wrestling card expired on ${longDate(exp)}. Booking is paused until a current card is added in your family account.`});
      if (waiver && !signed.has(`${f.user_id}|${w.id}|${String(w.name).trim().toLowerCase()}`))
        list.push({userId: f.user_id, email: f.email, kind: 'waiver_needed', dedupeKey: `waiver:${waiver.id}:${f.user_id}:${w.id}`, link: '/waiver?wrestler=' + encodeURIComponent(w.id),
          subject: `Please sign the ${waiver.title} for ${w.name}`,
          body: `The academy asks every family to sign the ${waiver.title}. ${w.name} cannot book until it is signed. It takes about a minute in your family account.`});
    }
  }
  return notify(list);
}

// Inbox view and read state for a family.
export async function familyNotices(userId: string) {
  return (await env.DB!.prepare('SELECT id,kind,subject,body,created_at,read_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 200').bind(userId).all<any>()).results
    .map(n => ({id: n.id, kind: n.kind, subject: n.subject, body: n.body, at: n.created_at, read: !!n.read_at}));
}
export async function markNoticeRead(userId: string, id: unknown) {
  if (typeof id !== 'string') return;
  await env.DB!.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL').bind(new Date().toISOString(), id, userId).run();
}
