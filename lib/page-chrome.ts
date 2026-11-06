// One look on every page (issue #129). The Worker passes each HTML page through decoratePage(), which adds the shared
// stylesheet, the browser icons and the same top bar (logo home link, Calendar, Home) everywhere, so no page needs its
// own copy. "/" sends each person to their own home (owner dashboard, coach home, family home or the welcome page).
// Left alone: the owner dashboard (it has its own menu), printable documents and pages shown inside other pages.
const SKIP = new Set(['/', '/scholarship-agreement', '/waiver-copy']);
const HOMES = new Set(['/family', '/coach']);

export function shouldDecorate(url: URL, contentType: string | null) {
  if (!contentType?.startsWith('text/html')) return false;
  if (SKIP.has(url.pathname) || url.pathname.startsWith('/api/')) return false;
  return !url.searchParams.has('embed') && !url.searchParams.has('embedded');
}

export function topBar(pathname: string) {
  const current = (href: string) => (href === pathname || (href === '/' && HOMES.has(pathname)) ? ' aria-current="page"' : '');
  return '<header class="swa-bar"><div class="swa-bar__inner">'
    + '<a class="swa-bar__home" href="/" aria-label="Savage Wrestling Academy home"><img src="/brand/savage-logo-128.png" alt="" width="42" height="42"><span class="swa-bar__word">SAVAGE</span></a>'
    + `<nav class="swa-bar__links" aria-label="Site"><a href="/calendar"${current('/calendar')}>Calendar</a><a href="/"${current('/')}>Home</a></nav>`
    + '</div></header>';
}

const HEAD = '<link rel="icon" href="/brand/favicon-32.png" sizes="32x32"><link rel="icon" href="/brand/favicon-64.png" sizes="64x64">'
  + '<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png"><link rel="stylesheet" href="/savage.css">';

// The black page header (issue #146): a page that opens with optional back links, its heading and an intro paragraph
// gets them wrapped in .swa-head. Status lines and notices stay outside; pages with their own header are left alone.
const OPENING = /^(\s*(?:<a\b[^>]*>[^<]*<\/a>\s*)*(?:<p class="eyebrow"[^>]*>[^<]*<\/p>\s*)?<h1\b[^>]*>[\s\S]*?<\/h1>(?:\s*<p\b(?![^>]*(?:id="status"|role="status"|class="notice"))[^>]*>[\s\S]*?<\/p>)?)/;
export function pageHead(html: string) {
  if (/class="[^"]*\b(?:fam-hero|hero|swa-head)\b/.test(html)) return html;
  const main = html.match(/<main\b[^>]*>/i);
  if (!main || main.index === undefined) return html;
  const at = main.index + main[0].length, rest = html.slice(at);
  // Pages whose opening is already one block (the calendar's header, the Messages heading row) just get the class.
  const block = rest.match(/^\s*<(header|div) (id="heading"|class="top")>/);
  if (block && /^[\s\S]*?<h1\b/.test(rest.slice(0, rest.indexOf('</' + block[1] + '>'))))
    return html.slice(0, at) + rest.replace(block[0], block[0].replace(/>$/, block[2] === 'class="top"' ? '' : ' class="swa-head">').replace('class="top"', 'class="top swa-head">'));
  const open = rest.match(OPENING);
  if (!open) return html;
  return html.slice(0, at) + '<div class="swa-head">' + open[1] + '</div>' + html.slice(at + open[1].length);
}

export function decoratePage(html: string, pathname: string) {
  if (html.includes('class="swa-bar"')) return html;
  let out = html.includes('</head>') ? html.replace('</head>', HEAD + '</head>') : HEAD + html;
  const body = out.match(/<body[^>]*>/i);
  // data-swa-page lets the shared stylesheet give a page its own treatment (the sign-in page, for one).
  const tagged = body ? body[0].replace(/^<body/i, `<body data-swa-page="${pathname.replace(/[^\w/-]/g, '')}"`) : '';
  out = body ? out.replace(body[0], tagged + topBar(pathname)) : topBar(pathname) + out;
  return pageHead(out);
}

export async function decorateResponse(request: Request, response: Response) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || response.status !== 200 || !shouldDecorate(url, response.headers.get('Content-Type'))) return response;
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(decoratePage(await response.text(), url.pathname), {status: response.status, statusText: response.statusText, headers});
}
