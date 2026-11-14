// Issue #347 (Lauren, Nov 14: "We never want to turn on the 2fa. At all."), on top of #306. A confirmed email and a
// password is the whole sign-in, for the owner, coaches and families, always:
//   - an account that still has a verified authenticator saved in Supabase is treated like any other account;
//   - the old Worker setting STAFF_MFA changes nothing, because nothing reads it;
//   - /api/security sets nothing up and checks no code;
//   - no page, email or message mentions a second step.
// The routes run for real against the stand-in Supabase client from tests/accounts.mjs. That client has no factor
// calls at all, and every session token is a password one (aal1), so any leftover check would fail here.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {load, request, sqlite, users, env} from './accounts.mjs';

const leftover = id => [{id, status: 'verified', factor_type: 'totp', friendly_name: 'Phone'}];
users.owner.factors = leftover('f-owner');
users.dana = {id: 'dana-uuid', email: 'dana.coach@example.test', email_confirmed_at: '2026-10-15', factors: leftover('f-dana')};
users.pat = {id: 'pat-uuid', email: 'pat@example.test', email_confirmed_at: '2026-10-15', factors: leftover('f-pat')};
users.unconfirmed = {id: 'new-uuid', email: 'new@example.test', factors: leftover('f-new')};
sqlite.prepare('INSERT INTO staff_access VALUES (?,?,?,?,?)').run('dana.coach@example.test', 'Coach Dana', '["Intermediate"]', 1, '2026-11-01');

const auth = load('app/api/auth/route.ts'), security = load('app/api/security/route.ts');
const page = async (file, path, who) => { const r = await load(file).GET(request(path, 'GET', null, who)); return [r.status, r.headers.get('location')]; };
const api = async (file, path, who) => (await load(file).GET(request(path, 'GET', null, who))).status;

for (const setting of [undefined, 'on', 'off']) {
  if (setting === undefined) delete env.STAFF_MFA; else env.STAFF_MFA = setting;
  const why = 'STAFF_MFA=' + setting;

  // Signing in goes straight home. Nobody is sent to /security.
  for (const [who, home] of [['owner', '/'], ['dana', '/coach'], ['pat', '/family']]) {
    const r = await auth.POST(request('/api/auth', 'POST', {action: 'login', email: users[who].email, password: 'valid-password'}));
    assert.equal(r.status, 200, why); assert.equal((await r.json()).redirect, home, who + ' ' + why);
  }

  // The owner: the dashboard, owner pages, owner APIs, the roster.
  assert.deepEqual(await page('app/route.ts', '/', 'owner'), [200, null], why);
  assert.deepEqual(await page('app/payment-setup/route.ts', '/payment-setup', 'owner'), [200, null], why);
  assert.deepEqual(await page('app/roster/route.ts', '/roster', 'owner'), [200, null], why);
  assert.deepEqual(await page('app/security/route.ts', '/security', 'owner'), [200, null], why);
  for (const [file, path] of [['app/api/academy/route.ts', '/api/academy'], ['app/api/staff/route.ts', '/api/staff'], ['app/api/launch-checklist/route.ts', '/api/launch-checklist'], ['app/api/roster/route.ts', '/api/roster']])
    assert.equal(await api(file, path, 'owner'), 200, path + ' ' + why);

  // A coach: coach home, the roster, practice plans. Never the owner's pages.
  assert.deepEqual(await page('app/coach/route.ts', '/coach', 'dana'), [200, null], why);
  assert.deepEqual(await page('app/roster/route.ts', '/roster', 'dana'), [200, null], why);
  assert.deepEqual(await page('app/practice-plans/route.ts', '/practice-plans', 'dana'), [200, null], why);
  assert.deepEqual(await page('app/route.ts', '/', 'dana'), [303, '/coach'], why);
  for (const [file, path] of [['app/api/coach/route.ts', '/api/coach'], ['app/api/roster/route.ts', '/api/roster'], ['app/api/practice-plans/route.ts', '/api/practice-plans']])
    assert.equal(await api(file, path, 'dana'), 200, path + ' ' + why);
  assert.equal(await api('app/api/academy/route.ts', '/api/academy', 'dana'), 403, 'a coach is still not the owner');

  // A family: the family home, the waiver and consent pages, the family APIs.
  for (const [file, path] of [['app/family/route.ts', '/family'], ['app/waiver/route.ts', '/waiver'], ['app/consent/route.ts', '/consent'], ['app/register/route.ts', '/register'], ['app/booking/route.ts', '/booking'],
    ['app/lesson/route.ts', '/lesson'], ['app/pass/route.ts', '/pass'], ['app/inbox/route.ts', '/inbox'], ['app/security/route.ts', '/security']])
    assert.deepEqual(await page(file, path, 'pat'), [200, null], path + ' ' + why);
  assert.deepEqual(await page('app/route.ts', '/', 'pat'), [303, '/family'], why);
  for (const [file, path] of [['app/api/family/route.ts', '/api/family'], ['app/api/orders/route.ts', '/api/orders'], ['app/api/inbox/route.ts', '/api/inbox'], ['app/api/passes/route.ts', '/api/passes']])
    assert.equal(await api(file, path, 'pat'), 200, path + ' ' + why);
  assert.equal(await api('app/api/roster/route.ts', '/api/roster', 'pat'), 403, 'a family is still not staff');

  // Changing a password needs the session and nothing else.
  for (const who of ['owner', 'dana', 'pat']) {
    const r = await auth.POST(request('/api/auth', 'POST', {action: 'change', password: 'a-new-long-password'}, who));
    assert.equal(r.status, 200, who + ' ' + why); assert.match((await r.json()).message, /Password updated/);
  }

  // What stays: a confirmed email, a session, and the owner email check.
  assert.deepEqual(await page('app/family/route.ts', '/family', 'unconfirmed'), [303, '/login'], why);
  assert.deepEqual(await page('app/family/route.ts', '/family', ''), [303, '/login'], why);
  assert.deepEqual(await page('app/payment-setup/route.ts', '/payment-setup', 'pat'), [303, '/login'], 'owner pages send everyone else to sign in');
  assert.equal(await api('app/api/academy/route.ts', '/api/academy', 'unverified'), 403, 'the owner email without a confirmed email is not the owner');
  assert.equal((await auth.POST(request('/api/auth', 'POST', {action: 'login', email: users.pat.email, password: 'wrong'}))).status, 401);
}
delete env.STAFF_MFA;

