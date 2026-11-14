// Issue #320: every email the site sends goes out in the Savage layout, as HTML plus the plain text the caller wrote.
// lib/email-brand.ts builds the HTML from the plain text (pure, no browser needed); lib/email.ts adds it to every
// message it hands to the email service.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import {makeDb} from './fixtures/d1.mjs';

const transpile = file => ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
// The layout needs nothing from its surroundings: no imports, no fetch, no URL, no environment.
const brandModule = {exports: {}};
vm.runInNewContext(transpile('lib/email-brand.ts'), {module: brandModule, exports: brandModule.exports, require(name) { throw Error('lib/email-brand.ts must not import ' + name); }});
const brand = brandModule.exports;
const {brandedEmail} = brand;

const O = 'https://swa.example';
const notice = (body, link = '/inbox') => `${body}\n\n—\nSavage Wrestling Academy\n${O}${link}`;
const count = (html, piece) => html.split(piece).length - 1;

// --- The layout: header, card, button, footer ---
const text = notice('Sam Example is booked for the SWA Intermediate walk-in on Monday, November 16 at 6:00 PM. Pay $40.00 in cash at the academy.', '/family#purchaseHistory');
let mail = brandedEmail({subject: 'Booked: SWA Intermediate walk-in', text, origin: O});
assert.equal(mail.text, text, 'the plain text is exactly what the caller wrote');
let html = mail.html;
assert.match(html, /^<!doctype html>\n<html lang="en">/);
assert.match(html, /<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">/);
assert.match(html, /<title>Booked: SWA Intermediate walk-in<\/title>/);
// Header: black band, the mark from the site's own address, the wordmark as text, the red rule.
assert.match(html, /bgcolor="#111113" style="background:#111113;[^"]*border-bottom:3px solid #C4222C/);
assert.match(html, /<img src="https:\/\/swa\.example\/brand\/savage-logo-128\.png" width="64" height="64" alt="Savage Wrestling Academy"/);
assert.ok(statSync('public' + brand.LOGO_PATH).size > 0, 'the logo the header loads exists in public/');
assert.match(html, /letter-spacing:7px;[^"]*color:#FFFFFF;text-transform:uppercase;">Savage<\/div>/, 'SAVAGE in white caps, as text');
assert.match(html, /color:#B9C4C9;text-transform:uppercase;">Wrestling Academy<\/div>/, 'WRESTLING ACADEMY in silver');
assert.match(html, /font-family:'Arial Narrow','Helvetica Neue',Arial,sans-serif/);
// Card: white, 600px at most, on the grey ground; the subject as the headline; body text 16px/1.55 in ink.
assert.match(html, /style="max-width:600px;margin:0 auto;"/);
assert.match(html, /<body class="swa-ground" style="margin:0;padding:0;background:#F3F4F6;/);
assert.match(html, /bgcolor="#FFFFFF" style="background:#FFFFFF;[^"]*font-size:16px;line-height:1\.55;color:#111113;"/);
assert.match(html, /<h1 class="swa-h"[^>]*>Booked: SWA Intermediate walk-in<\/h1>/);
assert.match(html, /<p class="swa-text"[^>]*>Sam Example is booked for the SWA Intermediate walk-in[^<]*<\/p>/);
// Button: the first link to the site itself, with a full address, named after the page it opens.
assert.match(html, /bgcolor="#C4222C"[^>]*><a href="https:\/\/swa\.example\/family#purchaseHistory" style="[^"]*font-weight:700;[^"]*text-transform:uppercase;color:#FFFFFF;[^"]*">Open your family account<\/a>/);
assert.match(html, /If the button doesn’t work, paste this link into your browser:<br><a href="https:\/\/swa\.example\/family#purchaseHistory"[^>]*>https:\/\/swa\.example\/family#purchaseHistory<\/a>/);
// Footer: the academy, its address, and why the reader got it. The plain-text sign-off is not repeated in the card.
assert.match(html, /Savage Wrestling Academy &middot; 20 Railroad St, Huntington Station, NY 11746<br>You’re getting this because you have an account with Savage Wrestling Academy\./);
assert.match(readFileSync('lib/interest.ts', 'utf8'), new RegExp(`ACADEMY_ADDRESS = '${brand.ACADEMY_ADDRESS}'`), 'the same address the site shows families');
assert.ok(!html.includes('—'), 'the "—" sign-off stays in the plain text only');
assert.equal(count(html, 'Savage Wrestling Academy<br>'), 0);
// The line an inbox shows after the subject: the first sentence, hidden in the email itself.
assert.match(html, /<div style="display:none;[^"]*">Sam Example is booked for the SWA Intermediate walk-in on Monday, November 16 at 6:00 PM\.<\/div>/);
// Safe for email apps: tables marked as layout, no scripts, no fonts or styles to download, nothing but the logo loaded.
assert.ok(count(html, '<table') >= 2 && count(html, '<table') === count(html, 'role="presentation"') + 0, 'every table is a layout table');
assert.doesNotMatch(html, /<script|<link|@import|@font-face|url\(|javascript:|\son\w+=/i);
assert.equal(count(html, '<img'), 1);
assert.equal(count(html, '<style>'), 1, 'one small style block, for phones and dark mode');
assert.match(html, /@media \(prefers-color-scheme:dark\)/); assert.match(html, /@media \(max-width:480px\)/);
assert.ok(!html.includes('{{'), 'nothing Supabase would read as a variable');

// --- Everything from families and the owner is escaped ---
const nasty = `<script>alert("x")</script> & "quotes" 'single' <img src=x onerror=alert(1)>`;
mail = brandedEmail({subject: nasty, text: notice(`Hi <b>Pat</b> & family,\n${nasty}\n\nSee <a href="javascript:alert(1)">this</a> or javascript:alert(1)`), origin: O});
html = mail.html;
assert.doesNotMatch(html, /<script/i); assert.doesNotMatch(html, /<b>|<img src=x|onerror=alert\(1\)>/);
assert.equal(count(html, '<img'), 1, 'only the logo');
assert.match(html, /<title>&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &quot;quotes&quot; &#39;single&#39; &lt;img src=x onerror=alert\(1\)&gt;<\/title>/);
assert.match(html, /<h1[^>]*>&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &quot;quotes&quot; &#39;single&#39;/);
assert.match(html, /Hi &lt;b&gt;Pat&lt;\/b&gt; &amp; family,<br>&lt;script&gt;/, 'line breaks kept, text escaped');
assert.doesNotMatch(html, /href="javascript:/i, 'only http and https addresses become links');
assert.match(html, /&lt;a href=&quot;javascript:alert\(1\)&quot;&gt;this&lt;\/a&gt;/);
// An address that tries to break out of its attribute stops at the quote and stays escaped.
html = brandedEmail({subject: 's', text: 'Go to https://evil.example/"onmouseover="alert(1) now & then', origin: O}).html;
assert.match(html, /<a href="https:\/\/evil\.example\/" class="swa-link"[^>]*>https:\/\/evil\.example\/<\/a>&quot;onmouseover=&quot;alert\(1\) now &amp; then/);
html = brandedEmail({subject: 's', text: `${O}/family?a=1&b=<x>`, origin: O}).html;
assert.match(html, /<a href="https:\/\/swa\.example\/family\?a=1&amp;b=" style=/, 'the button address is escaped too');

// --- Links ---
// Other sites stay text links; the sentence's own punctuation is not part of the address.
html = brandedEmail({subject: 'Card', text: notice('Renew at https://www.usawmembership.com/login. Then (see https://example.test/help) update it.', '/family#summary'), origin: O}).html;
assert.match(html, /Renew at <a href="https:\/\/www\.usawmembership\.com\/login" class="swa-link"[^>]*>https:\/\/www\.usawmembership\.com\/login<\/a>\. Then \(see <a href="https:\/\/example\.test\/help"[^>]*>https:\/\/example\.test\/help<\/a>\) update it\./);
assert.equal(count(html, 'bgcolor="#C4222C"'), 1, 'one button');
assert.match(html, /<a href="https:\/\/swa\.example\/family#summary" style=/);
// A look-alike address is not the site: no button for it.
html = brandedEmail({subject: 's', text: 'Open https://swa.example.evil.test/family or https://swa.examplex/inbox', origin: O}).html;
assert.equal(count(html, 'bgcolor="#C4222C"'), 0);
assert.match(html, /<a href="https:\/\/swa\.example\.evil\.test\/family" class="swa-link"/);
// The first link to the site is the button; a second one stays a text link.
const alert = ['The site recorded 2 new problems.', '', `See what happened on the Site health page (owner sign-in needed):\n${O}/site-health\nand under Payment attempts on Payments:\n${O}/payments#attempts`, '',
  'You get at most one of these emails an hour.', '', '—', 'Savage Wrestling Academy site'].join('\n');
html = brandedEmail({subject: 'Site alert: 2 new problems on the academy site', text: alert, origin: O, audience: 'owner'}).html;
assert.equal(count(html, 'bgcolor="#C4222C"'), 1);
assert.match(html, /owner sign-in needed\):<\/p>\n<table role="presentation"[^>]*><tr><td[^>]*><a href="https:\/\/swa\.example\/site-health"[^>]*>Open Site health<\/a>/, 'the button sits where the address was');
assert.match(html, /and under Payment attempts on Payments:<br><a href="https:\/\/swa\.example\/payments#attempts" class="swa-link"/);
assert.ok(html.indexOf('Open Site health') < html.indexOf('You get at most one of these emails an hour.'));
assert.match(html, /You’re getting this because you run the Savage Wrestling Academy site\./, 'owner alerts say why the owner got them');
assert.ok(!html.includes('Savage Wrestling Academy site</p>'), 'the sign-off is the footer’s job');
// Button names come from the page; anything unknown gets the safe default.
for (const [link, label] of [['/inbox', 'Read your messages'], ['/family#summary', 'Open your family account'], ['/coach-join#invite=abc', 'Accept your invite'], ['/coach', 'Open coach home'],
  ['/coach-time', 'Open your hours'], ['/waiver?wrestler=w1', 'Sign the waiver'], ['/consent?wrestler=w1', 'Sign the consent form'], ['/contract', 'Sign your contract'], ['/wrestler?id=w1', 'Open the wrestler view'],
  ['/register?program=Advanced', 'Choose training'], ['/lesson', 'Open private lessons'], ['/payments#attention', 'Open Payments'], ['/approvals', 'Open approvals'], ['/site-health', 'Open Site health'],
  ['/something-new/later', 'Open Savage Wrestling Academy'], ['', 'Open Savage Wrestling Academy'], ['/', 'Open Savage Wrestling Academy'], ['/constructor', 'Open Savage Wrestling Academy']]) {
  assert.equal(brand.buttonLabel(O + link, O), label, link);
  assert.match(brandedEmail({subject: 's', text: notice('Hello.', link), origin: O}).html, new RegExp(`<a href="${(O + link).replace(/[.?]/g, '\\$&')}" style="[^"]*">${label}</a>`), link);
}
// Every page a notice links to today has its own button name (lib/notify.ts and the other senders).
const linked = new Set();
for (const file of ['lib/notify.ts', 'lib/cash-bookings.ts', 'lib/lessons.ts', 'lib/coach-time-off.ts', 'app/api/coach-openings/route.ts'])
  for (const [, page] of readFileSync(file, 'utf8').matchAll(/link: (?:\([^)]*\? )?'\/([a-z-]+)/g)) linked.add(page);
assert.ok(linked.size >= 8, 'found the notices’ links');
for (const page of linked) assert.notEqual(brand.buttonLabel(`${O}/${page}`, O), brand.DEFAULT_LABEL, `/${page} has a button name`);

// --- A coach invite: the button where the link was, the invite line in the footer, the rest in order ---
const invite = `Hi Dana Example,\n\nSavage Wrestling Academy has invited you to join as a coach for SWA Intermediate.\n\nOpen this link to create your coach account (or sign in with dana@example.test) and set up your authenticator app:\n${O}/coach-join#invite=tok_123\n\nThe link works once and ends on November 21. If it stops working, ask the academy for a new one.\n\n—\nSavage Wrestling Academy`;
mail = brandedEmail({subject: 'You’re invited to coach at Savage Wrestling Academy', text: invite, origin: O, audience: 'invite'});
assert.equal(mail.text, invite);
html = mail.html;
assert.match(html, /authenticator app:<\/p>\n<table[^>]*><tr><td[^>]*><a href="https:\/\/swa\.example\/coach-join#invite=tok_123"[^>]*>Accept your invite<\/a>/);
assert.ok(html.indexOf('Hi Dana Example,') < html.indexOf('Accept your invite') && html.indexOf('Accept your invite') < html.indexOf('The link works once'));
assert.match(html, /You’re getting this because Savage Wrestling Academy invited you to coach\./);
assert.doesNotMatch(html, /you have an account/);
assert.match(html, /<div style="display:none;[^"]*">Hi Dana Example,<\/div>/);

// --- An announcement: the owner's paragraphs and line breaks kept; the inbox link is the button ---
const announcement = 'Practice moves to 6:30 tonight.\nDoors open at 6:15.\n\n\nBring:\n- water\n- headgear\r\n\r\nSee you there.' + '\n\n—\nSavage Wrestling Academy\nRead and reply in your family account: ' + O + '/inbox';
mail = brandedEmail({subject: 'Practice moved', text: announcement, origin: O});
assert.equal(mail.text, announcement);
html = mail.html;
assert.match(html, /<p class="swa-text"[^>]*>Practice moves to 6:30 tonight\.<br>Doors open at 6:15\.<\/p>\n<p class="swa-text"[^>]*>Bring:<br>- water<br>- headgear<\/p>\n<p class="swa-text"[^>]*>See you there\.<\/p>\n<table/);
assert.match(html, /<a href="https:\/\/swa\.example\/inbox" style="[^"]*">Read your messages<\/a>/);
assert.ok(!html.includes('Read and reply in your family account'), 'the button and the paste line carry the link');
// An announcement with its own "—" line keeps it; only the sign-off at the very end is the footer's.
html = brandedEmail({subject: 'Note', text: notice('One.\n\n—\n\nTwo.\n\nThree.\n\nFour.\n\nFive.'), origin: O}).html;
assert.match(html, /<p class="swa-text"[^>]*>—<\/p>\n<p class="swa-text"[^>]*>Two\.<\/p>/);
// A sign-off line that is neither the academy's name nor the button's link is kept.
html = brandedEmail({subject: 'Note', text: 'Hello.\n\n—\nCoach Justin\nSavage Wrestling Academy', origin: O}).html;
assert.match(html, /<p class="swa-text"[^>]*>Hello\.<\/p>\n<p class="swa-text"[^>]*>Coach Justin<\/p>/);

// --- A first line that only repeats the subject is not said twice (the test alert) ---
html = brandedEmail({subject: 'Test alert: no action needed', text: `Test alert: no action needed.\n\nNothing is wrong with the site.\n\nSite health page (owner sign-in needed):\n${O}/site-health\n\n—\nSavage Wrestling Academy site`, origin: O, audience: 'owner'}).html;
assert.equal(count(html, 'Test alert: no action needed'), 2, 'the title and the headline');
assert.match(html, /<div style="display:none;[^"]*">Nothing is wrong with the site\.<\/div>/);
assert.match(html, />Open Site health<\/a>/);

// --- Without a site address: still branded, with text links, no button and no picture to load ---
for (const origin of [undefined, null, '', 'not a url', 'javascript:alert(1)', 'https://swa.example/path', 'https://swa.example"><script>']) {
  html = brandedEmail({subject: 'Booked', text, origin}).html;
  assert.equal(count(html, '<img'), 0, String(origin)); assert.equal(count(html, 'bgcolor="#C4222C"'), 0);
  assert.match(html, />Savage<\/div>/); assert.match(html, /20 Railroad St/);
  assert.match(html, /<a href="https:\/\/swa\.example\/family#purchaseHistory" class="swa-link"/, 'the link is still there, as a text link');
  assert.doesNotMatch(html, /<script/);
}
assert.match(brandedEmail({subject: 's', text, origin: O + '/'}).html, /<img src="https:\/\/swa\.example\/brand\//, 'a trailing slash on the address is fine');

// --- Empty and odd input never throws ---
for (const [subject, body] of [['', ''], ['Only a subject', ''], ['', '\n\n\n'], [undefined, undefined], [null, null], [42, {}], ['s', '—'], ['s', '—\n—\n—'], ['s', O], ['s', `${O}\n${O}`], ['s', 'https://'], ['s', 'x'.repeat(20000)],
  ['s', '\r\n\r\nline\r\n'], ['s', '((((https://a.test/))))...'], ['😀 emoji', 'Ünïcödé ✓ 日本語']]) {
  const made = brandedEmail({subject, text: body, origin: O});
  assert.ok(made.html.startsWith('<!doctype html>') && made.html.endsWith('</body></html>'));
  assert.match(made.html, />Savage<\/div>/); assert.match(made.html, /20 Railroad St/);
  assert.equal(made.text, String(body ?? ''));
}
assert.doesNotThrow(() => brandedEmail(undefined)); assert.doesNotThrow(() => brandedEmail({}));
assert.match(brandedEmail({subject: '', text: 'Hi', origin: O}).html, /<h1[^>]*>Savage Wrestling Academy<\/h1>/, 'no subject: the academy’s name is the headline');
assert.match(brandedEmail({subject: 's', text: 'Ünïcödé ✓', origin: O}).html, /Ünïcödé ✓/);
assert.match(brandedEmail({subject: 's', text: 'Hi', audience: 'nonsense'}).html, /you have an account with/, 'an unknown audience gets the usual line');

// A long, odd message is still quick to build (no slow patterns on a run of dots or spaces).
{
  const started = Date.now();
  for (const filler of ['.', ' ', '!', ')', '—\n', 'https://a.test/..........']) brandedEmail({subject: filler.repeat(150), text: `${O}/family${filler.repeat(20000)}x\n\n${filler.repeat(20000)}x`, origin: O});
  assert.ok(Date.now() - started < 2000, 'built in ' + (Date.now() - started) + 'ms');
}

// --- No address is written into the layout: it comes from appOrigin() through lib/email.ts ---
const source = readFileSync('lib/email-brand.ts', 'utf8');
assert.doesNotMatch(source, /https?:\/\/[a-z0-9]/i, 'no hard-coded hostname in lib/email-brand.ts');
assert.doesNotMatch(source, /workers\.dev|savagewrestling\.com|chatgpt/i);
assert.doesNotMatch(source, /^import /m, 'pure: no imports');

// --- lib/email.ts: every message goes to the email service with both html and text ---
const env = {EMAIL_API_KEY: 'test-key', MAIL_FROM: 'SWA <academy@swa.example>'};
let origin = () => O, layout = brand, requests = [];
const logged = [];
function loadEmail() {
  const module = {exports: {}};
  vm.runInNewContext(transpile('lib/email.ts'), {module, exports: module.exports, JSON, String, console: {error: (...a) => logged.push(a)},
    fetch: async (url, init) => { requests.push({url, init, body: JSON.parse(init.body)}); return new Response('{}', {status: 200}); },
    require(name) {
      if (name === 'cloudflare:workers') return {env};
      if (name.endsWith('/account-auth')) return {appOrigin: () => origin(), OWNER_EMAIL: 'savagewrestlingclub@gmail.com'};
      if (name.endsWith('/email-brand')) return layout;
      if (name.endsWith('/net')) return {EMAIL_TIMEOUT_MS: 10000, timeoutSignal: () => undefined};
      throw Error('unexpected import ' + name);
    }});
  return module.exports;
}
let email = loadEmail();
const outgoing = [
  {to: 'pat@example.test', subject: 'Booked: SWA Intermediate walk-in', text},
  {to: 'savagewrestlingclub@gmail.com', subject: 'Payment needs attention: Sam (pat@example.test)', text: notice('A monthly payment failed.', '/payments#attention')},
  {to: 'Savagewrestlingclub@Gmail.com', subject: 'Site alert: 2 new problems on the academy site', text: alert, audience: 'owner'},
  {to: 'dana@example.test', subject: 'You’re invited to coach at Savage Wrestling Academy', text: invite, audience: 'invite'},
  {to: 'lee@example.test', subject: '<b>Hi</b>', text: 'A & B'}
];
const before = JSON.stringify(outgoing);
let results = await email.sendEmailsDetailed(outgoing);
assert.deepEqual(JSON.parse(JSON.stringify(results)), outgoing.map(() => ({status: 'sent', reason: null})), 'one result per message, as before');
assert.equal(JSON.stringify(outgoing), before, 'the caller’s messages are not changed');
assert.equal(requests.length, 1); assert.equal(requests[0].url, 'https://api.resend.com/emails/batch');
let sent = requests[0].body;
assert.equal(sent.length, outgoing.length);
sent.forEach((m, i) => {
  assert.deepEqual(Object.keys(m).sort(), ['from', 'html', 'subject', 'text', 'to'], 'html and text for every message, and nothing extra');
  assert.equal(m.text, outgoing[i].text, 'plain text exactly as the caller wrote it'); assert.equal(m.subject, outgoing[i].subject, 'subjects are left alone');
  assert.deepEqual(m.to, [outgoing[i].to]); assert.equal(m.from, 'SWA <academy@swa.example>');
  assert.equal(m.html, brandedEmail({subject: outgoing[i].subject, text: outgoing[i].text, origin: O, audience: ['account', 'owner', 'owner', 'invite', 'account'][i]}).html);
  assert.match(m.html, />Savage<\/div>/); assert.match(m.html, /20 Railroad St/);
  assert.match(m.html, /<img src="https:\/\/swa\.example\/brand\/savage-logo-128\.png"/, 'the logo address comes from appOrigin()');
});
assert.match(sent[0].html, /you have an account with/); assert.match(sent[1].html, /you run the Savage Wrestling Academy site/, 'email to the owner address gets the owner line');
assert.match(sent[2].html, /you run the Savage Wrestling Academy site/); assert.match(sent[3].html, /invited you to coach/);
assert.match(sent[4].html, /<h1[^>]*>&lt;b&gt;Hi&lt;\/b&gt;<\/h1>/); assert.match(sent[4].html, /A &amp; B/);
assert.deepEqual([...await email.sendEmails(outgoing.slice(0, 2))], ['sent', 'sent'], 'sendEmails still answers with one status per message');
// More than 100 messages: batches of 100, each one branded.
requests = [];
results = await email.sendEmailsDetailed(Array.from({length: 205}, (_, i) => ({to: `f${i}@example.test`, subject: 'Practice moved', text: announcement})));
assert.equal(results.length, 205); assert.deepEqual(requests.map(r => r.body.length), [100, 100, 5]);
assert.ok(requests.every(r => r.body.every(m => m.html.includes('>Read your messages</a>') && m.text === announcement)));
// The same message to everyone is laid out once; a different footer line or text is its own layout.
{
  let builds = 0;
  layout = {...brand, brandedEmail(input) { builds++; return brand.brandedEmail(input); }}; email = loadEmail(); requests = [];
  await email.sendEmailsDetailed([...Array.from({length: 150}, (_, i) => ({to: `f${i}@example.test`, subject: 'Practice moved', text: announcement})),
    {to: 'savagewrestlingclub@gmail.com', subject: 'Practice moved', text: announcement}, {to: 'x@example.test', subject: 'Practice moved', text: announcement + '!'}]);
  assert.equal(builds, 3); assert.equal(requests.flatMap(r => r.body).filter(m => m.html.includes('you have an account')).length, 151);
  layout = brand; email = loadEmail();
}
// Without APP_ORIGIN the email still goes, branded, with no logo and no button.
origin = () => { throw Error('APP_ORIGIN is not set.'); }; requests = [];
results = await email.sendEmailsDetailed([{to: 'savagewrestlingclub@gmail.com', subject: 'Test alert: no action needed', text: 'Test alert: no action needed.\n\nSee the Site health page in the owner dashboard.\n\n—\nSavage Wrestling Academy site', audience: 'owner'}]);
assert.equal(results[0].status, 'sent');
assert.match(requests[0].body[0].html, />Savage<\/div>/); assert.equal(count(requests[0].body[0].html, '<img'), 0); assert.doesNotMatch(requests[0].body[0].html, /https?:\/\//);
origin = () => O;
// If the layout ever fails, the plain text goes alone rather than nothing.
layout = {brandedEmail() { throw Error('layout broke'); }}; email = loadEmail(); requests = [];
results = await email.sendEmailsDetailed([outgoing[0]]);
assert.equal(results[0].status, 'sent'); assert.deepEqual(Object.keys(requests[0].body[0]).sort(), ['from', 'subject', 'text', 'to']); assert.equal(requests[0].body[0].text, text);
assert.equal(logged.length, 1);
layout = brand; email = loadEmail();
// Email not set up: nothing is sent and nothing is built.
delete env.EMAIL_API_KEY; requests = [];
assert.deepEqual(JSON.parse(JSON.stringify(await email.sendEmailsDetailed([outgoing[0]]))), [{status: 'skipped', reason: null}]); assert.equal(requests.length, 0);

// --- Nothing else sends email: lib/email.ts is the only code that talks to the email service ---
const walk = dir => readdirSync(dir, {withFileTypes: true}).flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name)) : /\.(ts|tsx|js|mjs|html)$/.test(d.name) ? [path.join(dir, d.name)] : []);
const code = ['app', 'lib', 'build', 'public'].flatMap(walk);
assert.deepEqual(code.filter(f => /api\.resend\.com|api\.sendgrid\.com|api\.mailgun\.net|api\.postmarkapp\.com|\/emails\/batch/i.test(readFileSync(f, 'utf8'))).map(f => f.split(path.sep).join('/')), ['lib/email.ts']);
const adapter = readFileSync('lib/email.ts', 'utf8');
assert.equal(count(adapter, 'fetch('), 1); assert.match(adapter, /body: JSON\.stringify\(chunk\.map\(m => emailPayload\(m, e\.MAIL_FROM, origin, built\)\)\)/);
assert.match(adapter, /import \{appOrigin, OWNER_EMAIL\} from '\.\/account-auth'/, 'the site address comes from appOrigin()');
// Every sender goes through sendEmails or sendEmailsDetailed (a new one is branded without doing anything), and the
// alerts and the invite name their footer line.
const senders = code.filter(f => f !== path.join('lib', 'email.ts') && /\bsendEmails(Detailed)?\(/.test(readFileSync(f, 'utf8'))).map(f => f.split(path.sep).join('/'));
for (const f of ['lib/coach-invites.ts', 'lib/email-failures.ts', 'lib/messages.ts', 'lib/notify.ts', 'lib/owner-alerts.ts']) assert.ok(senders.includes(f), f + ' sends through lib/email.ts');
assert.equal(count(readFileSync('lib/owner-alerts.ts', 'utf8'), "audience: 'owner'"), 2, 'the alert and the test alert');
assert.match(readFileSync('lib/coach-invites.ts', 'utf8'), /audience: 'invite'/);

// --- A coach invite through the real code: the link the owner copies is the button the coach gets ---
{
  const inviteEnv = {DB: makeDb().DB, EMAIL_API_KEY: 'test-key', MAIL_FROM: 'SWA <academy@swa.example>'}, posted = [], cache = new Map();
  const loadLib = file => {
    if (cache.has(file)) return cache.get(file);
    const module = {exports: {}}; cache.set(file, module.exports);
    vm.runInNewContext(transpile(file), {module, exports: module.exports, crypto, TextEncoder, Uint8Array, Date, JSON, String, Array, console,
      fetch: async (url, init) => { posted.push(...JSON.parse(init.body)); return new Response('{}', {status: 200}); },
      require(name) {
        if (name === 'cloudflare:workers') return {env: inviteEnv};
        if (name.endsWith('/account-auth')) return {appOrigin: () => O, OWNER_EMAIL: 'savagewrestlingclub@gmail.com'};
        return loadLib(path.join('lib', name.replace('./', '') + '.ts'));
      }});
    return module.exports;
  };
  const made = await loadLib(path.join('lib', 'coach-invites.ts')).createInvite({name: 'Dana Example', email: 'dana@example.test', programs: ['Intermediate']}, 'owner-id');
  assert.equal(made.status, 200); assert.equal(made.emailStatus, 'sent'); assert.equal(posted.length, 1);
  const [m] = posted;
  assert.deepEqual(Object.keys(m).sort(), ['from', 'html', 'subject', 'text', 'to']); assert.deepEqual(m.to, ['dana@example.test']);
  assert.equal(m.subject, 'You’re invited to coach at Savage Wrestling Academy');
  assert.ok(m.text.startsWith('Hi Dana Example,\n\nSavage Wrestling Academy has invited you to join as a coach for SWA Intermediate.') && m.text.includes('\n' + made.link + '\n'), 'the plain text is as before');
  assert.ok(m.html.includes(`<a href="${made.link}" style=`) && m.html.includes('>Accept your invite</a>'), 'the invite link is the button');
  assert.match(m.html, />Savage<\/div>/); assert.match(m.html, /You’re getting this because Savage Wrestling Academy invited you to coach\./);
  assert.equal(count(m.html, made.link), 3, 'the button, and the paste line’s link and text');
}

console.log('Email brand tests passed');
