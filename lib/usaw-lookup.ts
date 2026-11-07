// USA Wrestling card lookup (issue #202). Lauren decided against card photos (#192): instead the site checks a card
// number on USA Wrestling's public, no-login verify page (usawmembership.com/verify_membership), the same page the
// owner used to open by hand (#131). This file only talks to that page and reads its answer; lib/usaw-check.ts decides
// what the answer means for a wrestler. It runs on the server only, and only the card number is sent.
//
// How the page works (checked by hand, Nov 6 2026): GET verify_membership returns HTML with a CSRF token, a Livewire
// component snapshot and its update address, and sets session cookies. A POST to the update address with the card
// number as the "USAW ID" filter returns JSON whose components[0].effects.html is a results table. In the Athlete column
// a green dot (#66ff33) means an active athlete membership and a red dot (#a94442) means not active. The page shows no
// expiry date; every card expires on August 31 of its season (lib/usaw.ts).
//
// Anything that does not look exactly like that comes back 'unavailable', never as valid.
import {env} from 'cloudflare:workers';

export type LookupStatus = 'active' | 'inactive' | 'not_found' | 'unavailable';
export type LookupResult = {status: LookupStatus; name?: string; state?: string};

export const DEFAULT_LOOKUP_BASE = 'https://www.usawmembership.com';
export const USER_AGENT = 'SavageWrestlingAcademy/1.0 (card check)';
export const LOOKUP_TIMEOUT_MS = 8000;
const COMPONENT = 'data-tables.resources.verify-memberships';
const NO_RECORDS = 'There are no records that match the criteria.';
const ACTIVE = '66ff33', INACTIVE = 'a94442';
const MAX_BYTES = 3_000_000;
const unavailable: LookupResult = {status: 'unavailable'};

// The card number as USA Wrestling's USAW ID: upper case, without spaces or dashes.
export const lookupId = (number: string) => String(number || '').toUpperCase().replace(/[\s-]/g, '');

// Where the lookup goes. USAW_LOOKUP_BASE points it at a local stand-in for tests; it defaults to USA Wrestling and
// must be https, or http on this machine.
export function lookupBase(): URL | null {
  const raw = ((env as {USAW_LOOKUP_BASE?: string}).USAW_LOOKUP_BASE || '').trim() || DEFAULT_LOOKUP_BASE;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) return null;
  return new URL(url.origin);
}

const ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const textOf = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// The verify page: CSRF token, the verify-memberships component's snapshot (as the exact string to send back) and
// the Livewire update address. Null if any is missing or odd.
export function parseVerifyPage(html: string): {csrf: string; snapshot: string; updateUri: string} | null {
  if (typeof html !== 'string') return null;
  let csrf = '';
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!/\bname\s*=\s*["']csrf-token["']/i.test(tag)) continue;
    csrf = decodeEntities(tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1] ?? '');
    break;
  }
  if (!/^[A-Za-z0-9+/=._-]{10,200}$/.test(csrf)) return null;
  const snapshots: string[] = [];
  for (const m of html.matchAll(/wire:snapshot\s*=\s*"([^"]*)"/gi)) {
    const raw = decodeEntities(m[1]);
    try { if (JSON.parse(raw)?.memo?.name === COMPONENT) snapshots.push(raw); } catch {}
  }
  if (snapshots.length !== 1) return null;
  const updates = [...html.matchAll(/data-update-uri\s*=\s*"([^"]+)"/gi)].map(m => decodeEntities(m[1]).trim());
  if (!updates.length || new Set(updates).size !== 1) return null;
  return {csrf, snapshot: snapshots[0], updateUri: updates[0]};
}

