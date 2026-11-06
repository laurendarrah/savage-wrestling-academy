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
assert.match(out, /<body class="a"><header class="swa-bar">/, 'top bar comes first in the body');
assert.match(out, /href="\/brand\/favicon-32.png"/);
assert.equal(decoratePage(out, '/register'), out, 'decorating twice changes nothing');
assert.match(topBar('/calendar'), /href="\/calendar" aria-current="page">Calendar/);
assert.match(topBar('/family'), /href="\/" aria-current="page">Home/, 'a home page marks Home as current');
assert.doesNotMatch(topBar('/register'), /aria-current/);

const u = p => new URL('https://x.test' + p);
assert.equal(shouldDecorate(u('/family'), 'text/html; charset=utf-8'), true);
for (const p of ['/', '/waiver-copy', '/scholarship-agreement', '/attendance-demo', '/api/family', '/calendar?embed=1']) assert.equal(shouldDecorate(u(p), 'text/html'), false, p);
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
