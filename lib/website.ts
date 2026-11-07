// The academy's public marketing website (issue #196; Justin's decision in #197, question 22): the welcome page's
// headline, introduction and mission, and the team page with coaches, wrestler achievements and alumni.
// - Stored as one academy_settings row, id 'website' (like 'lessons'), so it never touches the owner workspace's
//   academy_state document or its revision. updated_at guards against two devices saving over each other.
// - Wrestlers appear by name only: there is no photo or image field anywhere, and no link fields at all, so the
//   pages never load anything from another site (the routes send img-src 'self').
// - Coaches come from their real profiles (#190): display name, bio and specialties. Never the email or phone.
// - The owner chooses which coaches appear and in what order. An empty list hides its section.
// - Absolute addresses (canonical, og:url) use appOrigin(), so moving to savagewrestling.com (#43) needs no code change.
import {env} from 'cloudflare:workers';
import {appOrigin} from './account-auth';

export const ACADEMY = 'Savage Wrestling Academy';
export type Achievement = {name: string; achievement: string; season: string};
export type Alum = {name: string; years: string; next: string};
export type Website = {headline: string; intro: string; mission: string; coaches: string[]; achievements: Achievement[]; alumni: Alum[]; address: string; email: string};
export type PublicCoach = {name: string; bio: string; specialties: string[]};
export type CoachRow = {email: string; name: string; active: number; display_name: string | null; bio: string | null; specialties: string | null};

export const LIMITS = {headline: 80, intro: 320, mission: 1500, name: 80, achievement: 160, season: 30, years: 30, next: 160, address: 160, email: 120, items: 200, coaches: 40};
// Until the owner saves, the welcome page reads exactly as it did before (issue #137).
export const DEFAULT_WEBSITE: Website = {headline: ACADEMY, intro: 'Wrestling for kindergarten through 12th grade, from first-time wrestlers to experienced competitors.', mission: '', coaches: [], achievements: [], alumni: [], address: '', email: ''};

export const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!);
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/;
const EMAIL = /^[^@\s<>"]{1,64}@[^@\s<>"]+\.[^@\s<>"]+$/;

type Check = {value: string} | {error: string};
// One line of plain text: spaces and line breaks collapse to single spaces.
function line(v: unknown, max: number, what: string, required: boolean): Check {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') return {error: `Check ${what}.`};
  const value = v.replace(/\s+/g, ' ').trim();
  if (required && !value) return {error: `Enter ${what}.`};
  if (value.length > max) return {error: `Keep ${what} to ${max} characters.`};
  if (CONTROLS.test(value)) return {error: `${what[0].toUpperCase() + what.slice(1)} has characters that can’t be saved.`};
  return {value};
}
// A few paragraphs: blank lines separate them.
function text(v: unknown, max: number, what: string): Check {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') return {error: `Check ${what}.`};
  const value = v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (value.length > max) return {error: `Keep ${what} to ${max} characters.`};
  if (/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/.test(value)) return {error: `${what[0].toUpperCase() + what.slice(1)} has characters that can’t be saved.`};
  return {value};
}

// Checks everything the owner sends and keeps only the known fields (a photo or image field is dropped).
// knownCoaches: emails on Coaches (staff_access); a coach who is not there cannot be shown.
export function cleanWebsite(input: any, knownCoaches?: Set<string>): {site: Website} | {error: string} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {error: 'Check the website content.'};
  const out: any = {};
  const fields: [keyof Website, Check][] = [
    ['headline', line(input.headline, LIMITS.headline, 'the headline', true)],
    ['intro', line(input.intro, LIMITS.intro, 'the introduction', true)],
    ['mission', text(input.mission, LIMITS.mission, 'the mission')],
    ['address', line(input.address, LIMITS.address, 'the address', false)],
    ['email', line(input.email, LIMITS.email, 'the contact email', false)]];
  for (const [key, r] of fields) { if ('error' in r) return r; out[key] = r.value; }
  if (out.email && !EMAIL.test(out.email)) return {error: 'Enter a contact email like name@example.com, or leave it blank.'};

  const coaches = input.coaches ?? [];
  if (!Array.isArray(coaches) || coaches.length > LIMITS.coaches) return {error: 'Check the coaches to show.'};
  out.coaches = [];
  for (const c of coaches) {
    if (typeof c !== 'string' || !EMAIL.test(c.trim()) || c.length > 254) return {error: 'Check the coaches to show.'};
    const email = c.trim().toLowerCase();
    if (knownCoaches && !knownCoaches.has(email)) return {error: 'A coach you chose is no longer on Coaches. Reload the page and choose again.'};
    if (!out.coaches.includes(email)) out.coaches.push(email);
  }

  const list = <T>(raw: unknown, label: string, one: string, parts: [keyof T, number, string, boolean][]): T[] | {error: string} => {
    raw = raw ?? [];
    if (!Array.isArray(raw)) return {error: `Check the ${label} list.`};
    if (raw.length > LIMITS.items) return {error: `List up to ${LIMITS.items} ${label}.`};
    const rows: T[] = [];
    for (const [i, item] of raw.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return {error: `Check the ${label} list.`};
      const row: any = {};
      for (const [key, max, what, required] of parts) {
        const r = line((item as any)[key], max, what, required);
        if ('error' in r) return {error: `${one} ${i + 1}: ${r.error[0].toLowerCase() + r.error.slice(1)}`};
        row[key] = r.value;
      }
      rows.push(row);
    }
    return rows;
  };
  const achievements = list<Achievement>(input.achievements, 'achievements', 'Achievement', [['name', LIMITS.name, 'the wrestler’s name', true], ['achievement', LIMITS.achievement, 'what they achieved', true], ['season', LIMITS.season, 'the season or year', true]]);
  if ('error' in achievements) return achievements;
  const alumni = list<Alum>(input.alumni, 'alumni', 'Alumni entry', [['name', LIMITS.name, 'the name', true], ['years', LIMITS.years, 'the years', false], ['next', LIMITS.next, 'where they went or what they did', true]]);
  if ('error' in alumni) return alumni;
  out.achievements = achievements; out.alumni = alumni;
  return {site: out as Website};
}

