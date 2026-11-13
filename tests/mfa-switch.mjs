// Issues #204 and #306: staff sign in without an authenticator unless STAFF_MFA=on. Off is the default, so a deploy that
// drops the setting can't bring the requirement back.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const load = f => { const module = {exports: {}}; vm.runInNewContext(ts.transpileModule(readFileSync(f, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {module, exports: module.exports, String}); return module.exports; };
const {fullySignedIn, mfaSwitchedOff} = load('lib/mfa-policy.ts');
for (const v of [undefined, '', 'off', ' OFF ', 'false', '0', 'no']) assert.equal(mfaSwitchedOff(v), true, String(v));
assert.equal(mfaSwitchedOff('on'), false); assert.equal(mfaSwitchedOff(' ON '), false, 'only "on" requires an authenticator');
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
// No red warning any more (#306): a password-only sign-in is the decided policy.
const cl = readFileSync('lib/launch-checklist.ts', 'utf8');
assert.doesNotMatch(cl, /mfa-off/);
console.log('mfa-switch ok');
