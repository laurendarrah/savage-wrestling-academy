// Owner payment setup (issues #26 and #255): the owner connects the academy's own Stripe account with a restricted test key.
// No account is hard-coded. The STRIPE_ACCOUNT_ID setting decides when present; otherwise the first test key the owner
// confirms records its own account, later keys must match it, and "Connect a different Stripe account" resets it.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {
  prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }, async run() { return {meta: sqlite.prepare(sql).run(...a)}; },
    _execute() { return {meta: sqlite.prepare(sql).run(...a)}; }}; },
  async batch(list) { sqlite.exec('BEGIN'); try { const r = list.map(s => s._execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }
};
let owner = {userId: 'owner-test'}, originAllowed = true, limited = false, stripeFailure = false;
// What Stripe says the key's own account is. The site must ask for its own account (no id), never a named one.
let stripeAccount = {id: 'acct_JustinAcademy01', settings: {dashboard: {display_name: 'Savage Wrestling Academy'}}};
const retrieved = [], events = [];
const env = {DB, STRIPE_CONFIG_ENCRYPTION_KEY: '11'.repeat(32)};
class StripeMock {
  constructor(key) { assert(key.startsWith('rk_test_') || key.startsWith('rk_live_')); this.accounts = {retrieve: async id => { retrieved.push(id); if (stripeFailure) throw Error('PRIVATE_KEY_DATA_MUST_NOT_ESCAPE'); return stripeAccount; }}; }
  static createFetchHttpClient() { return {}; }
}
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const m = {exports: {}}; modules.set(file, m.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText,
    {module: m, exports: m.exports, crypto, TextEncoder, TextDecoder, Uint8Array, JSON, Array, Date, Intl, URL, Math, Number, String, Object, Set, Map, Response, Request, Headers, console, require(name) {
      if (name === 'cloudflare:workers') return {env};
      if (name === 'stripe') return StripeMock;
      if (name.endsWith('/account-auth')) return {ownerIdentity: async () => ({owner, headers: new Headers()}), sameOrigin: () => originAllowed, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
      if (name.endsWith('/rate-limit')) return {rateLimited: async () => limited};
      if (name.endsWith('/security-events')) return {securityEvent: async (actor, action, target = '') => { events.push({action, target}); }};
      if (name.endsWith('/stripe-test')) return load('lib/stripe-test.ts');
      if (name.endsWith('/checkout-config')) return load('lib/checkout-config.ts');
      if (name.startsWith('.')) return load(path.relative('.', path.resolve(path.dirname(file), name + '.ts')));
      throw Error(name);
    }});
  return m.exports;
}
const api = load('app/api/payment-setup/route.ts'), vault = load('lib/stripe-test.ts');
const KEY = 'rk_' + 'test_' + 'a'.repeat(32), OTHER_KEY = 'rk_' + 'test_' + 'b'.repeat(32);
const post = async body => { const r = await api.POST(new Request('https://academy.test/api/payment-setup', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const get = async () => { const r = await api.GET(new Request('https://academy.test/api/payment-setup')); return {status: r.status, body: await r.json()}; };
const rows = () => sqlite.prepare('SELECT id FROM integration_secrets ORDER BY id').all().map(r => r.id);
const actions = () => events.map(e => e.action);

// --- Owner boundary, CSRF and key format: unchanged ---
owner = null; assert.equal((await get()).status, 403); assert.equal((await post({testKey: KEY})).status, 403); owner = {userId: 'owner-test'};
originAllowed = false; assert.equal((await post({testKey: KEY})).status, 403); originAllowed = true;
for (const k of ['rk_' + 'live_' + 'a'.repeat(32), 'sk_' + 'test_' + 'a'.repeat(32), 'not-a-key']) assert.equal((await post({testKey: k, confirmAccount: true})).status, 400);
assert.deepEqual(rows(), []); assert.deepEqual(retrieved, [], 'malformed keys never reach Stripe');

// --- A new site knows no account ---
assert.equal(vault.STRIPE_TEST_ACCOUNT, undefined, 'no hard-coded account');
assert.doesNotMatch(readFileSync('lib/stripe-test.ts', 'utf8') + readFileSync('app/api/payment-setup/route.ts', 'utf8'), /acct_1U8nF9PkPTNkVQBz/);
let status = (await get()).body;
assert.equal(status.account, null); assert.equal(status.configured, false); assert.equal(status.canChangeAccount, true);
assert.equal(await vault.expectedStripeAccount(), null);

// --- First key: the owner sees the key's own account and must confirm before anything is stored ---
limited = true; assert.equal((await post({testKey: KEY})).status, 429); limited = false;
stripeFailure = true; const failed = await post({testKey: KEY}); assert.equal(failed.status, 502); assert(!JSON.stringify(failed.body).includes('PRIVATE_KEY')); stripeFailure = false;
let r = await post({testKey: KEY, account: 'acct_FromTheBrowser1'});
assert.equal(r.status, 200); assert.equal(r.body.confirmAccount, true); assert.equal(r.body.configured, false);
assert.deepEqual(r.body.account, {id: 'acct_JustinAcademy01', name: 'Savage Wrestling Academy'});
assert.match(r.body.message, /Savage Wrestling Academy \(acct_JustinAcademy01\)/);
assert.deepEqual(rows(), [], 'nothing stored before the owner confirms');
assert.ok(retrieved.every(id => id === null), 'the site asks Stripe for the key\'s own account, never one named by the browser');
r = await post({testKey: KEY, confirmAccount: 'acct_JustinAcademy01'});
assert.equal(r.body.confirmAccount, true, 'confirmation is a plain yes, not an account id');
assert.deepEqual(rows(), []);
r = await post({testKey: KEY, confirmAccount: true});
assert.equal(r.status, 200); assert.equal(r.body.configured, true); assert.equal(r.body.mode, 'test'); assert.equal(r.body.checkoutEnabled, false);
assert.match(r.body.message, /^Connected to Savage Wrestling Academy \(acct_JustinAcademy01\)\./);
assert(!JSON.stringify(r.body).includes(KEY));
assert.deepEqual(rows(), ['stripe-account', 'stripe-test']);
assert.equal(await vault.storedStripeKey(), KEY); assert.equal(await vault.storedStripeKeyFor('test'), KEY);
assert.deepEqual({...await vault.recordedStripeAccount()}, {id: 'acct_JustinAcademy01', name: 'Savage Wrestling Academy'});
const accountRow = sqlite.prepare("SELECT encrypted FROM integration_secrets WHERE id='stripe-account'").get().encrypted;
assert.doesNotMatch(accountRow, /acct_|Savage/, 'the recorded account is sealed too');
assert.deepEqual(events, [{action: 'stripe_test_key_saved', target: ''}, {action: 'stripe_account_recorded', target: 'acct_JustinAcademy01'}]);
status = (await get()).body;
assert.deepEqual(status.account, {id: 'acct_JustinAcademy01', name: 'Savage Wrestling Academy', source: 'recorded'});
assert.equal(status.configured, true); assert.equal(status.encrypted, undefined); assert.equal(status.testKey, undefined);

// --- Later keys must belong to the recorded account ---
stripeAccount = {id: 'acct_SomeoneElse0001', business_profile: {name: 'Other Gym'}};
r = await post({testKey: OTHER_KEY, confirmAccount: true});
assert.equal(r.status, 400, 'a key from another account is refused, even with a yes');
assert.match(r.body.error, /different Stripe account, Other Gym \(acct_SomeoneElse0001\)\. The site is connected to Savage Wrestling Academy \(acct_JustinAcademy01\)/);
assert.match(r.body.error, /Connect a different Stripe account/);
assert.equal(await vault.storedStripeKey(), KEY, 'the saved key is unchanged');
stripeAccount = {id: 'acct_JustinAcademy01', business_profile: {name: 'Savage Wrestling Academy LLC'}};
events.length = 0;
r = await post({testKey: OTHER_KEY});
assert.equal(r.status, 200); assert.equal(r.body.configured, true, 'a replacement key from the same account needs no second confirmation');
assert.equal(await vault.storedStripeKey(), OTHER_KEY);
assert.equal((await vault.recordedStripeAccount()).name, 'Savage Wrestling Academy LLC', 'the name follows Stripe');
assert.deepEqual(actions(), ['stripe_test_key_saved'], 'no new account is logged');

// --- Stored secrets: wrong encryption key or tampering is refused ---
env.STRIPE_CONFIG_ENCRYPTION_KEY = '22'.repeat(32); await assert.rejects(() => vault.storedStripeKey()); await assert.rejects(() => vault.recordedStripeAccount());
env.STRIPE_CONFIG_ENCRYPTION_KEY = '11'.repeat(32);
const testRow = sqlite.prepare("SELECT encrypted FROM integration_secrets WHERE id='stripe-test'").get().encrypted;
sqlite.prepare("UPDATE integration_secrets SET encrypted=? WHERE id='stripe-account'").run(testRow);
await assert.rejects(() => vault.recordedStripeAccount(), 'a test-key ciphertext cannot pass as the account record');
sqlite.prepare("UPDATE integration_secrets SET encrypted=? WHERE id='stripe-account'").run(accountRow);
const tampered = JSON.parse(testRow); tampered.data[0] ^= 1;
sqlite.prepare("UPDATE integration_secrets SET encrypted=? WHERE id='stripe-test'").run(JSON.stringify(tampered));
await assert.rejects(() => vault.storedStripeKey());
sqlite.prepare("UPDATE integration_secrets SET encrypted=? WHERE id='stripe-test'").run(testRow);

// --- Connect a different Stripe account: a confirmed reset clears the key and the account, and is logged ---
assert.equal((await post({resetAccount: 'yes'})).status, 400, 'only an explicit true resets');
env.STRIPE_MODE = 'live'; r = await post({resetAccount: true}); env.STRIPE_MODE = undefined;
assert.equal(r.status, 400); assert.match(r.body.error, /real payments/);
env.STRIPE_ACCOUNT_ID = 'acct_JustinAcademy01'; r = await post({resetAccount: true});
assert.equal(r.status, 400, 'the setting fixes the account'); assert.match(r.body.error, /fixed in the site’s settings/);
assert.equal((await get()).body.canChangeAccount, false); delete env.STRIPE_ACCOUNT_ID;
assert.deepEqual(rows(), ['stripe-account', 'stripe-test'], 'refused resets change nothing');
sqlite.prepare("INSERT INTO integration_secrets VALUES ('stripe-live',?,?,?)").run(await vault.sealStripeKeyFor('live', 'rk_live_' + 'L'.repeat(30)), 'o', 'x');
events.length = 0;
r = await post({resetAccount: true});
assert.equal(r.status, 200); assert.equal(r.body.configured, false); assert.equal(r.body.account, null);
assert.deepEqual(rows(), [], 'test key, recorded account and the old account\'s live key are gone');
assert.deepEqual(events, [{action: 'stripe_account_reset', target: 'acct_JustinAcademy01'}]);
status = (await get()).body; assert.equal(status.account, null); assert.equal(status.configured, false);
// The next key decides again, after confirmation.
stripeAccount = {id: 'acct_SomeoneElse0001', business_profile: {name: 'Other Gym'}};
assert.equal((await post({testKey: OTHER_KEY})).body.confirmAccount, true);
r = await post({testKey: OTHER_KEY, confirmAccount: true});
assert.equal(r.status, 200); assert.equal((await vault.recordedStripeAccount()).id, 'acct_SomeoneElse0001');
assert.equal(events.at(-1).action, 'stripe_account_recorded'); assert.equal(events.at(-1).target, 'acct_SomeoneElse0001');

// --- The STRIPE_ACCOUNT_ID setting overrides the recorded account, with no confirmation step ---
env.STRIPE_ACCOUNT_ID = 'acct_SettingOwner001';
r = await post({testKey: OTHER_KEY, confirmAccount: true});
assert.equal(r.status, 400, 'the recorded account is not enough when the setting names another');
assert.match(r.body.error, /set to use the academy’s account acct_SettingOwner001/);
stripeAccount = {id: 'acct_SettingOwner001', company: {name: 'Savage Wrestling Academy LLC'}};
r = await post({testKey: KEY});
assert.equal(r.status, 200); assert.equal(r.body.configured, true); assert.equal(r.body.account.source, 'setting');
assert.equal((await vault.recordedStripeAccount()).id, 'acct_SettingOwner001');
assert.deepEqual((await get()).body.account, {id: 'acct_SettingOwner001', name: 'Savage Wrestling Academy LLC', source: 'setting'});
env.STRIPE_ACCOUNT_ID = ' acct_SettingOwner001\n'; assert.equal(vault.settingStripeAccount(), 'acct_SettingOwner001');
env.STRIPE_ACCOUNT_ID = 'not-an-account';
assert.equal(vault.settingStripeAccount(), 'invalid'); assert.equal(await vault.expectedStripeAccount(), 'invalid');
r = await post({testKey: KEY, confirmAccount: true}); assert.equal(r.status, 400, 'a malformed setting refuses every key'); assert.match(r.body.error, /not a valid account id/);
status = (await get()).body; assert.equal(status.accountSettingInvalid, true); assert.equal(status.account, null);
delete env.STRIPE_ACCOUNT_ID;

// --- Account names come only from Stripe and are trimmed ---
assert.equal(vault.stripeAccountName({settings: {dashboard: {display_name: '  Savage   WA '}}, business_profile: {name: 'B'}}), 'Savage WA');
assert.equal(vault.stripeAccountName({business_profile: {name: ''}, company: {name: 'Co'}}), 'Co');
assert.equal(vault.stripeAccountName({}), ''); assert.equal(vault.stripeAccountName(null), '');

// --- Security activity names the new events ---
const log = load('lib/security-log.ts');
const names = {people: {}, you: [], approvals: {}, waitlist: {}, orders: {}, waivers: {}, wrestlers: {}, requests: {}, curricula: {}, coaches: {}};
const entry = action => log.describeSecurityEvent({actor: 'owner-test', action, target: 'acct_JustinAcademy01', created_at: new Date().toISOString()}, names);
assert.equal(entry('stripe_account_recorded').title, 'Stripe account connected'); assert.equal(entry('stripe_account_recorded').detail, 'Stripe account acct_JustinAcademy01');
assert.equal(entry('stripe_account_reset').title, 'Stripe account disconnected');

// --- The page: wording, confirmation and reset, run with a fake DOM (inline JavaScript is not typechecked) ---
const html = readFileSync('app/payment-setup/screen.html', 'utf8');
assert.match(html, /type="password"/); assert.match(html, /Online payment is off\./); assert.doesNotMatch(html, /CHECKOUT_KINDS|STRIPE_[A-Z_]+/, 'setting names are explained in words, not shown'); assert.match(html, /No live charges/);
assert.doesNotMatch(html, /Savage Wrestling Academy LLC|acct_/, 'no account is written into the page');
assert.match(html, /dashboard\.stripe\.com\/register/, 'step 1: create the Stripe account');
assert.match(html, /Create restricted key/); assert.match(html, /Balance \(read, so card fees reach your books\)/); assert.match(html, /Customer Portal sessions \(write\)/);
assert.match(html, /Connect a different Stripe account/);
{
  const nodes = new Map(), calls = [];
  const el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: id === 'confirmBox' || id === 'resetBox' || id === 'changeSection', disabled: false, textContent: '', focus() {}, scrollIntoView() {}}); return nodes.get(id); };
  let server = {mode: 'test', configured: false, account: null, canChangeAccount: true, webhookConfigured: true, checkoutEnabled: false, message: 'Online payment is off.'};
  const fetch = async (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null; calls.push(body);
    if (!body) return {ok: true, json: async () => server};
    if (body.resetAccount) { server = {...server, configured: false, account: null}; return {ok: true, json: async () => ({message: 'Disconnected.'})}; }
    if (!body.confirmAccount) return {ok: true, json: async () => ({confirmAccount: true, account: {id: 'acct_JustinAcademy01', name: '<b>Savage</b>'}, message: 'Check the account.'})};
    server = {...server, configured: true, account: {id: 'acct_JustinAcademy01', name: '<b>Savage</b>', source: 'recorded'}};
    return {ok: true, json: async () => ({configured: true, message: 'Connected to <b>Savage</b> (acct_JustinAcademy01).'})};
  };
  const ctx = vm.createContext({JSON, Promise, Error, console, fetch, document: {getElementById: el}});
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], ctx);
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(res => setImmediate(res)); };
  await settle();
  assert.equal(el('accountLine').textContent, 'Not connected to a Stripe account yet.'); assert.equal(el('changeSection').hidden, true);
  el('testKey').value = ' ' + KEY + ' ';
  el('keyForm').onsubmit({preventDefault() {}}); await settle();
  assert.equal(el('testKey').value, '', 'the field is cleared at once');
  assert.deepEqual(calls.at(-1), {testKey: KEY});
  assert.equal(el('confirmBox').hidden, false);
  assert.equal(el('confirmText').textContent, 'This key belongs to <b>Savage</b> (acct_JustinAcademy01). Is this the academy’s Stripe account?', 'shown as text, never as markup');
  el('confirmYes').onclick(); await settle();
  assert.deepEqual(calls.find(c => c?.confirmAccount), {testKey: KEY, confirmAccount: true}, 'the yes sends the key and a plain true, never an account id');
  assert.equal(el('confirmBox').hidden, true);
  assert.equal(el('accountLine').textContent, 'Connected to <b>Savage</b> (acct_JustinAcademy01)');
  assert.equal(el('changeSection').hidden, false);
  assert.match(el('status').textContent, /^Connected to/);
  // Cancelling a confirmation saves nothing and forgets the key.
  el('testKey').value = OTHER_KEY; el('keyForm').onsubmit({preventDefault() {}}); await settle();
  const before = calls.length; el('confirmNo').onclick(); await settle();
  assert.equal(calls.length, before); assert.equal(el('confirmBox').hidden, true); assert.match(el('status').textContent, /Nothing was saved/);
  // Reset asks first.
  el('changeAccount').onclick();
  assert.equal(el('resetBox').hidden, false); assert.match(el('resetText').textContent, /^Disconnect <b>Savage<\/b> \(acct_JustinAcademy01\)\? The saved test key is removed/);
  el('resetNo').onclick(); assert.equal(el('resetBox').hidden, true); assert.ok(!calls.some(c => c?.resetAccount), 'no reset without the yes');
  el('changeAccount').onclick(); await el('resetYes').onclick(); await settle();
  assert.deepEqual(calls.find(c => c?.resetAccount), {resetAccount: true});
  assert.equal(el('accountLine').textContent, 'Not connected to a Stripe account yet.'); assert.equal(el('changeSection').hidden, true);
  // An older site with a saved key but no recorded account asks for the key again.
  server = {...server, configured: true, account: null}; calls.length = 0;
  vm.runInContext('status()', ctx); await settle();
  assert.match(el('accountLine').textContent, /doesn’t know which Stripe account it belongs to yet/);
}

