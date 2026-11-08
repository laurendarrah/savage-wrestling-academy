// One look on every page (issue #129). The Worker passes each HTML page through decoratePage(), which adds the shared
// stylesheet, the browser icons and the same top bar (logo home link, Calendar, Home) everywhere, so no page needs its
// own copy. "/" sends each person to their own home (owner dashboard, coach home, family home or the welcome page).
// Left alone: printable documents and pages shown inside other pages. Owner pages get the owner shell instead of the
// top bar (issue #261, lib/owner-shell.ts), including the owner dashboard at "/".
import {OWNER_SHELL_HEADER, OWNER_SHELL_HEAD, wrapOwnerBody} from './owner-shell';
const SKIP = new Set(['/', '/scholarship-agreement', '/waiver-copy']);
const HOMES = new Set(['/family', '/coach']);

export function shouldDecorate(url: URL, contentType: string | null, ownerShell = false) {
  if (!contentType?.startsWith('text/html')) return false;
  if ((SKIP.has(url.pathname) && !(ownerShell && url.pathname === '/')) || url.pathname.startsWith('/api/')) return false;
  return !url.searchParams.has('embed') && !url.searchParams.has('embedded');
}

// The family's pages (issue #282): the top bar carries the family's links on a desk, and a phone gets the tab bar
// (familyTabs) instead of the bar's links. Every page here is a family's own; the owner and coaches never open them.
const FAMILY_PAGES = new Set(['/family', '/register', '/booking', '/lesson', '/inbox', '/pass', '/wrestler', '/waiver', '/consent', '/scholarship']);
export function familyPage(pathname: string) { return FAMILY_PAGES.has(pathname); }
const current = (pathname: string, href: string) => (href === pathname || (href === '/' && HOMES.has(pathname)) ? ' aria-current="page"' : '');

export function topBar(pathname: string) {
  const family = familyPage(pathname), at = (href: string) => current(pathname, href);
  const links = family
    ? `<a href="/"${at('/')}>Home</a><a href="/calendar"${at('/calendar')}>Calendar</a><a href="/pass"${at('/pass')}>Pass</a><a href="/inbox"${at('/inbox')}>Messages</a>`
    : `<a href="/calendar"${at('/calendar')}>Calendar</a><a href="/"${at('/')}>Home</a>`;
  return `<header class="swa-bar${family ? ' swa-bar--family' : ''}"><div class="swa-bar__inner">`
    + '<a class="swa-bar__home" href="/" aria-label="Savage Wrestling Academy home"><img src="/brand/savage-logo-128.png" alt="" width="40" height="40"><span class="swa-bar__word">SAVAGE</span></a>'
    + `<nav class="swa-bar__links" aria-label="Site">${links}</nav>`
    + '</div></header>';
}