// What a family or visitor may see of each chosen coach, in the owner's order. Only active coaches. Never the email or
// phone: the rows passed in have no phone column, and the email is only used to match the owner's choice.
export function publicCoaches(order: string[], rows: CoachRow[]): PublicCoach[] {
  const by = new Map(rows.map(r => [r.email.toLowerCase(), r]));
  const out: PublicCoach[] = [];
  for (const email of order) {
    const r = by.get(email.toLowerCase());
    if (!r || r.active !== 1) continue;
    let specialties: string[] = [];
    try { const s = JSON.parse(r.specialties || '[]'); if (Array.isArray(s)) specialties = s.filter(x => typeof x === 'string'); } catch {}
    out.push({name: r.display_name || r.name, bio: r.bio || '', specialties});
  }
  return out;
}

// ---------- Rendering (owner text is always escaped) ----------
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
.coach__bio p:last-child{margin:0}`;
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

const alums = (n: number) => n === 1 ? '1 alum' : `${n} alumni`;
const joinWords = (xs: string[]) => xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs.at(-1);
const hasTeam = (site: Website, coaches: PublicCoach[]) => coaches.length + site.achievements.length + site.alumni.length > 0;
// The welcome page's link to /team names only what the team page shows (issue #231): "Meet our coaches" when there are
// only coaches, "Meet our wrestlers" when there are only achievements or alumni.
export function teamLinkText(site: Website, coaches: PublicCoach[]) {
  const who = [coaches.length ? 'coaches' : '', site.achievements.length + site.alumni.length ? 'wrestlers' : ''].filter(Boolean);
  return `Meet our ${joinWords(who)} →`;
}

function visitSection(site: Website) {
  if (!site.address && !site.email) return '';
  const map = site.address ? `<p class="visit__line"><span class="visit__label">Address</span>${esc(site.address)}</p>` : '';
  const mail = site.email ? `<p class="visit__line"><span class="visit__label">Email</span><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p>` : '';
  return `<section class="plain visit" id="visit" aria-labelledby="visitTitle"><h2 id="visitTitle">Visit the academy</h2><div class="visit__card card">${map}${mail}</div></section>`;
}

// The welcome page (also the signed-out home): the owner's headline, introduction and mission, a look at the team and
// the visit details, around the programs, steps and calendar that the page's own script loads.
export function renderWelcome(template: string, site: Website, coaches: PublicCoach[], origin: string | null) {
  const title = site.headline === ACADEMY ? `${ACADEMY} | Wrestling in Huntington Station, NY` : `${site.headline} | ${ACADEMY}`;
  const mission = site.mission ? `<section class="mission" aria-labelledby="missionTitle"><h2 id="missionTitle">Our mission</h2><div class="mission__text">${paras(site.mission)}</div></section>` : '';
  let team = '';
  if (hasTeam(site, coaches)) {
    const parts = [coaches.length ? `${coaches.length} coach${coaches.length === 1 ? '' : 'es'}` : '', site.achievements.length ? `${site.achievements.length} wrestler achievement${site.achievements.length === 1 ? '' : 's'}` : '', site.alumni.length ? alums(site.alumni.length) : ''].filter(Boolean);
    const names = coaches.slice(0, 4).map(c => `<li><span class="mono" aria-hidden="true">${esc(initials(c.name))}</span>${esc(c.name)}</li>`).join('');
    team = `<section class="teaser" aria-labelledby="teamTitle"><div class="teaser__in"><div><p class="eyebrow">The team</p><h2 id="teamTitle">${coaches.length ? 'Meet the coaches' : 'Our wrestlers'}</h2><p class="teaser__count">${esc(joinWords(parts))}</p></div>${names ? `<ul class="teaser__names">${names}</ul>` : ''}<a class="button primary" href="/team">Meet the team</a></div></section>`;
  }
  return fill(template, {
    head: seoHead(title, clip(site.intro), '/welcome', origin),
    headline: esc(site.headline), intro: esc(site.intro), mission,
    herolink: hasTeam(site, coaches) ? `<a class="herolink" href="/team">${esc(teamLinkText(site, coaches))}</a>` : '',
    team, visit: visitSection(site)});
}

// The team page: coaches, wrestler achievements (grouped by season, in the owner's order) and alumni. Each section is
// left out when its list is empty.
export function renderTeam(template: string, site: Website, coaches: PublicCoach[], origin: string | null) {
  const present = [coaches.length ? 'coaches' : '', site.achievements.length ? 'achievements' : '', site.alumni.length ? 'alumni' : ''].filter(Boolean);
  const title = present.length ? `${joinWords(present.map((p, i) => i ? p : p[0].toUpperCase() + p.slice(1)))} | ${ACADEMY}` : `Our team | ${ACADEMY}`;
  const lede = present.length
    ? joinWords([coaches.length ? 'meet the coaches' : '', site.achievements.length ? 'see what our wrestlers have achieved' : '', site.alumni.length ? 'follow our alumni' : ''].filter(Boolean)) + '.'
    : 'Our coaches, wrestler achievements and alumni will be listed here soon.';
  const description = present.length
    ? clip(`${ACADEMY} in Huntington Station, NY: ` + joinWords([coaches.length ? 'coaches ' + joinWords(coaches.slice(0, 4).map(c => c.name)) : '', site.achievements.length ? `${site.achievements.length} wrestler achievement${site.achievements.length === 1 ? '' : 's'}` : '', site.alumni.length ? alums(site.alumni.length) : ''].filter(Boolean)) + '.')
    : `The coaches and wrestlers of ${ACADEMY} in Huntington Station, NY.`;
  const jump = present.length > 1 ? `<nav class="jump" aria-label="On this page">${present.map(p => `<a href="#${p}">${p[0].toUpperCase() + p.slice(1)}</a>`).join('')}</nav>` : '';

  const coachHtml = coaches.length ? `<section class="plain block" id="coaches" aria-labelledby="coachesTitle"><div class="block__head"><p class="eyebrow">On the mat</p><h2 id="coachesTitle">Coaches</h2></div><div class="coaches">${coaches.map(coachCard).join('')}</div></section>` : '';

  const seasons: {season: string; items: Achievement[]}[] = [];
  for (const a of site.achievements) { const g = seasons.find(s => s.season.toLowerCase() === a.season.toLowerCase()); if (g) g.items.push(a); else seasons.push({season: a.season, items: [a]}); }
  const achHtml = seasons.length ? `<section class="plain block" id="achievements" aria-labelledby="achTitle"><div class="block__head"><p class="eyebrow">Results</p><h2 id="achTitle">Wrestler achievements</h2></div><div class="seasons">${seasons.map(g =>
    `<article class="season card"><h3 class="season__label">${esc(g.season)}</h3><ul class="results">${g.items.map(a => `<li><b>${esc(a.name)}</b><span>${esc(a.achievement)}</span></li>`).join('')}</ul></article>`).join('')}</div></section>` : '';

  const alumHtml = site.alumni.length ? `<section class="plain block" id="alumni" aria-labelledby="alumniTitle"><div class="block__head"><p class="eyebrow">Where they went</p><h2 id="alumniTitle">Alumni</h2></div><div class="alumni">${site.alumni.map(a =>
    `<article class="alum card"><h3>${esc(a.name)}</h3>${a.years ? `<p class="alum__years">${esc(a.years)}</p>` : ''}<p class="alum__next">${esc(a.next)}</p></article>`).join('')}</div></section>` : '';

  return fill(template, {head: seoHead(title, description, '/team', origin), coachcss: COACH_CARD_CSS, lede: esc(lede[0].toUpperCase() + lede.slice(1)), jump,
    sections: coachHtml + achHtml + alumHtml || '<section class="plain block"><p class="soon">Check back soon. In the meantime, see the programs and the practice calendar.</p></section>',
    visit: visitSection(site)});
}

// ---------- Storage ----------
export async function loadWebsite(): Promise<{site: Website; updatedAt: string | null}> {
  const row = await env.DB!.prepare("SELECT payload,updated_at FROM academy_settings WHERE id='website'").first<{payload: string; updated_at: string}>();
  if (!row) return {site: {...DEFAULT_WEBSITE}, updatedAt: null};
  let parsed: unknown = null;
  try { parsed = JSON.parse(row.payload); } catch {}
  // A restored backup is checked again; anything unreadable falls back to the defaults rather than breaking the page.
  const r = cleanWebsite(parsed);
  return {site: 'site' in r ? r.site : {...DEFAULT_WEBSITE}, updatedAt: row.updated_at};
}

// Coaches as the owner's editor and the public pages need them. No phone column is read.
export async function coachRows() {
  return (await env.DB!.prepare('SELECT s.email,s.name,s.active,p.display_name,p.bio,p.specialties FROM staff_access s LEFT JOIN coach_profiles p ON p.email=s.email ORDER BY COALESCE(p.display_name,s.name)').all<CoachRow>()).results;
}

export async function publicWebsite() {
  const {site} = await loadWebsite();
  return {site, coaches: site.coaches.length ? publicCoaches(site.coaches, await coachRows()) : []};
}

// Saves only if nobody else saved since the editor loaded (updatedAt), and records it in the security log.
export async function saveWebsite(site: Website, updatedAt: string | null, actor: string): Promise<{updatedAt: string} | null> {
  const at = new Date().toISOString(), payload = JSON.stringify(site);
  const saved = updatedAt === null
    ? await env.DB!.prepare("INSERT INTO academy_settings(id,payload,updated_at,updated_by) VALUES ('website',?,?,?) ON CONFLICT(id) DO NOTHING RETURNING updated_at").bind(payload, at, actor).first()
    : await env.DB!.prepare("UPDATE academy_settings SET payload=?,updated_at=?,updated_by=? WHERE id='website' AND updated_at=? RETURNING updated_at").bind(payload, at, actor, updatedAt).first();
  if (!saved) return null;
  await env.DB!.prepare('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), actor, 'website_saved', 'website', at).run();
  return {updatedAt: at};
}
