// Issue #26: live mode is deliberate, keys are separated by mode, and webhooks must match their signing secret.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {
  prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }, async run() { return {meta: sqlite.prepare(sql).run(...a)}; },
    _execute() { const s = sqlite.prepare(sql); return s.columns().length ? {results: s.all(...a)} : {results: [], meta: s.run(...a)}; }}; },
  async batch(list) { sqlite.exec('BEGIN'); try { const r = list.map(s => s._execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }
};
const TEST_SECRET = 'whsec_test_unit', LIVE_SECRET = 'whsec_live_unit';
const env = {DB, STRIPE_CONFIG_ENCRYPTION_KEY: 'cd'.repeat(32), STRIPE_TEST_WEBHOOK_SECRET: TEST_SECRET, CHECKOUT_KINDS: 'event'};
const ACCOUNT = 'acct_1U8nF9PkPTNkVQBz';
let accountReturned = ACCOUNT, n = 0;
const clientsMade = [];
function StripeMock(key) {
  clientsMade.push(key);
  return {
    accounts: {retrieve: async () => ({id: accountReturned})},
    checkout: {sessions: {create: async params => ({id: `cs_${key.startsWith('rk_live_') ? 'live' : 'test'}_${++n}`, url: 'https://checkout.stripe.test/' + n, livemode: key.startsWith('rk_live_'), params}), expire: async () => ({})}}
  };
}
StripeMock.createFetchHttpClient = () => ({});

const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText,
    {module, exports: module.exports, crypto, TextEncoder, TextDecoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name === 'stripe') return StripeMock;
        if (name.endsWith('/account-auth')) return {
          ownerIdentity: async () => ({owner: {userId: 'owner-id'}, headers: new Headers()}),
          strongAccount: async () => ({user: {id: 'parent-1', email: 'pat@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}),
          sameOrigin: () => true, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.endsWith('/security-events')) return {securityEvent: async () => {}};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
const vault = load(path.resolve('lib/stripe-test.ts'));
const config = load(path.resolve('lib/checkout-config.ts'));
const setup = load(path.resolve('app/api/payment-setup/route.ts'));
const checkout = load(path.resolve('app/api/checkout/route.ts'));
const webhook = load(path.resolve('app/api/stripe-webhook/route.ts'));
const plain = v => JSON.parse(JSON.stringify(v));
const saveLive = async liveKey => { const r = await setup.POST(new Request('https://a.test/api/payment-setup', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({liveKey})})); return {status: r.status, body: await r.json()}; };
const LIVE_KEY = 'rk_live_' + 'L'.repeat(30), TEST_KEY = 'rk_test_' + 'T'.repeat(30);

// --- Test mode (default): live keys refused, test checkout needs only the test secret ---
assert.equal(config.stripeMode(), 'test');
assert.equal((await saveLive(LIVE_KEY)).status, 400, 'live key refused while in test mode');
assert.equal(sqlite.prepare("SELECT count(*) n FROM integration_secrets WHERE id='stripe-live'").get().n, 0);
assert.deepEqual([...config.checkoutKinds()], ['event']);
env.STRIPE_MODE = 'Live'; assert.equal(config.stripeMode(), 'test', 'only the exact value "live" switches modes');

// --- Live mode: checkout closed until the live webhook secret exists ---
env.STRIPE_MODE = 'live';
assert.equal(config.checkoutKinds().size, 0, 'test webhook secret does not open live checkout');
env.STRIPE_LIVE_WEBHOOK_SECRET = LIVE_SECRET;
assert.deepEqual([...config.checkoutKinds()], ['event']);

// --- Saving the live key ---
assert.equal((await saveLive(TEST_KEY)).status, 400, 'a test key is not a live key');
assert.equal((await saveLive('sk_live_' + 'x'.repeat(30))).status, 400, 'unrestricted live secret keys refused');
accountReturned = 'acct_someoneelse';
assert.equal((await saveLive(LIVE_KEY)).status, 400, 'wrong Stripe account refused');
accountReturned = ACCOUNT;
let r = await saveLive(LIVE_KEY);
assert.equal(r.status, 200); assert.equal(r.body.mode, 'live');
assert.ok(!JSON.stringify(r.body).includes(LIVE_KEY));
const row = sqlite.prepare("SELECT encrypted FROM integration_secrets WHERE id='stripe-live'").get();
assert.ok(!row.encrypted.includes(LIVE_KEY), 'stored encrypted');
assert.equal(await vault.storedStripeKeyFor('live'), LIVE_KEY);
assert.equal(await vault.storedStripeKeyFor('test'), null, 'test slot untouched');
// A live ciphertext placed in the test slot cannot be decrypted as a test key.
sqlite.prepare("INSERT INTO integration_secrets VALUES ('stripe-test',?,?,?)").run(row.encrypted, 'x', 'x');
await assert.rejects(() => vault.storedStripeKeyFor('test'), 'encryption labels separate modes');
sqlite.prepare("UPDATE integration_secrets SET encrypted=? WHERE id='stripe-test'").run(await vault.sealStripeKeyFor('test', TEST_KEY));
// Custom account for a separately owned live Stripe account.
env.STRIPE_ACCOUNT_ID = 'acct_LiveOwner123'; accountReturned = 'acct_LiveOwner123';
assert.equal((await saveLive(LIVE_KEY)).status, 200);
env.STRIPE_ACCOUNT_ID = 'not-an-account'; assert.equal(vault.expectedStripeAccount(), ACCOUNT, 'malformed setting falls back to the known account');
delete env.STRIPE_ACCOUNT_ID; accountReturned = ACCOUNT;
const status = plain(await (await setup.GET(new Request('https://a.test/api/payment-setup'))).json());
assert.equal(status.mode, 'live'); assert.equal(status.liveConfigured, true); assert.equal(status.webhookConfigured, true);

// --- Live checkout uses the live key and records a live order ---
const day = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
sqlite.prepare('INSERT INTO academy_state VALUES (?,?,?,?,?)').run('academy', JSON.stringify({programNamingVersion: 2, programs: [], events: [{id: 'camp-1', name: 'Camp', type: 'Camp', dates: [day(10)], price: 100, slots: 10}]}), 1, 'o', day(0));
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('parent-1', 'pat@example.test', JSON.stringify({parentName: 'Pat', phone: '', wrestlers: [{id: 'w-1', name: 'Sam', grade: '8', usawNumber: 'TEST-1234', usawExpires: '2099-12-31'}]}), 1, day(0));
clientsMade.length = 0;
r = await checkout.POST(new Request('https://a.test/api/checkout', {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://a.test'}, body: JSON.stringify({source: 'booking', type: 'event', id: 'camp-1', wrestlerId: 'w-1', acceptTerms: true})}));
const body = await r.json();
assert.equal(r.status, 200);
assert.deepEqual(clientsMade, [LIVE_KEY], 'live mode charges with the live key only');
const order = sqlite.prepare('SELECT * FROM orders WHERE id=?').get(body.orderId);
assert.equal(order.livemode, 1); assert.match(order.stripe_session_id, /^cs_live_/);

// --- Webhook: signing secret and event mode must agree ---
const sign = (raw, secret) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`; };
let ev = 0;
const deliver = async (secret, livemode, object) => {
  const raw = JSON.stringify({id: 'evt_' + ++ev, type: 'checkout.session.completed', livemode, data: {object}});
  const res = await webhook.POST(new Request('https://a.test/api/stripe-webhook', {method: 'POST', headers: {'stripe-signature': sign(raw, secret)}, body: raw}));
  return {status: res.status, body: await res.json()};
};
const session = {id: order.stripe_session_id, client_reference_id: order.id, metadata: {order_id: order.id}, amount_total: order.amount_cents, currency: 'usd', livemode: true, payment_status: 'paid', payment_intent: 'pi_live_1'};
assert.equal((await deliver(TEST_SECRET, true, session)).status, 400, 'test-signed event claiming to be live is refused');
assert.equal((await deliver(LIVE_SECRET, false, {...session, livemode: false})).status, 400, 'live-signed event claiming to be test is refused');
assert.equal((await deliver('whsec_unknown', true, session)).status, 400);
assert.equal(sqlite.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status, 'pending');
let w = await deliver(LIVE_SECRET, true, session);
assert.equal(w.status, 200); assert.equal(w.body.outcome, 'paid');
assert.equal(sqlite.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status, 'paid');

console.log('Passed: test mode refuses live keys; live mode needs the exact setting and its own webhook secret; live keys are restricted, account-checked, stored and encrypted separately; live checkout uses only the live key; webhooks must be signed with the secret matching their mode.');
