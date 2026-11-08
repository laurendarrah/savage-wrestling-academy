// Issue #222: shared stylesheet guards. The page batches rely on these tokens, and the fixes must not come back undone.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css = readFileSync('public/savage.css', 'utf8');
const root = css.match(/:root\{([\s\S]*?)\n\}/)[1];
const token = name => (root.match(new RegExp(`--${name}:([^;]+);`)) || [])[1];

// Tokens the pages adopt: program colors (as on the public calendar), the amber note, the ground and two widths.
assert.equal(token('swa-prog-advance'), '#000000');
assert.equal(token('swa-prog-intermediate'), '#686868');
assert.equal(token('swa-prog-development'), '#FFFFFF');
assert.equal(token('swa-prog-event'), '#D72732');
for (const t of ['swa-prog-advance-ink', 'swa-prog-intermediate-ink', 'swa-prog-development-ink', 'swa-prog-development-line', 'swa-prog-event-ink']) assert.ok(token(t), t);
assert.equal(token('swa-warn-bg'), '#FFF7E6');
assert.equal(token('swa-warn-line'), '#F0D49C');
assert.equal(token('swa-warn-ink'), '#5C3B00');
assert.ok(token('swa-ground') && token('swa-width-wide') && token('swa-width-narrow'), 'ground and content widths');

// The ground has zero specificity, so the dark wrestler page keeps its own background (PR #149).
assert.match(css, /:where\(body\)\{background:var\(--swa-ground\)\}/);
assert.doesNotMatch(css, /html body\{[^}]*background/, 'no forced body background');

// Phones: the header watermark stays inside the screen (it made pages 398px wide on a 390px phone).
for (const m of css.matchAll(/::after\{[^}]*\}/g)) assert.doesNotMatch(m[0], /right:-/, 'watermark has no negative right offset');

// "var(--swa-texture) fixed" fixes only the last layer and leaves a seam; every layer must be fixed.
assert.doesNotMatch(css, /var\(--swa-texture\) fixed/);
assert.match(css, /\[data-swa-page="\/coach-join"\]\{background:var\(--swa-texture\);background-attachment:fixed/);

// Buttons and fields get padding only where a page sets none: zero specificity, and link-buttons keep padding 0.
assert.match(css, /:where\(button,\.button\)\{padding:[^}]+\}/);
assert.match(css, /:where\(input:not\([^)]*\),select,textarea\)\{padding:[^}]+\}/);
assert.match(css, /html body button\.link\{[^}]*padding:0[;}]/);
assert.doesNotMatch(css.match(/html body button,html body \.button,html body a\.button\{[^}]*\}/)[0], /padding/, 'the strong button rule sets no padding');

// Phones: footer links and the calendar's section links are 44px tap targets.
const phone = css.match(/\/\* Phones: bigger tap targets[\s\S]*?\n\}/)[0];
assert.match(phone, /html body footer a,html body \.swa-head \.bar a,html body a\.more\{[^}]*min-height:44px/);
console.log('Shared styles: tokens, ground, watermark, texture, padding and tap targets ok');

