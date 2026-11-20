// The lesson calendar (issue #390), owner only: every coach's lesson times in a month, and per time the Public/Private
// switch and the link to send parents. The rules are in lib/lessons.ts. Each change is in the security log.
import {ownerIdentity, sameOrigin, accountReply, appOrigin} from '../../../lib/account-auth';
import {lessonCalendar, setLessonPrivate, lessonShareCode} from '../../../lib/lessons';
import {academyToday} from '../../../lib/public-schedule';
import {holidaysInMonth} from '../../../lib/holidays';
import {securityEvent} from '../../../lib/security-events';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';
const validMonth = (m: unknown): m is string => typeof m === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(m);
// The link a parent opens: the lesson page, after sign-in, opened at this lesson.
const shareUrl = (code: string) => appOrigin() + '/lesson?join=' + encodeURIComponent(code);

export const GET = withApi(GET_); async function GET_(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in required.'}, 403, auth.headers);
  const today = academyToday(), asked = new URL(request.url).searchParams.get('month'), month = validMonth(asked) ? asked : today.slice(0, 7);
  return accountReply({month, today, holidays: holidaysInMonth(month), lessons: await lessonCalendar(month)}, 200, auth.headers);
}

export const POST = withApi(POST_); async function POST_(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 1024) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  if (input?.action === 'visibility') {
    const r = await setLessonPrivate(input.id, input.private);
    if (r.status !== 200) return reply({error: r.error}, r.status);
    await securityEvent(auth.owner.userId, r.private ? 'lesson_made_private' : 'lesson_made_public', `${r.coach} · ${r.when}`);
    return reply({ok: true, private: r.private});
  }
  if (input?.action === 'link') {
    const r = await lessonShareCode(input.id);
    if (r.status !== 200) return reply({error: r.error}, r.status);
    return reply({ok: true, url: shareUrl(r.code!)});
  }
  return reply({error: 'Choose visibility or link.'}, 400);
}
