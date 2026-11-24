// The welcome page, the signed-out home and the front door families sign up from. Justin decided on Nov 24 (#197, Q22,
// changed; issue #412) that the site does not host the academy's marketing website: the team page (coach bios, wrestler
// achievements, alumni) and the owner's Public website editor were removed. The welcome page keeps a short fixed welcome
// (the academy's name, who it is for, and its address and email) around the programs, steps and calendar that the page's
// own script loads. No wrestler or coach is named on it.
// - The academy's address and email for families (academyContact) still read the 'website' settings row when an
//   earlier editor saved them, else the fixed ones below. Nothing writes that row any more.
// - The coach card (coachCard, COACH_CARD_CSS) stays: the coach's own profile page shows it as "What families see"
//   beside lesson times.
// - Absolute addresses (canonical, og:url) use appOrigin(), so moving to savagewrestling.com (#43) needs no code change.
import {env} from 'cloudflare:workers';
import {appOrigin} from './account-auth';

export const ACADEMY = 'Savage Wrestling Academy';
export const WELCOME_INTRO = 'Wrestling for kindergarten through 12th grade, from first-time wrestlers to experienced competitors.';
export type PublicCoach = {name: string; bio: string; specialties: string[]};

export const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!);

// ---------- Rendering ----------
const paras = (t: string) => t.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
const initials = (n: string) => n.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

// One coach's card on the team page. The coach's own profile page shows the same card as its "What families see"
// preview (issue #223): the route adds COACH_CARD_CSS, and the page's teamCard() builds this markup as the coach types
// (tests/coach-polish.mjs checks the two give the same HTML).
export function coachCard(c: PublicCoach) {
  return `<article class="coach card"><div class="coach__top"><span class="mono mono--lg" aria-hidden="true">${esc(initials(c.name))}</span><h3>${esc(c.name)}</h3></div>`
    + (c.specialties.length ? `<ul class="chips" aria-label="Specialties">${c.specialties.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '')
    + (c.bio ? `<div class="coach__bio">${paras(c.bio)}</div>` : '') + '</article>';
}
// The card's styles, for the team page and the coach profile page. Initials stand in for a photo.
export const COACH_CARD_CSS = `.coach{padding:22px;display:flex;flex-direction:column;gap:12px;border-top:3px solid #141416!important}
.coach__top{display:flex;align-items:center;gap:14px}
html body .coach h3{margin:0;font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;font-weight:800;font-size:26px;text-transform:uppercase;letter-spacing:.2px;line-height:1.05;overflow-wrap:anywhere}
.mono{flex:none;width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:#141416;color:#fff;border:2px solid #C4222C;font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;font-weight:800;font-size:22px;letter-spacing:.5px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.chips li{background:#EEF0F2;border-radius:999px;padding:3px 11px;font-size:14px;font-weight:600;overflow-wrap:anywhere}
.coach__bio p{margin:0 0 10px;color:#2A2B30;overflow-wrap:anywhere}
.coach__bio p:last-child{margin:0}
/* A coach with no bio yet (issue #231): a compact card at its own height, not a tall empty box beside a coach with one. */
.coach:not(:has(.coach__bio)){align-self:start;padding:16px 20px}`;
// Fill <!--slot:name--> markers. A function replacement, so "$&" or "$1" in owner text stays literal.
export function fill(template: string, slots: Record<string, string>) {
  return template.replace(/<!--slot:([a-z]+)-->/g, (m, k: string) => (k in slots ? slots[k] : m));
}
export function clip(t: string, max = 160) {
  const s = t.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1), at = cut.lastIndexOf(' ');
  return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:–-]+$/, '') + '…';
}
// Title, description, canonical address and Open Graph text tags. No og:image: nothing is loaded from elsewhere.
export function seoHead(title: string, description: string, path: string, origin: string | null) {
  const url = origin ? origin + path : '';
  return `<title>${esc(title)}</title><meta name="description" content="${esc(description)}">`
    + (url ? `<link rel="canonical" href="${esc(url)}">` : '')
    + `<meta property="og:type" content="website"><meta property="og:site_name" content="${ACADEMY}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">`
    + (url ? `<meta property="og:url" content="${esc(url)}">` : '')
    + `<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">`;
}
export function siteOrigin() { try { return appOrigin(); } catch { return null; } }

// Where to find the academy, under the welcome.
function visitSection(c: Contact) {
  const map = c.address ? `<p class="visit__line"><span class="visit__label">Address</span>${esc(c.address)}</p>` : '';
  const mail = c.email ? `<p class="visit__line"><span class="visit__label">Email</span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>` : '';
  return map || mail ? `<section class="plain visit" id="visit" aria-labelledby="visitTitle"><h2 id="visitTitle">Visit the academy</h2><div class="visit__card card">${map}${mail}</div></section>` : '';
}

// The welcome page: the fixed welcome and the visit details, around the programs, steps and calendar that the page's own
// script loads. The template's mission, team and team-link slots stay empty (issue #412).
export function renderWelcome(template: string, contact: Contact, origin: string | null) {
  return fill(template, {
    head: seoHead(`${ACADEMY} | Wrestling in Huntington Station, NY`, clip(WELCOME_INTRO), '/welcome', origin),
    headline: esc(ACADEMY), intro: esc(WELCOME_INTRO), mission: '', herolink: '', team: '', visit: visitSection(contact)});
}

// ---------- The academy's contact ----------
// Where a family can reach the academy (issue #273): the address and email an earlier website editor saved, else the
// academy's fixed address and email, the ones on the membership terms page. Used by "Tell the academy I want this", the
// membership emails and the welcome page.
export const ACADEMY_ADDRESS = '20 Railroad St, Huntington Station, NY 11746';
export const ACADEMY_EMAIL = 'savagewrestlingclub@gmail.com';
export type Contact = {address: string; email: string};
const SAVED_EMAIL = /^[^@\s<>"]{1,64}@[^@\s<>"]+\.[^@\s<>"]+$/;
const savedLine = (v: unknown, max: number) => typeof v === 'string' && v.trim() && v.length <= max && !/[\u0000-\u001f\u007f\u2028\u2029]/.test(v) ? v.replace(/\s+/g, ' ').trim() : '';
export async function academyContact(): Promise<Contact> {
  let saved: any = null;
  try {
    const row = await env.DB!.prepare("SELECT payload FROM academy_settings WHERE id='website'").first<{payload: string}>();
    saved = row ? JSON.parse(row.payload) : null;
  } catch { saved = null; }
  const address = savedLine(saved?.address, 160), email = savedLine(saved?.email, 120);
  return {address: address || ACADEMY_ADDRESS, email: email && SAVED_EMAIL.test(email) ? email : ACADEMY_EMAIL};
}
