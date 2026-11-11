// Issue #300: Online payment setup says why a Stripe key couldn't be verified, and never repeats the key.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const module = {exports: {}};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/stripe-setup-errors.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {module, exports: module.exports, Set, Number, String});
const {stripeSetupError} = module.exports;
const key = 'rk_test_51AbCdEfGhIjKlMnOp';

let m = stripeSetupError({type: 'StripeAuthenticationError', statusCode: 401, message: `Invalid API Key provided: ${key}`}, 'test');
assert.match(m, /didn’t recognize this key/); assert.match(m, /not a sandbox/); assert.ok(!m.includes('rk_'), 'never repeats the key');

m = stripeSetupError({type: 'StripePermissionError', statusCode: 403, message: `The provided key '${key}' does not have the required permissions for this endpoint on account 'acct_1Xyz'. Having the 'rak_accounts_kyc_basic_read' permission would allow this request to continue.`}, 'test');
assert.match(m, /missing a permission Stripe needs: rak_accounts_kyc_basic_read\./);
assert.ok(!m.includes('rk_test') && !m.includes('acct_1Xyz'), 'only the permission name comes from Stripe’s message');

m = stripeSetupError({type: 'StripePermissionError', statusCode: 403, message: 'Forbidden'}, 'live');
assert.match(m, /isn’t allowed to read the account details/);

for (const e of [{type: 'StripeConnectionError'}, {type: 'StripeAPIError', statusCode: 500}, {statusCode: 429}])
  assert.match(stripeSetupError(e, 'test'), /couldn’t be reached/);

assert.match(stripeSetupError(Error('Secure storage is not configured.'), 'test'), /STRIPE_CONFIG_ENCRYPTION_KEY setting is missing/);
assert.match(stripeSetupError(Error('Unexpected account.'), 'test'), /^The test connection could not be verified or saved/);
assert.match(stripeSetupError(undefined, 'live'), /^The live connection could not be verified or saved/);
assert.match(stripeSetupError({type: 'StripeAuthenticationError'}, 'live'), /Test mode off/);

const route = readFileSync('app/api/payment-setup/route.ts', 'utf8');
assert.match(route, /catch\(err\)\{return reply\(\{error:stripeSetupError\(err,'test'\)\},502\)\}/);
assert.match(route, /catch\(err\)\{return reply\(\{error:stripeSetupError\(err,'live'\)\},502\)\}/);
console.log('Stripe setup errors: ok');
