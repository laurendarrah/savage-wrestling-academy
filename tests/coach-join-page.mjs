// Issue #384: the coach invite page after the account is created. The confirmation email often opens in a different
// app or browser from the invite link, where the site cannot sign the coach in. So the invite page itself carries the
// way forward: confirm the email, come back, sign in, and coach access is added. The page script runs in a fake DOM
// (inline JavaScript is not typechecked).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('app/coach-join/screen.html', 'utf8');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
const TOKEN = 'a'.repeat(64), EMAIL = 'new.coach@example.test';
const openInvite = {name: 'Coach Riley', email: EMAIL, programs: ['Intermediate'], expiresAt: '2026-11-27T17:00:00.000Z', status: 'open'};
const reply = (body, status = 200) => ({ok: status < 400, status, json: async () => body});

// One visit to the invite link. `answers` maps an action to the reply the server gives; every request is recorded.
function visit({store = {}, storage = 'ok', signedIn = null, invite = openInvite, answers = {}} = {}) {
  const nodes = new Map(), sent = [], went = [];
  const el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, disabled: false, innerHTML: '', textContent: '', className: '', focused: 0, focus() { this.focused++; }}); return nodes.get(id); };
  for (const id of ['details', 'acceptBox', 'otherBox', 'signupForm', 'signinForm', 'signinBox', 'resendConfirm']) el(id).hidden = true;   // as the markup has them
  const localStorage = storage === 'blocked' ? {getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }} : {getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }};
  const fetch = async (url, init) => { const body = JSON.parse(init.body); sent.push([url, body]);
    if (url === '/api/coach-invite' && body.action === 'check') return reply({invite, signedIn});
    return answers[body.action] ?? reply({ok: true, redirect: '/coach', message: 'ok'}); };
  const ctx = vm.createContext({document: {getElementById: el}, location: {hash: '#invite=' + TOKEN, assign: to => went.push(to), reload: () => went.push('reload')}, localStorage, fetch, URLSearchParams, Date, JSON, Promise, Error, String, console});
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  const submit = async id => { await el(id).onsubmit({preventDefault() {}}); await settle(); };
  const shown = () => ['acceptBox', 'otherBox', 'signupForm', 'signinForm'].filter(id => !el(id).hidden);
  const step = () => ['step1', 'step2', 'step3', 'step4'].map(id => el(id).className).join(',');
  return {el, sent, went, store, submit, shown, step};
}

// ---------- A first visit: create the account, then the page shows what to do next ----------
{
  const v = visit(); await settle();
  assert.deepEqual(v.shown(), ['signupForm']); assert.equal(v.step(), 'on,,,'); assert.equal(v.el('intro').textContent, 'Welcome, Coach Riley. Create your coach account to get started.');
  assert.deepEqual([v.el('signupEmail').value, v.el('signinEmail').value], [EMAIL, EMAIL]);
  v.el('signupPassword').value = 'correct horse battery'; v.el('signupConfirm').value = 'different words here';
  await v.submit('signupForm'); assert.equal(v.el('message').textContent, 'The passwords do not match.'); assert.equal(v.sent.length, 1, 'nothing is sent');
  v.el('signupConfirm').value = 'correct horse battery'; await v.submit('signupForm');
  assert.deepEqual(v.sent.at(-1), ['/api/auth', {action: 'signup', email: EMAIL, password: 'correct horse battery'}]);
  // Step 2 is not a dead end: the sign-in form is right there, with what to do.
  assert.deepEqual(v.shown(), ['signinForm']); assert.equal(v.step(), 'done,on,,'); assert.equal(v.el('intro').textContent, 'Your account is created, Coach Riley. One step left.');
  assert.equal(v.el('signinIntro').textContent, `Open the confirmation email we sent to ${EMAIL} and tap the button in it. It brings you to the last step. If it does not, come back to this page and sign in with the password you just made.`);
  assert.equal(v.el('message').textContent, `Account created. Check ${EMAIL} for the confirmation email.`);
  assert.deepEqual([v.el('resendConfirm').hidden, v.el('toSignup').hidden], [false, true], 'offers the email again, not a second account');
  assert.deepEqual([v.el('signupPassword').value, v.el('signupConfirm').value], ['', ''], 'the password does not stay on the page');
  assert.deepEqual(v.store, {'swa-coach-join-started': EMAIL}, 'this device remembers the account was created here, and nothing else');
  // Signing in before the email is confirmed: the server's words are shown and the form stays.
  v.el('signinPassword').value = 'correct horse battery';
  const notYet = visit({store: {...v.store}, answers: {login: reply({error: 'Email or password is incorrect. If you just signed up, confirm your email first.'}, 401)}}); await settle();
  notYet.el('signinPassword').value = 'correct horse battery'; await notYet.submit('signinForm');
  assert.equal(notYet.el('message').textContent, 'Email or password is incorrect. If you just signed up, confirm your email first.'); assert.deepEqual(notYet.shown(), ['signinForm']); assert.deepEqual(notYet.went, []); assert.equal(notYet.el('signinButton').disabled, false);
  // After confirming (in any app or browser), signing in here accepts the invite and opens coach home.
  await v.submit('signinForm');
  assert.deepEqual(v.sent.slice(-2), [['/api/auth', {action: 'login', email: EMAIL, password: 'correct horse battery'}], ['/api/coach-invite', {action: 'accept', token: TOKEN}]]);
  assert.deepEqual(v.went, ['/coach']); assert.equal(v.el('message').textContent, 'Coach access added. Opening coach home…');
}

