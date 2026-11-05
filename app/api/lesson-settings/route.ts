// Owner lesson settings (issues #70 and #75): price per lesson format and each coach's share of lesson pay.
import {env} from 'cloudflare:workers';
import {ownerIdentity, accountReply, sameOrigin} from '../../../lib/account-auth';
import {privateFormats} from '../../../lib/public-schedule';
import {lessonSettings, saveLessonSettings} from '../../../lib/lessons';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: 'Owner sign-in and authenticator verification required.'}, 403, auth.headers);
  const coaches = (await env.DB!.prepare('SELECT email,name,active FROM staff_access ORDER BY name').all<{email: string; name: string; active: number}>()).results;
  return accountReply({formats: privateFormats, settings: await lessonSettings(), coaches}, 200, auth.headers);
}

export async function POST(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: 'Owner sign-in and authenticator verification required.'}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 8192) return reply({error: 'Request too large.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  const r = await saveLessonSettings(input, auth.owner.userId);
  return r.status === 200 ? reply({ok: true, settings: r.settings}) : reply({error: r.error}, r.status);
}