// The phone tab bar on family pages: Home, Calendar, Pass, Messages, Account (the family home's Account menu). The
// Messages tab carries an unread count the family home fills in (#inboxBadge). Styled in public/savage.css (.swa-tabs).
const TAB_ICONS: Record<string, string> = {
  home: '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  pass: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M21 14v7h-7"/>',
  messages: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/>',
};
export function familyTabs(pathname: string) {
  const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${TAB_ICONS[name]}</svg>`;
  const tab = (href: string, name: string, label: string, extra = '') => `<a href="${href}"${current(pathname, href)}${extra}>${icon(name)}${label}</a>`;
  return '<nav class="swa-tabs" aria-label="Family">'
    + tab('/', 'home', 'Home') + tab('/calendar', 'calendar', 'Calendar') + tab('/pass', 'pass', 'Pass')
    + tab('/inbox', 'messages', 'Messages<span class="swa-tabs__badge" id="inboxBadge" hidden></span>', ' id="inboxLink"')
    + tab('/family#account', 'account', 'Account')
    + '</nav>';
}

const ICONS = '<link rel="icon" href="/brand/favicon-32.png" sizes="32x32"><link rel="icon" href="/brand/favicon-64.png" sizes="64x64">'
  + '<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">';
// The toast helper (public/toast.js) rides along with the stylesheet, so any page can call swaToast(text) (issue #280).
// The stylesheet stays the last thing in <head>, so it wins over a page's own styles.
const HEAD = ICONS + '<script src="/toast.js" defer></script><link rel="stylesheet" href="/savage.css">';

// The public pages open with the black header band (.swa-head, issue #146). Every other page is someone's workspace
// and opens with a title row instead (issue #280): the brand lives in the top bar, the page gets to the point.
const BAND_PAGES = new Set(['/welcome', '/team', '/calendar', '/login', '/coach-join', '/help']);
export function bandPage(pathname: string) { return BAND_PAGES.has(pathname) || pathname.startsWith('/help/'); }

// A page's opening: optional back links, an optional eyebrow line, the heading and an optional intro paragraph.
// Status lines and notices stay outside; pages with their own header are left alone.
// After the heading: paragraphs that hold only a link (Family accounts' "SWA Advance approvals →"), which become the
// title row's actions, then at most one intro paragraph. Status lines and notices never come along.
const LINK_LINE = /\s*<p>\s*<a\b[^>]*>[^<]*<\/a>\s*<\/p>/;
const INTRO_P = /\s*<p\b(?![^>]*(?:id="status"|role="status"|class="notice"))[^>]*>[\s\S]*?<\/p>/;
const OPENING = new RegExp(`^(\\s*(?:<a\\b[^>]*>[^<]*<\\/a>\\s*)*(?:<p class="eyebrow"[^>]*>[^<]*<\\/p>\\s*)?<h1\\b[^>]*>[\\s\\S]*?<\\/h1>(?:${LINK_LINE.source})*(?:${INTRO_P.source})?)`);
const HAND_WRITTEN_HEAD = /<div class="swa-head">([\s\S]*?)<\/div>/;
// The visible intro is one short sentence. A first sentence longer than this (the roster's 44-word opener) would be a
// paragraph again, so the whole intro goes behind the disclosure and the page opens with its controls.
export const INTRO_MAX = 140;

export function pageHead(html: string, pathname = '', opts: {band?: boolean} = {}) {
  const band = opts.band ?? bandPage(pathname);
  if (/class="[^"]*\b(?:fam-hero|hero)\b/.test(html)) return html;
  if (/class="[^"]*\bswa-head\b/.test(html)) {
    // A page that writes the band itself (Choose training) keeps it only when it is public; otherwise it becomes the
    // title row too, from the same markup.
    if (band) return html;
    const own = html.match(HAND_WRITTEN_HEAD);
    return own ? html.replace(own[0], titleRow(own[1], html)) : html;
  }
  const main = html.match(/<main\b[^>]*>/i);
  if (!main || main.index === undefined) return html;
  const at = main.index + main[0].length, rest = html.slice(at);
  // Pages whose opening is already one block (the calendar's header, the Messages heading row) just get the class,
  // or, off the public pages, become the title row with their buttons as its actions.
  const block = rest.match(/^\s*<(header|div) (id="heading"|class="top")>/);
  if (block && /^[\s\S]*?<h1\b/.test(rest.slice(0, rest.indexOf('</' + block[1] + '>')))) {
    if (band) return html.slice(0, at) + rest.replace(block[0], block[0].replace(/>$/, block[2] === 'class="top"' ? '' : ' class="swa-head">').replace('class="top"', 'class="top swa-head">'));
    const close = '</' + block[1] + '>', end = rest.indexOf(close) + close.length;
    return html.slice(0, at) + titleRow(rest.slice(block[0].length, end - close.length), html) + rest.slice(end);
  }
  const open = rest.match(OPENING);
  if (!open) return html;
  return html.slice(0, at) + (band ? '<div class="swa-head">' + open[1] + '</div>' : titleRow(open[1], html)) + html.slice(at + open[1].length);
}

// The title row: the heading and what came before it on the left with the intro's first sentence under it, and on the
// right any buttons, links or link-only paragraphs that shared the opening block. An intro longer than one sentence
// keeps its first sentence in the row and puts the rest, word for word, behind "How this works"; a first sentence
// longer than INTRO_MAX goes behind it too, whole. An intro a page's script fills in (its id appears in the page
// again) is left whole, since the script replaces it anyway, and so is the intro of a page that already folds its
// explanation into its own details.howto (USA Wrestling cards).
export function titleRow(opening: string, page = '') {
  const m = opening.match(/^([\s\S]*?<\/h1>)([\s\S]*)$/);
  if (!m) return '<div class="swa-title"><div class="swa-title__text">' + opening + '</div></div>';
  const head = m[1];
  let tail = m[2], intro = '', how = '';
  const links: string[] = [];
  for (let l = tail.match(new RegExp('^' + LINK_LINE.source)); l; l = tail.match(new RegExp('^' + LINK_LINE.source))) { links.push(l[0].trim().replace(/^<p>\s*|\s*<\/p>$/g, '')); tail = tail.slice(l[0].length); }
  const p = tail.match(/^\s*(<p\b(?![^>]*(?:id="status"|role="status"|class="notice"))[^>]*>)([\s\S]*?)<\/p>/);
  if (p) {
    tail = tail.slice(p[0].length);
    const id = p[1].match(/\bid="([^"]+)"/)?.[1];
    const whole = (id ? page.split(id).length > 2 : false) || /class="howto"/.test(page);
    let [first, rest] = whole ? [p[2], ''] : splitSentence(p[2]);
    const hidden = !whole && first.replace(/<[^>]*>/g, '').length > INTRO_MAX;
    if (hidden) [first, rest] = ['', p[2]];
    // The paragraph stays even when empty: a page's script may fill it (coach home's "You coach SWA Intermediate.").
    if (!hidden) intro = p[1] + first + '</p>';
    if (rest) how = `<details class="how"><summary>How this works</summary><p>${rest}</p></details>`;
  }
  const actions = [...links, tail.trim()].filter(Boolean).join('');
  return `<div class="swa-title"><div class="swa-title__text">${head}${intro}</div>${actions ? `<div class="swa-title__actions">${actions}</div>` : ''}</div>${how}`;
}

// Splits inline HTML after its first sentence: a full stop, question or exclamation mark (optionally closed by a
// quote or bracket), a space, then a sentence starting with a capital letter, all outside any tag.
export function splitSentence(inner: string): [string, string] {
  const masked = inner.replace(/<[^>]*>/g, t => '\u0000'.repeat(t.length));
  const end = masked.match(/[.!?]["”’)]?\s+(?=[A-Z“"(])/);
  if (!end || end.index === undefined) return [inner, ''];
  const cut = end.index + end[0].length;
  return [inner.slice(0, cut).trimEnd(), inner.slice(cut).trim()];
}

export function decoratePage(html: string, pathname: string, ownerShell = false) {
  if (html.includes('class="swa-bar') || html.includes('data-swa-shell=')) return html;
  // The dashboard keeps its own styles (it never loaded savage.css) and its own title row.
  const dashboard = ownerShell && pathname === '/';
  const head = (dashboard ? ICONS : HEAD) + (ownerShell ? OWNER_SHELL_HEAD : '');
  let out = html.includes('</head>') ? html.replace('</head>', head + '</head>') : head + html;
  const body = out.match(/<body[^>]*>/i);
  // data-swa-page lets the shared stylesheet give a page its own treatment (the sign-in page, for one).
  const tagged = body ? body[0].replace(/^<body/i, `<body data-swa-page="${pathname.replace(/[^\w/-]/g, '')}"${ownerShell ? ' data-swa-shell="owner"' : ''}`) : '';
  // Inside the owner shell every page opens with the title row, the owner guide under /help included.
  if (ownerShell && body) return wrapOwnerBody(dashboard ? out.replace(body[0], tagged) : pageHead(out.replace(body[0], tagged), pathname, {band: false}), pathname);
  out = body ? out.replace(body[0], tagged + topBar(pathname)) : topBar(pathname) + out;
  if (familyPage(pathname)) out = out.includes('</body>') ? out.replace('</body>', familyTabs(pathname) + '</body>') : out + familyTabs(pathname);
  return pageHead(out, pathname);
}

// Scripts a page may run (issue #274). A signed-in page's policy (lib/account-auth.ts) gains a script-src that allows
// only scripts carrying this response's nonce (and what they load: 'strict-dynamic'), so injected markup can never run
// code even if a page forgot to escape something. The nonce is fresh per response and is never cached: only pages
// sent with no-store get one. A page that still uses inline event handlers (onclick="...") cannot have the policy yet,
// because a nonce policy blocks those; tests/csp-nonce.mjs lists those pages, and the list may only shrink.
export const INLINE_HANDLER = /\son[a-z]+\s*=\s*\\?["']/i;
export function hasInlineHandlers(html: string) { return INLINE_HANDLER.test(html) || /\bhref\s*=\s*["']\s*javascript:/i.test(html); }
export function newNonce() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''); }
// Every <script> in the page, inline or external, carries the nonce: 'strict-dynamic' trusts only scripts those load.
export function applyScriptNonce(html: string, nonce: string) { return html.replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`); }
export function scriptPolicy(csp: string, nonce: string) { return `${csp}; script-src 'nonce-${nonce}' 'strict-dynamic' 'self'`; }
export function nonceApplies(headers: Headers, html: string) {
  const csp = headers.get('Content-Security-Policy') ?? '';
  return !!csp && !/script-src/.test(csp) && /no-store/.test(headers.get('Cache-Control') ?? '') && !hasInlineHandlers(html);
}

export async function decorateResponse(request: Request, response: Response) {
  const url = new URL(request.url);
  // A route marks an owner page only after its own owner check (lib/owner-shell.ts). The mark never leaves the Worker.
  const ownerShell = response.headers.has(OWNER_SHELL_HEADER);
  if (request.method !== 'GET' || response.status !== 200 || !shouldDecorate(url, response.headers.get('Content-Type'), ownerShell)) {
    if (!ownerShell) return response;
    const headers = new Headers(response.headers);
    headers.delete(OWNER_SHELL_HEADER);
    return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
  }
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  headers.delete(OWNER_SHELL_HEADER);
  let html = decoratePage(await response.text(), url.pathname, ownerShell);
  if (nonceApplies(headers, html)) {
    const nonce = newNonce();
    html = applyScriptNonce(html, nonce);
    headers.set('Content-Security-Policy', scriptPolicy(headers.get('Content-Security-Policy')!, nonce));
  }
  return new Response(html, {status: response.status, statusText: response.statusText, headers});
}
