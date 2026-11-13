// Issue #308: a restricted key that Stripe won't let read the account still connects: it proves itself with a Balance
// read, and the account comes from Stripe's refusal or from the STRIPE_ACCOUNT_ID setting.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const stripeTest = {ACCOUNT_ID: /^acct_[A-Za-z0-9]{8,64}$/, stripeAccountName: a => a?.settings?.dashboard?.display_name ?? ''};
const m = {exports: {}};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/stripe-key-account.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
  {module: m, exports: m.exports, String, Number, Error, require: name => { if (name === './stripe-test') return stripeTest; throw Error(name); }});
const {NEEDS_ACCOUNT_SETTING} = m.exports;
// Results are made inside the module's own context, so compare plain copies.
const keyAccount = async (...a) => JSON.parse(JSON.stringify(await m.exports.keyAccount(...a)));

const refused = message => Object.assign(Error(message), {type: 'StripePermissionError', statusCode: 403});
function client({account, accountError, balanceError}) {
  const calls = [];
  return {calls, accounts: {retrieve: async id => { calls.push('account:' + id); if (accountError) throw accountError; return account; }},
    balance: {retrieve: async () => { calls.push('balance'); if (balanceError) throw balanceError; return {}; }}};
}

// The account can be read: as before, with its name, and no balance call.
let c = client({account: {id: 'acct_Academy0001', settings: {dashboard: {display_name: 'Savage Wrestling Academy'}}}});
assert.deepEqual(await keyAccount(c, null), {id: 'acct_Academy0001', name: 'Savage Wrestling Academy'}); assert.deepEqual(c.calls, ['account:null']);

// Refused, and Stripe's refusal names the account: the key proves itself, the named account is used.
c = client({accountError: refused("The provided key 'rk_test_***abcd' does not have the required permissions for this endpoint on account 'acct_Sandbox0001'.")});
assert.deepEqual(await keyAccount(c, null), {id: 'acct_Sandbox0001', name: ''}); assert.deepEqual(c.calls, ['account:null', 'balance']);
c = client({accountError: refused("… on account 'acct_Sandbox0001'.")});
assert.deepEqual(await keyAccount(c, 'acct_Academy0001'), {id: 'acct_Sandbox0001', name: ''}, 'Stripe’s own answer wins, so a key from another account is still caught');

// Refused without an account id: the setting decides; without the setting, the owner is told what to add.
c = client({accountError: refused('This key is not allowed to read the account.')});
assert.deepEqual(await keyAccount(c, 'acct_Academy0001'), {id: 'acct_Academy0001', name: ''});
assert.equal(await keyAccount(client({accountError: refused('Not allowed.')}), null), 'needs-setting');
assert.match(NEEDS_ACCOUNT_SETTING, /STRIPE_ACCOUNT_ID in Cloudflare/); assert.match(NEEDS_ACCOUNT_SETTING, /acct_/);

// A key that doesn't work at all still fails: the balance refusal or Stripe's own error goes back to the caller.
const badKey = Object.assign(Error('Invalid API Key'), {type: 'StripeAuthenticationError', statusCode: 401});
await assert.rejects(keyAccount(client({accountError: badKey}), 'acct_Academy0001'), e => e === badKey, 'an unrecognized key is never accepted');
const noBalance = refused('no balance permission');
await assert.rejects(keyAccount(client({accountError: refused('Not allowed.'), balanceError: noBalance}), 'acct_Academy0001'), e => e === noBalance);
await assert.rejects(keyAccount(client({account: {id: 'not-an-account'}}), null), /Unexpected account/);

// Both the test key and the live key use it.
const route = readFileSync('app/api/payment-setup/route.ts', 'utf8');
assert.match(route, /const found=await keyAccount\(stripeTestClient\(data\.testKey\),expected\?\.source==='setting'\?expected\.id:null\);\n\s*if\(found==='needs-setting'\)return reply\(\{error:NEEDS_ACCOUNT_SETTING\},400\);/);
assert.match(route, /const account=await keyAccount\(stripeClientFor\('live',liveKey\),expected\.source==='setting'\?expected\.id:null\);\n\s*if\(account==='needs-setting'\)return reply\(\{error:NEEDS_ACCOUNT_SETTING\},400\);\n\s*if\(account\.id!==expected\.id\)/);
assert.doesNotMatch(route, /accounts\.retrieve\(/, 'no direct account reads left in the route');
console.log('Stripe key account: ok');
