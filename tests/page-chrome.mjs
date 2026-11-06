// Issue #129: every page gets the shared stylesheet, icons and the same top bar; some pages are deliberately left alone.
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const module = {exports: {}};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/page-chrome.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
  {module, exports: module.exports, URL, Headers, Response, Request});
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

// Issue #146: a page's opening back link, heading and intro move into the black header band.
{
  const {pageHead} = module.exports;
  const wrap = h => pageHead(`<html><body><main>${h}</main></body></html>`);
  assert.equal(wrap('<a href="/">← Back</a><h1>Roster</h1><p class="muted">Who paid.</p><section>x</section>'),
    '<html><body><main><div class="swa-head"><a href="/">← Back</a><h1>Roster</h1><p class="muted">Who paid.</p></div><section>x</section></main></body></html>');
  assert.equal(wrap('<h1>Site health</h1><p id="status" role="status">Loading…</p>'),
    '<html><body><main><div class="swa-head"><h1>Site health</h1></div><p id="status" role="status">Loading…</p></main></body></html>', 'status lines stay outside');
  assert.match(wrap('<h1>Terms</h1><p class="notice">Draft</p>'), /<div class="swa-head"><h1>Terms<\/h1><\/div><p class="notice">/, 'notices stay outside');
  assert.match(wrap('<h1>Pay <b>now</b></h1><p>Intro with <a href="/x">a link</a>.</p><p>Second</p>'), /<div class="swa-head"><h1>Pay <b>now<\/b><\/h1><p>Intro with <a href="\/x">a link<\/a>.<\/p><\/div><p>Second/);
  const own = '<html><body><div class="fam-hero"></div><main><h1>Hi</h1></main></body></html>';
  assert.equal(pageHead(own), own, 'pages with their own header are left alone');
  const card = '<html><body><main><section class="card"><h1>Welcome back</h1></section></main></body></html>';
  assert.equal(pageHead(card), card, 'a heading inside a card is not moved');
  assert.match(decoratePage('<html><head></head><body><main><h1>Payments</h1><p>All of them.</p></main></body></html>', '/payments'), /<main><div class="swa-head"><h1>Payments<\/h1><p>All of them.<\/p><\/div>/);
}
// Issue #157: an eyebrow line before the heading, the calendar header and the Messages heading row.
{
  const {pageHead} = module.exports;
  const wrap = h => pageHead(`<html><body><main>${h}</main></body></html>`);
  assert.match(wrap('<p class="eyebrow" id="kind">Camp</p><h1 id="heading">Winter camp</h1><p id="status" role="status">x</p>'), /<main><div class="swa-head"><p class="eyebrow" id="kind">Camp<\/p><h1 id="heading">Winter camp<\/h1><\/div><p id="status"/);
  assert.match(wrap('<header id="heading"><h1>Calendar</h1><p>Choose.</p></header><section>x</section>'), /<main><header id="heading" class="swa-head"><h1>Calendar<\/h1>/);
  assert.match(wrap('<div class="top"><h1>Messages</h1><button id="markAll" hidden>Mark all</button></div><p id="status">x</p>'), /<main><div class="top swa-head"><h1>Messages<\/h1>/);
  assert.equal(wrap('<div class="top"><span class="brand">X</span></div><h1 id="name">Sam</h1>').includes('swa-head'), false, 'a top row without a heading (the dark wrestler page) is left alone');
}
console.log('page head ok');
