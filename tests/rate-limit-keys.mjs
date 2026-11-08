// Issue #274: sign-out and password changes are limited per signed-in account, never under one shared key, so ten
// anonymous requests a minute cannot block everyone's sign-out (the audit's reproduction). Each sign-in action has its
// own counters, the per-email sign-in limit backs off over an hour, and the coach-invite "mine" counter is per person.
import assert from 'node:assert/strict';
import {load, DB, sqlite} from './accounts.mjs';
const auth = load('app/api/auth/route.ts');
let counter = 0;
const req = (body, session = '', ip) => new Request('https://academy.test/api/auth', {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://academy.test',
  'cf-connecting-ip': ip ?? ('203.0.113.' + (++counter % 250)), cookie: session ? 'test-session=' + session : ''}, body: JSON.stringify(body)});
sqlite.prepare('DELETE FROM auth_attempts').run();

// Attacker: eleven anonymous sign-outs from different addresses within the same minute.
let last;
for (let i = 0; i < 11; i++) last = (await auth.POST(req({action: 'logout'}))).status;
assert.equal(last, 200, 'anonymous sign-outs from different addresses are counted per address, not under one key');
// Victim: a real signed-in person from another address signs out and changes a password as usual.
assert.equal((await auth.POST(req({action: 'logout'}, 'alice', '198.51.100.7'))).status, 200, 'the victim can still sign out');
const change = await auth.POST(req({action: 'change', password: 'a-long-enough-password'}, 'alice', '198.51.100.8'));
assert.equal(change.status, 200, 'and change a password: ' + await change.text());
// Two signed-in people never share a counter: one person's eleventh sign-out blocks only them.
for (let i = 0; i < 11; i++) last = (await auth.POST(req({action: 'logout'}, 'bob', '198.51.100.9'))).status;
assert.equal(last, 429, 'the eleventh in a minute for one account is refused');
assert.equal((await auth.POST(req({action: 'logout'}, 'alice', '198.51.100.9'))).status, 200, 'another account from the same address is not');
const keys = sqlite.prepare('SELECT count(*) AS n FROM auth_attempts').get().n;
assert.ok(keys > 12, 'separate rows per account and address, not one shared counter: ' + keys);

// Sign-in has its own counters: ten tries per email a minute, and resets are not used up by sign-in attempts.
sqlite.prepare('DELETE FROM auth_attempts').run();
for (let i = 0; i < 11; i++) last = (await auth.POST(req({action: 'login', email: 'victim@example.test', password: 'wrong-password'}, '', '203.0.113.200'))).status;
assert.equal(last, 429, 'the eleventh sign-in attempt for one email in a minute is refused');
assert.equal((await auth.POST(req({action: 'reset', email: 'victim@example.test'}, '', '203.0.113.200'))).status, 200, 'a password reset for that email still goes through');
assert.equal((await auth.POST(req({action: 'resend', email: 'victim@example.test'}, '', '203.0.113.200'))).status, 200, 'so does a confirmation email');
// A shared network (the academy WiFi) gets 30 sign-ins a minute, so eleven families signing in do not block the twelfth.
sqlite.prepare('DELETE FROM auth_attempts').run();
for (let i = 0; i < 25; i++) last = (await auth.POST(req({action: 'login', email: `family${i}@example.test`, password: 'wrong-password'}, '', '203.0.113.201'))).status;
assert.equal(last, 401, '25 different families on one address are all answered');
for (let i = 25; i < 32; i++) last = (await auth.POST(req({action: 'login', email: `family${i}@example.test`, password: 'wrong-password'}, '', '203.0.113.201'))).status;
assert.equal(last, 429, 'but one address cannot try more than 30 accounts a minute');
// Back-off: the per-email limit also counts over an hour, so a burst every minute runs out after 30 tries.
sqlite.prepare('DELETE FROM auth_attempts').run();
const hourRows = () => sqlite.prepare('SELECT count(*) AS n FROM auth_attempts WHERE bucket % 60 = 0').get().n;
await auth.POST(req({action: 'login', email: 'slow@example.test', password: 'wrong-password'}, '', '203.0.113.202'));
assert.ok(hourRows() >= 1, 'an hourly counter is kept for the email');
const hourly = sqlite.prepare("SELECT id FROM auth_attempts WHERE bucket % 60 = 0").all();
for (const r of hourly) sqlite.prepare('UPDATE auth_attempts SET count=30 WHERE id=?').run(r.id);
assert.equal((await auth.POST(req({action: 'login', email: 'slow@example.test', password: 'wrong-password'}, '', '203.0.113.203'))).status, 429, 'past 30 an hour, the email waits for the hour even from a new address and a new minute');
assert.equal((await auth.POST(req({action: 'login', email: 'other@example.test', password: 'wrong-password'}, '', '203.0.113.203'))).status, 401, 'other emails are unaffected');

// One answer for a wrong password and an unconfirmed email (issue #274).
const src = (await import('node:fs')).readFileSync('app/api/auth/route.ts', 'utf8');
assert.match(src, /error\?\.code==='email_not_confirmed'\|\|error\?\.code==='invalid_credentials'\)return reply\(\{error:LOGIN_FAILED\}/);
assert.doesNotMatch(src, /Confirm your email before signing in/);

// The coach-invite "mine" counter is per signed-in person (issue #274), not one for the whole site.
const invite = load('app/api/coach-invite/route.ts');
sqlite.prepare('DELETE FROM auth_attempts').run();
const check = (session, ip) => invite.POST(new Request('https://academy.test/api/coach-invite', {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://academy.test', 'cf-connecting-ip': ip, cookie: 'test-session=' + session}, body: JSON.stringify({action: 'check'})}));
for (let i = 0; i < 21; i++) last = (await check('bob', '198.51.100.' + (i % 5))).status;
assert.equal(last, 429, 'one person checking 21 times a minute is slowed');
assert.notEqual((await check('alice', '198.51.100.1')).status, 429, 'another person is not');
assert.ok(sqlite.prepare("SELECT count(*) AS n FROM auth_attempts").get().n >= 3, 'per-person rows');

// lib/rate-limit.ts does its work in one D1 round trip (issue #274): one batch per call.
let batches = 0, singles = 0;
const rl = load('lib/rate-limit.ts');
// The module reads env.DB from cloudflare:workers; swap the DB methods in place to count.
const realPrepare = DB.prepare, realBatch = DB.batch;
DB.prepare = (...a) => { const s = realPrepare.call(DB, ...a); const first = s.first.bind(s), run = s.run.bind(s); s.first = (...x) => { singles++; return first(...x); }; s.run = (...x) => { singles++; return run(...x); }; return s; };
DB.batch = (...a) => { batches++; return realBatch.call(DB, ...a); };
await rl.rateLimited(new Request('https://a.test/x', {headers: {'cf-connecting-ip': '192.0.2.1'}}), 'thing:p', 5, {hourly: 20});
DB.prepare = realPrepare; DB.batch = realBatch;
assert.equal(batches, 1, 'one batch'); assert.equal(singles, 0, 'no single queries');
console.log('Rate-limit keys: sign-out and password change per account, sign-in actions apart with address and hourly limits, coach-invite per person, one round trip');