// ---------- /api/security: who is signed in and where home is; nothing to enroll or verify ----------
{
  for (const [who, role, destination] of [['owner', 'owner', '/'], ['dana', 'coach', '/coach'], ['pat', 'family', '/family']]) {
    const r = await security.GET(request('/api/security', 'GET', null, who));
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), {email: users[who].email, role, destination}, 'no factors, no "required", no level');
  }
  assert.equal((await security.GET(request('/api/security'))).status, 401);
  assert.equal((await security.GET(request('/api/security', 'GET', null, 'unconfirmed'))).status, 401);
  const before = sqlite.prepare('SELECT count(*) AS n FROM security_events').get().n;
  for (const body of [{action: 'enroll'}, {action: 'verify', factorId: 'f-pat', code: '123456'}, {action: 'anything'}]) {
    const r = await security.POST(request('/api/security', 'POST', body, 'pat'));
    assert.equal(r.status, 410); const said = (await r.json()).error;
    assert.equal(said, 'This page has changed. Reload it to continue: your email and password are all you need to sign in.');
  }
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM security_events').get().n, before, 'nothing is recorded');
  assert.deepEqual(users.pat.factors, leftover('f-pat'), 'and nothing on the account is touched');
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM security_events WHERE action='mfa_verified'").get().n, 0);
}

// ---------- The code: no setting, no factor calls, no second level ----------
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const code = [...walk('app'), ...walk('lib'), ...walk('build')].filter(p => /\.(ts|tsx)$/.test(p));
assert.ok(code.length > 150, 'the scan found the code');
assert.ok(!existsSync('lib/mfa-policy.ts'), 'the policy file is gone');
for (const file of code) {
  const text = readFileSync(file, 'utf8');
  assert.doesNotMatch(text, /STAFF_MFA/, file + ' reads the old setting');
  assert.doesNotMatch(text, /\.mfa\b|listFactors|challengeAndVerify|getAuthenticatorAssuranceLevel|\.factors\b|aal2|\baal\b|mfaRequired|strongAccount|\.strong\b/, file + ' still has second-step plumbing');
  assert.doesNotMatch(text, /'Location', ?'\/security(\?|')|redirect: ?'\/security'/, file + ' still sends someone to /security');
}
for (const file of ['.env.example', 'wrangler.jsonc', 'wrangler.toml', '.github/workflows/deploy.yml'].filter(existsSync)) assert.doesNotMatch(readFileSync(file, 'utf8'), /STAFF_MFA/, file);
// The one trace kept on purpose: old Security activity rows still read (lib/security-log.ts); nothing writes them.
assert.match(readFileSync('lib/security-log.ts', 'utf8'), /mfa_verified: 'Sign-in code verified \(no longer used\)'/);
assert.equal(code.filter(f => /securityEvent\([^)]*mfa_verified/.test(readFileSync(f, 'utf8'))).length, 0);

