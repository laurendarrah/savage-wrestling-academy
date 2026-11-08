// Issue #129: every page gets the shared stylesheet, icons and the same top bar; some pages are deliberately left alone.
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// lib/page-chrome.ts and the owner shell it loads (lib/owner-shell.ts, lib/owner-nav.ts), transpiled as the build does.
const loaded = new Map();
function load(file) {
  if (loaded.has(file)) return loaded.get(file);
  const module = {exports: {}}; loaded.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, URL, Headers, Response, Request, crypto, Uint8Array, Array, require: name => load('lib/' + name.replace('./', '') + '.ts')});
  return module.exports;
}
const module = {exports: load('lib/page-chrome.ts')};
const {decoratePage, decorateResponse, shouldDecorate, topBar} = module.exports;
const page = '<!doctype html><html><head><title>X</title></head><body class="a"><main>Hi</main></body></html>';

const out = decoratePage(page, '/register');
assert.match(out, /<link rel="stylesheet" href="\/savage.css"><\/head>/, 'stylesheet is the last thing in head, so it wins');
assert.match(out, /<body data-swa-page="\/register" class="a"><header class="swa-bar">/, 'top bar comes first in the body, and the body names the page');
assert.match(out, /href="\/brand\/favicon-32.png"/);
assert.equal(decoratePage(out, '/register'), out, 'decorating twice changes nothing');
assert.match(topBar('/calendar'), /href="\/calendar" aria-current="page">Calendar/);
assert.match(topBar('/family'), /href="\/" aria-current="page">Home/, 'a home page marks Home as current');
assert.doesNotMatch(topBar('/register'), /aria-current/);

const u = p => new URL('https://x.test' + p);
assert.equal(shouldDecorate(u('/family'), 'text/html; charset=utf-8'), true);
for (const p of ['/', '/waiver-copy', '/scholarship-agreement', '/api/family', '/calendar?embed=1']) assert.equal(shouldDecorate(u(p), 'text/html'), false, p);
assert.equal(shouldDecorate(u('/family'), 'application/json'), false);

const res = await decorateResponse(new Request('https://x.test/inbox'), new Response(page, {headers: {'Content-Type': 'text/html', 'Content-Length': '99', 'Cache-Control': 'private, no-store'}}));
const text = await res.text();
assert.match(text, /swa-bar/); assert.equal(res.headers.get('Content-Length'), null, 'stale length dropped'); assert.equal(res.headers.get('Cache-Control'), 'private, no-store', 'other headers kept');
const redirect = new Response(null, {status: 303, headers: {Location: '/login', 'Content-Type': 'text/html'}});
assert.equal(await decorateResponse(new Request('https://x.test/family'), redirect), redirect, 'redirects pass through untouched');

// The files the bar and stylesheet point at exist, and the font license ships with the fonts.
for (const f of ['public/savage.css', 'public/brand/savage-logo-128.png', 'public/brand/favicon-32.png', 'public/brand/favicon-64.png', 'public/brand/apple-touch-icon.png', 'public/fonts/OFL-LICENSE.txt']) assert.ok(existsSync(f), f);
for (const m of readFileSync('public/savage.css', 'utf8').matchAll(/url\(\/(fonts\/[^)]+)\)/g)) assert.ok(existsSync('public/' + m[1]), m[1]);
console.log('Page chrome: stylesheet, icons and top bar on every page; skipped pages, redirects and headers handled');

