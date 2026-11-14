// The Savage look for every email (issue #320). lib/email.ts sends each message as HTML in this layout, with the
// plain text the caller wrote as the text alternative. The sign-in emails Supabase sends use the same pieces
// (scripts/build-email-templates.mjs writes docs/email-templates/ from them).
//
// Pure: no imports, no environment, no network. The site address is passed in (appOrigin() in lib/email.ts), so no
// address is written here. Subjects and message text come from families and the owner, so everything is escaped;
// only http and https addresses become links.
//
// Built for email apps: tables for layout, styles on each element, a short <style> for phones and dark mode, no
// scripts and no fonts to download. Barlow Condensed is not available in an email, so headings fall back to
// Arial Narrow.

export type BrandAudience = 'account' | 'owner' | 'invite';
export type BrandInput = {subject: string; text: string; origin?: string | null; audience?: BrandAudience};

export const ACADEMY_NAME = 'Savage Wrestling Academy';
// The same address as ACADEMY_ADDRESS in lib/interest.ts (tests/email-brand.mjs checks they match).
export const ACADEMY_ADDRESS = '20 Railroad St, Huntington Station, NY 11746';
export const LOGO_PATH = '/brand/savage-logo-128.png';
// Why the reader got the email: one line in the footer.
export const WHY: Record<BrandAudience, string> = {
  account: 'You’re getting this because you have an account with Savage Wrestling Academy.',
  owner: 'You’re getting this because you run the Savage Wrestling Academy site.',
  invite: 'You’re getting this because Savage Wrestling Academy invited you to coach.'
};

const INK = '#111113', RED = '#C4222C', SILVER = '#B9C4C9', GROUND = '#F3F4F6', MUTED = '#55585F', LINE = '#E4E6EA';
const DISPLAY = "'Arial Narrow','Helvetica Neue',Arial,sans-serif", BODY = "'Helvetica Neue',Arial,sans-serif";

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- The pieces (also used for the Supabase templates). Arguments here are trusted HTML or already escaped. ---

// No "{{" or "}}" anywhere in here: Supabase reads those as its variables in the sign-in templates.
const STYLE = '<style>'
  + ':root{color-scheme:light dark;supported-color-schemes:light dark}'
  + 'body{margin:0;padding:0}'
  + 'a{word-break:break-word}'
  + '@media (max-width:480px){.swa-pad{padding-left:20px!important;padding-right:20px!important}.swa-h{font-size:25px!important}.swa-out{padding:12px 8px!important} }'
  + '@media (prefers-color-scheme:dark){'
  + '.swa-ground{background:#0D0D0F!important}.swa-card{background:#17181B!important}'
  + '.swa-text,.swa-h{color:#ECEDEF!important}.swa-muted{color:#A6A9B0!important}.swa-link{color:#FF8A91!important}'
  + '.swa-rule{border-top-color:#2C2D32!important}.swa-code{background:#222327!important;color:#FFFFFF!important} }'
  + '[data-ogsc] .swa-text,[data-ogsc] .swa-h{color:#ECEDEF!important}[data-ogsc] .swa-muted{color:#A6A9B0!important}[data-ogsc] .swa-link{color:#FF8A91!important}'
  + '</style>';

// The black band: the mark (when there is a site address to load it from), SAVAGE, WRESTLING ACADEMY and the red rule.
// The words are text, so the band still reads when an email app blocks pictures.
export function brandHeader(logoUrl?: string | null): string {
  const logo = logoUrl
    ? `<img src="${logoUrl}" width="64" height="64" alt="${ACADEMY_NAME}" style="display:block;margin:0 auto 10px;border:0;outline:none;width:64px;height:64px;font-family:${BODY};font-size:11px;line-height:1.3;color:${SILVER};">`
    : '';
  return `<tr><td align="center" bgcolor="${INK}" style="background:${INK};padding:26px 24px 22px;border-bottom:3px solid ${RED};border-radius:12px 12px 0 0;">${logo}`
    + `<div style="font-family:${DISPLAY};font-stretch:condensed;font-size:36px;line-height:1;font-weight:700;letter-spacing:7px;padding-left:7px;color:#FFFFFF;text-transform:uppercase;">Savage</div>`
    + `<div style="font-family:${DISPLAY};font-size:11px;line-height:1.4;font-weight:700;letter-spacing:4px;padding:7px 0 0 4px;color:${SILVER};text-transform:uppercase;">Wrestling Academy</div>`
    + '</td></tr>';
}

// Under the card, on the grey ground: who sent it, where the academy is, and why the reader got it.
export function brandFooter(why: string): string {
  return `<tr><td align="center" class="swa-muted" style="padding:20px 20px 8px;font-family:${BODY};font-size:12px;line-height:1.6;color:${MUTED};">`
    + `${ACADEMY_NAME} &middot; ${ACADEMY_ADDRESS}<br>${why}</td></tr>`;
}