// The results table for one USAW ID.
export function parseResults(html: unknown, id: string): LookupResult {
  if (typeof html !== 'string' || !html) return unavailable;
  const want = lookupId(id), noRecords = html.includes(NO_RECORDS);
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) || [];
  if (!tables.length) return noRecords ? {status: 'not_found'} : unavailable;
  if (tables.length !== 1) return unavailable;
  const table = tables[0];
  const head = table.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1], body = table.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (head === undefined || body === undefined) return unavailable;
  const headers = [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m => textOf(m[1]).toLowerCase());
  const col = (name: string) => { const i = headers.indexOf(name.toLowerCase()); return headers.lastIndexOf(name.toLowerCase()) === i ? i : -1; };
  const [cId, cName, cState, cAthlete] = ['USAW ID', 'Name', 'State', 'Athlete'].map(col);
  if ([cId, cName, cState, cAthlete].some(i => i < 0)) return unavailable;
  const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1]));
  if (noRecords) return rows.some(r => r.length) ? unavailable : {status: 'not_found'};
  if (!rows.length || rows.some(r => r.length !== headers.length)) return unavailable;
  const matches = rows.filter(r => lookupId(textOf(r[cId])) === want);
  // Rows for other numbers but none for this one, or two rows for one number, are not a shape we know.
  if (matches.length !== 1) return unavailable;
  const row = matches[0];
  const colors = [...row[cAthlete].matchAll(/background-color\s*:\s*#([0-9a-f]{3,8})\b/gi)].map(m => m[1].toLowerCase());
  if (colors.length !== 1 || textOf(row[cAthlete])) return unavailable;
  const status = colors[0] === ACTIVE ? 'active' : colors[0] === INACTIVE ? 'inactive' : null;
  const name = textOf(row[cName]), state = textOf(row[cState]);
  if (!status || !name || name.length > 120 || state.length > 40) return unavailable;
  return {status, name, state};
}

// Cookies from a response, as "name=value" pairs, added to the jar.
function keepCookies(res: Response, jar: Map<string, string>) {
  const h = res.headers as Headers & {getSetCookie?: () => string[]};
  const list = typeof h.getSetCookie === 'function' ? h.getSetCookie() : (h.get('set-cookie') || '').split(/,(?=\s*[^;,=\s]+=)/);
  for (const c of list) { const m = c.trim().match(/^([^=;\s]+)=([^;]*)/); if (m) jar.set(m[1], m[2]); }
}
const cookieHeader = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

async function readText(res: Response) {
  const t = await res.text();
  return t.length > MAX_BYTES ? null : t;
}

// Looks one card number up. Never throws; anything unexpected, slow or refused is 'unavailable'.
export async function lookUpCard(number: string, fetchImpl: typeof fetch = fetch): Promise<LookupResult> {
  const id = lookupId(number), base = lookupBase();
  if (!/^[A-Z0-9]{4,24}$/.test(id) || !base) return unavailable;
  const jar = new Map<string, string>();
  try {
    const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
    // The page, following at most a few redirects on the same site, keeping the session cookies.
    let page = new URL('/verify_membership', base), res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      res = await fetchImpl(page.toString(), {method: 'GET', redirect: 'manual', signal, headers: {'User-Agent': USER_AGENT, Accept: 'text/html', ...(jar.size ? {Cookie: cookieHeader(jar)} : {})}});
      keepCookies(res, jar);
      if (res.status < 300 || res.status >= 400) break;
      const next = res.headers.get('location');
      if (!next) return unavailable;
      page = new URL(next, page);
      if (page.origin !== base.origin) return unavailable;
      res = null;
    }
    if (!res || !res.ok) return unavailable;
    const html = await readText(res), form = html === null ? null : parseVerifyPage(html);
    if (!form) return unavailable;
    const update = new URL(form.updateUri, page);
    if (update.origin !== base.origin) return unavailable;
    const post = await fetchImpl(update.toString(), {method: 'POST', redirect: 'manual', signal, headers: {
      'User-Agent': USER_AGENT, 'Content-Type': 'application/json', Accept: 'application/json', 'X-Livewire': '1', 'X-CSRF-TOKEN': form.csrf,
      Referer: page.toString(), ...(jar.size ? {Cookie: cookieHeader(jar)} : {})},
      body: JSON.stringify({_token: form.csrf, components: [{snapshot: form.snapshot, updates: {'filters.usaw_id': id}, calls: [{path: '', method: 'search', params: []}]}]})});
    if (!post.ok) return unavailable;
    const raw = await readText(post);
    if (raw === null) return unavailable;
    let data: any;
    try { data = JSON.parse(raw); } catch { return unavailable; }
    return parseResults(data?.components?.[0]?.effects?.html, id);
  } catch {
    return unavailable;
  }
}

