// Issue #161: a brand-new owner (no authenticator yet) sees a clear setup step on /security.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('app/security/screen.html', 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);

async function page(state, enrollReply) {
  const els = {};
  for (const id of ids) {
    const cls = new Set((html.match(new RegExp(`id="${id}"[^>]*class="([^"]*)"`)) || html.match(new RegExp(`class="([^"]*)"[^>]*id="${id}"`)) || [, ''])[1].split(' ').filter(Boolean));
    els[id] = {id, hidden: new RegExp(`id="${id}"[^>]*\\shidden`).test(html), textContent: '', href: '', disabled: false, value: '', src: '',
      classList: {toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: c => cls.has(c)}, replaceChildren() {}, removeAttribute() {}};
  }
  const fetch = async (url, opts) => ({ok: true, json: async () => (opts?.body ? enrollReply : state)});
  const ctx = {document: {getElementById: id => els[id], createElement: () => ({})}, fetch, globalThis: {}, encodeURIComponent, console};
  vm.runInNewContext(script, ctx);
  await new Promise(r => setTimeout(r, 20));
  return {els, ctx};
}

// First sign-in: no factor yet.
{
  const {els, ctx} = await page({email: 'savagewrestlingclub@gmail.com', destination: '/', role: 'owner', required: true, strong: false, factors: []},
    {factorId: 'f1', qr: '<svg/>', secret: 'ABC'});
  assert.equal(els.authHeading.textContent, 'Set up your authenticator');
  assert.match(els.explain.textContent, /Google Authenticator or Microsoft Authenticator/);
  assert.equal(els.enroll.hidden, false); assert.equal(els.enroll.classList.contains('primary'), true, 'Set up is the main button');
  assert.equal(els.codeForm.hidden, true, 'no code box before setup starts');
  assert.equal(els.backupNote.hidden, true, 'backup note waits until verified');
  assert.equal(els.home.textContent, 'Back to sign in'); assert.equal(els.home.href, '/login');
  await vm.runInNewContext('enroll()', ctx); await new Promise(r => setTimeout(r, 20));
  assert.equal(els.enrollment.hidden, false); assert.equal(els.codeForm.hidden, false);
  assert.equal(els.enroll.hidden, true, 'Set up hides once the QR code shows');
  assert.equal(els.explain.textContent, '', 'the numbered steps take over once setup starts'); assert.equal(els.status.textContent, '');
}
// Returning owner with a verified factor: the usual code prompt.
{
  const {els} = await page({email: 'o@x', destination: '/', role: 'owner', required: true, strong: false, factors: [{id: 'f', name: 'Phone'}]});
  assert.equal(els.authHeading.textContent, 'Authenticator verification');
  assert.equal(els.enroll.hidden, true); assert.equal(els.codeForm.hidden, false);
}
// Verified: backup note and owner tools show.
{
  const {els} = await page({email: 'o@x', destination: '/', role: 'owner', required: true, strong: true, factors: [{id: 'f', name: 'Phone'}]});
  assert.equal(els.backupNote.hidden, false); assert.equal(els.ownerTools.hidden, false);
}
console.log('security-first-time ok');
