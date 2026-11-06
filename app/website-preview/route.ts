import { env } from 'cloudflare:workers';
import { ownerIdentity, sameOrigin } from '../../lib/account-auth';
import { programDetails } from '../../lib/program-names';
import { defaultWebsite, ownerPortraitSource, readDraft, type WebsiteDraft } from '../../lib/website-draft';
import { editor, escapeHtml } from './editor';

export const dynamic = 'force-dynamic';

const programs = ['Elementary', 'Intermediate', 'Advanced'].map((id, index) => {
  const program = programDetails[id];
  return `<article class="program">
    <span class="index" aria-hidden="true">0${index + 1}</span>
    <p class="grade">${program.grades}</p>
    <h3>${program.name}</h3>
    <p>${program.description}</p>
    <a href="/register?program=${id}">Registration for ${program.name} <span aria-hidden="true">↗</span></a>
  </article>`;
}).join('');

const draftKey = 'website-draft';

function directory(title: string, intro: string, entries: WebsiteDraft['staff'], empty: string, logos = false) {
  return `<section class="wrap section directory">
    <p class="eyebrow">Savage Wrestling Academy</p>
    <h2>${title}</h2><p class="intro">${intro}</p>
    ${entries.length ? `<div class="programs">${entries.map(entry => `<article class="program">
      ${entry.image ? `<img class="directory-image${logos ? ' college-logo' : ''}" src="${escapeHtml(entry.image === ownerPortraitSource ? '/swa-justin-accordino.webp' : entry.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      <h3>${escapeHtml(entry.name)}</h3>
      ${entry.detail ? `<p class="grade">${escapeHtml(entry.detail)}</p>` : ''}
      ${entry.description ? `<p class="entry-description">${escapeHtml(entry.description)}</p>` : ''}
    </article>`).join('')}</div>` : `<p>${empty}</p>`}
  </section>`;
}

function render(draft: WebsiteDraft, revision: number, url: URL, message = '') {
  const page = url.searchParams.get('page');
  const editing = url.searchParams.get('edit') === '1';
  const theme = Object.entries(draft.colors).map(([key, value]) => '--' + key + ':' + value).join(';');
  return `<!doctype html>
<html lang="en" style="${theme}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Savage Wrestling Academy | Huntington Station, NY</title>
  <link rel="stylesheet" href="/swa-website.css">
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <aside class="preview"><div class="wrap"><strong>Owner preview</strong><div class="preview-actions"><a href="/website-preview?edit=1">Edit website draft</a><a href="/">Owner workspace</a></div></div></aside>
  <header class="header">
    <div class="wrap masthead">
      <a href="/website-preview" class="brand" aria-label="Savage Wrestling Academy home">
        <img src="/swa-wolf-logo.webp" alt="" width="52" height="51">
        <span><b>SWA</b><small>SAVAGE WRESTLING ACADEMY</small></span>
      </a>
      <nav aria-label="Main navigation">
        <a href="/website-preview#programs">Programs</a><a href="/calendar">Schedule</a><a href="/website-preview?page=staff">Staff</a><a href="/website-preview?page=achievements">Wrestlers &amp; Alumni</a><a href="/website-preview#visit">Contact</a>
        <a class="login" href="/login">Family login</a>
      </nav>
    </div>
  </header>
  ${url.searchParams.has('saved') && !editing ? '<p class="wrap save-notice" role="status">Draft saved. You are viewing the private preview.</p>' : ''}
  <main id="main">
    ${editing ? editor(draft, revision, message)
    : page === 'staff' ? directory('Meet the staff', 'Get to know the coaches at Savage Wrestling Academy.', draft.staff, 'Staff profiles will appear here when added to the draft.')
    : page === 'achievements' ? directory('Wrestler accomplishments', 'Results and milestones from SWA wrestlers.', draft.wrestlers, 'Wrestler accomplishments will appear here when added to the draft.')
      + directory('College alumni', 'Follow SWA alumni into college wrestling and beyond.', draft.alumni, 'Add alumni and their colleges in the website editor.', true)
    : `<section class="hero">
      <div class="wrap hero-layout">
        <div class="hero-copy">
          <p class="eyebrow">Huntington Station, New York</p>
          <h1>${escapeHtml(draft.headline)}</h1>
          <p class="intro">${escapeHtml(draft.intro)}</p>
          <div class="actions" role="group" aria-label="Registration and schedule">
            <a class="button primary" href="/register?plan=monthly">Membership · Pay monthly <span aria-hidden="true">↗</span></a>
            <a class="button secondary" href="/register?plan=walkin">Walk-in · One practice</a>
            <a class="button secondary" href="/calendar">View practice schedule</a>
          </div>
        </div>
        <img class="hero-logo" src="/swa-wolf-logo.webp" width="540" height="528" alt="">
      </div>
    </section>
    <section class="wrap section" id="programs" aria-labelledby="program-heading">
      <p class="eyebrow">Youth and high school training</p>
      <h2 id="program-heading">Find your program</h2>
      <div class="programs">${programs}</div>
    </section>
    <section class="visit" id="visit" aria-labelledby="visit-heading">
      <div class="wrap section visit-layout">
        <div>
          <p class="eyebrow">Visit the academy</p>
          <h2 id="visit-heading">See you on the mat.</h2>
          <address>${escapeHtml(draft.address)}<br>${escapeHtml(draft.city)}</address>
        </div>
        <div class="visit-links">
          <a href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(draft.address + ", " + draft.city)}">Get directions <span aria-hidden="true">↗</span></a>
          <a href="mailto:${encodeURIComponent(draft.email).replace("%40", "@")}">Email the academy <span aria-hidden="true">↗</span></a>
        </div>
      </div>
    </section>`}
  </main>
  <footer><div class="wrap"><strong>Savage Wrestling Academy</strong><a href="/login">Family login</a></div></footer>
</body>
</html>`;
}

async function currentDraft() {
  const row = await env.DB!.prepare('SELECT payload, revision FROM academy_state WHERE id=?')
    .bind(draftKey).first<{ payload: string; revision: number }>();
  return { draft: row ? JSON.parse(row.payload) as WebsiteDraft : defaultWebsite, revision: row?.revision ?? 0 };
}

async function authorize(request: Request) {
  const auth = await ownerIdentity(request);
  auth.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return auth;
}

function redirect(headers: Headers, path: string) {
  headers.set('Location', path);
  return new Response(null, { status: 303, headers });
}

function html(headers: Headers, body: string, status = 200) {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(body, { headers, status });
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.owner) {
    if (auth.user && !auth.mfaRequired) return new Response(null, { status: 404, headers: auth.headers });
    return redirect(auth.headers, auth.mfaRequired ? '/security' : '/login');
  }
  const { draft, revision } = await currentDraft();
  return html(auth.headers, render(draft, revision, new URL(request.url)));
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.owner || !sameOrigin(request)) return new Response(null, { status: 403, headers: auth.headers });
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
    return new Response(null, { status: 415, headers: auth.headers });
  }
  if (Number(request.headers.get('content-length')) > 3_000_000) return new Response(null, { status: 413, headers: auth.headers });
  const raw = await request.text();
  if (raw.length > 3_000_000) return new Response(null, { status: 413, headers: auth.headers });
  const form = new URLSearchParams(raw);
  const revisionText = form.get('revision') ?? '';
  const revision = Number(revisionText);
  const editorUrl = new URL('/website-preview?edit=1', request.url);
  let draft: WebsiteDraft;
  try {
    if (!/^\d+$/.test(revisionText) || !Number.isSafeInteger(revision)) throw Error('Reopen the editor and try again.');
    draft = readDraft(form);
  } catch (error) {
    const current = await currentDraft();
    return html(auth.headers, render(current.draft, current.revision, editorUrl, (error as Error).message), 400);
  }
  const payload = JSON.stringify(draft);
  if (new TextEncoder().encode(payload).length > 700_000) {
    return html(auth.headers, render(draft, revision, editorUrl, 'This draft is too large. Shorten the entries and save again.'), 413);
  }

  const now = new Date().toISOString();
  const db = env.DB!;
  const saved = revision === 0
    ? await db.prepare('INSERT INTO academy_state (id,payload,revision,updated_by,updated_at) VALUES (?,?,1,?,?) ON CONFLICT(id) DO NOTHING RETURNING revision')
      .bind(draftKey, payload, auth.owner.userId, now).first()
    : await db.prepare('UPDATE academy_state SET payload=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND revision=? RETURNING revision')
      .bind(payload, auth.owner.userId, now, draftKey, revision).first();
  if (!saved) {
    return html(auth.headers, render(draft, revision, editorUrl, 'Another session saved this draft first. Copy any changes you want to keep, then reopen the editor to load the latest draft.'), 409);
  }
  return redirect(auth.headers, '/website-preview?saved=1');
}