// ---------- Name match ----------
// Conservative on purpose: a mismatch never verifies, and the owner can still check by hand. First and last names
// must match ignoring case and accents. A middle name or initial may be on one side only; when both have one, they
// must agree (an initial matches a name starting with it). A common nickname counts for the first name only, and only
// because the last name must match exactly anyway.
const NICKNAMES: Record<string, string[]> = {
  abby: ['abigail'], abe: ['abraham'], al: ['albert', 'alan', 'allen', 'alexander'], alex: ['alexander', 'alexandra', 'alexis'],
  andy: ['andrew'], drew: ['andrew'], ben: ['benjamin'], benny: ['benjamin'], bill: ['william'], billy: ['william'], will: ['william'],
  willy: ['william'], liam: ['william'], bob: ['robert'], bobby: ['robert'], rob: ['robert'], robbie: ['robert'], bert: ['albert', 'robert'],
  cal: ['calvin', 'callum'], cam: ['cameron'], charlie: ['charles'], chuck: ['charles'], chris: ['christopher', 'christian', 'christina', 'christine'],
  dan: ['daniel'], danny: ['daniel'], dave: ['david'], davey: ['david'], dom: ['dominic'], don: ['donald'], ed: ['edward'], eddie: ['edward'],
  ted: ['edward', 'theodore'], teddy: ['edward', 'theodore'], theo: ['theodore'], eli: ['elijah', 'elias'], fred: ['frederick'],
  gabe: ['gabriel'], gabby: ['gabriella', 'gabrielle'], greg: ['gregory'], hank: ['henry'], harry: ['henry', 'harrison'],
  jack: ['john', 'jackson'], johnny: ['john', 'jonathan'], jon: ['jonathan'], jake: ['jacob'], jim: ['james'], jimmy: ['james'], jamie: ['james'],
  jeff: ['jeffrey'], jerry: ['gerald', 'jerome'], joe: ['joseph'], joey: ['joseph'], josh: ['joshua'], ken: ['kenneth'], kenny: ['kenneth'],
  larry: ['lawrence'], leo: ['leonardo', 'leonard'], lou: ['louis'], luke: ['lucas'], matt: ['matthew'], matty: ['matthew'],
  max: ['maxwell', 'maximilian', 'maximus'], mike: ['michael'], mikey: ['michael'], mick: ['michael'], nate: ['nathan', 'nathaniel'],
  nat: ['nathaniel', 'natalie'], nick: ['nicholas'], nicky: ['nicholas'], nico: ['nicholas'], pat: ['patrick', 'patricia'],
  pete: ['peter'], phil: ['phillip', 'philip'], ray: ['raymond'], rich: ['richard'], rick: ['richard'], ricky: ['richard'],
  ron: ['ronald'], ronnie: ['ronald'], russ: ['russell'], sam: ['samuel', 'samantha'], sammy: ['samuel'], sandy: ['alexander', 'sandra'],
  seb: ['sebastian'], steve: ['steven', 'stephen'], stevie: ['steven', 'stephen'], tim: ['timothy'], timmy: ['timothy'], tom: ['thomas'],
  tommy: ['thomas'], tony: ['anthony'], ty: ['tyler', 'tyson'], vince: ['vincent'], walt: ['walter'], wes: ['wesley'],
  zach: ['zachary', 'zachariah'], zack: ['zachary'], zac: ['zachary'], beth: ['elizabeth'], liz: ['elizabeth'], lizzie: ['elizabeth'],
  ellie: ['eleanor', 'elena', 'ellen'], izzy: ['isabella', 'isabel'], bella: ['isabella'], jess: ['jessica'], jessie: ['jessica'],
  kate: ['katherine', 'kathryn', 'catherine'], katie: ['katherine', 'kathryn', 'catherine'], kat: ['katherine', 'catherine'],
  maddie: ['madison', 'madeline', 'madelyn'], mandy: ['amanda'], meg: ['megan', 'margaret'], maggie: ['margaret'], becca: ['rebecca'],
  becky: ['rebecca'], sophie: ['sophia'], tori: ['victoria'], vicky: ['victoria'], addie: ['addison', 'adeline'], livvy: ['olivia'], liv: ['olivia'],
};
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

// "José O'Brien-Smith Jr." -> ['jose', 'obriensmith']. "Example, Sam" (last name first) is turned around.
export function nameParts(name: string): string[] {
  let s = String(name || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const comma = s.split(',');
  if (comma.length === 2 && comma[0].trim() && comma[1].trim()) s = comma[1] + ' ' + comma[0];
  const parts = s.replace(/['’.]/g, '').replace(/-/g, '').replace(/[^a-z]+/g, ' ').trim().split(' ').filter(Boolean);
  while (parts.length > 2 && SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  return parts;
}
const firstNamesMatch = (a: string, b: string) => a === b || !!NICKNAMES[a]?.includes(b) || !!NICKNAMES[b]?.includes(a);
const middlesAgree = (a: string[], b: string[]) => !a.length || !b.length || a[0] === b[0] ||
  (a[0].length === 1 && b[0].startsWith(a[0])) || (b[0].length === 1 && a[0].startsWith(b[0]));

export function namesMatch(wrestlerName: string, cardName: string): boolean {
  const w = nameParts(wrestlerName), c = nameParts(cardName);
  if (w.length < 2 || c.length < 2) return false;
  if (w[w.length - 1] !== c[c.length - 1]) return false;
  if (w[0].length < 2 || c[0].length < 2) return false;
  return firstNamesMatch(w[0], c[0]) && middlesAgree(w.slice(1, -1), c.slice(1, -1));
}
