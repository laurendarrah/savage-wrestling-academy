// Who collected a payment at the academy (issue #250, decided by Lauren on November 7): coaches receive cash at the door,
// and the site shows which coach marked it received.
//
// When a coach or the owner taps Cash received (lib/cash-bookings.ts receiveCash), the payment's pricing keeps:
// - recordedBy: the account that tapped it. This is the key Payments filters and totals by.
// - collectedBy: the name shown, worked out at that moment: the coach's profile display name (#207), else their name on
//   Coaches, else "Coach". The owner is "Owner". Never an email.
// - collectedByEmail: the coach's email (null for the owner), for the 3-year coach cleanup (#226), which replaces all three
//   with "former-coach-<id>" / "Former coach".
// - collectedAt: when it was tapped.
// An offline payment the owner records on Payments has recordedBy only: it was collected by the owner.
//
// The family is never shown who collected it, only that it was paid in cash at the academy.
import {env} from 'cloudflare:workers';

export const OWNER_COLLECTOR = 'Owner';
export const FORMER_COLLECTOR = 'Former coach';
export type Collector = {id: string; name: string; email: string | null};

// The collector for a coach tapping Cash received: profile display name, else the name on Coaches, else "Coach".
export async function coachCollector(userId: string, staff: {email: string; name: string}): Promise<Collector> {
  const email = staff.email.toLowerCase();
  const profile = await env.DB!.prepare('SELECT display_name FROM coach_profiles WHERE email=?').bind(email).first<{display_name: string}>();
  const name = [profile?.display_name, staff.name].map(v => String(v ?? '').trim()).find(v => v && !v.includes('@')) || 'Coach';
  return {id: userId, name, email};
}
export const ownerCollector = (userId: string): Collector => ({id: userId, name: OWNER_COLLECTOR, email: null});

// SQL for the key and the name of who collected an offline payment, on an orders row aliased `o`. Online payments have
// neither. A name saved before this change could be an email (#249 fell back to it); it is looked up again from the
// coach's profile and Coaches, and is never shown.
const p = (o: string, k: string) => `json_extract(${o}.pricing,'$.${k}')`;
export const collectorKeySql = (o = 'o') => `CASE WHEN ${o}.source='offline' THEN ${p(o, 'recordedBy')} END`;
export const collectorNameSql = (o = 'o') => `CASE WHEN ${o}.source<>'offline' THEN NULL
  WHEN COALESCE(${p(o, 'collectedBy')},'')<>'' AND instr(${p(o, 'collectedBy')},'@')=0 THEN ${p(o, 'collectedBy')}
  WHEN ${p(o, 'collectedByEmail')} LIKE 'former-coach-%' THEN '${FORMER_COLLECTOR}'
  WHEN ${p(o, 'collectedByEmail')} IS NOT NULL THEN COALESCE(
    (SELECT NULLIF(trim(display_name),'') FROM coach_profiles WHERE email=lower(${p(o, 'collectedByEmail')}) AND instr(display_name,'@')=0),
    (SELECT NULLIF(trim(name),'') FROM staff_access WHERE email=lower(${p(o, 'collectedByEmail')}) AND instr(name,'@')=0), 'Coach')
  ELSE '${OWNER_COLLECTOR}' END`;
