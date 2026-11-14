// Pages describe the site as it is now (issue #349): email works, payments and messaging are built, and nothing calls
// itself unfinished or a sample. Wording that is only shown while something is switched off (a note with `hidden`, a
// reply from the server) is not covered here.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = f => readFileSync(f, 'utf8');
const visible = html => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');

// Approvals: the family is emailed and gets a notice when the owner decides (lib/notify.ts noticeApproval).
const approvals = visible(read('app/approvals/screen.html'));
assert.match(approvals, /The family gets an email and a notice in their account when you decide/);
assert.doesNotMatch(approvals, /Email isn’t set up yet|Email isn't set up yet/);

// Account setup: only the sign-in link settings and where the other settings are. Nothing about unfinished features.
const setup = read('app/account-setup/route.ts');
assert.match(setup, /<h1>Sign-in settings<\/h1>/);
assert.match(setup, /1\. Set the email link destination/, 'the Supabase link settings stay: they are needed again when the address changes');
assert.match(setup, /<a href="\/payment-setup">Online payment setup<\/a>/); assert.match(setup, /<a href="\/site-health">Site health<\/a>/);
assert.doesNotMatch(setup, /unfinished|still being tested|sample views|demonstrations|Live charges remain disabled|default email service|Create account/i);

// Coach help: email works, and the clock, the month and time off are explained, matching the words on Your hours.
const coach = visible(read('app/help/coach/screen.html')), hours = read('app/coach-time/screen.html');
assert.doesNotMatch(coach, /Once the academy sets up email/);
assert.match(coach, /<li><a href="#hours">Your hours and time off<\/a><\/li>/);
const section = coach.match(/<section id="hours">[\s\S]*?<\/section>/)?.[0] ?? '';
assert.match(section, /<a href="\/coach-time">Your hours<\/a>/);
for (const words of ['Fix the times', 'Ask for time off', 'Forgot to clock in?']) { assert.ok(section.includes(words), 'help names ' + words); assert.ok(hours.includes(words), 'and Your hours has ' + words); }
assert.match(section, /Only the academy sees your reason/); assert.match(hours, /Only the academy sees your reason/);
assert.match(section, /Private lessons are paid separately, from what families paid for them\./); assert.match(hours, /Private lessons are paid separately, from what families paid for them\./);
assert.doesNotMatch(section, /\$\d/, 'rates are shown on the page, from lib/coach-time.ts, never copied into help');

// Owner guide and Site health no longer speak of email as something still to come.
assert.doesNotMatch(visible(read('app/help/owner/screen.html')), /Once email is set up|Until email is set up/);
assert.doesNotMatch(read('app/site-health/screen.html'), /now and then until email is set up/);
console.log('Passed: Approvals, Account setup, coach help, the owner guide and Site health describe the site as it is now; coach help covers hours and time off.');
