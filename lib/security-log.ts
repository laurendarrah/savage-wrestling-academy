// The owner's Security activity page (issue #127): each recorded event in plain words, with the person's name or
// email instead of internal ids. Records are never changed; this only reads them and looks up names.
import {env} from 'cloudflare:workers';
import {programDetails} from './program-names';
import {dayDate, dayTime, fullDate, when} from './datetime';
import {allFamilies, keysetPage} from './paging';

export type SecurityRow = {actor: string; action: string; target: string; created_at: string};
export type SecurityNames = {
  people: Record<string, string>;      // account id -> "Name (email)" or email
  you: string[];                       // account ids of the owner reading the page
  approvals: Record<string, string>;   // program approval id -> wrestler name
  waitlist: Record<string, string>;    // waitlist entry id -> wrestler name
  orders: Record<string, {wrestler: string; item: string}>;
  waivers: Record<string, string>;     // waiver, consent form and contract version id -> title
  wrestlers: Record<string, string>;   // "accountId/wrestlerId" -> wrestler name
  requests: Record<string, string>;    // data request id -> family
  curricula: Record<string, string>;   // curriculum or curriculum group id -> name
  coaches: Record<string, string>;     // coach email -> name
  cash?: Record<string, {wrestler: string; item: string}>;   // pay-at-the-academy booking id (issue #248)
};
export type SecurityEntry = {title: string; detail: string; who: string; at: string};

const TITLES: Record<string, string> = {
  mfa_verified: 'Authenticator code verified',
  backup_exported: 'Backup downloaded',
  backup_restored: 'Backup restored',
  coach_opening_added: 'Lesson opening added',
  coach_opening_removed: 'Lesson opening removed',
  coach_opening_changed: 'Lesson type or spots changed',
  owner_opening_added: 'Lesson openings added for a coach',
  owner_opening_changed: 'A coach’s lesson type or spots changed',
  owner_opening_removed: 'A coach’s lesson opening removed',
  lesson_group_requested: 'Private lesson group asked for',
  lesson_group_canceled: 'Private lesson group called off',
  stripe_test_key_saved: 'Stripe test key saved',
  stripe_live_key_saved: 'Stripe live key saved',
  stripe_account_recorded: 'Stripe account connected',
  stripe_account_reset: 'Stripe account disconnected',
  program_approval_requested: 'SWA Advance approval requested',
  program_approval_approved: 'SWA Advance approved',
  program_approval_declined: 'SWA Advance declined',
  program_curriculum_saved: 'Curriculum saved',
  curriculum_lesson_created: 'Curriculum lesson added',
  curriculum_lesson_updated: 'Curriculum lesson updated',
  practice_plan_shared: 'Practice plan shared with coaches',
  practice_plan_draft: 'Practice plan saved privately',
  practice_plan_hidden: 'Practice plan hidden from coaches',
  coach_access_granted: 'Coach access given',
  coach_access_revoked: 'Coach access removed',
  coach_permanently_removed: 'Coach removed permanently',
  coach_records_deleted: 'Removed coaches’ records deleted after 3 years',
  waitlist_offer: 'Waitlist seat offered',
  pass_revoked: 'Entry pass replaced',
  usaw_card_valid: 'USA Wrestling card verified',
  usaw_card_invalid: 'USA Wrestling card marked not valid',
  usaw_card_review_cleared: 'USA Wrestling card review cleared',
  usaw_card_lookup_verified: 'USA Wrestling card verified by lookup',
  lesson_settings_saved: 'Private lesson prices or coach pay saved',
  announcement_sent: 'Announcement sent',
  emails_resent: 'Emails that didn’t send were sent again',
  waiver_published: 'Waiver published',
  waiver_retired: 'Waiver no longer required',
  waiver_signed: 'Waiver signed',
  parent_consent_published: 'Parent Consent Form published',
  parent_consent_retired: 'Parent Consent Form no longer required',
  parent_consent_signed: 'Parent Consent Form signed',
  coach_contract_published: 'Coach contract published',
  coach_contract_retired: 'Coach contract no longer asked for',
  coach_contract_signed: 'Coach contract signed',
  waiver_reissued: 'Family asked to sign the waiver again',
  parent_consent_reissued: 'Family asked to sign the Parent Consent Form again',
  coach_contract_reissued: 'Coach asked to sign the contract again',
  membership_transferred: 'Membership moved to another program',
  booking_exception_granted: 'Booking allowed anyway',
  booking_exception_removed: 'Booking exception removed',
  offline_payment_recorded: 'Offline payment recorded',
  offline_payment_voided: 'Offline payment voided',
  cash_received: 'Cash received at the academy',
  cash_booking_canceled: 'Pay-at-the-academy booking canceled',
  account_closure_requested: 'Family asked to close their account',
  data_request_handled: 'Data request handled',
  family_account_deleted: 'Family account deleted',
  stripe_event_rejected: 'Stripe message refused',
  lesson_double_booked: 'Lesson paid for twice',
  event_over_capacity: 'Event paid over its seat limit',
};

