// Automatic notices (issue #105). A notice goes to the family's Messages inbox and, once an email provider is set
// (#87), by email. Coaches have no inbox, so their notices are email only. Each event has a dedupe key and is sent once,
// however many times the code that triggers it runs. Links use appOrigin(), never a hard-coded host.
import {env} from 'cloudflare:workers';
import {appOrigin, OWNER_EMAIL} from './account-auth';
import {academyToday} from './public-schedule';
import {sendEmailsDetailed} from './email';
import {currentVersion, FAMILY_KINDS, LIVE_SIGNATURE, DOCUMENTS, CARRIED_NAME, SIGNATURE_JOIN, signatureCounts, type Kind} from './documents';
import {dayTime, fullDate} from './datetime';
import {cardSeason, isSeasonEnd, renewalDue} from './usaw';
import {chunks, eachFamily, jsonChunks, keysetPage} from './paging';

type Notice = {userId: string | null; email: string; kind: string; subject: string; body: string; dedupeKey: string; link?: string};

export const footer = (link = '/inbox') => `\n\n—\nSavage Wrestling Academy\n${appOrigin()}${link}`;

// Saves each new notice and emails it. Notices already sent (same dedupe key) are skipped silently. Works through the
// list in batches (issue #46): one query per 90 dedupe keys, one email request per 100 messages and one insert per
// batch, so a morning with thousands of reminders stays inside D1's per-run query limit.
export const NOTICE_BATCH = 450;
const INSERT_NOTICES = `INSERT OR IGNORE INTO notifications(id,user_id,email,kind,subject,body,dedupe_key,created_at,read_at,email_status,email_error)
  SELECT json_extract(value,'$.id'),json_extract(value,'$.userId'),json_extract(value,'$.email'),json_extract(value,'$.kind'),json_extract(value,'$.subject'),
    json_extract(value,'$.body'),json_extract(value,'$.dedupeKey'),json_extract(value,'$.at'),NULL,json_extract(value,'$.status'),json_extract(value,'$.reason') FROM json_each(?)`;
