// Issue #144: Choose training has the Savage band (the shared .swa-head since #231), three numbered steps, and one red
// button while choosing.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html = readFileSync('app/register/screen.html', 'utf8'), body = html.slice(html.indexOf('<body>'), html.indexOf('<script'));
assert.match(body, /<div class="swa-head"><p class="eyebrow">Savage Wrestling Academy<\/p><h1>Choose training<\/h1>/);
assert.deepEqual([...body.matchAll(/<span class="num" aria-hidden="true">(\d)<\/span>/g)].map(m => m[1]), ['1', '2', '3'], 'three numbered steps');

// While choosing, the only red button is Review selection. The approval request only shows for SWA Advance.
const form = body.match(/<form id="selection">[\s\S]*?<\/form>/)[0], gate = form.match(/<div id="approvalGate" hidden>[\s\S]*?<\/div><div id="monthly">/)[0];
assert.deepEqual([...form.replace(gate, '').matchAll(/<button[^>]*class="primary"[^>]*id="(\w+)"/g)].map(m => m[1]), ['reviewButton']);
assert.match(form, /<div class="reviewbar"><p id="price" class="price"><\/p><button class="primary" id="reviewButton">/, 'price and Review selection sit together');

// Headings carry no trailing period (issue #130).
for (const [, text] of body.matchAll(/<h[12][^>]*>([^<]+)<\/h[12]>/g)) assert.doesNotMatch(text, /\.$/, text);
assert.match(body, /<h2>Review your selection<\/h2>/);

// Prices are never written into the page; they come from the server catalog and review.
assert.doesNotMatch(body, /\$\d/, 'no hard-coded prices');
// Before the academy publishes programs, one clear message replaces the empty form (issue #151).
assert.match(body, /<section id="notOpen" hidden[^>]*><h2 id="notOpenHeading">Training opens soon<\/h2>/);
const script = html.slice(html.indexOf('<script'));
assert.match(script, /if\(!catalog\.programs\.length\)\{\$\('notOpen'\)\.hidden=false;[^}]*return\}/, 'no programs: show the message and stop');
console.log('register-design ok');