// Issue #146: on a public page, the opening back link, heading and intro move into the black header band.
{
  const {pageHead} = module.exports;
  const wrap = h => pageHead(`<html><body><main>${h}</main></body></html>`, '/help');
  assert.equal(wrap('<a href="/">← Back</a><h1>Roster</h1><p class="muted">Who paid.</p><section>x</section>'),
    '<html><body><main><div class="swa-head"><a href="/">← Back</a><h1>Roster</h1><p class="muted">Who paid.</p></div><section>x</section></main></body></html>');
  assert.equal(wrap('<h1>Site health</h1><p id="status" role="status">Loading…</p>'),
    '<html><body><main><div class="swa-head"><h1>Site health</h1></div><p id="status" role="status">Loading…</p></main></body></html>', 'status lines stay outside');
  assert.match(wrap('<h1>Terms</h1><p class="notice">Draft</p>'), /<div class="swa-head"><h1>Terms<\/h1><\/div><p class="notice">/, 'notices stay outside');
  assert.match(wrap('<h1>Pay <b>now</b></h1><p>Intro with <a href="/x">a link</a>.</p><p>Second</p>'), /<div class="swa-head"><h1>Pay <b>now<\/b><\/h1><p>Intro with <a href="\/x">a link<\/a>.<\/p><\/div><p>Second/);
  const own = '<html><body><div class="fam-hero"></div><main><h1>Hi</h1></main></body></html>';
  assert.equal(pageHead(own, '/welcome'), own, 'pages with their own header are left alone');
  const card = '<html><body><main><section class="card"><h1>Welcome back</h1></section></main></body></html>';
  assert.equal(pageHead(card, '/login'), card, 'a heading inside a card is not moved');
  assert.match(decoratePage('<html><head></head><body><main><h1>Help</h1><p>All of it.</p></main></body></html>', '/help/coach'), /<main><div class="swa-head"><h1>Help<\/h1><p>All of it.<\/p><\/div>/);
}
// Issue #157: an eyebrow line before the heading, the calendar header and a heading row, on public pages.
{
  const {pageHead} = module.exports;
  const wrap = h => pageHead(`<html><body><main>${h}</main></body></html>`, '/calendar');
  assert.match(wrap('<p class="eyebrow" id="kind">Camp</p><h1 id="heading">Winter camp</h1><p id="status" role="status">x</p>'), /<main><div class="swa-head"><p class="eyebrow" id="kind">Camp<\/p><h1 id="heading">Winter camp<\/h1><\/div><p id="status"/);
  assert.match(wrap('<header id="heading"><h1>Calendar</h1><p>Choose.</p></header><section>x</section>'), /<main><header id="heading" class="swa-head"><h1>Calendar<\/h1>/);
  assert.match(wrap('<div class="top"><h1>Messages</h1><button id="markAll" hidden>Mark all</button></div><p id="status">x</p>'), /<main><div class="top swa-head"><h1>Messages<\/h1>/);
  assert.equal(wrap('<div class="top"><span class="brand">X</span></div><h1 id="name">Sam</h1>').includes('swa-head'), false, 'a top row without a heading (the dark wrestler page) is left alone');
}
console.log('page head ok');