export async function notify(list: Notice[]) {
  // The same event twice in one list is one notice.
  const unique = [...new Map(list.map(n => [n.dedupeKey, n])).values()];
  let saved = 0;
  for (const part of chunks(unique, NOTICE_BATCH)) {
    const seen = new Set<string>();
    for (const keys of chunks(part.map(n => n.dedupeKey)))
      for (const r of (await env.DB!.prepare(`SELECT dedupe_key FROM notifications WHERE dedupe_key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all<{dedupe_key: string}>()).results) seen.add(r.dedupe_key);
    const fresh = part.filter(n => !seen.has(n.dedupeKey));
    if (!fresh.length) continue;
    const results = await sendEmailsDetailed(fresh.map(n => ({to: n.email, subject: n.subject, text: n.body + footer(n.link)})));
    const at = new Date().toISOString();
    const rows = fresh.map((n, i) => ({id: crypto.randomUUID(), userId: n.userId, email: n.email, kind: n.kind, subject: n.subject, body: n.body, dedupeKey: n.dedupeKey, at, status: results[i].status, reason: results[i].reason}));
    const done = await env.DB!.batch(jsonChunks(rows).map(c => env.DB!.prepare(INSERT_NOTICES).bind(JSON.stringify(c))));
    for (const r of done) saved += Number(r.meta?.changes ?? (r as any).changes ?? 0);
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

export async function noticeApproval(approvalId: string, status: string) {
  const a = await env.DB!.prepare('SELECT * FROM program_approvals WHERE id=?').bind(approvalId).first<any>();
  const f = a ? await family(a.user_id) : null;
  if (!a || !f || !['approved', 'declined'].includes(status)) return;
  await notify([{userId: a.user_id, email: f.email, kind: 'approval_' + status, dedupeKey: `approval:${a.id}:${status}:${a.updated_at}`, link: '/register?program=Advanced',
    subject: status === 'approved' ? `${a.wrestler_name} is approved for SWA Advance` : `Update on ${a.wrestler_name}'s SWA Advance request`,
    body: status === 'approved' ? `${a.wrestler_name} is approved for SWA Advance. You can now register from your family account.`
      : `The academy has not approved ${a.wrestler_name} for SWA Advance at this time. You can talk it over with Justin in the private conversation on the registration page.`}]);
}

// A family changed a wrestler's grade or name while an SWA Advance request waits (issue #271). The owner is told: the
// request still stands after a grade change within 7–12 and shows "Requested as Grade 9, now Grade 10" on /approvals;
// a renamed entry no longer applies, so the family asks again. One notice per change.
export async function noticeApprovalProfileChanged(userId: string, before: {id: string; name: string; grade: string}[], after: {id: string; name: string; grade: string}[]) {
  const list: Notice[] = [];
  if (!OWNER_EMAIL) return;
  for (const w of after) {
    const was = before.find(x => x.id === w.id);
    if (!was || (was.name === w.name && was.grade === w.grade)) continue;
    const a = await env.DB!.prepare("SELECT id,wrestler_name,grade,status FROM program_approvals WHERE user_id=? AND wrestler_id=? AND program='Advanced' AND status='pending'").bind(userId, w.id).first<{id: string; wrestler_name: string; grade: string; status: string}>();
    if (!a) continue;
    const renamed = was.name.trim().toLowerCase() !== w.name.trim().toLowerCase(), high = ['7', '8', '9', '10', '11', '12'].includes(w.grade);
    list.push({userId: null, email: OWNER_EMAIL, kind: 'approval_profile_changed', dedupeKey: `approval-changed:${a.id}:${w.name}:${w.grade}`, link: '/approvals',
      subject: renamed ? `SWA Advance request: ${was.name} was renamed ${w.name}` : `SWA Advance request: ${w.name} is now Grade ${w.grade}`,
      body: renamed ? `The family changed the wrestler on a waiting SWA Advance request from ${was.name} to ${w.name}. The request no longer applies: if it is the same wrestler, the family asks again; if they renamed the entry for another child, that child needs their own request. Nothing is approved.`
        : high ? `${w.name}'s grade changed from ${was.grade} to ${w.grade} while their SWA Advance request waits. The request still stands and shows "Requested as Grade ${a.grade}, now Grade ${w.grade}" on SWA Advance approvals, where you can approve or decline it.`
        : `${w.name}'s grade changed from ${was.grade} to ${w.grade}, outside grades 7–12, so their waiting SWA Advance request no longer applies. The family may have mistyped the grade.`});
  }
  if (list.length) await notify(list);
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
    body: `${o.wrestler_name} booked ${Number(p.slots) > 1 ? 'a spot in your' : 'a'} ${p.formatName ?? 'private lesson'} with you for ${dayTime(date, p.start)}.${p.partners ? ` Training partners: ${p.partners}.` : ''} The lesson's roster is on your coach page.`});
  await notify(list);
}

