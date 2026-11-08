// Issue #274: signed-in pages get a nonce-based script policy. Every page route runs here with a stand-in sign-in and
// goes through the Worker's decoration, as on the site. A page without inline event handlers answers with
// script-src 'nonce-…' 'strict-dynamic', and every <script> on it (the page's own, the owner shell's start-up script,
// its prefetch rules and the shared scripts) carries that nonce. Pages that still use inline handlers are listed in
// PENDING: the list may only shrink, and a page that gains an inline handler fails here. Public pages keep their own
// policies, and every signed-in page carries a Permissions-Policy that allows only the camera, for the pass scanner.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const OWNER = 'savagewrestlingclub@gmail.com';
const users = {
  owner: {id: 'u-owner', email: OWNER, email_confirmed_at: '2026-01-01', factors: [{status: 'verified', factor_type: 'totp'}]},
  coach: {id: 'u-coach', email: 'coach@example.test', email_confirmed_at: '2026-01-01', factors: [{status: 'verified', factor_type: 'totp'}]},
  family: {id: 'u-family', email: 'family@example.test', email_confirmed_at: '2026-01-01', factors: []},
};
let as = 'owner';
const headersFor = () => new Headers({'Cache-Control': 'private, no-store, max-age=0', 'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'", 'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()'});
const auth = {
  securityHeaders: headersFor,
  OWNER_EMAIL: OWNER, appOrigin: () => 'https://academy.test', sameOrigin: () => true, verifiedOwner: u => u?.email === OWNER,
  verifiedAccount: async () => ({user: users[as], headers: headersFor()}),
  strongAccount: async () => ({user: users[as], strong: true, headers: headersFor()}),
  ownerIdentity: async () => ({user: users[as], strong: true, mfaRequired: false, headers: headersFor(), owner: as === 'owner' ? {userId: 'supabase:u-owner', displayName: OWNER} : null}),
};
const access = {accountRole: async () => ({role: as, staff: as === 'coach' ? {email: 'coach@example.test', name: 'Coach', programs: ['Intermediate']} : null}), coachAccess: async () => ({email: 'coach@example.test', name: 'Coach', programs: ['Intermediate'], owner: as === 'owner'})};
const statement = {bind() { return statement; }, all: async () => ({results: []}), first: async () => null, run: async () => ({meta: {changes: 0}}), raw: async () => []};
const DB = {prepare: () => statement, batch: async list => list.map(() => ({results: []}))};
const loaded = new Map();
function load(file) {
  if (loaded.has(file)) return loaded.get(file);
  const module = {exports: {}}; loaded.set(file, module.exports);
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js, {module, exports: module.exports, Response, Request, Headers, URL, URLSearchParams, Intl, Date, JSON, Math, console, crypto, TextEncoder, TextDecoder, Uint8Array, Array, atob, btoa, setTimeout,
    require(name) {
      if (name === 'cloudflare:workers') return {env: {DB, SUPABASE_URL: 'https://abcdefgh.supabase.co', APP_ORIGIN: 'https://academy.test'}};
      if (name.endsWith('/account-auth')) return auth;
      if (name.endsWith('/access-control')) return access;
      if (name.endsWith('?raw')) return {default: readFileSync(join(dirname(file), name.replace('?raw', '')), 'utf8')};
      if (!name.startsWith('.')) throw new Error('unexpected import ' + name);
      return load(join(dirname(file), name) + '.ts');
    }});
  return module.exports;
}
const {decorateResponse, hasInlineHandlers, applyScriptNonce, scriptPolicy, nonceApplies} = load('lib/page-chrome.ts');

async function open(path, who = 'owner') {
  as = who;
  const url = 'https://academy.test' + path, pathname = new URL(url).pathname;
  const route = load(`app${pathname === '/' ? '' : pathname}/route.ts`);
  const request = new Request(url);
  const response = await decorateResponse(request, await route.GET(request));
  return {status: response.status, headers: response.headers, html: response.status === 200 ? await response.text() : ''};
}

// --- The helpers ---
assert.equal(hasInlineHandlers('<button onclick="x()">'), true);
assert.equal(hasInlineHandlers('<p>reason="x" season="y" button="z"</p>'), false, 'attribute names that merely end in "on" are not handlers');
assert.equal(hasInlineHandlers("el.innerHTML='<a onclick=\\\"go()\\\">'"), true, 'handlers built inside scripts count too');
assert.equal(hasInlineHandlers('<a href="javascript:void(0)">'), true);
assert.equal(hasInlineHandlers('<script>el.onclick=fn;x.oninput=g</script>'), false, 'property assignments are fine under the policy');
assert.equal(applyScriptNonce('<script>a</script><script src="/x.js" defer></script><script type="speculationrules">{}</script><script nonce="k">b</script>', 'n1'),
  '<script nonce="n1">a</script><script nonce="n1" src="/x.js" defer></script><script nonce="n1" type="speculationrules">{}</script><script nonce="k">b</script>');
assert.equal(scriptPolicy("base-uri 'self'", 'n1'), "base-uri 'self'; script-src 'nonce-n1' 'strict-dynamic' 'self'");
assert.equal(nonceApplies(new Headers({'Cache-Control': 'public, max-age=20', 'Content-Security-Policy': "base-uri 'self'"}), '<p>'), false, 'a cacheable page never gets a per-response nonce');
assert.equal(nonceApplies(new Headers({'Cache-Control': 'private, no-store', 'Content-Security-Policy': "script-src 'nonce-x'"}), '<p>'), false, 'a page with its own script policy is left alone');
assert.equal(nonceApplies(new Headers({'Cache-Control': 'private, no-store'}), '<p>'), false, 'no policy, no change');

// --- Every signed-in page ---
const PAGES = {
  owner: ['/', '/roster', '/payments', '/messages', '/cards', '/accounts', '/account-setup', '/approvals', '/scholarships', '/waivers', '/consent-forms', '/transfers',
    '/practice-plans?date=2026-11-09&program=Elementary', '/curricula', '/website', '/staff', '/coach-openings?email=coach%40example.test', '/coach-profile?email=coach%40example.test',
    '/contracts', '/lesson-settings', '/timesheets', '/financials', '/coach-pay', '/payment-setup', '/backups', '/site-health', '/data-requests', '/security-log', '/help/owner', '/security'],
  coach: ['/coach', '/coach-time', '/contract', '/help/coach'],
  family: ['/family', '/register', '/booking', '/lesson', '/inbox', '/pass', '/wrestler?id=w1', '/waiver', '/consent', '/scholarship', '/membership-terms'],
};
// Pages that still use inline event handlers (onclick="…"), so they cannot carry the nonce policy yet. Each is a
// follow-up: move its handlers to listeners, as /website, /roster, /practice-plans, /coach and /coach-pay did in #274.
const PENDING = ['/', '/family', '/cards', '/register', '/booking'];
const withNonce = [], without = [];
for (const [who, paths] of Object.entries(PAGES)) {
  for (const path of paths) {
    const {status, headers, html} = await open(path, who);
    assert.equal(status, 200, `${path} as ${who}`);
    assert.equal(headers.get('Permissions-Policy'), 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()', path + ': the camera only, for the pass scanner');
    assert.match(headers.get('Cache-Control') ?? '', /no-store/, path);
    const csp = headers.get('Content-Security-Policy') ?? '', nonce = csp.match(/script-src 'nonce-([0-9a-f]{32})' 'strict-dynamic' 'self'/)?.[1];
    const pathname = path.split('?')[0];
    if (!nonce) { without.push(pathname); assert.ok(hasInlineHandlers(html), path + ': the only reason not to have the policy is an inline handler'); continue; }
    withNonce.push(pathname);
    assert.doesNotMatch(csp, /script-src[^;]*script-src/, path + ': one script-src');
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map(m => m[0]);
    // (The help pages have no scripts at all.)
    for (const tag of scripts) assert.ok(tag.includes(`nonce="${nonce}"`), `${path}: every script carries the nonce: ${tag.slice(0, 80)}`);
    assert.ok(!hasInlineHandlers(html), path + ': no inline handlers under the policy');
    // The nonce is fresh for every response.
    const again = await open(path, who);
    assert.notEqual(again.headers.get('Content-Security-Policy'), csp, path + ': a new nonce each time');
  }
}
assert.deepEqual([...new Set(without)].sort(), [...PENDING].sort(), 'exactly the pending pages lack the policy; remove a page from PENDING once its handlers are listeners, never add one');
assert.ok(withNonce.includes('/website') && withNonce.includes('/roster') && withNonce.includes('/coach') && withNonce.includes('/practice-plans') && withNonce.includes('/coach-pay'), 'the pages converted in #274 have the policy');
assert.ok(withNonce.length >= 35, withNonce.length + ' pages carry the nonce policy');

// --- Public pages keep their own policies and are never given a nonce (they are cacheable) ---
for (const path of ['/calendar', '/welcome', '/team']) {
  const {status, headers} = await open(path, 'family');
  assert.equal(status, 200, path);
  assert.doesNotMatch(headers.get('Content-Security-Policy') ?? '', /nonce-/, path + ' is public and cacheable');
}
// The sign-in and invite pages are public too; they keep the base policy until their handlers move to listeners.
for (const path of ['/login', '/coach-join']) {
  const {status, headers} = await open(path, 'family');
  assert.equal(status, 200, path);
  const csp = headers.get('Content-Security-Policy') ?? '';
  assert.match(csp, /frame-ancestors 'none'/, path);
}
// The website editor shows a preview in a srcdoc iframe, which inherits the page's policy: its scripts get the nonce too.
const site = readFileSync('app/website/screen.html', 'utf8');
assert.match(site, /const NONCE=document\.currentScript\?\.nonce\|\|''/); assert.match(site, /srcdoc=withNonce\(d\.html\)/);
console.log(`CSP nonce: ${withNonce.length} signed-in pages carry script-src 'nonce-…' 'strict-dynamic' with every script nonced; ${PENDING.length} pages pending their inline handlers; Permissions-Policy everywhere`);
