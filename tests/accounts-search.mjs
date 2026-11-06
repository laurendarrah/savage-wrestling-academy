// Issue #169: Family accounts has a search box over parent, email, phone and wrestler names, and a count.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src = readFileSync('app/accounts/route.ts', 'utf8');
assert.match(src, /const search=\[family\.parentName,row\.email,family\.phone,\.\.\.\(family\.wrestlers\?\?\[\]\)\.map/, 'search covers parent, email, phone and wrestlers');
assert.match(src, /data-search="\$\{escape\(search\)\}"/, 'search text is escaped');
assert.match(src, /<input id="find" type="search"/);
assert.match(src, /families match/);
assert.doesNotMatch(src, /sample families/, 'no mention of the removed sample families');
// The filter itself, run against two cards.
const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
const cards = [{dataset: {search: 'pat example family.a@x 555 sam example'}, hidden: false}, {dataset: {search: 'riley parent family.b@x riley two'}, hidden: false}];
const els = {find: {value: ''}, count: {textContent: '2 families · 2 wrestlers'}, none: {hidden: true}};
const document = {getElementById: id => els[id], querySelectorAll: () => cards};
new Function('document', script)(document);
els.find.value = 'Riley'; els.find.oninput();
assert.deepEqual(cards.map(c => c.hidden), [true, false]); assert.equal(els.count.textContent, '1 of 2 families match'); assert.equal(els.none.hidden, true);
els.find.value = 'nobody'; els.find.oninput(); assert.equal(els.none.hidden, false);
els.find.value = ''; els.find.oninput(); assert.deepEqual(cards.map(c => c.hidden), [false, false]); assert.equal(els.count.textContent, '2 families · 2 wrestlers');
console.log('accounts-search ok');