// --- Monthly memberships (issue #271) ---
// The owner has no inbox, so an owner notice is email only (userId null), like a coach's. OWNER_EMAIL is the owner's
// address from lib/account-auth.ts; with none set, nothing goes to the owner.
const ownerNotice = (n: Omit<Notice, 'userId' | 'email'>): Notice[] => OWNER_EMAIL ? [{...n, userId: null, email: OWNER_EMAIL}] : [];
const dollars = (c: number) => '$' + (c / 100).toFixed(2);
async function membershipOrder(orderId: string) {
  return await env.DB!.prepare('SELECT o.*,s.paid_through,s.payments_made,s.payments_total FROM orders o JOIN subscriptions s ON s.order_id=o.id WHERE o.id=?').bind(orderId).first<any>();
}
// A monthly payment failed: the family is asked to fix the card; the owner sees who, and for how long the wrestler stays
// on the roster (the grace, lib/membership-term.ts). One notice per failed invoice event, so Stripe's retries, which
// each send their own event, each get one, and a replay none.
export async function noticeInstallmentFailed(orderId: string, eventId: string) {
  const o = await membershipOrder(orderId);
  if (!o) return;
  await notify([{userId: o.user_id, email: o.email, kind: 'installment_failed', dedupeKey: `installment-failed:${orderId}:${eventId}`, link: '/family#memberships',
    subject: `Payment needs attention: ${o.wrestler_name}'s membership`,
    body: `The monthly payment for ${o.wrestler_name}'s ${o.item_label} did not go through. Stripe will try the card again over the next few days; to fix it sooner, update the card in Stripe's email receipt or contact the academy. ${o.wrestler_name} can still come to practice through ${longDate(o.term_end)}. After that, the membership pauses until a payment goes through.`},
    ...ownerNotice({kind: 'installment_failed_owner', dedupeKey: `installment-failed-owner:${orderId}:${eventId}`, link: '/payments#attention',
      subject: `Payment needs attention: ${o.wrestler_name} (${o.email})`,
      body: `A monthly payment for ${o.wrestler_name}'s ${o.item_label} failed at Stripe (${o.payments_made} of ${o.payments_total} payments made, paid through ${longDate(o.paid_through)}). Stripe retries the card by itself. ${o.wrestler_name} stays on the roster through ${longDate(o.term_end)}. The Payment needs attention list on Payments shows every membership in this state.`})]);
}
// Stripe collected a different amount than the membership's price (a coupon, or a price edited in Stripe). The payment
// counted; the owner checks it is what they meant.
export async function noticeInstallmentMismatch(orderId: string, eventId: string, number: number, paidCents: number, expectedCents: number, invoiceId: string) {
  const o = await membershipOrder(orderId);
  if (!o) return;
  await notify(ownerNotice({kind: 'installment_mismatch_owner', dedupeKey: `installment-mismatch:${orderId}:${eventId}`, link: '/payments#attempts',
    subject: `Check a monthly payment: ${o.wrestler_name} paid ${dollars(paidCents)}, not ${dollars(expectedCents)}`,
    body: `Stripe collected ${dollars(paidCents)} for payment ${number} of ${o.payments_total} on ${o.wrestler_name}'s ${o.item_label}; the membership's price is ${dollars(expectedCents)}. The payment counts and the books show ${dollars(paidCents)}. If this is not a discount you gave in Stripe, check the subscription${invoiceId ? ` (invoice ${invoiceId})` : ''} in your Stripe dashboard.`}));
}
// The monthly plan ended before its 12 payments: the family's access ends on the paid-through day.
export async function noticeSubscriptionCanceled(orderId: string, eventId: string) {
  const o = await membershipOrder(orderId);
  if (!o) return;
  await notify([{userId: o.user_id, email: o.email, kind: 'subscription_canceled', dedupeKey: `subscription-canceled:${orderId}:${eventId}`, link: '/family#memberships',
    subject: `${o.wrestler_name}'s membership has ended`,
    body: `The monthly payments for ${o.wrestler_name}'s ${o.item_label} have stopped after ${o.payments_made} of ${o.payments_total}, so the membership ends on ${longDate(o.term_end)}. To keep training, sign up again from your family account, or talk to the academy.`},
    ...ownerNotice({kind: 'subscription_canceled_owner', dedupeKey: `subscription-canceled-owner:${orderId}:${eventId}`, link: '/payments',
      subject: `Membership ended early: ${o.wrestler_name} (${o.email})`,
      body: `Stripe canceled the monthly plan for ${o.wrestler_name}'s ${o.item_label} after ${o.payments_made} of ${o.payments_total} payments. ${o.wrestler_name} comes off the roster after ${longDate(o.term_end)}. The family has been told.`})]);
}

export async function noticeTransfer(orderId: string, toProgramName: string, effective: string) {
  const o = await env.DB!.prepare('SELECT * FROM orders WHERE id=?').bind(orderId).first<any>();
  if (!o) return;
  await notify([{userId: o.user_id, email: o.email, kind: 'transfer', dedupeKey: `transfer:${o.id}:${toProgramName}:${effective}`, link: '/wrestler?id=' + encodeURIComponent(o.wrestler_id),
    subject: `${o.wrestler_name} moves to ${toProgramName}`,
    body: `${o.wrestler_name}'s membership moves to ${toProgramName} from ${longDate(effective)}. Practices from that date are in the wrestler view.`}]);
}

