// Issue #159: fixes from the sweep of every page after the premium pass.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = f => readFileSync(f, 'utf8');
// The wrestler page's red "Next up" card wins over the shared white card style.
assert.match(read('app/wrestler/screen.html'), /html body main section\.card\.next\{background:#C4222C/);
// Headings set from script carry no trailing period (issue #130).
assert.doesNotMatch(read('app/payment-setup/screen.html'), /'(?:Stripe payments: live|Stripe payments: test mode|Connect Stripe for testing)\.'/);
assert.doesNotMatch(read('app/practice-plans/screen.html'), /Program curricula\./);
// The sample signature page gets the shared look; printable documents stay undecorated.
const chrome = read('lib/page-chrome.ts');
assert.doesNotMatch(chrome, /'\/scholarship-signature-preview'/);
assert.match(chrome, /'\/scholarship-agreement', '\/waiver-copy'/);
// Its sandboxed page has an opaque origin, so it needs same-site fonts and images allowed, and fonts sent with CORS.
assert.match(read('app/scholarship-signature-preview/route.ts'), /font-src 'self'; img-src 'self';/);
assert.match(read('public/_headers'), /\/fonts\/\*\n\s+Access-Control-Allow-Origin: \*/);
console.log('page-sweep ok');