const REJECTIONS: Record<string, string> = {
  'rejected:malformed': 'The message was not readable.',
  'rejected:unknown-order': 'It named an order the site does not have.',
  'rejected:session-mismatch': 'It did not match the order’s checkout.',
  'rejected:mode-mismatch': 'Test and live payments were mixed up.',
  'rejected:amount-mismatch': 'The amount paid did not match the price.',
  'rejected:duplicate-payment-refund-needed': 'The same purchase was paid twice. Refund one payment in Stripe.',
  'rejected:no-subscription': 'The monthly plan was missing from Stripe.',
  'rejected:payment-beyond-term-refund-needed': 'A payment came after all 12 were made. Refund it in Stripe.',
};

const program = (id: string) => programDetails[id]?.name ?? id;
const money = (cents: string) => Number.isFinite(Number(cents)) ? '$' + (Number(cents) / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const humanize = (action: string) => action.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

export function describeSecurityEvent(row: SecurityRow, names: SecurityNames, now: Date = new Date()): SecurityEntry {
  const t = String(row.target ?? ''), [first = '', ...rest] = t.split(' ');
  const wrestler = (key: string) => names.wrestlers[key] ?? 'A wrestler who has since been removed';
  const order = (id: string) => names.orders[id];
  let detail = '';
  switch (row.action) {
    case 'coach_access_granted': case 'coach_access_revoked': case 'coach_permanently_removed':
      detail = t.startsWith('former-coach-') ? 'A former coach' : names.coaches[t.toLowerCase()] ? `${names.coaches[t.toLowerCase()]} (${t})` : t; break;
    case 'coach_records_deleted': {
      // Counts only (issue #212): "finished:1 in-progress:0 deleted:12 anonymized:4".
      const n = Object.fromEntries(t.split(' ').map(p => p.split(':')).map(([k, v]) => [k, Number(v) || 0]));
      detail = [n.finished ? plural(n.finished, 'former coach', 'former coaches') + ' done' : '', n['in-progress'] ? 'more to do tomorrow' : '',
        plural(n.deleted ?? 0, 'record', 'records') + ' deleted', plural(n.anonymized ?? 0, 'record', 'records') + ' kept without the coach’s name'].filter(Boolean).join(' · '); break;
    }
    case 'practice_plan_shared': case 'practice_plan_draft': case 'practice_plan_hidden': {
      const [p, d] = t.split(':'); detail = d ? `${program(p)} · ${dayDate(d)}` : program(p); break;
    }
    case 'program_approval_requested': case 'program_approval_approved': case 'program_approval_declined':
      detail = names.approvals[t] ?? ''; break;
    case 'waitlist_offer': detail = names.waitlist[t] ?? ''; break;
    case 'pass_revoked': case 'usaw_card_valid': case 'usaw_card_invalid': case 'usaw_card_review_cleared': case 'usaw_card_lookup_verified': detail = wrestler(t); break;
    case 'waiver_published': case 'waiver_retired': case 'parent_consent_published': case 'parent_consent_retired':
    case 'coach_contract_published': case 'coach_contract_retired': case 'coach_contract_signed': detail = names.waivers[t] ?? ''; break;
    case 'waiver_signed': case 'parent_consent_signed': {
      const [version, ...w] = t.split('/'); const key = row.actor + '/' + w.join('/');
      detail = [names.waivers[version], names.wrestlers[key]].filter(Boolean).join(' · '); break;
    }
    // Issue #239: "version/account/wrestler" for a family, "email version" for a coach.
    case 'waiver_reissued': case 'parent_consent_reissued': {
      const [version, ...w] = t.split('/');
      detail = [names.waivers[version], wrestler(w.join('/'))].filter(Boolean).join(' · '); break;
    }
    case 'coach_contract_reissued': {
      const coach = first.startsWith('former-coach-') ? 'A former coach' : names.coaches[first.toLowerCase()] ?? first;
      detail = [coach, names.waivers[rest[0] ?? '']].filter(Boolean).join(' · '); break;
    }
    case 'offline_payment_recorded': case 'cash_received': {
      const o = order(first); detail = [o?.wrestler, o?.item, money(rest[1] ?? '')].filter(Boolean).join(' · '); break;
    }
    case 'offline_payment_voided': { const o = order(t); detail = o ? `${o.wrestler} · ${o.item}` : ''; break; }
    case 'cash_booking_canceled': { const c = names.cash?.[t]; detail = c ? `${c.wrestler} · ${c.item}` : ''; break; }
    case 'membership_transferred': {
      const o = order(first), [from = '', to = ''] = (rest[0] ?? '').split('->');
      detail = `${o?.wrestler ? o.wrestler + ': ' : ''}${program(from)} → ${program(to)} from ${fullDate(rest[1] ?? '')}`; break;
    }
    case 'booking_exception_granted': {
      const m = /^(\w+) (\S+) until (\S+)$/.exec(t);
      detail = m ? `${wrestler(m[2])} may book without a ${m[1] === 'usaw' ? 'current USA Wrestling card' : m[1] === 'parent_consent' ? 'signed Parent Consent Form' : 'signed waiver'} until ${fullDate(m[3])}` : ''; break;
    }
    // The owner changing a coach's openings (issue #239): "email count", "email openingId" or "email date start".
    case 'owner_opening_added': case 'owner_opening_changed': case 'owner_opening_removed': {
      const coach = first.startsWith('former-coach-') ? 'A former coach' : names.coaches[first.toLowerCase()] ?? first;
      detail = [coach, row.action === 'owner_opening_added' && rest[0] ? plural(Number(rest[0]), 'opening', 'openings')
        : row.action === 'owner_opening_removed' && rest[0] ? dayTime(rest[0], rest[1]) : ''].filter(Boolean).join(' · '); break;
    }
    case 'announcement_sent': detail = rest[0] ? 'Sent to ' + plural(Number(rest[0]), 'family', 'families') : ''; break;
    case 'emails_resent': detail = t; break;
    case 'stripe_account_recorded': case 'stripe_account_reset': detail = /^acct_[A-Za-z0-9]{8,64}$/.test(t) ? 'Stripe account ' + t : ''; break;
    case 'account_closure_requested': detail = names.people[t] ?? ''; break;
    case 'data_request_handled': detail = names.requests[t] ?? ''; break;
    // Counts only (issue #259): "deleted-family-<id> deleted:12 payments-kept:2 test:1".
    case 'family_account_deleted': {
      const n = Object.fromEntries(rest.map(p => p.split(':')).map(([k, v]) => [k, Number(v) || 0]));
      detail = [n.test ? 'A test account' : '', plural(n.deleted ?? 0, 'record', 'records') + ' deleted',
        n['payments-kept'] ? plural(n['payments-kept'], 'payment', 'payments') + ' kept for the books as “Deleted family”' : ''].filter(Boolean).join(' · '); break;
    }
    case 'program_curriculum_saved': case 'curriculum_lesson_created': case 'curriculum_lesson_updated': detail = names.curricula[t] ?? ''; break;
    case 'stripe_event_rejected': detail = REJECTIONS[rest[0] ?? ''] ?? 'Stripe sent a payment message the site could not match.'; break;
    case 'lesson_double_booked': case 'event_over_capacity': {
      const o = order(first), m = /^(\d{4}-\d{2}-\d{2}): (\d+) paid for (\d+) seats?$/.exec(rest.join(' '));
      detail = [o ? `${o.wrestler} · ${o.item}` : '', m ? `${fullDate(m[1])}: ${m[2]} paid for ${plural(Number(m[3]), 'seat', 'seats')}. Refund one or move it.` : ''].filter(Boolean).join(' · '); break;
    }
  }
  const who = row.actor === 'stripe' ? 'Stripe' : row.actor === 'system' ? 'The site' : row.actor.startsWith('former-coach-') ? 'A former coach' : names.you.includes(row.actor) ? 'You' : names.people[row.actor] ?? 'Another account';
  return {title: TITLES[row.action] ?? humanize(row.action), detail, who, at: when(row.created_at, now)};
}

type Q<T> = {results: T[]};
const all = async <T>(sql: string): Promise<T[]> => ((await env.DB!.prepare(sql).all<T>()) as Q<T>).results;

// Events newest first, 100 a page (issue #46), described. ownerIds are the ids the reading owner is recorded under.
// `cursor` comes from the previous page's `next`, for older events.
export const SECURITY_PAGE = 100;
export async function securityLogPage(ownerIds: string[], cursor?: unknown): Promise<{entries: SecurityEntry[]; next: string | null}> {
  const page = await keysetPage<SecurityRow & {id: string}>({select: 'id,actor,action,target,created_at', from: 'FROM security_events',
    cols: [{expr: 'created_at', desc: true}, {expr: 'id', desc: true}], keyOf: r => [r.created_at, r.id], cursor, limit: SECURITY_PAGE});
  const rows = page.rows;
  const names: SecurityNames = {people: {}, you: ownerIds, approvals: {}, waitlist: {}, orders: {}, waivers: {}, wrestlers: {}, requests: {}, curricula: {}, coaches: {}, cash: {}};
  const families = await allFamilies();
  for (const f of families) {
    let p: any = {}; try { p = JSON.parse(f.payload); } catch {}
    names.people[f.user_id] = p.parentName ? `${p.parentName} (${f.email})` : f.email;
    for (const w of Array.isArray(p.wrestlers) ? p.wrestlers : []) if (w?.id) names.wrestlers[`${f.user_id}/${w.id}`] = String(w.name ?? '');
  }
  for (const c of await all<{email: string; name: string}>('SELECT email,name FROM staff_access')) names.coaches[c.email.toLowerCase()] = c.name;
  for (const o of await all<{user_id: string; coach_email: string | null}>('SELECT DISTINCT user_id,coach_email FROM coach_openings WHERE coach_email IS NOT NULL'))
    names.people[o.user_id] ??= names.coaches[o.coach_email!.toLowerCase()] ? `${names.coaches[o.coach_email!.toLowerCase()]} (${o.coach_email})` : o.coach_email!;
  // Coaches who collected cash at the door (issue #248) are named from the payment they recorded.
  for (const c of await all<{id: string; name: string; email: string}>(`SELECT DISTINCT json_extract(pricing,'$.recordedBy') AS id,json_extract(pricing,'$.collectedBy') AS name,json_extract(pricing,'$.collectedByEmail') AS email
      FROM orders WHERE source='offline' AND json_extract(pricing,'$.collectedByEmail') IS NOT NULL AND json_extract(pricing,'$.recordedBy') IS NOT NULL`))
    names.people[c.id] ??= c.email.startsWith('former-coach-') ? 'A former coach' : `${c.name} (${c.email})`;
  for (const a of await all<{id: string; wrestler_name: string}>('SELECT id,wrestler_name FROM program_approvals')) names.approvals[a.id] = a.wrestler_name;
  for (const w of await all<{id: string; wrestler_name: string}>('SELECT id,wrestler_name FROM waitlist_entries')) names.waitlist[w.id] = w.wrestler_name;
  for (const o of await all<{id: string; wrestler_name: string; item_label: string}>('SELECT id,wrestler_name,item_label FROM orders')) names.orders[o.id] = {wrestler: o.wrestler_name, item: o.item_label};
  for (const v of await all<{id: string; title: string}>('SELECT id,title FROM waiver_versions')) names.waivers[v.id] = v.title;
  for (const c of await all<{id: string; wrestler_name: string; item_label: string; session_date: string}>("SELECT id,wrestler_name,item_label,session_date FROM cash_bookings WHERE status='canceled' AND canceled_by NOT IN ('stripe')"))
    names.cash![c.id] = {wrestler: c.wrestler_name, item: `${c.item_label}, ${dayDate(c.session_date)}`};
  for (const r of await all<{id: string; user_id: string; email: string}>('SELECT id,user_id,email FROM data_requests')) names.requests[r.id] = names.people[r.user_id] ?? r.email;
  for (const c of await all<{id: string; name: string}>('SELECT id,name FROM practice_curricula UNION ALL SELECT id,name FROM practice_curriculum_groups')) names.curricula[c.id] = c.name;
  return {entries: rows.map(r => describeSecurityEvent(r, names)), next: page.next};
}
export async function securityLog(ownerIds: string[]): Promise<SecurityEntry[]> { return (await securityLogPage(ownerIds)).entries; }