// --- Daily reminders ---
// Card reminder wording (issue #131). Every USA Wrestling card expires on August 31, the end of its membership season,
// so a card ending then is renewed for the next season. A card with a different date gets the plain wording.
export function cardExpiringNotice(name: string, exp: string) {
  const subject = `${name}'s USA Wrestling card expires ${longDate(exp)}`;
  if (!isSeasonEnd(exp)) return {subject,
    body: `${name}'s USA Wrestling card expires on ${longDate(exp)}. Renew it at usawmembership.com and update the new expiration date in your family account. Sessions after that date cannot be booked until then.`};
  const next = cardSeason(`${exp.slice(0, 4)}-09-01`);
  return {subject,
    body: `${name}'s USA Wrestling card expires on ${longDate(exp)}, at the end of the ${cardSeason(exp).label}. Renew for the ${next.label} by Aug 31 at usawmembership.com. New-season cards usually open in mid-August. Then choose the ${next.label} for ${name} in your family account. Sessions after Aug 31 cannot be booked until then.`};
}
// An expired season card is renewed for the season the academy is in now.
export function cardExpiredNotice(name: string, exp: string, today: string) {
  const subject = `${name}'s USA Wrestling card has expired`;
  if (!isSeasonEnd(exp)) return {subject, body: `${name}'s USA Wrestling card expired on ${longDate(exp)}. Booking is paused until a current card is added in your family account.`};
  return {subject, body: `${name}'s USA Wrestling card expired on ${longDate(exp)}, at the end of the ${cardSeason(exp).label}. Booking is paused until you renew for the ${cardSeason(today).label} at usawmembership.com and choose it in your family account.`};
}

// Runs at most once per academy day: every morning from the Cron Trigger (build/worker.ts, #123), or on the first
// family or roster visit of the day if the schedule has not run yet. A per-day record stops a second send.
// `today` is the academy's date; tests can set it. Every family is covered (issue #46): families are read in batches
// of REMINDER_BATCH and each batch's notices are sent before the next batch is read, so the work per step stays the
// same however many families the academy has.
export const REMINDER_BATCH = 500;
export async function dailyReminders(force = false, today = academyToday()) {
  if (!force) {
    const r = await env.DB!.prepare("INSERT OR IGNORE INTO academy_settings(id,payload,updated_at,updated_by) VALUES (?,'{}',?,'system')").bind('reminders:' + today, new Date().toISOString()).run();
    if (!Number(r.meta?.changes ?? (r as any).changes ?? 0)) return 0;
  }
  const soon = renewalDue(today);
  // Family documents in force (the waiver, and the Parent Consent Form once published, issue #195).
  const docs = [];
  for (const kind of FAMILY_KINDS) { const version = await currentVersion(kind); if (version) docs.push({kind, version}); }
  let saved = 0;
  for await (const families of eachFamily(REMINDER_BATCH)) {
    // Who signed each document in force, for this batch's families only. A signature counts for the same wrestler entry
    // by the family's saved names (lib/documents.ts signatureCounts, issue #271), exactly as booking and the roster decide.
    const signed = new Map<string, any[]>();
    if (docs.length) for (const ids of chunks(families.map(f => f.user_id), 80))
      for (const s of (await env.DB!.prepare(`SELECT s.version_id,s.user_id,s.wrestler_id,s.wrestler_name,${CARRIED_NAME} FROM waiver_signatures s ${SIGNATURE_JOIN} WHERE s.version_id IN (${docs.map(() => '?').join(',')}) AND s.user_id IN (${ids.map(() => '?').join(',')}) AND ${LIVE_SIGNATURE}`)
        .bind(...docs.map(d => d.version.id), ...ids).all<any>()).results) {
        const k = `${s.version_id}|${s.user_id}|${s.wrestler_id}`;
        if (!signed.has(k)) signed.set(k, []);
        signed.get(k)!.push(s);
      }
    const list: Notice[] = [];
    for (const f of families) {
      const kids = JSON.parse(f.payload).wrestlers ?? [];
      for (const w of kids) {
        const exp = w.usawExpires as string | undefined;
        if (w.usawNumber && exp && exp >= today && exp <= soon)
          list.push({userId: f.user_id, email: f.email, kind: 'card_expiring', dedupeKey: `card-soon:${f.user_id}:${w.id}:${exp}`, link: '/family#summary',
            ...cardExpiringNotice(w.name, exp)});
        if (w.usawNumber && exp && exp < today)
          list.push({userId: f.user_id, email: f.email, kind: 'card_expired', dedupeKey: `card-expired:${f.user_id}:${w.id}:${exp}`, link: '/family#summary',
            ...cardExpiredNotice(w.name, exp, today)});
        for (const {kind, version} of docs) {
          if ((signed.get(`${version.id}|${f.user_id}|${w.id}`) ?? []).some(s => signatureCounts(s, w, kids))) continue;
          if (kind === 'waiver')
            list.push({userId: f.user_id, email: f.email, kind: 'waiver_needed', dedupeKey: `waiver:${version.id}:${f.user_id}:${w.id}`, link: '/waiver?wrestler=' + encodeURIComponent(w.id),
              subject: `Please sign the ${version.title} for ${w.name}`,
              body: `The academy asks every family to sign the ${version.title}. ${w.name} cannot book until it is signed. It takes about a minute in your family account.`});
          else
            list.push({userId: f.user_id, email: f.email, kind: 'consent_needed', dedupeKey: `consent:${version.id}:${f.user_id}:${w.id}`, link: '/consent?wrestler=' + encodeURIComponent(w.id),
              subject: `Please sign the Parent Consent Form for ${w.name}`,
              body: `The academy asks a parent or guardian to sign the Parent Consent Form for every wrestler. ${w.name} cannot book until it is signed. It takes about a minute in your family account.`});
        }
      }
    }
    saved += await notify(list);
  }
  return saved;
}

