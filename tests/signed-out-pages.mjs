// Issue #373: a signed-in page opened by a signed-out visitor sends them to the sign-in page, never a bare line of
// text. A coach page opened with another kind of account says who the page is for, in the academy's look, as a 403
// that sends nothing from the page asked for. Runs the real routes with the Supabase stand-in from tests/accounts.mjs.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {load, request} from './accounts.mjs';

const pages = load('lib/protected-page.ts');
const where = r => [r.status, r.headers.get('location')];
const open = (route, path, who) => route.GET(request(path, 'GET', null, who));

// ---------- Coach pages ----------
for (const opts of [{}, {ownerWithoutCoach: true}, {ownerShell: true}]) {
  assert.deepEqual(where(await pages.coachPage(request('/coach', 'GET', null, ''), '<p>coach home</p>', opts)), [303, '/login'], 'signed out: the sign-in page');
  const r = await pages.coachPage(request('/coach', 'GET', null, 'alice'), '<p>coach home</p>', opts), html = await r.text();
  assert.deepEqual([r.status, r.headers.get('location'), r.headers.get('content-type')], [403, null, 'text/html; charset=utf-8'], 'a family account: still refused');
  assert.match(html, /<title>Not your page \| Savage Wrestling Academy<\/title>/); assert.match(html, /<h1>This page is for coaches<\/h1>/);
  assert.match(html, /<a class="button primary" href="\/">Go to the home page<\/a><a class="button" href="\/security">See who is signed in<\/a>/, 'two ways on');
  assert.ok(!html.includes('coach home'), 'nothing from the page asked for is sent');
  assert.match(r.headers.get('cache-control'), /no-store/);
}

// ---------- Practice plans: coaches and the owner ----------
const plans = load('app/practice-plans/route.ts');
assert.deepEqual(where(await open(plans, '/practice-plans', '')), [303, '/login']);
{
  const r = await open(plans, '/practice-plans', 'alice'), html = await r.text();
  assert.equal(r.status, 403); assert.match(html, /<h1>This page is for coaches and the owner<\/h1>/); assert.ok(html.length < 2000, 'the plans page itself is not sent');
}

// ---------- Owner pages that check for themselves: the sign-in page, as on every other owner page ----------
for (const [file, path] of [['app/approvals/route.ts', '/approvals'], ['app/account-setup/route.ts', '/account-setup'], ['app/accounts/route.ts', '/accounts'], ['app/security-log/route.ts', '/security-log']]) {
  const route = load(file);
  for (const who of ['', 'alice']) { const r = await open(route, path, who); assert.deepEqual(where(r), [303, '/login'], path + ' as ' + (who || 'nobody')); assert.equal(await r.text(), ''); }
  assert.equal((await open(route, path, 'owner')).status, 200, path + ' still opens for the owner');
}
// A signed copy of a waiver or a scholarship agreement, opened signed out (a link kept from an email or a bookmark).
for (const [file, path] of [['app/waiver-copy/route.ts', '/waiver-copy?id=abc'], ['app/scholarship-agreement/route.ts', '/scholarship-agreement?id=abc']]) assert.deepEqual(where(await open(load(file), path, '')), [303, '/login'], path);
for (const who of ['', 'alice']) assert.deepEqual(where(await pages.ownerPage(request('/timesheets', 'GET', null, who), '<p>owner</p>')), [303, '/login'], 'the shared owner check does the same');

// ---------- No page answers with a bare line of text ----------
const routes = []; (function walk(dir) { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) { if (p !== join('app', 'api')) walk(p); } else if (name === 'route.ts') routes.push(p); } })('app');
assert.ok(routes.length > 40, 'found the page routes');
for (const f of [...routes, 'lib/protected-page.ts']) assert.doesNotMatch(readFileSync(f, 'utf8'), /new Response\((['"`])[^<'"`][^'"`]*\1,\s*\{\s*status:\s*40[13]/, f + ' answers a page with plain text');
console.log('Passed: coach pages, practice plans and the owner pages that check for themselves and signed document copies send a signed-out visitor to the sign-in page; a coach page opened with a family account says who it is for as a 403 and sends nothing from the page; no page answers with a bare line of text.');
