// Issue #173: on phones the coach's Today rows wrap and each waitlist entry stacks.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
assert.match(readFileSync('app/coach/screen.html', 'utf8'), /@media\(max-width:560px\)\{\.session\{flex-wrap:wrap/);
assert.match(readFileSync('app/waitlists/screen.html', 'utf8'), /@media\(max-width:640px\)\{\.table thead\{display:none\}\.table table,\.table tbody,\.table tr,\.table td\{display:block/);
console.log('phone-polish ok');