export const headlineHtml = (html: string) =>
  `<h1 class="swa-h" style="margin:0 0 16px;font-family:${DISPLAY};font-stretch:condensed;font-size:28px;line-height:1.12;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:${INK};">${html}</h1>`;
export const paragraphHtml = (html: string) => `<p class="swa-text" style="margin:0 0 16px;color:${INK};">${html}</p>`;
export const noteHtml = (html: string) => `<p class="swa-muted" style="margin:0 0 16px;font-size:14px;line-height:1.55;color:${MUTED};">${html}</p>`;
export const linkHtml = (href: string, label: string) => `<a href="${href}" class="swa-link" style="color:${RED};text-decoration:underline;word-break:break-word;">${label}</a>`;
// The one main action: red, white bold caps. The padding is on the link so the whole button can be tapped; Outlook
// reads it from the cell instead.
export const buttonHtml = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;"><tr><td align="center" bgcolor="${RED}" style="background:${RED};border-radius:8px;mso-padding-alt:14px 28px;">`
  + `<a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${BODY};font-size:15px;line-height:1.25;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;border-radius:8px;">${label}</a>`
  + '</td></tr></table>';
// A one-time code, large and easy to read.
export const codeHtml = (html: string) =>
  `<p class="swa-code" style="margin:4px 0 20px;padding:14px 18px;background:${GROUND};border-radius:8px;font-family:'Courier New',Courier,monospace;font-size:30px;line-height:1.2;font-weight:700;letter-spacing:6px;color:${INK};text-align:center;">${html}</p>`;
// For when the button does not work: the same address, to copy.
export const fallbackHtml = (href: string) =>
  `<p class="swa-muted swa-rule" style="margin:8px 0 0;padding:16px 0 0;border-top:1px solid ${LINE};font-size:13px;line-height:1.55;color:${MUTED};">`
  + `If the button doesn’t work, paste this link into your browser:<br>${linkHtml(href, href)}</p>`;