// Issue #236: the intro rule (.swa-head>p) must not enlarge the small uppercase label in the band.
assert.match(css, /html body \.swa-head>p\.eyebrow\{font-size:13px/);

// ---------- Issue #280 (redesign Phase 1): the system every page inherits ----------
// Tokens: the type scale, the space scale, the surfaces and the dark set, the control heights. Every older token keeps
// its name and value (checked above); these are additions.
for (const [name, value] of Object.entries({'swa-t-13': '13px', 'swa-t-15': '15px', 'swa-t-17': '17px', 'swa-t-20': '20px', 'swa-t-24': '24px', 'swa-t-29': '29px', 'swa-t-35': '35px', 'swa-t-42': '42px', 'swa-t-50': '50px',
  'swa-s-4': '4px', 'swa-s-8': '8px', 'swa-s-12': '12px', 'swa-s-16': '16px', 'swa-s-24': '24px', 'swa-s-32': '32px', 'swa-s-48': '48px',
  'swa-surface': '#FFFFFF', 'swa-surface-2': '#F8F9FA', 'swa-dark-0': '#0D0D0F', 'swa-dark-1': '#17181B', 'swa-dark-2': '#222327', 'swa-dark-line': 'rgba(255,255,255,.08)', 'swa-dark-text': '#ECEDEF', 'swa-dark-muted': '#A6A9B0',
  'swa-h-small': '36px', 'swa-h-control': '48px', 'swa-h-big': '56px', 'swa-r-card': '12px', 'swa-r-control': '8px', 'swa-r-chip': '999px',
  'swa-ink': '#111113', 'swa-ground': '#F3F4F6', 'swa-red': '#C4222C', 'swa-muted': '#55585F', 'swa-ok-bg': '#E6F2EA'})) assert.equal(token(name)?.trim(), value, name);
const rule = sel => { const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')); assert.ok(m, sel); return m[1]; };
// Type: h1 condensed caps on the scale, h2 Barlow sentence case, section labels 13px caps, big figures condensed.
assert.match(rule('html body h1'), /font-family:var\(--swa-display\);font-weight:800;text-transform:uppercase;[^}]*font-size:var\(--swa-t-35\)/);
assert.match(rule('html body h2'), /font-family:var\(--swa-body\);font-weight:700;text-transform:none;[^}]*font-size:var\(--swa-t-20\)/);
assert.match(css, /@media \(min-width:900px\)\{html body h1\{font-size:var\(--swa-t-42\)\}html body h2,html body\[data-swa-page\] h2,html body\[data-swa-page\] \.step-head \.h2\{font-size:var\(--swa-t-24\)\}\}/);
assert.match(rule('html body[data-swa-page] h2,html body[data-swa-page] .step-head .h2'), /text-transform:none/, 'outranks a page\'s own one-class h2 rule');
assert.match(rule('html body .eyebrow,html body .swa-label'), /font-size:var\(--swa-t-13\);letter-spacing:1\.6px;text-transform:uppercase/);
assert.match(rule('html body .swa-figure'), /font-family:var\(--swa-display\);font-weight:800;font-size:var\(--swa-t-42\)/);
assert.match(rule('html body'), /font-size:var\(--swa-t-17\)/);
// Condensed caps live on h1, figures and the primary button only: the plain button, the top bar and the pills are Barlow.
const button = rule('html body button,html body .button,html body a.button');
assert.match(button, /font-family:var\(--swa-body\);font-weight:600;font-size:var\(--swa-t-17\);letter-spacing:0;text-transform:none;[^}]*min-height:var\(--swa-h-control\)/);
assert.match(rule('html body button.primary,html body .primary,html body a.button.primary,html body button[type=submit].primary'), /font-family:var\(--swa-display\);font-weight:700;font-size:var\(--swa-t-20\);[^}]*text-transform:uppercase;background:var\(--swa-red\)/);
assert.match(rule('html body button.quiet,html body .button.quiet,html body a.button.quiet'), /background:transparent;[^}]*text-decoration:underline/);
assert.match(rule('html body button.danger,html body .button.danger,html body a.button.danger'), /color:var\(--swa-red-dark\);border-color:var\(--swa-red\)/);
assert.match(rule('html body button.big,html body .button.big'), /min-height:var\(--swa-h-big\)/);
assert.match(rule('html body button.sm,html body .button.sm'), /min-height:var\(--swa-h-small\)/);
assert.match(rule('html body input:not([type=checkbox]):not([type=radio]):not([type=file]),html body select,html body textarea'), /min-height:var\(--swa-h-control\)/, 'fields are as tall as buttons');
assert.match(rule('.swa-bar__links a'), /font-family:var\(--swa-body\);[^}]*text-transform:none/);
assert.match(rule('html body .badge,html body .pill,html body .tag,html body .billing-pill'), /font-size:var\(--swa-t-13\);letter-spacing:0;text-transform:none/);
for (const state of ['ok', 'warn', 'bad', 'neutral']) assert.match(css, new RegExp(`html body :is\\(\\.badge,\\.pill,\\.tag,\\.billing-pill\\):is\\(\\.${state}[,)]`), 'pill tint ' + state);
assert.match(css, /:is\(\.warn,\.warning,\.due,/, 'older state names map onto the tints'); assert.match(css, /:is\(\.ok,\.paid,\.verified,\.active,/); assert.match(css, /:is\(\.bad,\.voided,\.refunded,/);
// One card, one table, one empty state, one disclosure, one skeleton.
assert.match(rule('html body main>section,html body main section.card,html body .card'), /border:1px solid var\(--swa-hair\);border-radius:var\(--swa-r-card\)/);
assert.match(css, /html body main>section,html body main>details\.card,html body \.card\{padding:var\(--swa-s-16\)\}\n@media \(min-width:900px\)\{html body main>section,html body main>details\.card,html body \.card\{padding:var\(--swa-s-24\)\}\}/);
assert.match(rule('html body .card.dark,html body main>section.dark'), /var\(--swa-dark-1\),var\(--swa-dark-0\)\);color:var\(--swa-dark-text\)/);
assert.match(rule('html body .swa-table th,html body .swa-table td'), /padding:var\(--swa-s-12\) var\(--swa-s-8\)/);
assert.match(css, /@media \(max-width:600px\)\{\n  html body :not\(\.stack\)>\.swa-table thead\{position:absolute/, 'two-line rows on a phone, except inside a .stack wrapper');
assert.match(rule('html body :not(.stack)>.swa-table tr'), /display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
assert.match(rule('html body .empty'), /display:flex;flex-direction:column;[^}]*font-style:normal/);
assert.match(rule('html body details>summary'), /list-style:none;display:flex;align-items:center;gap:var\(--swa-s-8\);min-height:44px/);
assert.match(rule('html body details>summary::after'), /border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate\(45deg\)/, 'a chevron');
assert.match(rule('html body .skeleton'), /animation:swa-shimmer 1\.4s linear infinite/);
// Chrome: the band has no watermark any more; the title row and "How this works" are styled; the family band is a title row.
assert.doesNotMatch(css, /\.swa-head::after/, 'no watermark on the band');
assert.doesNotMatch(css, /\.fam-hero::before\{content:""/, 'the family home has no textured band');
assert.match(rule('html body .swa-title'), /display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between/);
assert.match(rule('html body .swa-title__text>p'), /color:var\(--swa-muted\);font-size:var\(--swa-t-17\);max-width:62ch/);
assert.match(rule('html body .how>summary'), /font-size:var\(--swa-t-15\)/);
assert.match(rule('html body .fam-hero'), /background:none;box-shadow:none;clip-path:none;color:var\(--swa-ink\)/);
assert.match(rule('html body .fam-hero .quick a'), /font-family:var\(--swa-body\);[^}]*text-transform:none;color:var\(--swa-ink\)/);
// The login keeps its look: the texture, the logo, the big heading in the card.
assert.match(css, /html body\[data-swa-page="\/login"\] main::before\{content:"";display:block;width:96px;height:96px/);
assert.match(rule('html body[data-swa-page="/login"] h1,html body[data-swa-page="/coach-join"] h1'), /font-size:clamp\(38px,7\.4vw,64px\)/);
assert.match(rule('html body[data-swa-page="/login"] main>section.card'), /padding:26px/, 'the sign-in card keeps its width, so the heading stays on one line');
// Dark pages on the dark set, not pure black and white; the pass card itself stays white for the QR code.
assert.match(rule('html body[data-swa-page="/wrestler"]'), /background:var\(--swa-dark-0\);color:var\(--swa-dark-text\)/);
assert.match(rule('html body[data-swa-page="/pass"]'), /background:var\(--swa-dark-0\);color:var\(--swa-dark-text\)/);
assert.match(rule('html body[data-swa-page="/wrestler"] #passCard'), /background:var\(--swa-surface\)/);
// The owner shell: a flat sidebar on the dark set with 44px items, 12px group labels and a count badge.
const shell = readFileSync('public/owner-shell.css', 'utf8');
assert.doesNotMatch(shell, /os-texture|savage-logo-256/, 'no texture or watermark in the sidebar');
assert.match(shell, /html body \.os-side\{[^}]*background:var\(--swa-dark-0,#0D0D0F\);border-right:1px solid var\(--swa-dark-line,rgba\(255,255,255,\.08\)\);color:var\(--swa-dark-text,#ECEDEF\)/);
assert.match(shell, /html body \.os-nav a,html body \.os-family-drawer a\{[^}]*min-height:44px/);
assert.match(shell, /html body \.os-group\{[^}]*font:700 12px\/1\.2 var\(--os-body\)/);
assert.match(shell, /html body \.os-badge\{[^}]*border-radius:999px;background:var\(--os-red\);color:#fff;font:700 12px\/22px/);
assert.doesNotMatch(shell, /\.os-work \.swa-head/, 'owner pages have no band to clip');
console.log('Phase 1 system: tokens, type discipline, three buttons, one card/pill/table/empty/disclosure/skeleton, title row, dark pages, flat sidebar ok');
