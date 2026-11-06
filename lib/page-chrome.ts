// One look on every page (issue #129). The Worker passes each HTML page through decoratePage(), which adds the shared
// stylesheet, the browser icons and the same top bar (logo home link, Calendar, Home) everywhere, so no page needs its
// own copy. "/" sends each person to their own home (owner dashboard, coach home, family home or the welcome page).
// Left alone: the owner dashboard (it has its own menu), printable documents and pages shown inside other pages.
const SKIP = new Set(['/', '/scholarship-agreement', '/waiver-copy', '/scholarship-signature-preview']);
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

export function decoratePage(html: string, pathname: string) {
  if (html.includes('class="swa-bar"')) return html;
  let out = html.includes('</head>') ? html.replace('</head>', HEAD + '</head>') : HEAD + html;
  const body = out.match(/<body[^>]*>/i);
  out = body ? out.replace(body[0], body[0] + topBar(pathname)) : topBar(pathname) + out;
  return out;
}

export async function decorateResponse(request: Request, response: Response) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || response.status !== 200 || !shouldDecorate(url, response.headers.get('Content-Type'))) return response;
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(decoratePage(await response.text(), url.pathname), {status: response.status, statusText: response.statusText, headers});
}
