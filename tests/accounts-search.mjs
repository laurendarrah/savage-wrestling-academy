// Issue #169: Family accounts has a search box over parent, email, phone and wrestler names, and a count.
// Issue #188: a program filter sits next to it, and both narrow the list together.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src = readFileSync('app/accounts/route.ts', 'utf8');
assert.match(src, /const search=\[family\.parentName,row\.email,family\.phone,\.\.\.\(family\.wrestlers\?\?\[\]\)\.map/, 'search covers parent, email, phone and wrestlers');
assert.match(src, /data-search="\$\{escape\(search\)\}"/, 'search text is escaped');
assert.match(src, /<input id="find" type="search"/);
assert.match(src, /families match/);
assert.match(src, /<select id="program">/, 'program filter next to the search');
assert.match(src, /data-programs="/, 'each family lists its programs');
assert.doesNotMatch(src, /sample families/, 'no mention of the removed sample families');
// The filter itself, run against two cards.
const script = src.match(/<script>([\s\S]*?)<\/script>/)[1];
const cards = [{dataset: {search: 'pat example family.a@x 555 sam example', programs: 'Intermediate Elementary'}, hidden: false}, {dataset: {search: 'riley parent family.b@x riley two', programs: 'none'}, hidden: false}];
const els = {find: {value: ''}, program: {value: ''}, count: {textContent: '2 families · 2 wrestlers'}, none: {hidden: true}};
const document = {getElementById: id => els[id], querySelectorAll: () => cards};
new Function('document', script)(document);
els.find.value = 'Riley'; els.find.oninput();
assert.deepEqual(cards.map(c => c.hidden), [true, false]); assert.equal(els.count.textContent, '1 of 2 families match'); assert.equal(els.none.hidden, true);
els.find.value = 'nobody'; els.find.oninput(); assert.equal(els.none.hidden, false);
els.find.value = ''; els.find.oninput(); assert.deepEqual(cards.map(c => c.hidden), [false, false]); assert.equal(els.count.textContent, '2 families · 2 wrestlers');
els.program.value = 'Intermediate'; els.program.onchange();
assert.deepEqual(cards.map(c => c.hidden), [false, true]); assert.equal(els.count.textContent, '1 of 2 families match');
els.program.value = 'Elementary'; els.program.onchange(); assert.deepEqual(cards.map(c => c.hidden), [false, true], 'a family with wrestlers in two programs shows under both');
els.program.value = 'none'; els.program.onchange(); assert.deepEqual(cards.map(c => c.hidden), [true, false]);
els.find.value = 'pat'; els.find.oninput(); assert.deepEqual(cards.map(c => c.hidden), [true, true], 'search and program combine'); assert.equal(els.none.hidden, false);
els.find.value = ''; els.program.value = ''; els.program.onchange(); assert.deepEqual(cards.map(c => c.hidden), [false, false]); assert.equal(els.count.textContent, '2 families · 2 wrestlers');
console.log('accounts-search ok');
