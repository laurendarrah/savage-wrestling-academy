// Issue #144: Choose training has the Savage band (the shared .swa-head since #231), three numbered steps, and one red
// button while choosing.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html = readFileSync('app/register/screen.html', 'utf8'), body = html.slice(html.indexOf('<body>'), html.indexOf('<script'));
assert.match(body, /<div class="swa-head"><p class="eyebrow">Savage Wrestling Academy<\/p><h1>Choose training<\/h1>/);
assert.deepEqual([...body.matchAll(/<span class="num" aria-hidden="true">(\d)<\/span>/g)].map(m => m[1]), ['1', '2', '3'], 'three numbered steps');

// While choosing, the only red button is Review selection. The approval request only shows for SWA Advance.
const form = body.match(/<form id="selection" class="reg">[\s\S]*?<\/form>/)[0], gate = form.match(/<div id="approvalGate" hidden>[\s\S]*?<\/div><div id="monthly">/)[0];
assert.deepEqual([...form.replace(gate, '').matchAll(/<button[^>]*class="primary"[^>]*id="(\w+)"/g)].map(m => m[1]), ['reviewButton']);
assert.match(form, /<div class="reviewbar"><p id="price" class="price"><\/p><button class="primary" id="reviewButton">/, 'price and Review selection sit together');
// Phase 2 (#282): the wrestler is a chip row over a hidden value, the plan a two-way segmented control over a hidden
// value, and the summary sits in its own column on a desk (sticky) while staying the thumb bar on a phone.
assert.match(form, /<div class="swa-chips" id="wrestlerChips"><\/div><input type="hidden" id="wrestler" required>/);
assert.match(form, /<input type="hidden" id="plan" value="monthly"><div class="swa-seg" id="planSeg" role="group" aria-label="Plan"><button type="button" id="plan-monthly" data-plan="monthly" aria-pressed="true">Monthly membership<small><span id="planPrice-monthly"><\/span> · <span id="planTerm-monthly">12 monthly payments<\/span><\/small><\/button><button type="button" id="plan-walkin" data-plan="walkin" aria-pressed="false">Walk-in/);
assert.match(form, /<aside class="reg-side" aria-label="Your selection">/);
assert.match(html, /@media \(min-width:900px\)\{\n \.reg\{grid-template-columns:minmax\(0,1fr\) 320px/); assert.match(html, /\.reg-side\{position:sticky;top:84px\}/);
assert.doesNotMatch(html, /practice-dot/, 'days with a practice are ink, not dotted red');
assert.match(html, /html body \.calendar-day\[aria-pressed=true\]\{color:#fff;background:var\(--swa-red\)/, 'red only on the chosen day');
assert.match(html, /html body \.calendar-day\[aria-current=date\]::after\{[^}]*background:var\(--swa-red\)/, 'a red dot for today');
// The review: the receipt then one Confirm, with the terms line beneath; no inline handlers (the page carries the nonce policy).
assert.match(body, /<div id="payBox" class="confirm" hidden><button class="primary" id="payButton" disabled>Confirm and pay<\/button><label class="swa-terms check"><input type="checkbox" id="acceptTerms">/);
assert.match(body, /<div id="cashBox" class="confirm" hidden><button class="primary" id="cashButton" type="button">Confirm booking<\/button>/);
assert.doesNotMatch(body, /\son[a-z]+=/, 'no inline handlers');

// Headings carry no trailing period (issue #130).
for (const [, text] of body.matchAll(/<h[12][^>]*>([^<]+)<\/h[12]>/g)) assert.doesNotMatch(text, /\.$/, text);
assert.match(body, /<h2 id="reviewHeading">Review your selection<\/h2>/);

// Prices are never written into the page; they come from the server catalog and review.
assert.doesNotMatch(body, /\$\d/, 'no hard-coded prices');
// Before the academy publishes programs, one clear message replaces the empty form (issue #151).
assert.match(body, /<section id="notOpen" hidden[^>]*><h2 id="notOpenHeading">Training opens soon<\/h2>/);
const script = html.slice(html.indexOf('<script'));
assert.match(script, /if\(!catalog\.programs\.length\)\{\$\('notOpen'\)\.hidden=false;[^}]*return\}/, 'no programs: show the message and stop');
console.log('register-design ok');