// The whole email around a card's content. `title` and `preheader` are plain text and are escaped here; `inner` is
// HTML made from the pieces above.
export function emailShell(parts: {title: string; preheader: string; inner: string; why: string; logoUrl?: string | null}): string {
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><meta name="x-apple-disable-message-reformatting">'
    + `<title>${escapeHtml(parts.title)}</title>${STYLE}</head>\n`
    + `<body class="swa-ground" style="margin:0;padding:0;background:${GROUND};-webkit-text-size-adjust:100%;">\n`
    // The line an inbox shows after the subject. Hidden in the email itself.
    + `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${GROUND};">${escapeHtml(parts.preheader)}</div>\n`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="swa-ground" bgcolor="${GROUND}" style="background:${GROUND};"><tr><td align="center" class="swa-out" style="padding:24px 12px;">\n`
    + '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->\n'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">\n'
    + brandHeader(parts.logoUrl) + '\n'
    + `<tr><td class="swa-card swa-pad swa-text" bgcolor="#FFFFFF" style="background:#FFFFFF;padding:32px 32px 24px;border-radius:0 0 12px 12px;font-family:${BODY};font-size:16px;line-height:1.55;color:${INK};">\n`
    + parts.inner + '\n</td></tr>\n'
    + brandFooter(parts.why) + '\n'
    + '</table>\n<!--[if mso]></td></tr></table><![endif]-->\n</td></tr></table>\n</body></html>';
}

// --- Plain text to HTML ---

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
// Cuts characters off the end one at a time (a pattern like /[.!?]+$/ gets slow on a long run of them mid-text).
function dropTrailing(s: string, chars: string): string {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1])) end--;
  return s.slice(0, end);
}
// A sentence's own punctuation after an address is not part of the address.
function trimUrl(raw: string): string {
  const count = (s: string, c: string) => s.split(c).length - 1;
  let url = raw;
  for (;;) {
    url = dropTrailing(url, '.,;:!?');
    const last = url.slice(-1), open = last === ')' ? '(' : last === ']' ? '[' : '';
    // An address in brackets ends before the closing bracket; one with its own pair, like "/wiki/Mat_(sport)", keeps it.
    if (!open || count(url, last) <= count(url, open)) return url;
    url = url.slice(0, -1);
  }
}
function urlsIn(text: string): string[] {
  return (text.match(URL_PATTERN) ?? []).map(trimUrl).filter(u => /^https?:\/\/[^/?#]/.test(u));
}
// Escaped text with its addresses turned into links.
export function linkify(text: string): string {
  let out = '', at = 0;
  for (const m of text.matchAll(URL_PATTERN)) {
    const url = trimUrl(m[0]);
    if (!/^https?:\/\/[^/?#]/.test(url)) continue;
    out += escapeHtml(text.slice(at, m.index)) + linkHtml(escapeHtml(url), escapeHtml(url));
    at = m.index + url.length;
  }
  return out + escapeHtml(text.slice(at));
}

const cleanOrigin = (origin: unknown) => typeof origin === 'string' && /^https?:\/\/[^/?#\s"'<>]+$/.test(origin.trim().replace(/\/+$/, '')) ? origin.trim().replace(/\/+$/, '') : null;
const onSite = (url: string, origin: string | null) => !!origin && (url === origin || ['/', '?', '#'].some(c => url.startsWith(origin + c)));

// What the button says, from the page it opens. Anything else gets the safe default.
const LABELS: Record<string, string> = {
  inbox: 'Read your messages', family: 'Open your family account', register: 'Choose training', wrestler: 'Open the wrestler view',
  lesson: 'Open private lessons', booking: 'Open your booking', calendar: 'Open the calendar', waiver: 'Sign the waiver', consent: 'Sign the consent form',
  contract: 'Sign your contract', 'coach-join': 'Accept your invite', coach: 'Open coach home', 'coach-time': 'Open your hours',
  'site-health': 'Open Site health', payments: 'Open Payments', approvals: 'Open approvals', messages: 'Open Messages', scholarship: 'Open your scholarship',
  login: 'Sign in', security: 'Open account security'
};
export const DEFAULT_LABEL = 'Open Savage Wrestling Academy';
export function buttonLabel(url: string, origin: string): string {
  const page = url.slice(origin.length).replace(/^\//, '').split(/[/?#]/)[0].toLowerCase();
  return Object.prototype.hasOwnProperty.call(LABELS, page) ? LABELS[page] : DEFAULT_LABEL;
}

const BRAND_LINE = /^savage wrestling academy( site)?$/i, RULE_LINE = /^(—|–|--)$/;
const sameWords = (a: string, b: string) => dropTrailing(a.trim(), '.!? ').toLowerCase() === dropTrailing(b.trim(), '.!? ').toLowerCase();

export function brandedEmail(input: BrandInput): {html: string; text: string} {
  const text = String(input?.text ?? ''), subject = String(input?.subject ?? '').trim() || ACADEMY_NAME;
  const origin = cleanOrigin(input?.origin);
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n').map(l => l.trimEnd());

  // The plain-text sign-off ("—", the academy's name, a link) is the footer's job here. Its link can be the button.
  let body = lines, signOff: string[] = [];
  let rule = lines.length - 1;
  while (rule >= 0 && !RULE_LINE.test(lines[rule].trim())) rule--;
  if (rule >= 0 && lines.length - rule <= 6) { body = lines.slice(0, rule); signOff = lines.slice(rule + 1).filter(l => l.trim() && !BRAND_LINE.test(l.trim())); }

  const button = [...urlsIn(body.join('\n')), ...urlsIn(signOff.join('\n'))].find(u => onSite(u, origin)) ?? null;
  // Sign-off lines that only carry the button's address are covered by the button and the "paste this link" line.
  const kept = signOff.filter(l => !(button && urlsIn(l).includes(button)));

  const blocks: string[] = [];
  let placed = false;
  const paragraphs = [...body, ...(kept.length ? ['', ...kept] : [])].join('\n').split(/\n{2,}/).map(p => p.split('\n').filter(l => l.trim())).filter(p => p.length);
  // A first line that only repeats the subject would say the headline twice.
  if (paragraphs.length && paragraphs[0].length === 1 && sameWords(paragraphs[0][0], subject)) paragraphs.shift();
  for (const p of paragraphs) {
    let run: string[] = [];
    const flush = () => { if (run.length) blocks.push(paragraphHtml(run.map(linkify).join('<br>'))); run = []; };
    for (const line of p) {
      // The button's address on a line of its own: the button goes right there.
      if (button && !placed && line.trim() === button) { flush(); blocks.push(buttonHtml(escapeHtml(button), escapeHtml(buttonLabel(button, origin!)))); placed = true; }
      else run.push(line);
    }
    flush();
  }
  if (button && !placed) blocks.push(buttonHtml(escapeHtml(button), escapeHtml(buttonLabel(button, origin!))));
  if (button) blocks.push(fallbackHtml(escapeHtml(button)));

  const first = paragraphs.flat().find(l => !urlsIn(l).includes(l.trim())) ?? subject;
  const preheader = (first.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? first).slice(0, 150);
  const html = emailShell({title: subject, preheader, inner: headlineHtml(escapeHtml(subject)) + '\n' + blocks.join('\n'),
    why: Object.prototype.hasOwnProperty.call(WHY, String(input?.audience)) ? WHY[input!.audience!] : WHY.account, logoUrl: origin ? escapeHtml(origin + LOGO_PATH) : null});
  return {html, text};
}
