// Issue #315: Online payment setup can check what the saved Stripe key can do and name the missing permission, and a
// checkout that can't start records Stripe's reason for the owner. Neither ever repeats the key.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const m = {exports: {}};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/stripe-key-check.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
  {module: m, exports: m.exports, Set, Number, String, Math, Date, Error});
const {checkKey, keyCheckSummary, stripeReason} = m.exports;
const plain = v => JSON.parse(JSON.stringify(v));
const KEY = 'rk_test_51SecretSecretSecret';
const refused = name => Object.assign(Error(`The provided key '${KEY}' does not have the required permissions for this endpoint on account 'acct_1Private'. Having the '${name}' permission would allow this request to continue.`), {type: 'StripePermissionError', statusCode: 403});
const noSuch = Object.assign(Error('No such subscription: sub_swa_permission_check'), {type: 'StripeInvalidRequestError', statusCode: 404, code: 'resource_missing'});

function client(fail = {}) {
  const calls = [], f = (name, value) => async (...a) => { calls.push([name, ...a]); if (fail[name]) throw fail[name]; return value; };
  return {calls, checkout: {sessions: {create: f('create', {id: 'cs_test_1'}), expire: f('expire', {})}}, subscriptions: {retrieve: f('subRead', {}), update: f('subWrite', {})},
    invoices: {list: f('invoices', {})}, paymentIntents: {list: f('pis', {})}, charges: {list: f('charges', {})}, balance: {retrieve: f('balance', {})}};
}

// A key with everything: all pass, and the one session it creates is shaped like a real walk-in and expired at once.
let c = client({subRead: noSuch, subWrite: noSuch});
let checks = plain(await checkKey(c, 'https://academy.test'));
assert.deepEqual(checks.map(x => [x.id, x.ok]), [['checkout', true], ['subscription-read', true], ['subscription-write', true], ['invoices', true], ['payment-intents', true], ['charges', true], ['balance', true]]);
const created = c.calls.find(x => x[0] === 'create')[1];
assert.equal(created.mode, 'payment'); assert.equal(created.line_items[0].price_data.unit_amount, 100); assert.ok(created.line_items[0].price_data.product_data.name);
assert.match(created.success_url, /^https:\/\/academy\.test\/payment-setup$/);
assert.deepEqual(c.calls.find(x => x[0] === 'expire'), ['expire', 'cs_test_1'], 'the check session is expired straight away');
assert.equal(keyCheckSummary(checks), 'This key can do everything the site needs.');

// The Nov 13 case: the key can't create a Checkout Session.
c = client({create: refused('rak_checkout_session_write'), subRead: noSuch, subWrite: noSuch, balance: refused('rak_balance_read')});
checks = plain(await checkKey(c, 'https://academy.test'));
const co = checks.find(x => x.id === 'checkout');
assert.equal(co.ok, false); assert.match(co.problem, /set Checkout Sessions to Write \(Stripe calls it rak_checkout_session_write\)/);
assert.equal(c.calls.some(x => x[0] === 'expire'), false, 'nothing to expire when none was created');
assert.match(checks.find(x => x.id === 'balance').problem, /Balance to Read/);
assert.match(keyCheckSummary(checks), /can’t start card payments/);
assert.ok(!JSON.stringify(checks).includes('rk_test') && !JSON.stringify(checks).includes('acct_1Private'), 'never the key or the account');

// Subscriptions refused: single purchases work, memberships don't. A dead key and an outage are told apart.
c = client({subRead: refused('rak_subscription_read'), subWrite: refused('rak_subscription_write')});
checks = plain(await checkKey(c, 'https://academy.test'));
assert.match(keyCheckSummary(checks), /Single purchases work\. Memberships need/);
c = client({subRead: noSuch, subWrite: noSuch, charges: refused('rak_charge_read')});
assert.match(keyCheckSummary(plain(await checkKey(c, 'https://academy.test'))), /Payments work\. Card fees/);
c = client({create: Object.assign(Error('down'), {type: 'StripeConnectionError'}), subRead: noSuch, subWrite: noSuch});
assert.match(plain(await checkKey(c, 'https://academy.test'))[0].problem, /Couldn’t check: Stripe could not be reached/);