// The owner asked one family (or one coach) to sign a document again (issue #239), with the reason.
export async function noticeReissue(kind: Kind, s: {id: string; user_id: string; email: string; wrestler_id: string; wrestler_name: string}, version: {title: string}, reason: string) {
  const spec = DOCUMENTS[kind], name = kind === 'waiver' ? version.title : spec.name;
  if (spec.signer === 'coach') {
    await notify([{userId: null, email: s.email, kind: 'contract_reissued', dedupeKey: `reissue:${s.id}`, link: '/contract',
      subject: 'Please sign your coach contract again', body: `The academy asked you to sign your coach contract again. Reason: ${reason.replace(/[.!?\s]+$/, '')}. Your earlier signed copy is kept. Sign again from coach home; it takes about a minute.`}]);
    return;
  }
  const f = await family(s.user_id);
  if (!f) return;
  await notify([{userId: s.user_id, email: f.email, kind: kind + '_reissued', dedupeKey: `reissue:${s.id}`, link: (kind === 'waiver' ? '/waiver' : '/consent') + '?wrestler=' + encodeURIComponent(s.wrestler_id),
    subject: `Please sign the ${name} again for ${s.wrestler_name}`,
    body: `The academy asked you to sign the ${name} again for ${s.wrestler_name}. Reason: ${reason.replace(/[.!?\s]+$/, '')}. ${s.wrestler_name} cannot book until it is signed again. Your earlier signed copy is kept in your family account.`}]);
}

// Inbox view and read state for a family.
// Newest first, a page at a time (issue #46), with a cursor for older notices.
export async function familyNotices(userId: string, cursor?: unknown, limit = 50) {
  const page = await keysetPage<any>({select: 'id,kind,subject,body,created_at,read_at', from: 'FROM notifications', where: 'user_id=?', args: [userId],
    cols: [{expr: 'created_at', desc: true}, {expr: 'id', desc: true}], keyOf: n => [n.created_at, n.id], cursor, limit});
  return {notices: page.rows.map(n => ({id: n.id, kind: n.kind, subject: n.subject, body: n.body, at: n.created_at, read: !!n.read_at})), noticesNext: page.next};
}
export async function markNoticeRead(userId: string, id: unknown) {
  if (typeof id !== 'string') return;
  await env.DB!.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL').bind(new Date().toISOString(), id, userId).run();
}
