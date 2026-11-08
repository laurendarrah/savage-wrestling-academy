// Issue #204: STAFF_MFA=off lets accounts without an authenticator sign in until launch, and the owner sees it in red.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const load = f => { const module = {exports: {}}; vm.runInNewContext(ts.transpileModule(readFileSync(f, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {module, exports: module.exports, String}); return module.exports; };
const {fullySignedIn, mfaSwitchedOff} = load('lib/mfa-policy.ts');
assert.equal(mfaSwitchedOff('off'), true); assert.equal(mfaSwitchedOff(' OFF '), true);
for (const v of [undefined, '', 'on', 'false', '0', 'no']) assert.equal(mfaSwitchedOff(v), false, String(v));
const base = {emailConfirmed: true, aal2: false, hasVerifiedFactor: false, mfaOff: false};
assert.equal(fullySignedIn(base), false, 'normally an authenticator code is required');
assert.equal(fullySignedIn({...base, mfaOff: true}), true, 'switched off: no authenticator needed');
assert.equal(fullySignedIn({...base, mfaOff: true, emailConfirmed: false}), false, 'never without a confirmed email');
assert.equal(fullySignedIn({...base, mfaOff: true, hasVerifiedFactor: true}), false, 'an account that set one up still uses it');
assert.equal(fullySignedIn({...base, mfaOff: true, hasVerifiedFactor: true, aal2: true}), true);
assert.equal(fullySignedIn({...base, hasVerifiedFactor: true, aal2: true}), true);
// Every sign-in check goes through strongAccount, which uses the policy.
const auth = readFileSync('lib/account-auth.ts', 'utf8');
assert.match(auth, /strong=fullySignedIn\(\{emailConfirmed:true,aal2:id\.aal2,hasVerifiedFactor,mfaOff:mfaSwitchedOff\(\(env as \{STAFF_MFA\?:string\}\)\.STAFF_MFA\)\}\)/);
// Issue #274: the authenticator level is read once per request from the session token; there is no second check.
assert.equal((auth.match(/getAuthenticatorAssuranceLevel|currentLevel/g) || []).length, 0, 'no second authenticator check in account-auth');
assert.equal((auth.match(/fullySignedIn\(/g) || []).length, 1, 'the policy is applied in one place');
// The launch checklist shows it in red while it's off.
const cl = readFileSync('lib/launch-checklist.ts', 'utf8');
assert.match(cl, /key: 'mfa-off', group: 'Safety', label: 'Authenticator sign-in is turned off', status: 'todo'/);
console.log('mfa-switch ok');