// Reasons for Site health.
assert.equal(stripeReason(refused('rak_checkout_session_write')), 'the saved key is missing a Stripe permission (rak_checkout_session_write)');
assert.match(stripeReason(Object.assign(Error(`Invalid API Key provided: ${KEY}`), {type: 'StripeAuthenticationError', statusCode: 401})), /no longer recognizes the saved key/);
assert.equal(stripeReason(Object.assign(Error('bad'), {type: 'StripeInvalidRequestError', statusCode: 400, code: 'parameter_invalid'})), 'Stripe did not accept the request (parameter_invalid)');
for (const e of [refused('rak_x'), Error(KEY), undefined]) assert.ok(!stripeReason(e).includes('rk_test'));
// Issue #319: the rejected field is named (a field path only), so an expiry under Stripe's minimum is recognizable.
assert.equal(stripeReason(Object.assign(Error('The `expires_at` timestamp must be at least 30 minutes from Checkout Session creation.'), {type: 'StripeInvalidRequestError', statusCode: 400, param: 'expires_at'})), 'Stripe did not accept the request (field expires_at)');
assert.equal(stripeReason(Object.assign(Error('x'), {type: 'StripeInvalidRequestError', statusCode: 400, code: 'parameter_invalid_integer', param: 'line_items[0][price_data][unit_amount]'})), 'Stripe did not accept the request (parameter_invalid_integer, field line_items[0][price_data][unit_amount])');
assert.equal(stripeReason(Object.assign(Error('x'), {type: 'StripeInvalidRequestError', statusCode: 400, param: 'someone@example.test said <b>'})), 'Stripe did not accept the request', 'anything that is not a field path is dropped');

// Issue #319: the payment page expires with a margin above Stripe's 30-minute minimum, never exactly 30 minutes.
const src = readFileSync('lib/checkout.ts', 'utf8');
const expiry = src.match(/export const SESSION_MARGIN_SECONDS = (\d+);/); assert.ok(expiry && Number(expiry[1]) >= 60, 'at least a minute of margin');
assert.match(src, /export const sessionExpiry = \(nowMs: number\) => Math\.floor\(nowMs \/ 1000\) \+ SESSION_MINUTES \* 60 \+ SESSION_MARGIN_SECONDS;/);
assert.match(src, /expires_at: sessionExpiry\(Date\.now\(\)\)/); assert.doesNotMatch(src, /expires_at: Math\.floor\(Date\.now\(\) \/ 1000\) \+ SESSION_MINUTES \* 60\b(?! \+)/);

// Wiring: the route, the checkout failure record, and the page button.
const route = readFileSync('app/api/payment-setup/route.ts', 'utf8');
assert.match(route, /data\.checkKey===true\)return checkSavedKey\(/); assert.match(route, /rateLimited\(request,'stripe-check:'\+ownerId,5\)/);
const checkout = readFileSync('lib/checkout.ts', 'utf8');
assert.match(checkout, /throw new CheckoutError\(502, 'Could not start secure checkout\. Nothing was charged\. Please try again\.', stripeReason\(err\)\)/);
const api = readFileSync('app/api/checkout/route.ts', 'utf8');
assert.match(api, /recordApiError\([^;]*`Card checkout could not start: \$\{e\.reason\}\./); assert.match(api, /auth\.headers\.set\(RECORDED_HEADER, '1'\)/);
assert.match(api, /return reply\(\{error: e\.message\}, e\.status\)/, 'the family still sees only the plain message');

// The page: the button shows progress and results right under it.
const html = readFileSync('app/payment-setup/screen.html', 'utf8'), script = html.match(/<script>([\s\S]*)<\/script>/)[1];
assert.match(html, /<button type="button" class="secondary" id="checkKey">Check this key<\/button><p id="checkNote" class="formnote"/);
const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {id, hidden: false, disabled: false, value: '', textContent: '', innerHTML: '', focus() {}, scrollIntoView() {}}); return nodes.get(id); };
const fetch = async (url, opts) => !opts || opts.method !== 'POST'
  ? {ok: true, status: 200, json: async () => ({configured: true, account: {id: 'acct_x', name: ''}, mode: 'test', webhookConfigured: true})}
  : {ok: true, status: 200, json: async () => ({summary: 'This key can’t start card payments, so families can’t pay online until it’s fixed.', checks: [{id: 'checkout', label: 'Start a card payment', ok: false, problem: 'Missing permission. <b>x</b>'}, {id: 'balance', label: 'Read card fees', ok: true, problem: ''}]})};
vm.runInNewContext(script, {document: {getElementById: el}, fetch, JSON, Error, String, setTimeout});
await new Promise(r => setImmediate(r));
await el('checkKey').onclick(); await new Promise(r => setImmediate(r));
assert.match(el('checkList').innerHTML, /<li class="bad"><b>Start a card payment<\/b>Missing permission\. &lt;b&gt;x&lt;\/b&gt;<\/li><li class="ok"><b>Read card fees<\/b>Works<\/li>/, 'results listed, escaped');
assert.match(el('checkNote').textContent, /can’t start card payments/); assert.equal(el('checkKey').disabled, false);
console.log('Stripe key check: ok');
