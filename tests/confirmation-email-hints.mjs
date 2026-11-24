// Issue #421: a family waiting on a confirmation email is told to look in Spam or Junk and how to get a new one, after
// creating an account, after asking for a new confirmation email, and on the coach invite page (as the password reset
// message already does).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const auth = readFileSync('app/api/auth/route.ts', 'utf8'), join = readFileSync('app/coach-join/screen.html', 'utf8');
assert.ok(auth.includes("Check your email to confirm your account, then return here to sign in. Not there in a few minutes? Check your Spam or Junk folder, or choose Didn’t get the confirmation email? on the sign-in page."), 'after Create account');
assert.ok(auth.includes('a confirmation email has been requested. Please check your inbox and your Spam or Junk folder.'), 'after asking for a new one');
assert.ok(auth.includes('Check your inbox and spam folder.'), 'the reset message already said so');
assert.ok(join.includes("for the confirmation email, and the Spam or Junk folder if it isn’t there in a few minutes."), 'the coach invite page');
// The sign-in page still offers a new confirmation email.
assert.match(readFileSync('app/login/screen.html', 'utf8'), /Didn.t get the confirmation email\?/);
console.log('Passed: after creating an account, asking for a new confirmation email, or creating a coach account, the page says to check Spam or Junk and how to get a new email.');
