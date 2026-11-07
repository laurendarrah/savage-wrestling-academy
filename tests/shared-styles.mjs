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
