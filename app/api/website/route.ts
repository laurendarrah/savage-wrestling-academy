// Owner editor for the public website (issue #196): the welcome page's headline, introduction and mission, which
// coaches the team page shows and in what order, wrestler achievements, alumni and visit details. Saving publishes.
// "preview" renders the unsaved content as the welcome or team page, for the editor's preview frame.
import welcomeHtml from '../../welcome/screen.html?raw';
import teamHtml from '../../team/screen.html?raw';
import {ownerIdentity, sameOrigin, accountReply} from '../../../lib/account-auth';
import {cleanWebsite, coachRows, loadWebsite, saveWebsite, publicCoaches, renderTeam, renderWelcome, siteOrigin, LIMITS} from '../../../lib/website';
import {decoratePage} from '../../../lib/page-chrome';
import {withApi} from '../../../lib/api';
export const dynamic = 'force-dynamic';
const DENIED = 'Owner sign-in and authenticator verification required.';

export const GET = withApi(GET_); async function GET_(request: Request) {
  const auth = await ownerIdentity(request);
  if (!auth.owner) return accountReply({error: DENIED}, 403, auth.headers);
  const {site, updatedAt} = await loadWebsite();
  // The owner chooses from everyone on Coaches. Whether a bio is written helps them choose; no phone is read.
  const coaches = (await coachRows()).map(r => ({email: r.email, name: r.display_name || r.name, active: r.active === 1, profileSaved: r.display_name !== null, hasBio: !!r.bio}));
  return accountReply({site, updatedAt, coaches, limits: LIMITS}, 200, auth.headers);
}

export const POST = withApi(POST_); async function POST_(request: Request) {
  const auth = await ownerIdentity(request), reply = (b: unknown, s = 200) => accountReply(b, s, auth.headers);
  if (!auth.owner) return reply({error: DENIED}, 403);
  if (!sameOrigin(request)) return reply({error: 'Invalid request origin.'}, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error: 'JSON required.'}, 415);
  const raw = await request.text();
  if (raw.length > 200000) return reply({error: 'That is too much text to save at once. Shorten the lists and try again.'}, 413);
  let input: any;
  try { input = JSON.parse(raw); } catch { return reply({error: 'Invalid request.'}, 400); }
  const rows = await coachRows();
  const clean = cleanWebsite(input?.site, new Set(rows.map(r => r.email.toLowerCase())));
  if ('error' in clean) return reply({error: clean.error}, 400);
  if (input.action === 'preview') {
    const coaches = publicCoaches(clean.site.coaches, rows), origin = siteOrigin();
    const page = input.page === 'team' ? decoratePage(renderTeam(teamHtml, clean.site, coaches, origin), '/team') : decoratePage(renderWelcome(welcomeHtml, clean.site, coaches, origin), '/welcome');
    return reply({html: page});
  }
  if (input.action !== 'save') return reply({error: 'Invalid request.'}, 400);
  if (input.updatedAt !== null && typeof input.updatedAt !== 'string') return reply({error: 'Reload the page and try again.'}, 400);
  const saved = await saveWebsite(clean.site, input.updatedAt, auth.owner.userId);
  if (!saved) return reply({error: 'The website was saved on another device. Reload the page to see the latest, then make your changes again.'}, 409);
  return reply({ok: true, site: clean.site, updatedAt: saved.updatedAt});
}
