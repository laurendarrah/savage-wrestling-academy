// Lesson formats with the owner's per-wrestler prices and the coach openings still open to book (issues #70, #177).
// Signed-in families and the owner (for recording offline lesson payments) can read it. A family also gets the private
// groups they organised (with each invite link), and with ?join=<code> the private group that link opens.
// Private groups are never in the openings list a family sees, and invite codes are only ever shown to the organiser.
import {strongAccount, ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {privateFormats, academyToday} from '../../../lib/public-schedule';
import {lessonSettings, openLessons, familyGroups, openingByInvite, groupView, requestGroup, cancelGroup} from '../../../lib/lessons';
import {checkoutKinds} from '../../../lib/checkout-config';
import {rateLimited} from '../../../lib/rate-limit';
import {publicProfiles} from '../../../lib/coach-profile';
import {holidaysInMonth} from '../../../lib/holidays';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';

async function family(request: Request) {
  const auth = await strongAccount(request);
  if (!auth.user?.email_confirmed_at) return {auth, error: accountReply({error: 'Sign-in required.'}, 401, auth.headers)};
  if (auth.user.factors?.some(f => f.status === 'verified') && !auth.strong) return {auth, error: accountReply({error: 'Authenticator verification required.'}, 403, auth.headers)};
  return {auth, error: null};
}

export const GET = withApi(GET_); async function GET_(request: Request) {
  const owner = await ownerIdentity(request);
  let headers = owner.headers, userId: string | null = null;
  if (!owner.owner) {
    const f = await family(request);
    if (f.error) return f.error;
    headers = f.auth.headers; userId = f.auth.user!.id;
  }
  const today = academyToday(), {prices} = await lessonSettings();
  const formats = privateFormats.map(f => ({...f, cents: typeof prices[f.id] === 'number' ? prices[f.id] : null}));
  // Families get an opaque coach key for filtering, never the coach's email address (issue #97).
  const key = async (email: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email)))).slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('');
  const list = await openLessons(today, undefined, {includeClosed: !!owner.owner});
  // About each coach with open times (issue #190): name, bio and specialties from their profile, by coach key.
  const profiles = await publicProfiles(list.map(o => o.coachEmail)), coaches: Record<string, {name: string; bio: string; specialties: string[]}> = {};
  const openings = await Promise.all(list.map(async ({coachEmail, ...o}) => {
    const k = await key(coachEmail), p = profiles.get(coachEmail.toLowerCase());
    if (p && (p.bio || p.specialties.length)) coaches[k] = p;
    return {...o, coachKey: k};
  }));
  // For the month view (issue #239): the academy's date, so the page marks today, and U.S. holidays as labels in every
  // month that has an open time.
  const months = [...new Set(list.map(o => o.date.slice(0, 7)))];
  const body: Record<string, unknown> = {formats, openings, coaches, paymentsOpen: checkoutKinds().has('lesson'), today, holidays: months.flatMap(holidaysInMonth)};
  if (userId) {
    body.mine = await familyGroups(userId, today);
    const join = new URL(request.url).searchParams.get('join');
    if (join !== null) {
      if (await rateLimited(request, 'lesson-invite:' + userId, 30)) return accountReply({error: 'Too many tries. Please wait a minute.'}, 429, headers);
      const o = await openingByInvite(join, today);
      if (!o) return accountReply({...body, error: 'This invite link isn’t working. The lesson may have passed or been called off. Ask the family who sent it.'}, 404, headers);
      body.invite = await groupView(o, userId);
    }
  }
  return accountReply(body, 200, headers);
}

// A family asks for a private partner or small group at an open time, or calls off one they asked for.
export const POST = withApi(POST_); async function POST_(request: Request) {
  const f = await family(request);
  if (f.error) return f.error;
  const reply = (b: unknown, s = 200) => accountReply(b, s, f.auth.headers), userId = f.auth.user!.id;
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 2048) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (await rateLimited(request, 'lesson-group:' + userId, 20)) return reply({error: 'Too many changes. Please wait a minute.'}, 429);
  const today = academyToday();
  if (input?.action === 'request') {
    const r = await requestGroup(userId, input, today);
    return r.status === 200 ? reply({group: r.group}) : reply({error: r.error, ...(r.extra ?? {})}, r.status);
  }
  if (input?.action === 'cancel') {
    const r = await cancelGroup(userId, input.openingId, today);
    return r.status === 200 ? reply({ok: true}) : reply({error: r.error}, r.status);
  }
  return reply({error: 'Unknown action.'}, 400);
}