// ---------- The Account security page: who is signed in, Change password, a tip, the way back ----------
const html = readFileSync('app/security/screen.html', 'utf8');
{
  assert.match(html, /<title>Account security \| Savage Wrestling Academy LLC<\/title>/); assert.match(html, /<h1>Account security<\/h1>/);
  assert.match(html, /<a id="change" class="button primary" href="\/login\?mode=change">Change password<\/a>/);
  assert.match(html, /Use a password you don’t use anywhere else\./);
  assert.doesNotMatch(html, /<form|<input|<select|<img|<button|method:'POST'|action:/, 'nothing to fill in, scan or submit');
  assert.doesNotMatch(html, /authenticator|verif|\bcode\b|six-digit|QR|factor|enroll|phone/i);

  const open = async (state, back = '', status = 200) => {
    const nodes = new Map(), cleared = [];
    const el = id => { if (!nodes.has(id)) nodes.set(id, {id, hidden: id === 'signedIn' || id === 'continue' || id === 'ownerTools', textContent: id === 'status' ? 'Loading your account…' : '', href: ''}); return nodes.get(id); };
    const calls = [];
    const ctx = vm.createContext({console, Error, document: {getElementById: el}, SavageReturn: {peek: () => back, clear: () => cleared.push(1)},
      fetch: async (url, init) => { calls.push([url, init?.method ?? 'GET']); return {ok: status < 400, status, json: async () => state}; }});
    ctx.globalThis = ctx;
    for (const [, js] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(js, ctx);
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    return {el, calls, cleared};
  };
  for (const [role, destination, label] of [['owner', '/', 'Back to the owner dashboard'], ['coach', '/coach', 'Back to coach home'], ['family', '/family', 'Back to your family account']]) {
    const {el, calls} = await open({email: 'pat@example.test', role, destination});
    assert.deepEqual(calls, [['/api/security', 'GET']], 'one read, nothing posted');
    assert.equal(el('identity').textContent, 'pat@example.test'); assert.equal(el('signedIn').hidden, false);
    assert.equal(el('home').href, destination); assert.equal(el('home').textContent, label);
    assert.equal(el('continue').hidden, true, 'no "continue" without a sign-up to go back to');
    assert.equal(el('ownerTools').hidden, role !== 'owner'); assert.equal(el('status').textContent, '');
  }
  // Someone who came here in the middle of signing up can go back to it (public/registration-return.js).
  const mid = await open({email: 'pat@example.test', role: 'family', destination: '/family'}, '/register?program=Advanced');
  assert.equal(mid.el('continue').hidden, false); assert.equal(mid.el('continue').href, '/register?program=Advanced');
  assert.equal(mid.el('home').href, '/family', 'home is still offered');
  mid.el('continue').onclick(); assert.equal(mid.cleared.length, 1, 'and the saved place is used once');
  // Old account data in the answer changes nothing on the page.
  const old = await open({email: 'pat@example.test', role: 'family', destination: '/family', strong: false, required: true, factors: [{id: 'f', name: 'Phone'}]});
  assert.equal(old.el('home').href, '/family'); assert.equal(old.el('status').textContent, '');
  // A failed load says so and leaves the way back to sign in.
  const failed = await open({error: 'Sign in with your email and password first.'}, '', 401);
  assert.equal(failed.el('status').textContent, 'Sign in with your email and password first.'); assert.equal(failed.el('signedIn').hidden, true);
}

// ---------- The pages around it ----------
{
  const login = readFileSync('app/login/screen.html', 'utf8');
  assert.match(login, /if\(body\.redirect\)\{location\.assign\(globalThis\.SavageReturn\?\.take\(\)\|\|body\.redirect\);return\}/, 'sign-in goes to the saved place or home, with no stop on the way');
  const join = readFileSync('app/coach-join/screen.html', 'utf8');
  assert.match(join, /say\('Coach access added\. Opening coach home…'\);location\.assign\(r\.redirect\)/);
  assert.match(readFileSync('lib/coach-invites.ts', 'utf8'), /Open this link to create your coach account \(or sign in with \$\{row\.email\}\):\\n/);
  // The menus that link to Account security still do.
  assert.match(readFileSync('app/family/screen.html', 'utf8'), /<a href="\/security">Account security<\/a><a href="\/login\?mode=change">Change password<\/a>/);
  assert.match(readFileSync('app/coach/screen.html', 'utf8'), /<a href="\/security">Account security<\/a>/);
  assert.match(readFileSync('lib/owner-shell.ts', 'utf8'), /href="\/security"\$\{pathname === '\/security' \? ' aria-current="page"' : ''\}>Account security<\/a>/);
  assert.doesNotMatch(readFileSync('app/portal.html', 'utf8'), /href="\/security">Verify/);
}

console.log('Passed: a password is the whole sign-in for the owner, coaches and families, with or without something left on the account in Supabase and whatever STAFF_MFA says; /api/security sets nothing up; the Account security page shows who is signed in, Change password and the way back.');
