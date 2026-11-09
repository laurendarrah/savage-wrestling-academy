// Issue #296: the browser walkthrough notes Chromium's abort of a View Transition into a page that did not opt in,
// and fails on every other page error, including other View Transition messages and errors that only mention one.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ABORTED_TRANSITION, abortedTransition, pageError} from '../scripts/e2e/page-errors.mjs';

// Chromium's wording, as a page error reports it (Chrome for Testing 153).
assert.equal(ABORTED_TRANSITION, 'Transition was aborted because of invalid state. ViewTransition opt-in disabled');
assert.equal(abortedTransition(ABORTED_TRANSITION), true);
assert.equal(abortedTransition(ABORTED_TRANSITION + ' '), true, 'Chromium joins the reason with a space; trailing space is fine');

const step = 'owner moves through the owner shell', url = 'http://127.0.0.1:8799/#programs';
const noted = pageError(step, url, ABORTED_TRANSITION);
assert.equal(noted.problem, undefined, 'the abort does not fail the walkthrough');
assert.match(noted.note, /^ {4}note: \[owner moves through the owner shell\] the browser aborted a View Transition into http:\/\/127\.0\.0\.1:8799\/#programs/);

// Everything else still fails, with the step, the page and the message.
for (const message of [
  'Transition was aborted because of invalid state.',                               // another reason, or none
  'Transition was aborted because of invalid state. Document hidden',
  'Transition was aborted because of timeout in DOM update.',
  'Transition was skipped',                                                          // the shell skips and must catch it
  'Transition was skipped. ViewTransition opt-in disabled',
  "TypeError: t.skipTransition is not a function",                                  // a real bug in SHELL_BOOT
  "Cannot read properties of null (reading 'skipTransition')",
  'ViewTransition opt-in disabled',
  'Uncaught Error: ' + ABORTED_TRANSITION,                                           // wrapped by page code, not the browser's
  'ReferenceError: render is not defined',
  '', undefined, null,
]) {
  assert.equal(abortedTransition(message), false, JSON.stringify(message));
  const r = pageError(step, url, message);
  assert.equal(r.note, undefined, JSON.stringify(message));
  assert.equal(r.problem, `[${step}] page error on ${url}: ${message}`, JSON.stringify(message));
}

// The walkthrough sends every page it opens through the same check, and has no other filter for page errors.
const journey = readFileSync('scripts/e2e/journey.mjs', 'utf8');
const listeners = journey.match(/\.on\('pageerror',[^\n]*/g) || [];
assert.ok(listeners.length >= 2, 'the walkthrough listens for page errors');
for (const l of listeners) assert.match(l, /^\.on\('pageerror', e => onPageError\((page|p), e\)\)/, l);
assert.doesNotMatch(journey, /browserNoise|Transition was aborted|skipTransition/, 'no second, looser filter for View Transition messages');
assert.match(journey, /function onPageError\(page, e\) \{\n  const \{note, problem\} = pageError\(current, page\.url\(\), e\.message\);\n  if \(note\) \{ console\.log\(note\); return; \}\n  problems\.push\(problem\);/);

console.log('Walkthrough page errors: the aborted View Transition is noted; every other page error fails');
