// Issue #173: on phones the coach's Today rows wrap. (The waitlist page it also covered was removed in #210.)
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
assert.match(readFileSync('app/coach/screen.html', 'utf8'), /@media\(max-width:560px\)\{\.session\{flex-wrap:wrap/);
console.log('phone-polish ok');