// The owner guide and the runbook describe the same steps.
assert.match(readFileSync('app/help/owner/screen.html', 'utf8'), /<strong>Connect your Stripe account<\/strong>[\s\S]*<strong>Yes, connect this account<\/strong>[\s\S]*<strong>Connect a different Stripe account<\/strong>/);
const runbook = readFileSync('docs/RUNBOOK.md', 'utf8');
assert.match(runbook, /### Connecting the academy's Stripe account/); assert.match(runbook, /Save your test key first so the site knows your Stripe account/);
assert.doesNotMatch(runbook, /Resend, plus Worker settings in Cloudflare \| Lauren|Stripe \| Justin \|\n|Lauren \(Resend|Lauren checks `EMAIL_API_KEY`|Lauren once added/, 'Justin owns Stripe and Resend; Lauren helps only if asked');
assert.match(readFileSync('docs/GO_LIVE.md', 'utf8'), /Yes, connect this account[\s\S]*Connect a different Stripe account/);

const catalog = JSON.parse(readFileSync('config/stripe-test-catalog.json', 'utf8')); assert.equal(catalog.livemode, false); assert.equal(Object.keys(catalog.programs).length, 3);
for (const p of Object.values(catalog.programs)) { assert.equal(p.monthlyCents, 20000); assert.equal(p.walkInCents, 4000); assert(p.monthlyPrice.startsWith('price_')); assert(p.walkInPrice.startsWith('price_')); }
console.log('Passed: owner/MFA boundary, CSRF, key format, no hard-coded account, first key records its own account only after confirmation, mismatched keys refused, confirmed reset clears and logs, setting overrides, malformed setting refuses, encrypted and separated storage, safe errors, page confirmation and reset.');
