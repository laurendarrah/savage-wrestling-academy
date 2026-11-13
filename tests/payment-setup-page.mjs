// Issue #304: Verify test key shows its progress and its result right under the button, not only at the top of the page.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('app/payment-setup/screen.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
assert.match(html, /<\/form><p id="keyNote" class="formnote" role="status" aria-live="polite"><\/p>/, 'a note sits right under the test key button');
assert.match(html, /<\/form><p id="liveNote" class="formnote" role="status" aria-live="polite"><\/p>/, 'and under the live key button');

function setup(answer) {
  const nodes = new Map(), scrolled = [];
  const el = id => { if (!nodes.has(id)) nodes.set(id, {id, hidden: false, disabled: false, value: '', textContent: '', focus() {}, scrollIntoView() { scrolled.push(id); }}); return nodes.get(id); };
  let release;
  const fetch = async (url, opts) => {
    if (!opts || opts.method !== 'POST') return {ok: true, status: 200, json: async () => ({configured: false, account: null, mode: 'test', canChangeAccount: true})};
    await new Promise(r => { release = r; });
    return answer;
  };
  vm.runInNewContext(script, {document: {getElementById: el}, fetch, JSON, Error, String, setTimeout});
  return {el, scrolled, release: () => release()};
}
const tick = () => new Promise(r => setImmediate(r));

// While Stripe is being asked, the owner sees it next to the button.
let p = setup({ok: true, status: 200, json: async () => ({confirmAccount: true, account: {id: 'acct_Test123', name: 'Savage Sandbox'}, message: 'This key belongs to Savage Sandbox.'})});
await tick();
p.el('testKey').value = ' rk_test_' + 'a'.repeat(30) + ' ';
p.el('keyForm').onsubmit({preventDefault() {}});
await tick();
assert.match(p.el('keyNote').textContent, /^Checking the key with Stripe/);
assert.equal(p.el('save').textContent, 'Verifying…'); assert.equal(p.el('save').disabled, true);
assert.equal(p.el('testKey').value, '', 'the key leaves the box at once');
p.release(); await tick(); await tick();
assert.equal(p.el('confirmBox').hidden, false, 'the account question appears under the form');
assert.equal(p.el('keyNote').textContent, '', 'the question replaces the progress note');
assert.equal(p.el('save').textContent, 'Verify test key'); assert.equal(p.el('save').disabled, false);

// A refusal shows under the button, without jumping to the top of the page.
p = setup({ok: false, status: 502, json: async () => ({error: 'Stripe didn’t recognize this key.'})});
await tick();
p.el('testKey').value = 'rk_test_' + 'b'.repeat(30);
p.el('keyForm').onsubmit({preventDefault() {}});
await tick(); p.release(); await tick(); await tick();
assert.equal(p.el('keyNote').textContent, 'Stripe didn’t recognize this key.');
assert.equal(p.el('status').textContent, 'Stripe didn’t recognize this key.', 'the top line agrees');
assert.deepEqual(p.scrolled, [], 'no scroll away from the button');

// A reply that isn't JSON (a gateway error page) gets plain words, not a parser error.
p = setup({ok: false, status: 502, json: async () => { throw SyntaxError('Unexpected token <'); }});
await tick();
p.el('testKey').value = 'rk_test_' + 'c'.repeat(30);
p.el('keyForm').onsubmit({preventDefault() {}});
await tick(); p.release(); await tick(); await tick();
assert.match(p.el('keyNote').textContent, /didn’t answer properly \(error 502\)/);
assert.doesNotMatch(p.el('keyNote').textContent, /Unexpected token/);
console.log('Payment setup page: ok');
