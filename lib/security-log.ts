// The owner's Security activity page (issue #127): each recorded event in plain words, with the person's name or
// email instead of internal ids. Records are never changed; this only reads them and looks up names.
import {env} from 'cloudflare:workers';
import {programDetails} from './program-names';
import {dayDate, fullDate, when} from './datetime';

export type SecurityRow = {actor: string; action: string; target: string; created_at: string};
export type SecurityNames = {
  people: Record<string, string>;      // account id -> "Name (email)" or email
  you: string[];                       // account ids of the owner reading the page
  approvals: Record<string, string>;   // program approval id -> wrestler name
  waitlist: Record<string, string>;    // waitlist entry id -> wrestler name
  orders: Record<string, {wrestler: string; item: string}>;
  waivers: Record<string, string>;     // waiver version id -> title
  wrestlers: Record<string, string>;   // "accountId/wrestlerId" -> wrestler name
  requests: Record<string, string>;    // data request id -> family
  curricula: Record<string, string>;   // curriculum or curriculum group id -> name
  coaches: Record<string, string>;     // coach email -> name
};
export type SecurityEntry = {title: string; detail: string; who: string; at: string};

const TITLES: Record<string, string> = {
  mfa_verified: 'Authenticator code verified',
  backup_exported: 'Backup downloaded',
  backup_restored: 'Backup restored',
  coach_opening_added: 'Lesson opening added',
  coach_opening_removed: 'Lesson opening removed',
  coach_opening_changed: 'Lesson type or spots changed',
  lesson_group_requested: 'Private lesson group asked for',
  lesson_group_canceled: 'Private lesson group called off',
  stripe_test_key_saved: 'Stripe test key saved',
  stripe_live_key_saved: 'Stripe live key saved',
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
  waitlist_offer: 'Waitlist seat offered',
  pass_revoked: 'Entry pass replaced',
  usaw_card_valid: 'USA Wrestling card verified',
  usaw_card_invalid: 'USA Wrestling card marked not valid',
  usaw_card_review_cleared: 'USA Wrestling card review cleared',
  lesson_settings_saved: 'Private lesson prices or coach pay saved',
  announcement_sent: 'Announcement sent',
  waiver_published: 'Waiver published',
  waiver_retired: 'Waiver no longer required',
  waiver_signed: 'Waiver signed',
  membership_transferred: 'Membership moved to another program',
  booking_exception_granted: 'Booking allowed anyway',
  booking_exception_removed: 'Booking exception removed',
  offline_payment_recorded: 'Offline payment recorded',
  offline_payment_voided: 'Offline payment voided',
  account_closure_requested: 'Family asked to close their account',
  data_request_handled: 'Data request handled',
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
    case 'coach_access_granted': case 'coach_access_revoked':
      detail = names.coaches[t.toLowerCase()] ? `${names.coaches[t.toLowerCase()]} (${t})` : t; break;
    case 'practice_plan_shared': case 'practice_plan_draft': case 'practice_plan_hidden': {
      const [p, d] = t.split(':'); detail = d ? `${program(p)} · ${dayDate(d)}` : program(p); break;
    }
    case 'program_approval_requested': case 'program_approval_approved': case 'program_approval_declined':
      detail = names.approvals[t] ?? ''; break;
    case 'waitlist_offer': detail = names.waitlist[t] ?? ''; break;
    case 'pass_revoked': case 'usaw_card_valid': case 'usaw_card_invalid': case 'usaw_card_review_cleared': detail = wrestler(t); break;
    case 'waiver_published': case 'waiver_retired': detail = names.waivers[t] ?? ''; break;
    case 'waiver_signed': {
      const [version, ...w] = t.split('/'); const key = row.actor + '/' + w.join('/');
      detail = [names.waivers[version], names.wrestlers[key]].filter(Boolean).join(' · '); break;
    }
    case 'offline_payment_recorded': {
      const o = order(first); detail = [o?.wrestler, o?.item, money(rest[1] ?? '')].filter(Boolean).join(' · '); break;
    }
    case 'offline_payment_voided': { const o = order(t); detail = o ? `${o.wrestler} · ${o.item}` : ''; break; }
    case 'membership_transferred': {
      const o = order(first), [from = '', to = ''] = (rest[0] ?? '').split('->');
      detail = `${o?.wrestler ? o.wrestler + ': ' : ''}${program(from)} → ${program(to)} from ${fullDate(rest[1] ?? '')}`; break;
    }
    case 'booking_exception_granted': {
      const m = /^(\w+) (\S+) until (\S+)$/.exec(t);
      detail = m ? `${wrestler(m[2])} may book without a ${m[1] === 'usaw' ? 'current USA Wrestling card' : 'signed waiver'} until ${fullDate(m[3])}` : ''; break;
    }
    case 'announcement_sent': detail = rest[0] ? 'Sent to ' + plural(Number(rest[0]), 'family', 'families') : ''; break;
    case 'account_closure_requested': detail = names.people[t] ?? ''; break;
    case 'data_request_handled': detail = names.requests[t] ?? ''; break;
    case 'program_curriculum_saved': case 'curriculum_lesson_created': case 'curriculum_lesson_updated': detail = names.curricula[t] ?? ''; break;
    case 'stripe_event_rejected': detail = REJECTIONS[rest[0] ?? ''] ?? 'Stripe sent a payment message the site could not match.'; break;
    case 'lesson_double_booked': case 'event_over_capacity': {
      const o = order(first), m = /^(\d{4}-\d{2}-\d{2}): (\d+) paid for (\d+) seats?$/.exec(rest.join(' '));
      detail = [o ? `${o.wrestler} · ${o.item}` : '', m ? `${fullDate(m[1])}: ${m[2]} paid for ${plural(Number(m[3]), 'seat', 'seats')}. Refund one or move it.` : ''].filter(Boolean).join(' · '); break;
    }
  }
  const who = row.actor === 'stripe' ? 'Stripe' : names.you.includes(row.actor) ? 'You' : names.people[row.actor] ?? 'Another account';
  return {title: TITLES[row.action] ?? humanize(row.action), detail, who, at: when(row.created_at, now)};
}