// ---------- Coming back to the invite link on the same device: sign in, not "create your account" again ----------
{
  const v = visit({store: {'swa-coach-join-started': EMAIL}}); await settle();
  assert.deepEqual(v.shown(), ['signinForm']); assert.equal(v.step(), 'done,on,,'); assert.equal(v.el('intro').textContent, 'Welcome back, Coach Riley.');
  assert.match(v.el('signinIntro').textContent, /^Open the confirmation email we sent to new\.coach@example\.test/); assert.equal(v.el('resendConfirm').hidden, false);
  // The email can be sent again from here.
  await v.el('resendConfirm').onclick(); await settle();
  assert.deepEqual(v.sent.at(-1), ['/api/auth', {action: 'resend', email: EMAIL}]); assert.equal(v.el('message').textContent, 'ok'); assert.equal(v.el('resendConfirm').disabled, false);
  const limited = visit({store: {'swa-coach-join-started': EMAIL}, answers: {resend: reply({error: 'Email sending is temporarily limited. A new confirmation email could not be sent. Please try again later.'}, 429)}}); await settle();
  await limited.el('resendConfirm').onclick(); await settle(); assert.match(limited.el('message').textContent, /^Email sending is temporarily limited/);
}
// A different invite, a device that never started, and a browser that refuses storage all begin at the first step.
for (const opts of [{store: {'swa-coach-join-started': 'someone.else@example.test'}}, {}, {storage: 'blocked'}]) {
  const v = visit(opts); await settle();
  assert.deepEqual(v.shown(), ['signupForm']); assert.equal(v.step(), 'on,,,');
  if (opts.storage === 'blocked') { v.el('signupPassword').value = v.el('signupConfirm').value = 'correct horse battery'; await v.submit('signupForm'); assert.deepEqual(v.shown(), ['signinForm'], 'the next step still shows when storage is refused'); }
}

// ---------- Someone who already has an account with the invited email ----------
{
  const v = visit(); await settle();
  v.el('toSignin').onclick();
  assert.deepEqual(v.shown(), ['signinForm']); assert.equal(v.el('signinIntro').textContent, 'Sign in with the invited email. Coach access is added to your account.');
  assert.deepEqual([v.el('resendConfirm').hidden, v.el('toSignup').hidden, v.el('signinPassword').focused], [true, false, 1]);
  v.el('toSignup').onclick(); assert.deepEqual(v.shown(), ['signupForm']);
  // The way to sign in is a button a thumb can find, not a small text link.
  assert.match(html, /<p class="switch"><button type="button" id="toSignin">I already have an account: sign in<\/button><\/p>/); assert.match(html, /\.switch button\{width:100%;min-height:44px\}/);
  assert.doesNotMatch(html, /Opening it brings you back here to finish/, 'the page no longer promises the email link returns here');
}

// ---------- Confirmed in the same browser: the confirm step brings the coach back signed in, to Accept ----------
{
  const v = visit({signedIn: {email: EMAIL, matches: true}}); await settle();
  assert.deepEqual(v.shown(), ['acceptBox']); assert.equal(v.step(), 'done,done,on,'); assert.equal(v.el('signedAs').textContent, EMAIL);
  await v.el('acceptInvite').onclick(); await settle(); assert.deepEqual(v.went, ['/coach']);
  const other = visit({signedIn: {email: 'parent@example.test', matches: false}}); await settle(); assert.deepEqual(other.shown(), ['otherBox']);
}
console.log('Passed: after a coach creates their account the invite page shows what to do and a sign-in form (confirm the email, come back, sign in), can send the email again, and remembers on that device so the link opens at sign-in, not at “create your account”; signing in accepts the invite and opens coach home.');
