// Issue #111: STRIPE_API_BASE (local stripe-mock rehearsals) only redirects test-mode calls to a loopback host.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const env = {};
let lastOptions = null;
class Stripe { constructor(key, options) { lastOptions = options; } static createFetchHttpClient() { return 'fetch'; } }
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, URL, TextEncoder, crypto, JSON, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name === 'stripe') return {__esModule: true, default: Stripe};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected ' + name);
      }});
  return module.exports;
}
const s = load(path.resolve('lib/stripe-test.ts'));
const key = mode => `rk_${mode}_` + 'A'.repeat(24);

assert.deepEqual({...s.testApiOverride('test')}, {}, 'unset: real Stripe');
env.STRIPE_API_BASE = 'http://127.0.0.1:12111';
assert.deepEqual({...s.testApiOverride('test')}, {host: '127.0.0.1', port: '12111', protocol: 'http'});
s.stripeClientFor('test', key('test')); assert.equal(lastOptions.host, '127.0.0.1', 'test client uses stripe-mock');
s.stripeTestClient(key('test')); assert.equal(lastOptions.port, '12111');
s.stripeClientFor('live', key('live')); assert.equal(lastOptions.host, undefined, 'live mode always uses real Stripe');
assert.deepEqual({...s.testApiOverride('live')}, {});
for (const bad of ['https://evil.example', 'http://10.0.0.5:12111', 'http://127.0.0.1.evil.example', 'not a url']) {
  env.STRIPE_API_BASE = bad; assert.deepEqual({...s.testApiOverride('test')}, {}, 'ignored: ' + bad);
  s.stripeClientFor('test', key('test')); assert.equal(lastOptions.host, undefined, 'ignored: ' + bad);
}
console.log('Stripe override tests passed');