type Q<T> = {results: T[]};
const all = async <T>(sql: string): Promise<T[]> => ((await env.DB!.prepare(sql).all<T>()) as Q<T>).results;

// The latest 100 events, described. ownerIds are the ids the reading owner is recorded under.
export async function securityLog(ownerIds: string[]): Promise<SecurityEntry[]> {
  const rows = await all<SecurityRow>('SELECT actor,action,target,created_at FROM security_events ORDER BY created_at DESC LIMIT 100');
  const names: SecurityNames = {people: {}, you: ownerIds, approvals: {}, waitlist: {}, orders: {}, waivers: {}, wrestlers: {}, requests: {}, curricula: {}, coaches: {}};
  const families = await all<{user_id: string; email: string; payload: string}>('SELECT user_id,email,payload FROM family_accounts');
  for (const f of families) {
    let p: any = {}; try { p = JSON.parse(f.payload); } catch {}
    names.people[f.user_id] = p.parentName ? `${p.parentName} (${f.email})` : f.email;
    for (const w of Array.isArray(p.wrestlers) ? p.wrestlers : []) if (w?.id) names.wrestlers[`${f.user_id}/${w.id}`] = String(w.name ?? '');
  }
  for (const c of await all<{email: string; name: string}>('SELECT email,name FROM staff_access')) names.coaches[c.email.toLowerCase()] = c.name;
  for (const o of await all<{user_id: string; coach_email: string | null}>('SELECT DISTINCT user_id,coach_email FROM coach_openings WHERE coach_email IS NOT NULL'))
    names.people[o.user_id] ??= names.coaches[o.coach_email!.toLowerCase()] ? `${names.coaches[o.coach_email!.toLowerCase()]} (${o.coach_email})` : o.coach_email!;
  for (const a of await all<{id: string; wrestler_name: string}>('SELECT id,wrestler_name FROM program_approvals')) names.approvals[a.id] = a.wrestler_name;
  for (const w of await all<{id: string; wrestler_name: string}>('SELECT id,wrestler_name FROM waitlist_entries')) names.waitlist[w.id] = w.wrestler_name;
  for (const o of await all<{id: string; wrestler_name: string; item_label: string}>('SELECT id,wrestler_name,item_label FROM orders')) names.orders[o.id] = {wrestler: o.wrestler_name, item: o.item_label};
  for (const v of await all<{id: string; title: string}>('SELECT id,title FROM waiver_versions')) names.waivers[v.id] = v.title;
  for (const r of await all<{id: string; user_id: string; email: string}>('SELECT id,user_id,email FROM data_requests')) names.requests[r.id] = names.people[r.user_id] ?? r.email;
  for (const c of await all<{id: string; name: string}>('SELECT id,name FROM practice_curricula UNION ALL SELECT id,name FROM practice_curriculum_groups')) names.curricula[c.id] = c.name;
  return rows.map(r => describeSecurityEvent(r, names));
}
