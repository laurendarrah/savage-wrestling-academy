// Issue #419: phones must not change what is typed in a password box. With Show, the sign-in page turns the password
// box into a text box, and an iPhone then capitalizes the first letter and may autocorrect it, so a password that
// works on a computer fails on a phone. Every password box tells phones to leave it alone.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

const files = [];
const walk = dir => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.html')) files.push(p); } };
walk('app'); walk('public');
let boxes = 0;
for (const f of files) {
  for (const [tag] of readFileSync(f, 'utf8').matchAll(/<input\b[^>]*type="password"[^>]*>/g)) {
    boxes++;
    for (const attr of ['autocapitalize="none"', 'autocorrect="off"', 'spellcheck="false"']) assert.ok(tag.includes(attr), `${f}: ${tag} needs ${attr}`);
  }
}
assert.ok(boxes >= 10, 'found the password boxes: ' + boxes);
// The sign-in page's Show button switches the same box, so the attributes stay with it.
const login = readFileSync('app/login/screen.html', 'utf8');
assert.match(login, /\$\('password'\)\.type=hidden\?'text':'password'/);
assert.match(login, /<input id="password" type="password"[^>]*autocapitalize="none" autocorrect="off" spellcheck="false">/);
console.log(`Passed: all ${boxes} password boxes tell phones not to capitalize, autocorrect or spell-check, including the sign-in box that Show turns into text.`);
