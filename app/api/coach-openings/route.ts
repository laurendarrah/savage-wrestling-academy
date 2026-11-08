// The owner manages any coach's lesson openings (issue #239, Justin's entry 05). Owner only. Adding, changing and
// removing go through the same functions as coach home (lib/lessons.ts), so the one-hour rule, lesson types and spots,
// the weekly repeat (up to 12 weeks), overlap checks and the refusal to remove a booked lesson are the same. The opening
// stays the coach's: families book it with that coach, and the lesson's pay goes to that coach (lib/coach-pay.ts reads
// the coach from the opening). Each change is in the security log, and the coach gets an email notice.
import {env} from 'cloudflare:workers';
import {ownerIdentity, sameOrigin, accountReply, OWNER_EMAIL} from '../../../lib/account-auth';
import {securityEvent} from '../../../lib/security-events';
import {coachSchedule, addOpenings, updateOpening, removeOpening, coachAccount, MAX_WEEKS, GROUP_SPOTS, type CoachRef} from '../../../lib/lessons';
import {academyToday} from '../../../lib/public-schedule';
import {notify, quietly} from '../../../lib/notify';
import {dayDate, dayTime, clockTime} from '../../../lib/datetime';
export const dynamic = 'force-dynamic';

type Staff = {email: string; name: string; programs: string; display_name: string | null};
// An active coach on /staff (the owner too, once they coach). Openings of a removed coach are not bookable anyway.
async function activeCoach(email: unknown) {
  if (typeof email !== 'string' || email.length > 254) return null;
  return await env.DB!.prepare('SELECT s.email,s.name,s.programs,p.display_name FROM staff_access s LEFT JOIN coach_profiles p ON p.email=s.email WHERE s.email=? AND s.active=1')
    .bind(email.trim().toLowerCase()).first<Staff>();
}
// The owner coaching under their own account files openings under it, as coach home does.
async function refOf(s: Staff, ownerAccount: string): Promise<CoachRef> {
  return {email: s.email, name: s.display_name || s.name, userId: s.email === OWNER_EMAIL ? ownerAccount : await coachAccount(s.email)};
}

export async function GET(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in and authenticator verification required.'}, 403, auth.headers);
  const s = await activeCoach(new URL(request.url).searchParams.get('email'));
  if (!s) return accountReply({error: 'Coach not found. Only coaches with access on Coaches have lesson openings.'}, 404, auth.headers);
  const today = academyToday(), coach = await refOf(s, auth.user!.id);
  return accountReply({coach: {email: s.email, name: coach.name, programs: JSON.parse(s.programs), you: s.email === OWNER_EMAIL}, today, maxWeeks: MAX_WEEKS, groupSpots: GROUP_SPOTS,
    openings: await coachSchedule(coach, today, true)}, 200, auth.headers);
}

export async function POST(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 2048) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  const s = await activeCoach(input?.email);
  if (!s) return reply({error: 'Coach not found. Only coaches with access on Coaches have lesson openings.'}, 404);
  const coach = await refOf(s, auth.user!.id), actor = auth.owner.userId, by = {byOwner: true};
  // The coach hears about it by email (coaches have no inbox), unless the owner is changing their own openings.
  const tell = (what: string, body: string) => s.email === OWNER_EMAIL ? Promise.resolve() : quietly(() => notify([{userId: null, email: s.email, kind: 'coach_openings_changed',
    dedupeKey: `owner-openings:${crypto.randomUUID()}`, link: '/coach#lessons', subject: what, body}]));

  if (input.action === 'add') {
    const r = await addOpenings(coach, input, by);
    if (r.status !== 200) return reply({error: r.error}, r.status);
    const n = r.created!.length, at = clockTime(input.start);
    await securityEvent(actor, 'owner_opening_added', `${s.email} ${n}`);
    await tell(n === 1 ? 'The academy added a lesson opening for you' : `The academy added ${n} lesson openings for you`,
      `The academy added ${n === 1 ? 'a one-hour lesson opening' : n + ' one-hour lesson openings'} for you at ${at}: ${r.created!.map(dayDate).join(', ')}. Families can book them now. See them under Your private lessons on coach home.`);
    return reply({ok: true, created: r.created, skipped: r.skipped});
  }
  if (input.action === 'update') {
    const r = await updateOpening(coach, input, by);
    if (r.status !== 200) return reply({error: r.error}, r.status);
    await securityEvent(actor, 'owner_opening_changed', `${s.email} ${String(input.id).slice(0, 80)}`);
    return reply({ok: true});
  }
  if (input.action === 'remove') {
    const r = await removeOpening(coach, input.id, by);
    if (r.status !== 200) return reply({error: r.error}, r.status);
    const when = dayTime(r.removed!.date, r.removed!.start);
    await securityEvent(actor, 'owner_opening_removed', `${s.email} ${r.removed!.date} ${r.removed!.start}`);
    await tell(`The academy removed your lesson opening: ${when}`, `The academy removed your open lesson time on ${when}. Nobody had booked it.`);
    return reply({ok: true});
  }
  return reply({error: 'Choose add, update or remove.'}, 400);
}
