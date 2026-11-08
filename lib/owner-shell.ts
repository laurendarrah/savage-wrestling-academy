// The owner shell (issue #261): the same sidebar and header on every owner page, so moving between the dashboard and
// the tool pages changes only the middle. The Worker adds it while it decorates a page (lib/page-chrome.ts), only for
// responses a route has marked with markOwnerShell(), which the routes do only after their own owner check. The shell
// is presentation: it opens nothing the page's own server check would not.
//
// Seamless moves: public/owner-shell.css opts every owner page into cross-document View Transitions and names the
// sidebar and header, so they stay still while the middle cross-fades; Speculation Rules prefetch an owner link when
// it is hovered. Browsers without either get an ordinary page load with the same shell. public/owner-shell.js runs the
// phone drawer, the Account menu, sign-out and focus after a move.
import {OWNER_NAV, OWNER_SHELL_PAGES, currentOwnerHref, ownerNavPlace} from './owner-nav';

export const OWNER_SHELL_HEADER = 'X-SWA-Owner-Shell';
// Called by an owner route after it has checked the owner, on the headers it answers with.
export function markOwnerShell(headers: Headers) { headers.set(OWNER_SHELL_HEADER, '1'); return headers; }

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));

// One line icon per destination, drawn in the text color (the dashboard's set from issue #232, extended).
const SHIELD = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>';
const FILE = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>';
export const OWNER_ICONS: Record<string, string> = {
  '/': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  '/roster': '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 14l2 2 4-4"/>',
  '/payments': '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  '/messages': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  '/cards': '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2M15 12h2M7 16h10"/>',
  '/accounts': '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M16 3.13a4 4 0 0 1 0 7.75M22 21v-2a4 4 0 0 0-3-3.87"/>',
  '/approvals': SHIELD + '<path d="M9 12l2 2 4-4"/>',
  '/scholarships': '<circle cx="12" cy="8" r="6"/><path d="M15.5 12.9L17 22l-5-3-5 3 1.5-9.1"/>',
  '/waivers': FILE + '<path d="M8 17c1.5-2 2.5-2 3.5 0s2 2 3.5 0"/>',
  '/consent-forms': FILE + '<path d="M9 15l2 2 4-4"/>',
  '/transfers': '<path d="M17 3l4 4-4 4M21 7H9M7 21l-4-4 4-4M3 17h12"/>',
  '/#practice-calendar': '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  '/#schedules': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  '/#programs': '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>',
  '/#events': '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  '/curricula': '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  '/website': '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  '/staff': '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 17a4 4 0 0 1 8 0"/>',
  '/coach': '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  '/contracts': '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  '/lesson-settings': '<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  '/timesheets': '<path d="M5 2h14M5 22h14M17 2v4l-5 6 5 6v4M7 2v4l5 6-5 6v4"/>',
  '/financials': '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17V9"/>',
  '/coach-pay': '<path d="M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.8c0 4.7 10 2.4 10 7.2 0 2.3-2.2 3.5-5 3.5s-5-1.2-5-3"/>',
  '/payment-setup': '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
  '/backups': '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
  '/site-health': '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  '/data-requests': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  '/security-log': SHIELD + '<path d="M12 8v4M12 16h.01"/>',
  '/help/owner': '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
};
const svg = (paths: string, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

const FAMILY_LINKS = '<a href="/welcome">Welcome page</a> <a href="/team">Team page</a> <a href="/calendar">Calendar</a>';

// The sidebar: brand, every destination in its group (the folded group opens when it holds the current page), and on
// phones the "What families see" links, since the header there has room only for the menu, logo and Account.
export function ownerSidebar(current: string | null) {
  const link = (href: string, label: string) => `<li><a href="${esc(href)}"${href === current ? ' aria-current="page"' : ''}>${svg(OWNER_ICONS[href] ?? '')}<span>${esc(label)}</span></a></li>`;
  const groups = OWNER_NAV.map((g, n) => {
    const list = `<ul class="os-list">${g.items.map(i => link(i.href, i.label)).join('')}</ul>`;
    if (!g.label) return list;
    if (g.folded) return `<details class="os-fold"${g.items.some(i => i.href === current) ? ' open' : ''}><summary>${esc(g.label)}</summary>${list}</details>`;
    return `<p class="os-group" id="swa-os-g${n}">${esc(g.label)}</p>${list.replace('<ul class="os-list">', `<ul class="os-list" aria-labelledby="swa-os-g${n}">`)}`;
  }).join('');
  return `<div class="os-side" id="swa-os-side" data-os-pages="${OWNER_SHELL_PAGES.join(' ')}">`
    + '<div class="os-side-top"><a class="os-brand" href="/"><img src="/brand/savage-logo-128.png" alt="" width="56" height="56"><span>SAVAGE<small>WRESTLING ACADEMY</small></span></a>'
    + `<button type="button" class="os-close" id="swa-os-close" aria-label="Close menu">${svg('<path d="M18 6L6 18M6 6l12 12"/>', 22)}</button></div>`
    + '<div class="os-redline"></div>'
    + `<nav class="os-nav" id="swa-os-nav" aria-label="Owner pages">${groups}</nav>`
    + `<nav class="os-family os-family-drawer" aria-label="What families see"><p class="os-group">What families see</p>${FAMILY_LINKS}</nav>`
    + '<p class="os-foot"><b>Built for the work.</b><br>Huntington Station, NY</p>'
    + '</div>';
}

// The header: the menu button and logo (phones), where the owner is, what families see, the dashboard's save status
// and the Account menu.
export function ownerTopbar(pathname: string, current: string | null) {
  const dashboard = pathname === '/';
  const place = ownerNavPlace(current) ?? (pathname === '/security' ? {group: 'Account', label: 'Account security'} : null);
  const crumb = place ? (place.group ? place.group + ' / ' : '') + place.label : 'Owner';
  return '<header class="os-top" id="swa-os-top">'
    + `<button type="button" class="os-menu" id="swa-os-menu" aria-expanded="false" aria-controls="swa-os-side">${svg('<path d="M3 6h18M3 12h18M3 18h18"/>', 20)}<span>Menu</span></button>`
    + '<a class="os-top-brand" href="/"><img src="/brand/savage-logo-128.png" alt="" width="36" height="36"><span>SAVAGE</span></a>'
    + `<p class="os-crumbs"><span class="os-crumbs-home">SAVAGE /</span> <span id="swa-os-crumb">${esc(crumb)}</span></p>`
    + `<nav class="os-family os-family-top" aria-label="What families see"><span class="os-family-label">What families see:</span> ${FAMILY_LINKS}</nav>`
    + '<div class="os-tools">'
    + (dashboard ? '<span id="syncStatus" class="os-sync" role="status" aria-live="polite">Connecting…</span>' : '')
    + '<details class="os-account" id="swa-os-account"><summary>Account</summary><div class="os-panel">'
    + (dashboard ? '<button type="button" class="os-item" onclick="closeOwnerTools();reloadAcademy()">Refresh saved data</button>' : '')
    + `<a class="os-item" href="/security"${pathname === '/security' ? ' aria-current="page"' : ''}>Account security</a><hr>`
    + '<button type="button" class="os-item" data-os-signout>Sign out</button></div></details>'
    + '</div></header>';
}

// Runs as soon as the shell is parsed, before it is drawn: on the dashboard, the server could not see the #section, so
// this marks the section's item and names it in the breadcrumb; then the sidebar goes back to where it was scrolled
// (public/owner-shell.js saves it when the page is left), keeping the current item in view. It also looks after the
// View Transitions: a move to a page outside the owner shell skips the transition (that page has not opted in), and a
// transition cut short by another click is let go quietly instead of reported as an error.
export const SHELL_BOOT = `(function(){try{var d=document,n=d.getElementById('swa-os-nav'),s=d.getElementById('swa-os-side'),c=n.querySelector('[aria-current="page"]');`
  + `var q=function(t){if(t)[t.ready,t.finished,t.updateCallbackDone].forEach(function(p){if(p)p.catch(function(){})})};`
  + `addEventListener('pagereveal',function(e){q(e.viewTransition)});`
  + `addEventListener('pageswap',function(e){var t=e.viewTransition;q(t);if(t&&(!e.activation||(s.getAttribute('data-os-pages')||'').split(' ').indexOf(new URL(e.activation.entry.url).pathname)<0))t.skipTransition()});`
  + `if(location.pathname==='/'){var h=location.hash.split('?')[0],a=h.length>1?n.querySelector('a[href="/'+h.replace(/[^\\w#-]/g,'')+'"]'):null;`
  + `if(a&&a!==c){if(c)c.removeAttribute('aria-current');a.setAttribute('aria-current','page');c=a;var g=a.closest('details');if(g)g.open=true;var m=d.getElementById('swa-os-crumb'),l=a.closest('ul').getAttribute('aria-labelledby');`
  + `if(m)m.textContent=(l?d.getElementById(l).textContent+' / ':'')+a.textContent}}`
  + `var y=Number(sessionStorage.getItem('swa-os-scroll'));if(y)s.scrollTop=y;if(c&&(c.offsetTop<s.scrollTop||c.offsetTop+c.offsetHeight>s.scrollTop+s.clientHeight))s.scrollTop=Math.max(0,c.offsetTop-s.clientHeight/2)}catch(e){}})();`;

// Prefetch an owner destination when the owner hovers it (or presses on it), so the next page is often ready before
// the click lands. On pages with a nonce script policy (issue #274, lib/page-chrome.ts) the Worker gives this block,
// the start-up script below and the page's own scripts the response's nonce, so the policy allows them.
const SPECULATION = '{"prefetch":[{"source":"document","where":{"selector_matches":".os-nav a, .os-top a, .os-family a"},"eagerness":"moderate"}]}';
export const OWNER_SHELL_HEAD = '<link rel="stylesheet" href="/owner-shell.css"><script src="/owner-shell.js" defer></script>'
  + `<script type="speculationrules">${SPECULATION}</script>`;

// Puts a page's body inside the shell: a skip link, the sidebar, then the header above the page's own content, which
// keeps its <main> (given an id for the skip link when it has none).
export function wrapOwnerBody(html: string, pathname: string) {
  const current = currentOwnerHref(pathname);
  const body = html.match(/<body\b[^>]*>/i);
  if (!body || body.index === undefined) return html;
  let rest = html.slice(body.index + body[0].length);
  const main = rest.match(/<main\b([^>]*)>/i);
  let mainId = main?.[1].match(/\bid="([^"]+)"/)?.[1];
  if (main && !mainId) { mainId = 'swa-main'; rest = rest.replace(main[0], `<main id="swa-main"${main[1]}>`); }
  const end = rest.lastIndexOf('</body>');
  const inner = end < 0 ? rest : rest.slice(0, end), after = end < 0 ? '' : rest.slice(end);
  return html.slice(0, body.index + body[0].length)
    + `<a class="os-skip" href="#${esc(mainId ?? 'swa-os-top')}">Skip to main content</a><div class="os">`
    + ownerSidebar(current) + '<div class="os-scrim" id="swa-os-scrim" hidden></div>'
    + '<div class="os-work">' + ownerTopbar(pathname, current) + `<script>${SHELL_BOOT}</script>`
    + inner + '</div></div>' + after;
}
