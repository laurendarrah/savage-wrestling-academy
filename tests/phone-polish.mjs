// Issue #173: the coach's Today rows fit a phone. Since the design pass each practice is a box whose name and time
// take the room that is left beside the count, and long names wrap. (The waitlist page it also covered was removed in #210.)
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const home = readFileSync('app/coach/screen.html', 'utf8');
assert.match(home, /\.session\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;/);
assert.match(home, /\.session \.name\{[^}]*overflow-wrap:anywhere\}/); assert.match(home, /\.session \.count\{[^}]*white-space:nowrap\}/);
console.log('phone-polish ok');