// Issue #280: the band stays on the public pages only. Every other page opens with a title row: the heading (and the
// back link or eyebrow before it) with the intro's first sentence, any buttons from the heading row as its actions,
// and the rest of a longer intro behind "How this works", word for word.
{
  const {pageHead, bandPage, titleRow, splitSentence} = module.exports;
  for (const p of ['/welcome', '/team', '/calendar', '/login', '/coach-join', '/help', '/help/coach', '/help/owner']) assert.equal(bandPage(p), true, p + ' keeps the band');
  for (const p of ['/family', '/register', '/roster', '/payments', '/coach', '/pass', '/wrestler', '/inbox', '/membership-terms', '/scholarship', '/helpers', '']) assert.equal(bandPage(p), false, p + ' gets the title row');
  const wrap = (h, path = '/roster') => pageHead(`<html><body><main>${h}</main></body></html>`, path);
  assert.equal(wrap('<a href="/">← Back</a><h1>Roster</h1><p class="muted">Who paid.</p><section>x</section>'),
    '<html><body><main><div class="swa-title"><div class="swa-title__text"><a href="/">← Back</a><h1>Roster</h1><p class="muted">Who paid.</p></div></div><section>x</section></main></body></html>', 'one sentence stays in the row');
  assert.equal(wrap('<h1>Payments</h1><p class="muted">Every payment, online and offline. A refund is taken off here; <a href="/financials">Income and expenses</a> books it later. Times are New York time.</p><p id="status" role="status">x</p>', '/payments'),
    '<html><body><main><div class="swa-title"><div class="swa-title__text"><h1>Payments</h1><p class="muted">Every payment, online and offline.</p></div></div>'
    + '<details class="how"><summary>How this works</summary><p>A refund is taken off here; <a href="/financials">Income and expenses</a> books it later. Times are New York time.</p></details><p id="status" role="status">x</p></main></body></html>', 'the rest of the intro folds away, unchanged');
  assert.equal(wrap('<h1>Site health</h1><p id="status" role="status">Loading…</p>', '/site-health'),
    '<html><body><main><div class="swa-title"><div class="swa-title__text"><h1>Site health</h1></div></div><p id="status" role="status">Loading…</p></main></body></html>', 'status lines stay outside');
  assert.match(wrap('<h1>Terms</h1><p class="notice">Draft</p>', '/membership-terms'), /<div class="swa-title"><div class="swa-title__text"><h1>Terms<\/h1><\/div><\/div><p class="notice">/, 'notices stay outside');
  assert.match(wrap('<div class="top"><h1>Messages</h1><button type="button" id="markAll" hidden>Mark all as read</button></div><p id="status">x</p>', '/inbox'),
    /<main><div class="swa-title"><div class="swa-title__text"><h1>Messages<\/h1><\/div><div class="swa-title__actions"><button type="button" id="markAll" hidden>Mark all as read<\/button><\/div><\/div><p id="status">x<\/p>/, 'a heading row\'s button becomes the action');
  assert.match(wrap('<p class="eyebrow" id="kind"></p><h1 id="heading">Book a session</h1><p id="status" role="status">x</p>', '/booking'), /<div class="swa-title__text"><p class="eyebrow" id="kind"><\/p><h1 id="heading">Book a session<\/h1><\/div>/, 'the eyebrow comes along');
  // An intro the page's script fills in (its id is used again in the page) is never split: the script replaces it.
  const dyn = pageHead('<html><body><main><h1>Coach home</h1><p id="intro" class="muted">One. Two. Three.</p></main><script>$(\'intro\').textContent=x</script></body></html>', '/coach');
  assert.match(dyn, /<p id="intro" class="muted">One\. Two\. Three\.<\/p><\/div><\/div><\/main><script>/); assert.doesNotMatch(dyn, /class="how"/);
  // A page that already folds its explanation (USA Wrestling cards' "How checking works") keeps its intro whole.
  const folded = pageHead('<html><body><main><h1>Cards</h1><p class="muted">One. Two.</p><details class="howto"><summary>How checking works</summary><p>x</p></details></main></body></html>', '/cards');
  assert.match(folded, /<p class="muted">One\. Two\.<\/p><\/div><\/div><details class="howto">/); assert.doesNotMatch(folded, /class="how"/);
  // Inside the owner shell no page carries the band, not even the owner guide under /help.
  assert.match(pageHead('<html><body><main><h1>Owner guide</h1><p>Read me.</p></main></body></html>', '/help/owner', {band: false}), /<div class="swa-title">/);
  // The family home's own band and the dark wrestler page's top row are left alone; a heading inside a card too.
  const own = '<html><body><main><div class="fam-hero"><h1>Hi</h1></div></main></body></html>';
  assert.equal(pageHead(own, '/family'), own);
  assert.equal(wrap('<div class="top"><span class="brand">X</span></div><h1 id="name">Sam</h1>', '/wrestler').includes('swa-title'), false);
  const card = '<html><body><main><section class="card"><h1>Welcome back</h1></section></main></body></html>';
  assert.equal(pageHead(card, '/security'), card);
  // A page that writes the band itself (Choose training) gets the title row from the same markup when it is signed in.
  const reg = pageHead('<html><body><main>\n<div class="swa-head"><p class="eyebrow">Savage Wrestling Academy</p><h1>Choose training</h1><p class="lede">One practice or a full year on the mat. Pick your wrestler, a program and how you want to train.</p></div>\n<p class="paynote">x</p></main></body></html>', '/register');
  assert.equal(reg, '<html><body><main>\n<div class="swa-title"><div class="swa-title__text"><p class="eyebrow">Savage Wrestling Academy</p><h1>Choose training</h1><p class="lede">One practice or a full year on the mat.</p></div></div><details class="how"><summary>How this works</summary><p>Pick your wrestler, a program and how you want to train.</p></details>\n<p class="paynote">x</p></main></body></html>');
  assert.doesNotMatch(reg, /swa-head/);
  // The split happens after the first sentence, outside tags, and never inside an abbreviation or a lower-case continuation.
  const split = (s, want) => assert.equal(JSON.stringify(splitSentence(s)), JSON.stringify(want), s);
  split('One thing. Two things.', ['One thing.', 'Two things.']);
  split('Ask <a href="/x">Justin.</a> He decides.', ['Ask <a href="/x">Justin.</a> He decides.', '']);
  split('See the price (it is $40.00). Then pay.', ['See the price (it is $40.00).', 'Then pay.']);
  split('Is it open? Yes, “always”. ok then', ['Is it open?', 'Yes, “always”. ok then']);
  split('Only one sentence here', ['Only one sentence here', '']);
  split('e.g. this, i.e. that. Then more.', ['e.g. this, i.e. that.', 'Then more.']);
  assert.equal(titleRow('<h1>X</h1>'), '<div class="swa-title"><div class="swa-title__text"><h1>X</h1></div></div>');
  // The Worker gives signed-in pages the title row, public ones the band, and both the toast helper (before the stylesheet, which stays last).
  const pay = decoratePage('<html><head></head><body><main><h1>Payments</h1><p>All of them. Every one.</p></main></body></html>', '/payments');
  assert.match(pay, /<main><div class="swa-title"><div class="swa-title__text"><h1>Payments<\/h1><p>All of them\.<\/p><\/div><\/div><details class="how"><summary>How this works<\/summary><p>Every one\.<\/p><\/details>/);
  assert.match(pay, /<script src="\/toast\.js" defer><\/script><link rel="stylesheet" href="\/savage\.css"><\/head>/);
  assert.match(decoratePage('<html><head></head><body><main><h1>Calendar</h1><p>All of them. Every one.</p></main></body></html>', '/calendar'), /<main><div class="swa-head"><h1>Calendar<\/h1><p>All of them\. Every one\.<\/p><\/div>/, 'public pages keep the whole intro in the band');
  assert.ok(existsSync('public/toast.js'));
}
console.log('title row ok');
