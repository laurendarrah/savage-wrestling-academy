// End-to-end walkthrough of the signed-in site in a real browser, against a local build with a stand-in for
// Supabase Auth (scripts/e2e/fake-supabase.mjs). Plays the owner, a coach and two families through every feature,
// and fails on any page error, console error or server error. Local only: never point it at production.
//
// Usage: see scripts/e2e/run.sh
import {createRequire} from 'node:module';
import {start, sessionCookie} from './fake-supabase.mjs';
const require = createRequire(import.meta.url);
let playwright;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { playwright = require(p); break; } catch {} }
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8799', AUTH = process.env.E2E_SUPABASE || 'http://127.0.0.1:54321';
const SHOTS = process.env.E2E_SHOTS || '';
const auth = await start(+new URL(AUTH).port);
const browser = await playwright.chromium.launch();
const ny = k => new Date(Date.now() + k * 864e5).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0);
const problems = [], passed = [];
let current = '';

async function as(name, viewport = {width: 1200, height: 900}) {
  const ctx = await browser.newContext({viewport, deviceScaleFactor: SHOTS ? 2 : 1, ...(viewport.width < 500 ? {isMobile: true, hasTouch: true} : {})});
  const c = sessionCookie(name, AUTH);
  await ctx.addCookies([{name: c.name, value: c.value, url: BASE}]);
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));
  page.on('pageerror', e => { problems.push(`[${current}] page error on ${page.url()}: ${e.message}`); if (process.env.E2E_SWEEP_LOG) console.log('    ERROR', e.message, (e.stack || '').split('\n')[1]); });
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) problems.push(`[${current}] console error on ${page.url()}: ${m.text().slice(0, 200)}`); });
  page.on('response', r => { if (r.status() >= 500) problems.push(`[${current}] HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  return page;
}
async function step(name, fn) {
  current = name;
  try { await fn(); passed.push(name); console.log('PASS', name); }
  catch (e) { problems.push(`[${name}] FAILED: ${e.message.split('\n')[0]}`); console.log('FAIL', name, '-', e.message.split('\n')[0]); }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const text = async (page, sel) => (await page.locator(sel).first().textContent({timeout: 20000})) ?? '';
const waitText = async (page, sel, re, ms = 20000) => { await page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent || ''), [sel, re.source], {timeout: ms}); };
const api = async (page, url, body) => page.evaluate(async ([u, b]) => { const r = await fetch(u, b ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b)} : {cache: 'no-store'}); return {status: r.status, body: await r.json().catch(() => null)}; }, [url, body]);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({path: `${SHOTS}/${name}.png`, fullPage: true}); };

const owner = await as('owner'), family = await as('family'), family2 = await as('family2'), coach = await as('coach');

// ---------- A fresh site: the owner publishes the programs from the launch checklist (issue #147) ----------
await step('on a fresh site the owner publishes the programs with one click', async () => {
  await owner.goto(BASE + '/'); await waitText(owner, '#syncStatus', /Nothing saved yet/);
  const before = await api(owner, '/api/public-schedule');
  expect(before.status === 200 && before.body.programs.length === 0, 'a fresh site should list no programs: ' + JSON.stringify(before.body?.programs));
  const pub = await (await browser.newContext()).newPage();
  await pub.goto(BASE + '/welcome'); await waitText(pub, '#programs', /listed here soon/);
  await owner.waitForSelector('[data-launch="programs"][data-status="todo"]');
  expect(!(await owner.isVisible('text=Preview what families see')), 'the sample preview menu is gone');
  expect(await owner.isVisible('nav.family-links a[href="/welcome"]') && await owner.isVisible('nav.family-links a[href="/calendar"]'), 'header links to what families see');
  await owner.click('#launch button:has-text("Publish the programs")');
  await waitText(owner, '#syncStatus', /All changes saved/);
  await owner.waitForSelector('[data-launch="programs"][data-status="done"]', {state: 'attached'});
  const after = await api(owner, '/api/public-schedule');
  expect(JSON.stringify(after.body.programs.map(p => [p.name, p.monthlyCents, p.annualCents, p.walkInCents])) === JSON.stringify([['SWA Development', 20000, 240000, 4000], ['SWA Intermediate', 20000, 240000, 4000], ['SWA Advance', 20000, 240000, 4000]]), 'published programs: ' + JSON.stringify(after.body.programs));
  await pub.goto(BASE + '/welcome'); await waitText(pub, '#programs', /SWA Development[\s\S]*SWA Intermediate[\s\S]*SWA Advance/);
  await shot(pub, 'welcome-programs'); await pub.close();
});

// ---------- Setup through the owner's real save paths ----------
await step('owner saves the academy schedule, programs, camp and Friday Night Live', async () => {
  await owner.goto(BASE + '/');
  const weekly = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
  const state = {kids: [], bookings: [], messages: [], offers: [], staff: [], attendance: {}, settings: {},
    programs: [['Elementary', 'SWA Development'], ['Intermediate', 'SWA Intermediate'], ['Advanced', 'SWA Advance']].map(([id, name]) => ({id, name, description: '', priceCents: 20000, walkInPriceCents: 4000})),
    seasons: ['Elementary', 'Intermediate', 'Advanced'].map(program => ({program, start: ny(-30), end: ny(120), weekly, excludedDates: []})),
    events: [{id: 'winter-camp', name: 'Winter camp', type: 'Camp', dates: [ny(10), ny(11)], price: 160, day: 90, slots: 1, gradeRange: '', description: ''}],
    extraPractices: [{id: 'fnl', name: 'Friday Night Live', dates: [ny(2)], enabled: true, start: '16:00', end: '17:00', memberCents: 1000, nonMemberCents: 2000}]};
  const got = await api(owner, '/api/academy');
  const r = await owner.evaluate(async ([s, rev]) => { const x = await fetch('/api/academy', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({revision: rev, data: s})}); return {status: x.status, body: await x.json()}; }, [state, got.body.revision]);
  expect(r.status === 200, 'save failed: ' + JSON.stringify(r.body));
  const staff = await api(owner, '/api/staff', {action: 'grant', email: 'coach.dana@example.test', name: 'Coach Dana', programs: ['Intermediate']});
  expect(staff.status === 200, 'coach access: ' + JSON.stringify(staff.body));
});

// ---------- Family: profile and USA Wrestling cards ----------
await step('family saves a profile and wrestler without a card, and sees booking blocked', async () => {
  await family.goto(BASE + '/family');
  await family.waitForSelector('#familyForm');
  await family.fill('[name=parentName]', 'Pat Example'); await family.fill('[name=phone]', '555-0100');
  await family.click('text=+ Add wrestler'); await family.fill('#name0', 'Sam Example'); await family.selectOption('#grade0', '8');
  await family.click('#save');
  await waitText(family, '#status', /saved/);
  await waitText(family, '#savedDetails', /No USA Wrestling card[\s\S]*Booking is blocked/);
  await shot(family, 'family-no-card');
});
await step('family is refused a walk-in without a card, with a link to fix it', async () => {
  await family.goto(BASE + '/register');
  await family.waitForFunction(() => document.querySelectorAll('#wrestler option').length > 0);
  await family.check('#plan-walkin'); await family.selectOption('#program', 'Intermediate');
  await family.waitForSelector('[data-day]'); await family.locator(`[data-day="${ny(1)}"]`).first().click();
  await family.waitForSelector('[data-slot]'); await family.locator('[data-slot]').first().click();
  await family.click('#reviewButton');
  await waitText(family, '#status', /needs a current USA Wrestling card/);
  expect(await family.isVisible('#cardHelp'), 'card help link not shown');
});
// Card seasons (issue #131): a card is entered by choosing its season, which stores August 31. A rare card with another
// date uses "My card has a different expiration date", which is also how this test enters an expired card.
const latestSeason = page => page.$$eval('#usawSeason0 option', os => os.map(o => o.value).filter(v => /^\d{4}-08-31$/.test(v)).pop());
await step('family adds an expired card, then a current one', async () => {
  await family.goto(BASE + '/family'); await family.click('text=Edit family profile');
  expect(await family.isHidden('#usawExpBox0'), 'the date box waits for "different date"');
  await family.fill('#usaw0', 'ab-123456'); await family.selectOption('#usawSeason0', 'other');
  await family.fill('#usawExp0', ny(-3)); await family.click('#save');
  await waitText(family, '#savedDetails', /USA Wrestling card expired/);
  await family.click('text=Edit family profile');
  expect(await family.inputValue('#usawSeason0') === 'other' && await family.inputValue('#usawExp0') === ny(-3), 'a saved special date shows as "different date" with the date filled in');
  const season = await latestSeason(family); expect(season, 'a season to choose');
  await family.selectOption('#usawSeason0', season);
  expect(await family.isHidden('#usawExpBox0'), 'choosing a season hides the date box');
  await family.click('#save');
  await waitText(family, '#savedDetails', /USA Wrestling card on file[\s\S]*Current through Aug 31, \d{4}, the end of the \d{4}–\d{2} season/);
  await family.click('text=Edit family profile');
  expect(await family.inputValue('#usawSeason0') === season, 'the saved season is preselected');
  await family.click('#save'); await waitText(family, '#status', /saved/);
});
await step('owner sees the card on /cards, marks it not valid; family is blocked with the reason', async () => {
  await owner.goto(BASE + '/cards'); await owner.selectOption('#show', 'all');
  await waitText(owner, '#rows', /Sam Example[\s\S]*AB-123456/);
  await waitText(owner, '#tRenewLabel', /^(Not yet renewed for \d{4}–\d{2}|Cards expire Aug 31, \d{4})$/);
  // "Look up on USA Wrestling" copies the number and opens USA Wrestling's check in a new tab (a stand-in page here).
  await owner.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: BASE});
  await owner.context().route('https://www.usawmembership.com/**', r => r.fulfill({status: 200, contentType: 'text/html', body: '<title>USA Wrestling stand-in</title>'}));
  const [popup] = await Promise.all([owner.waitForEvent('popup'), owner.click('#rows a:has-text("Look up on USA Wrestling")')]);
  expect(popup.url() === 'https://www.usawmembership.com/verify_membership', 'lookup opened ' + popup.url());
  expect(await popup.evaluate(() => window.opener === null), 'the USA Wrestling tab has no access to this page');
  await popup.close();
  await waitText(owner, '#status', /Copied AB-123456 for Sam Example|AB-123456 is selected on this page/);
  await owner.fill('#rows input[id^=note]', 'Number not found');
  await owner.click('#rows button:has-text("Not valid")');
  await waitText(owner, '#status', /Marked not valid/);
  const r = await api(family, '/api/registration', {wrestlerId: (await api(family, '/api/family')).body.data.wrestlers[0].id, program: 'Intermediate', plan: 'annual'});
  expect(r.status === 403 && /could not verify .*Number not found/.test(r.body.error), 'expected refusal, got ' + JSON.stringify(r));
  await shot(owner, 'owner-cards');
});
await step('family changes the card: still blocked until the owner checks it; owner verifies', async () => {
  await family.goto(BASE + '/family'); await family.click('text=Edit family profile');
  await family.fill('#usaw0', 'AB-123457'); await family.click('#save');
  await waitText(family, '#savedDetails', /Waiting for the academy/);
  await owner.goto(BASE + '/cards');
  await waitText(owner, '#rows', /Changed after rejection/);
  await owner.click('#rows button:has-text("Verified")');
  await waitText(owner, '#status', /Marked verified/);
  await family.goto(BASE + '/family'); await waitText(family, '#savedDetails', /USA Wrestling card verified/);
});


const wid = async page => (await api(page, '/api/family')).body.data.wrestlers[0].id;
let samId = '';

// ---------- Waivers ----------
await step('owner publishes a waiver; family is blocked until they sign it on /waiver', async () => {
  samId = await wid(family);
  await owner.goto(BASE + '/waivers');
  await owner.fill('#wTitle', 'Participation waiver'); await owner.fill('#wBody', 'Sample waiver text for testing. '.repeat(10));
  await owner.click('#publish'); await waitText(owner, '#status', /Published/);
  const r = await api(family, '/api/registration', {wrestlerId: samId, program: 'Intermediate', plan: 'annual'});
  expect(r.status === 403 && /needs a signed Participation waiver/.test(r.body.error), 'expected waiver block: ' + JSON.stringify(r.body));
  await family.goto(BASE + '/family'); await waitText(family, '#savedDetails', /Waiver not signed/);
  await family.goto(BASE + '/waiver?wrestler=' + samId); await family.waitForSelector('#signatureCanvas');
  await family.locator('#signatureCanvas').scrollIntoViewIfNeeded();
  const box = await family.locator('#signatureCanvas').boundingBox();
  await family.mouse.move(box.x + 30, box.y + 40); await family.mouse.down();
  for (let i = 0; i < 25; i++) await family.mouse.move(box.x + 30 + i * 14, box.y + 40 + Math.sin(i / 3) * 20);
  await family.mouse.up();
  await family.check('#accepted'); await family.check('#electronicConsent'); await family.click('#sign');
  await waitText(family, '#status', /Signed for Sam Example/);
  const copy = await family.locator('a:has-text("View / print")').first().getAttribute('href');
  const res = await family.request.get(BASE + copy); expect(res.status() === 200 && /<polyline/.test(await res.text()), 'signed copy');
  const other = await family2.request.get(BASE + copy); expect(other.status() === 404 || other.status() === 401, 'another family must not open the copy, got ' + other.status());
  const ownerCopy = await owner.request.get(BASE + copy); expect(ownerCopy.status() === 200, 'owner opens the copy');
  await shot(family, 'waiver-signed');
});

// ---------- Visitors and brand-new families (issue #132) ----------
const phoneAs = async name => { const ctx = await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: SHOTS ? 3 : 1, isMobile: true, hasTouch: true});
  if (name) { const c = sessionCookie(name, AUTH); await ctx.addCookies([{name: c.name, value: c.value, url: BASE}]); }
  const p = await ctx.newPage(); p.on('pageerror', e => problems.push(`[${current}] page error on ${p.url()}: ${e.message}`)); return p; };
await step('a signed-out visitor lands on the welcome page with programs, steps and what is coming up', async () => {
  const visitor = await phoneAs(null);
  await visitor.goto(BASE + '/'); expect(new URL(visitor.url()).pathname === '/welcome', 'signed-out home should be /welcome, got ' + visitor.url());
  await waitText(visitor, '#programs', /SWA Development[\s\S]*SWA Intermediate[\s\S]*SWA Advance/);
  await waitText(visitor, '#programs', /\$200 a month[\s\S]*\$40 for a single walk-in practice/);
  await waitText(visitor, '#programs', /needs coach approval/);
  await waitText(visitor, '#week', /practice/);
  expect(!/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}(?! [AP]M)/.test(await visitor.locator('#week').innerText()), 'coming up reads like "Mon, Nov 9 · 6:00 PM"');
  expect(await visitor.getAttribute('a:has-text("Join the academy")', 'href') === '/login?mode=signup', 'join link');
  expect(await visitor.getAttribute('main a[href="/login"], .actions a[href="/login"]', 'href') === '/login', 'sign-in link');
  const over = await visitor.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); expect(over <= 1, `/welcome scrolls sideways by ${over}px`);
  if (SHOTS) await visitor.screenshot({path: `${SHOTS}/phone-welcome.png`, fullPage: true});
  await visitor.context().close();
});
await step('the owner\'s first sign-in goes straight to a clear authenticator setup', async () => {
  const first = await as('freshowner');
  await first.goto(BASE + '/'); await first.waitForURL(/\/security/);
  await waitText(first, '#authHeading', /Set up your authenticator/);
  expect(await first.isVisible('#enroll') && await first.getAttribute('#enroll', 'class').then(c => /primary/.test(c || '')), 'Set up authenticator is the red main button');
  expect(!(await first.isVisible('#codeForm')), 'no code box before setup starts');
  expect(!(await first.isVisible('#backupNote')), 'the backup note waits until verified');
  expect(await first.textContent('#home') === 'Back to sign in', 'no link that loops back to this page');
  const closed = await first.request.get(BASE + '/api/launch-checklist'); expect(closed.status() === 403, 'dashboard data stays closed until the code is verified');
  await first.click('#enroll'); await first.waitForSelector('#enrollment:not([hidden])');
  expect(!(await first.isVisible('#enroll')) && await first.isVisible('#codeForm'), 'the QR step replaces the Set up button');
  if (SHOTS) await first.screenshot({path: `${SHOTS}/owner-first-signin.png`, fullPage: true});
  await first.context().close();
});

await step('a brand-new family sees a guided start, and lessons and booking say what to do first', async () => {
  const fresh = await phoneAs('newfam');
  await fresh.goto(BASE + '/family'); await fresh.waitForSelector('#start:not([hidden])');
  await waitText(fresh, '#startCount', /^0 of 4 done$/);
  expect((await fresh.locator('#startSteps [data-step]').count()) === 4, 'four steps once the academy has a waiver');
  expect(await fresh.locator('main .primary:visible').count() === 1, 'one main button: Save family profile, while the profile form is open');
  expect(!(await fresh.isVisible('#nextUp')), 'no "Next up" before anything is booked');
  expect(!(await fresh.isVisible('#accountMenu .menu a')), 'account links wait in the Account menu');
  if (SHOTS) await fresh.screenshot({path: `${SHOTS}/phone-newfam-family.png`, fullPage: true});
  await fresh.click('#startSteps [data-step=details] button'); await waitText(fresh, '#status', /Add your name and phone number/);
  expect(await fresh.evaluate(() => document.activeElement?.name === 'parentName'), 'the first step goes to the name field');
  await fresh.goto(BASE + '/lesson'); await waitText(fresh, '#closedHeading', /Add your wrestler first/);
  expect(!(await fresh.isVisible('#stepType')), 'lesson steps hidden until they can be used');
  if (SHOTS) await fresh.screenshot({path: `${SHOTS}/phone-newfam-lesson.png`, fullPage: true});
  await fresh.goto(BASE + '/register'); await fresh.waitForSelector('#empty:not([hidden])');
  if (SHOTS) await fresh.screenshot({path: `${SHOTS}/phone-newfam-register.png`, fullPage: true});
  await fresh.goto(BASE + '/inbox'); await waitText(fresh, '#announcements', /No announcements/);
  expect(!(await fresh.isVisible('#markAll')), 'nothing to mark as read');
  await fresh.context().close();
});

// ---------- Walk-in review now passes ----------
await step('family reviews a walk-in once card and waiver are in order', async () => {
  await family.goto(BASE + '/register'); await family.waitForFunction(() => document.querySelectorAll('#wrestler option').length > 0);
  expect(await family.inputValue('#program') === 'Intermediate', 'a Grade 8 wrestler should start on SWA Intermediate');
  await family.check('#plan-walkin'); await family.selectOption('#program', 'Intermediate');
  await family.locator(`[data-day="${ny(1)}"]`).first().click(); await family.locator('[data-slot]').first().click();
  await family.click('#reviewButton');
  await family.waitForFunction(() => /\$40\.00/.test(document.body.textContent), null, {timeout: 8000});
  expect(!(await family.isVisible('#cardHelp')) && !(await family.isVisible('#waiverHelp')), 'help links should be hidden');
  await shot(family, 'register-review');
});

// ---------- Owner records a cash membership; roster, check-in and QR ----------
await step('owner records a cash membership on /payments', async () => {
  await owner.goto(BASE + '/payments');
  await owner.waitForFunction(() => [...document.querySelectorAll('#family option')].some(o => /Pat Example/.test(o.textContent)));
  await owner.selectOption('#family', {label: 'Pat Example · family.a@example.test'});
  await owner.selectOption('#kind', 'annual'); await owner.waitForTimeout(300); await owner.selectOption('#program', 'Intermediate');
  await owner.click('#preview'); await owner.waitForSelector('#previewBox:not([hidden])');
  await owner.selectOption('#method', 'check'); await owner.fill('#note', 'Check 1042'); await owner.click('#record');
  await waitText(owner, '#status', /recorded/i);
  await waitText(owner, '#rows', /Sam Example[\s\S]*\$2,400\.00/);
});
await step('Sam is on today\'s roster; owner checks in, undoes, then a QR scan checks in once', async () => {
  await owner.goto(BASE + '/roster'); await waitText(owner, '#sessions', /Sam Example/);
  await owner.locator('[data-checkin]').first().click(); await waitText(owner, '#status', /checked in/);
  await owner.locator('[data-undo]').first().click(); await waitText(owner, '#status', /Check-in removed/);
  const pass = (await api(family, '/api/passes')).body.passes[0].code;
  let r = await api(owner, '/api/roster', {action: 'scan', date: today, code: pass});
  expect(r.status === 200 && !r.body.scan.already, 'first scan: ' + JSON.stringify(r.body).slice(0, 200));
  r = await api(owner, '/api/roster', {action: 'scan', date: today, code: pass});
  expect(r.body.scan.already === true, 'second scan should say already checked in');
  expect(await owner.isVisible('#scanStart'), 'scan button on roster');
});
await step('family sees the pass, the wrestler view and the membership', async () => {
  await family.goto(BASE + '/pass?wrestler=' + samId); await family.waitForSelector('.qr svg');
  await family.goto(BASE + '/wrestler?id=' + samId); await waitText(family, '#list', /SWA Intermediate/); await waitText(family, '#checkins', /1/);
  await shot(family, 'wrestler-view');
  await family.goto(BASE + '/family'); await waitText(family, '#membershipCards', /Active membership/);
  await waitText(family, '#paymentsPill', /^Paid$/);
  await waitText(family, '#purchaseList', /Paid/);
  // Set up, so the family home leads with the next session and the entry pass instead of the guided start (issue #132).
  await waitText(family, '#nextUpBody', /SWA Intermediate practice[\s\S]*Show entry pass/);
  expect(!(await family.isVisible('#start')), 'a family that is set up does not see the guided start');
  expect(await family.getAttribute('#nextUpBody a.primary', 'href') === '/pass?wrestler=' + samId, 'entry pass button');
  await waitText(family, '#savedDetails', /USA Wrestling card verified[\s\S]*Waiver signed[\s\S]*Member/);
  await shot(family, 'family-home');
});
await step('a coach sees today\'s roster for their program only and can check in', async () => {
  await coach.goto(BASE + '/roster'); await waitText(coach, '#sessions', /SWA Intermediate/);
  const t = await text(coach, '#sessions');
  expect(!/SWA Development|SWA Advance/.test(t), 'coach sees other programs');
  expect(!/family\.a@example\.test/.test(t), 'coach must not see family emails');
});

// ---------- Private lessons ----------
await step('coach adds an opening; owner sets prices; family reviews a lesson; owner records it; coach sees the booking', async () => {
  await coach.goto(BASE + '/coach'); await coach.waitForSelector('#opening');
  await coach.fill('#opening [name=date]', ny(3)); await coach.fill('#opening [name=start]', '15:00'); await coach.fill('#opening [name=end]', '16:00');
  await coach.click('#opening button'); await waitText(coach, '#status', /Opening saved/);
  await owner.goto(BASE + '/lesson-settings'); await owner.waitForSelector('[data-price="one-on-one"]');
  await owner.fill('[data-price="one-on-one"]', '60'); await owner.click('#prices button'); await waitText(owner, '#status', /prices saved/);
  await family.goto(BASE + '/lesson'); await family.waitForSelector('[data-format="one-on-one"]');
  await family.click('[data-format="one-on-one"]'); await family.locator('[data-opening]').first().click();
  await waitText(family, '#summary', /One-on-one lesson[\s\S]*Coach Dana[\s\S]*\$60\.00/);
  expect(await family.isVisible('#notOpen'), 'lesson payment should say not open yet');
  const body = await family.content(); expect(!body.includes('coach.dana@example.test'), 'coach email leaked to family page');
  await shot(family, 'lesson-review');
  await owner.goto(BASE + '/payments'); await owner.waitForFunction(() => [...document.querySelectorAll('#family option')].some(o => /Pat Example/.test(o.textContent)));
  await owner.selectOption('#family', {label: 'Pat Example · family.a@example.test'}); await owner.selectOption('#kind', 'lesson');
  await owner.waitForFunction(() => [...document.querySelectorAll('#opening option')].some(o => o.value));
  await owner.click('#preview'); await owner.waitForSelector('#previewBox:not([hidden])'); await owner.click('#record');
  await waitText(owner, '#status', /recorded/i);
  await coach.goto(BASE + '/coach'); await waitText(coach, '#slots', /Booked: One-on-one lesson with Sam Example/);
  await owner.goto(BASE + '/coach-pay'); await waitText(owner, '#coaches', /Coach Dana[\s\S]*1 lesson/);
});

await step('coach removes an opening nobody booked; the booked one stays', async () => {
  await coach.goto(BASE + '/coach'); await coach.waitForSelector('#opening');
  await coach.fill('#opening [name=date]', ny(4)); await coach.fill('#opening [name=start]', '17:00'); await coach.fill('#opening [name=end]', '18:00');
  await coach.click('#opening button'); await waitText(coach, '#status', /Opening saved/);
  const before = await coach.locator('[data-slot]').count();
  expect(before >= 1, 'the new opening should be removable');
  await coach.locator('[data-slot]').last().click(); await waitText(coach, '#status', /Opening removed/);
  await coach.waitForFunction(n => document.querySelectorAll('[data-slot]').length === n - 1, before);
});

// ---------- Waitlist ----------
await step('camp fills; family 2 joins the waitlist from the booking page; owner offers; family 2 can book', async () => {
  await family2.goto(BASE + '/family'); await family2.waitForSelector('#familyForm');
  await family2.fill('[name=parentName]', 'Riley Parent'); await family2.click('text=+ Add wrestler'); await family2.fill('#name0', 'Riley Two'); await family2.selectOption('#grade0', '8');
  await family2.fill('#usaw0', 'CD-5555'); await family2.selectOption('#usawSeason0', await latestSeason(family2)); await family2.click('#save'); await waitText(family2, '#status', /saved/);
  const rid = await wid(family2);
  await owner.goto(BASE + '/waivers'); await owner.selectOption('#show', 'all');
  await waitText(owner, '#rows', /Riley Two/);
  await owner.locator('summary:has-text("Allow booking anyway")').first().click();
  await owner.locator('[data-exc-until]').first().fill(ny(30)); await owner.locator('[data-exc-reason]').first().fill('Paper waiver at the door');
  await owner.locator('[data-exc-grant]').first().click(); await waitText(owner, '#status', /Exception saved/);
  // Sam takes the only camp seat.
  await owner.goto(BASE + '/payments'); await owner.waitForFunction(() => [...document.querySelectorAll('#family option')].some(o => /Pat Example/.test(o.textContent)));
  await owner.selectOption('#family', {label: 'Pat Example · family.a@example.test'}); await owner.selectOption('#kind', 'event');
  await owner.waitForFunction(() => [...document.querySelectorAll('#event option')].some(o => o.value === 'winter-camp'));
  await owner.click('#preview'); await owner.waitForSelector('#previewBox:not([hidden])'); await owner.click('#record'); await waitText(owner, '#status', /recorded/i);
  await family2.goto(BASE + '/booking?type=event&id=winter-camp'); await family2.waitForSelector('#submit');
  expect(!/\d{4}-\d{2}-\d{2}/.test(await family2.locator('main').innerText()), 'camp dates should be readable, not 2026-11-15');
  // The page is titled with the event and says where each wrestler stands (issue #132).
  await waitText(family2, 'h1', /Winter camp/); await waitText(family2, '#wrestlerStatus', /Riley Two is not registered yet/);
  await family2.click('#submit'); await waitText(family2, '#status', /Join the waitlist/);
  await family2.click('#joinWaitlist'); await waitText(family2, '#status', /on the waitlist/);
  await waitText(family2, '#wrestlerStatus', /Riley Two is on the waitlist/);
  await family.goto(BASE + '/booking?type=event&id=winter-camp'); await waitText(family, '#wrestlerStatus', /Sam Example is already registered/);
  await owner.goto(BASE + '/waitlists'); await waitText(owner, '#events', /Riley Two/);
  await owner.locator('[data-offer]').first().click(); await waitText(owner, '#status', /Seat offered/);
  // The camp was full, so the owner confirmed going over the limit; the page says so instead of a negative number.
  await waitText(owner, '#events', /Full: 1 over the 1-seat limit/);
  await family2.goto(BASE + '/family'); await waitText(family2, '#waitlistList', /Seat held for you/);
  await family2.goto(BASE + '/booking?type=event&id=winter-camp'); await family2.waitForSelector('#submit'); await family2.click('#submit');
  await family2.waitForFunction(() => /\$160\.00/.test(document.body.textContent), null, {timeout: 30000});
  expect(rid, 'riley id');
});

// ---------- Transfers ----------
await step('owner transfers Sam to SWA Advance after approval checks', async () => {
  await owner.goto(BASE + '/transfers'); await owner.waitForFunction(() => [...document.querySelectorAll('#order option')].some(o => o.value));
  await owner.selectOption('#to', 'Advanced'); await owner.fill('#reason', 'Moved up'); await owner.fill('#date', ny(5));
  await owner.click('#form button'); await waitText(owner, '#status', /approv/i);
  await owner.selectOption('#to', 'Elementary'); await owner.click('#form button'); await waitText(owner, '#status', /grades K/);
});

// ---------- Messages ----------
await step('owner announces to SWA Intermediate; family reads it and replies; owner sees the reply', async () => {
  await owner.goto(BASE + '/messages'); await owner.waitForSelector('#audType');
  await owner.selectOption('#audType', 'program'); await owner.selectOption('#program', 'Intermediate'); await waitText(owner, '#audCount', /1 family/);
  await owner.fill('#subject', 'Practice moved'); await owner.fill('#body', 'Practice starts at 6:30 tonight.'); await owner.click('#send');
  await waitText(owner, '#status', /Sent to 1 family/);
  await family.goto(BASE + '/family'); await waitText(family, '#inboxLink', /\d+ new/);
  await family.goto(BASE + '/inbox'); await waitText(family, '#announcements', /Practice moved/);
  // Automatic notices from earlier steps (issue #105).
  await waitText(family, '#notices', /Payment received[\s\S]*/); await waitText(family, '#notices', /Lesson booked/); await waitText(family, '#notices', /Please sign the Participation waiver/);
  await family.fill('#body', 'Thanks, see you there.'); await family.click('#reply button'); await waitText(family, '#thread', /see you there/);
  // The newest notice opens by itself, and one button marks everything read (issue #132).
  expect(await family.locator('#notices details[open]').count() === 1 && await family.locator('#notices details').first().getAttribute('open') !== null, 'newest notice is open');
  await family.waitForSelector('#markAll:not([hidden])'); await family.click('#markAll'); await waitText(family, '#status', /All messages are marked as read/);
  expect(await family.locator('#notices .unread, #announcements .unread').count() === 0 && !(await family.isVisible('#markAll')), 'nothing left unread');
  expect(!((await api(family, '/api/inbox')).body.unread), 'server agrees nothing is unread');
  await family.goto(BASE + '/family'); await family.waitForSelector('#summary:not([hidden])'); await family.waitForTimeout(500);
  expect(!/new/.test(await text(family, '#inboxLink')), 'Messages link no longer counts new messages');
  await family2.goto(BASE + '/inbox'); await waitText(family2, '#announcements', /No announcements/);
  await owner.goto(BASE + '/messages'); await owner.locator('[data-family]').filter({hasText: 'Pat Example'}).click();
  await waitText(owner, '#threadBox', /see you there/);
});

// ---------- Older owner pages ----------
const draw = async (page, sel) => {
  await page.locator(sel).scrollIntoViewIfNeeded(); const box = await page.locator(sel).boundingBox();
  await page.mouse.move(box.x + 30, box.y + 40); await page.mouse.down();
  for (let i = 0; i < 25; i++) await page.mouse.move(box.x + 30 + i * 12, box.y + 40 + Math.sin(i / 3) * 18);
  await page.mouse.up();
};
await step('owner grants coach access on /staff', async () => {
  await owner.goto(BASE + '/staff'); await owner.waitForSelector('#staffForm');
  await owner.fill('#staffForm [name=name]', 'Coach Lee'); await owner.fill('#staffForm [name=email]', 'coach.lee@example.test');
  await owner.check('#staffForm [name=programs][value=Elementary]'); await owner.click('#staffForm button');
  await waitText(owner, '#staff', /Coach Lee/);
});
await step('family requests SWA Advance approval; owner approves; transfer to SWA Advance goes through', async () => {
  await family.goto(BASE + `/register?program=Advanced&wrestler=${samId}`); await family.waitForSelector('#requestApproval');
  await family.waitForFunction(() => !document.querySelector('#requestApproval').closest('[hidden]'), null, {timeout: 8000});
  await family.click('#requestApproval'); await waitText(family, '#status', /Approval request saved/);
  await owner.goto(BASE + '/approvals'); await waitText(owner, '#requests', /Sam Example/);
  await owner.locator('[data-status="approved"]').first().click();
  await waitText(owner, '#requests', /Revoke approval/);
  await owner.goto(BASE + '/transfers'); await owner.waitForFunction(() => [...document.querySelectorAll('#order option')].some(o => o.value));
  await owner.selectOption('#to', 'Advanced'); await owner.fill('#reason', 'Moved up after evaluation'); await owner.fill('#date', ny(5));
  await owner.click('#form button'); await waitText(owner, '#status', /moves to SWA Advance/);
  const later = await api(owner, '/api/roster?date=' + ny(5)), before = await api(owner, '/api/roster?date=' + ny(4));
  const where = r => r.body.sessions.filter(s => s.entries.some(e => e.name === 'Sam Example')).map(s => s.title).join();
  expect(where(later) === 'SWA Advance' && where(before) === 'SWA Intermediate', `roster after transfer: ${where(before)} -> ${where(later)}`);
});
await step('owner offers a scholarship; family 2 accepts it with a drawn signature', async () => {
  await owner.goto(BASE + '/scholarships'); await owner.waitForSelector('#offerForm');
  await owner.fill('#offerForm [name=email]', 'family.b@example.test'); await owner.fill('#offerForm [name=wrestlerName]', 'Riley Two');
  await owner.selectOption('#program', 'Intermediate'); await owner.click('#create');
  await owner.waitForFunction(() => document.querySelector('#inviteUrl')?.value, null, {timeout: 8000});
  const invite = await owner.inputValue('#inviteUrl');
  // Acceptance opens only once the owner saves the attorney-reviewed terms.
  await owner.locator('summary:has-text("attorney-reviewed terms")').first().click();
  await owner.locator('[data-finalize] [name=terms]').first().fill('Sample scholarship terms for testing only. '.repeat(8));
  await owner.locator('[data-finalize] [name=reviewed]').first().check(); await owner.locator('[data-finalize] button').first().click();
  await owner.waitForTimeout(800);
  await family2.goto(invite.replace(/^https?:\/\/[^/]+/, BASE)); await family2.waitForSelector('#acceptForm');
  await family2.fill('#signer', 'Riley Parent'); await draw(family2, '#signatureCanvas');
  await family2.check('#accepted'); await family2.check('#electronicConsent'); await family2.click('#accept');
  await waitText(family2, '#offer', /Scholarship active/);
  await family2.goto(BASE + '/family'); await waitText(family2, '#membershipCards', /Active scholarship/);
  await owner.goto(BASE + '/scholarships'); await waitText(owner, '#awards', /Riley Two[\s\S]*(active|Active)/);
});
await step('owner shares a practice plan; the coach sees it', async () => {
  await owner.goto(BASE + `/practice-plans?program=Intermediate&date=${today}`);
  // The address chooses the practice; wait until the editor has loaded it.
  await owner.waitForFunction(() => document.querySelector('#fields') && !document.querySelector('#fields').disabled && document.querySelector('#planForm [name=title]')?.offsetParent, null, {timeout: 15000});
  await owner.fill('#planForm [name=title]', 'Leg attacks and finishes');
  if (!(await owner.locator('#sections input, #sections textarea').count())) await owner.click('#resetOrder');
  await owner.click('#save'); await owner.waitForTimeout(500);
  const st = await owner.locator('#status').first().textContent().catch(() => '');
  expect(/saved|shared|published/i.test(st || ''), 'plan save status: ' + st);
  await coach.goto(BASE + '/coach'); await coach.click('text=Open practice plans');
  await coach.waitForFunction(() => /Leg attacks and finishes/.test(document.body.textContent), null, {timeout: 10000});
});
await step('owner adds a curriculum lesson on /curricula', async () => {
  await owner.goto(BASE + '/curricula'); await owner.waitForSelector('#groupName');
  await owner.selectOption('#curriculumProgram', 'Intermediate').catch(() => {});
  await owner.fill('#groupName', 'Foundations'); await owner.click('#saveGroup'); await owner.waitForTimeout(500);
  await owner.fill('#curriculumName', 'Stance and motion'); await owner.fill('#lessonOrder', '1').catch(() => {});
  await owner.fill('#planForm [name=title]', 'Stance and motion');
  if (!(await owner.locator('#sections input, #sections textarea').count())) await owner.click('#resetOrder');
  await owner.click('#saveCurriculum').catch(async () => owner.click('#save')); await owner.waitForTimeout(600);
  const r = await api(owner, '/api/practice-curricula');
  expect(JSON.stringify(r.body).includes('Stance and motion'), 'curriculum lesson not saved: ' + JSON.stringify(r.body).slice(0, 200));
});
await step('payment setup, security log and family accounts load with real records', async () => {
  await owner.goto(BASE + '/payment-setup'); await owner.waitForFunction(() => /test mode/i.test(document.body.textContent), null, {timeout: 8000});
  await owner.goto(BASE + '/security-log'); expect(/offline_payment_recorded|waiver_published|Offline payment/i.test(await owner.content()), 'security log shows recent actions');
  await owner.goto(BASE + '/accounts'); const acc = await owner.content(); expect(/Pat Example/.test(acc) && /Riley Parent/.test(acc), 'accounts list both families');
  const fam = await family.request.get(BASE + '/accounts'); expect(fam.status() !== 200 || !/Riley Parent/.test(await fam.text()), 'a family opened the accounts list');
});
await step('owner downloads an encrypted backup and previews and restores it from the file', async () => {
  await owner.goto(BASE + '/backups'); await owner.waitForSelector('#exportPassword');
  await owner.fill('#exportPassword', 'correct horse battery staple 2026'); await owner.fill('#exportConfirm', 'correct horse battery staple 2026');
  const [dl] = await Promise.all([owner.waitForEvent('download', {timeout: 15000}), owner.click('#download')]);
  const file = await dl.path(); expect(file, 'no backup file');
  await owner.setInputFiles('#file', file); await owner.fill('#importPassword', 'correct horse battery staple 2026'); await owner.click('#preview');
  await owner.waitForFunction(() => /payments/.test(document.querySelector('#summary')?.textContent || ''), null, {timeout: 15000});
  await owner.click('#restore'); await owner.waitForFunction(() => /restored|Restore complete|No missing/i.test(document.body.textContent), null, {timeout: 15000});
});

// ---------- Owner dashboard and backups ----------
await step('owner dashboard shows today\'s real numbers', async () => {
  await owner.goto(BASE + '/'); await waitText(owner, '#todayTiles', /Sessions today/);
  await waitText(owner, '#todayTiles', /Collected this month/);
  await waitText(owner, '#todayTiles', /Site errors, last 24 hours/);
  // Launch checklist: by now the walkthrough has set programs, schedule, waiver, coach and lesson prices.
  await waitText(owner, '#launchCount', /\d+ of \d+ ready|Everything is set up/);
  for (const k of ['programs', 'schedule', 'waiver', 'coaches', 'lessons', 'address', 'signin'])
    expect(await owner.getAttribute(`[data-launch="${k}"]`, 'data-status') === 'done', `launch checklist: ${k} should be ready`);
  expect(await owner.getAttribute('[data-launch="email"]', 'data-status') === 'waiting', 'launch checklist: email waits on its decision');
  const h = await owner.request.get(BASE + '/api/health'); expect(h.status() === 200 && (await h.json()).ok === true, 'health check');
  expect(!(await owner.isVisible('.sample-notice')) && !(await owner.isVisible('#previewMenu')), 'the dashboard has no sample notices or previews');
  const bg = await owner.locator('a.button.primary').first().evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg !== 'rgb(255, 255, 255)' && bg !== 'rgba(0, 0, 0, 0)', 'primary button is invisible: ' + bg);
  await shot(owner, 'owner-dashboard');
  await owner.goto(BASE + '/site-health'); await waitText(owner, '#now', /Site and database are answering/);
});
await step('backup export includes payments and signed waivers', async () => {
  const r = await api(owner, '/api/backups');
  const b = r.body?.backup;
  expect(r.status === 200 && b?.version === 3 && b.records.orders.length >= 3 && b.records.waiver_signatures.length === 1 && b.records.wrestler_passes.length >= 1, 'backup export ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  // Restoring the same backup is accepted (real data passes validation) and changes nothing.
  const fp = (await api(owner, '/api/backups?mode=preview')).body.fingerprint;
  const back = await api(owner, '/api/backups', {action: 'restore', fingerprint: fp, backup: b});
  expect(back.status === 200 && Object.values(back.body.restored).every(n => n === 0), 'restore round trip ' + JSON.stringify(back.body).slice(0, 300));
});

// ---------- Family data requests ----------
await step('family downloads their data and asks to close the account; owner records how it was handled', async () => {
  await family.goto(BASE + '/family'); await family.waitForSelector('#yourData');
  const [dl] = await Promise.all([family.waitForEvent('download'), family.click('text=Download my family\'s data')]);
  const why = await dl.failure(); expect(!why, 'download failed: ' + why + ' ' + dl.url());
  const data = JSON.parse((await import('node:fs')).readFileSync(await dl.path(), 'utf8'));
  expect(data.profile.parentName === 'Pat Example' && data.payments.length >= 3 && !JSON.stringify(data).includes('Riley'), 'export contents');
  await family.click('summary:has-text("Ask to close my account")'); await family.fill('#closeNote', 'Moving away');
  await family.click('#closeForm button'); await waitText(family, '#requestStatus', /The academy will contact you/);
  await owner.goto(BASE + '/'); await waitText(owner, '#todayTiles', /Data requests/);
  await owner.goto(BASE + '/data-requests'); await waitText(owner, '#list', /Pat Example[\s\S]*Moving away/);
  await owner.fill('#list textarea', 'Kept payment records; family is staying after all.'); await owner.click('#list form button');
  await waitText(owner, '#list', /Handled/);
});

// ---------- Guides ----------
await step('each role has a guide linked from its home page; guides are role-only', async () => {
  await family.goto(BASE + '/family'); await family.click('#accountMenu summary'); await family.click('#accountMenu a:has-text("Help")'); await waitText(family, 'h1', /Help for families/);
  await coach.goto(BASE + '/coach'); await coach.click('text=Coach help'); await waitText(coach, 'h1', /Help for coaches/);
  await owner.goto(BASE + '/'); await owner.click('.toolmore summary'); await owner.click('.toolmore a:has-text("Owner guide")'); await waitText(owner, 'h1', /Owner guide/);
  const fc = await family.request.get(BASE + '/help/coach', {maxRedirects: 0}); expect(fc.status() !== 200, 'family opened the coach guide');
  const fo = await family.request.get(BASE + '/help/owner', {maxRedirects: 0}); expect(fo.status() !== 200, 'family opened the owner guide');
});

// ---------- Isolation and phone layout ----------
await step('one family cannot see another family\'s data', async () => {
  const r = await api(family2, '/api/wrestler?id=' + samId); expect(r.status === 404, 'wrestler view of another family');
  const o = await api(family2, '/api/orders'); expect(!JSON.stringify(o.body).includes('Sam Example'), 'orders leak');
  const c = await api(family2, '/api/usaw-cards'); expect(c.status === 403, 'family reached owner cards');
});
await step('family pages fit a phone screen', async () => {
  const phone = await (async () => { const p = await (await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: SHOTS ? 3 : 1, isMobile: true, hasTouch: true})); const c = (await import('./fake-supabase.mjs')).sessionCookie('family', AUTH); await p.addCookies([{name: c.name, value: c.value, url: BASE}]); return p.newPage(); })();
  for (const path of ['/welcome', '/help', '/family', '/register', '/lesson', '/waiver', '/pass', '/wrestler?id=' + samId, '/inbox', '/booking?type=event&id=winter-camp']) {
    await phone.goto(BASE + path); await phone.waitForTimeout(700);
    const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over <= 1, `${path} scrolls sideways by ${over}px on a phone`);
    // Buttons and links must not break a word across lines (for example "Messa ges").
    const broken = await phone.evaluate(() => [...document.querySelectorAll('a,button')].filter(el => el.offsetParent && el.children.length === 0 && /^\S+$/.test(el.textContent.trim()) && el.textContent.trim().length > 3 && el.getClientRects().length && el.scrollHeight > parseFloat(getComputedStyle(el).lineHeight || '20') * 1.9 + parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom)).map(el => el.textContent.trim()));
    expect(!broken.length, `${path}: words broken across lines: ${broken.join(', ')}`);
    if (SHOTS) await phone.screenshot({path: `${SHOTS}/phone-${path.replace(/[^a-z]/g, '') || 'home'}.png`, fullPage: true});
  }
  // The profile editor with the card season choice, and the "different date" box open (issue #131).
  await phone.goto(BASE + '/family'); await phone.click('text=Edit family profile'); await phone.waitForSelector('#usawSeason0');
  await phone.selectOption('#usawSeason0', 'other');
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over <= 1, `/family editor scrolls sideways by ${over}px on a phone`);
  if (SHOTS) { await phone.locator('#editor').scrollIntoViewIfNeeded(); await phone.screenshot({path: `${SHOTS}/phone-family-editor.png`, fullPage: true}); }
});

// ---------- Accessibility (axe-core) on every page, as each role ----------
const axeSource = (await import('node:fs')).readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const a11yPages = {
  public: ['/welcome', '/calendar', '/login', '/membership-terms', '/help'],
  family: ['/family', '/register', '/booking?type=event&id=winter-camp', '/lesson', '/waiver', '/pass', '/wrestler?id=' + samId, '/inbox', '/security'],
  coach: ['/coach', '/roster', '/help/coach'],
  owner: ['/', '/roster', '/payments', '/cards', '/waivers', '/lesson-settings', '/coach-pay', '/waitlists', '/transfers', '/messages', '/staff', '/approvals', '/scholarships', '/accounts', '/payment-setup', '/backups', '/security-log', '/site-health', '/data-requests', '/help/owner', `/practice-plans?program=Intermediate&date=${today}`, '/curricula'],
};
const a11y = [];
await step('accessibility: no serious or critical axe-core issues on any page', async () => {
  const pages = {family, coach, owner, public: await (await browser.newContext()).newPage()};
  for (const [role, paths] of Object.entries(a11yPages)) for (const path of paths) {
    const page = pages[role];
    await page.goto(BASE + path, {waitUntil: 'load'}); await page.waitForTimeout(600);
    await page.evaluate(axeSource);
    const result = await page.evaluate(async () => (await axe.run(document, {resultTypes: ['violations']})).violations.map(v => ({id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(' ')})));
    for (const v of result) if (v.impact === 'serious' || v.impact === 'critical') a11y.push(`${role} ${path}: ${v.id} (${v.impact}, ${v.nodes}x) ${v.help} e.g. ${v.target}`);
  }
  if (process.env.E2E_A11Y_REPORT) console.log(a11y.join('\n'));
  expect(!a11y.length, `${a11y.length} accessibility issue(s):\n` + a11y.slice(0, 40).join('\n'));
});

// ---------- Every button and link, on every page, as each role ----------
// Clicks every visible button (including ones that appear after a click, such as workspace tabs) and follows every
// link. Fails on errors, server failures and broken links. Buttons where nothing at all happens (no page change, no
// request, no navigation, no dialog) are listed, because a button that does nothing is a bug too.
const SKIP = /sign ?out|log ?out|restore from|print/i;
const sweepPages = {...a11yPages, coach: [...a11yPages.coach, '/practice-plans', '/security']};
const dead = [], broken = [], clicks = {n: 0};
await step('every button and link on every page responds', async () => {
  const pages = {family, coach, owner, public: await (await browser.newContext()).newPage()};
  const linkSeen = new Set();
  for (const [role, paths] of Object.entries(sweepPages)) for (const path of paths) {
    const page = pages[role], start = BASE + path;
    current = `sweep ${role} ${path}`;
    await page.goto(start, {waitUntil: 'load'}); await page.waitForTimeout(500);
    if (SHOTS) await page.screenshot({path: `${SHOTS}/page-${role}-${path.split('?')[0].replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '') || 'home'}.png`});
    // Links: every same-site address must open (no 404, no server error).
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith(location.origin) && !/\/(signout|logout)/.test(h)));
    for (const href of links) {
      const key = role + ' ' + href.split('#')[0]; if (linkSeen.has(key)) continue; linkSeen.add(key);
      const r = await page.request.get(href.split('#')[0], {maxRedirects: 5}).catch(e => ({status: () => 0}));
      if (r.status() === 404 || r.status() >= 500 || r.status() === 0) broken.push(`${role} ${path}: link ${href.replace(BASE, '')} -> ${r.status()}`);
    }
    // Buttons one at a time, re-reading the page after each click. Buttons a click just revealed (a workspace section,
    // a pop-up) go first, and close or cancel buttons go last, so every section and pop-up gets explored.
    const done = new Set(), LAST = /cancel|close|×|✕|back|done|not now/i;
    let prev = new Set();
    for (let n = 0; n < 250; n++) {
      const list = await page.evaluate(() => {
        const keyOf = b => { const host = b.closest('[id]'), box = b.closest('section,dialog,[role=dialog],form,article,.modal'); const head = box?.querySelector('h1,h2,h3,legend')?.textContent.trim().slice(0, 30) || '';
          return (b.textContent.trim() || b.getAttribute('aria-label') || b.title || b.value || '').replace(/\s+/g, ' ').slice(0, 60) + '@' + (host ? host.id : '') + '/' + head; };
        document.querySelectorAll('[data-sweep]').forEach(e => e.removeAttribute('data-sweep'));
        // While a pop-up is open, only its buttons can be reached.
        const open = [...document.querySelectorAll('[aria-modal=true], dialog[open]')].find(d => d.getClientRects().length);
        return [...(open || document).querySelectorAll('button, [role=button], input[type=submit], input[type=button]')]
          .filter(b => b.offsetParent && !b.matches(':disabled') && !b.closest('[hidden],[inert]')).map((b, i) => { b.dataset.sweep = i; return {i, key: keyOf(b)}; });
      });
      const todo = list.filter(b => !done.has(b.key) && !SKIP.test(b.key));
      if (!todo.length) { if (process.env.E2E_SWEEP_LOG) console.log(`    end ${role} ${path}: ${list.length} visible, url ${page.url()}`, JSON.stringify(list.slice(0, 8).map(x => x.key))); break; }
      const fresh = todo.filter(b => !prev.has(b.key)), pool = fresh.length ? fresh : todo;
      const b = pool.find(x => !LAST.test(x.key)) || pool[0];
      prev = new Set(list.map(x => x.key));
      {
        done.add(b.key);
        const el = page.locator(`[data-sweep="${b.i}"]`);
        if (!(await el.count()) || !(await el.isVisible().catch(() => false))) continue;
        if (process.env.E2E_SWEEP_LOG) console.log(`    click ${role} ${path}: ${b.key}`);
        let requests = 0, dialogs = 0; const onReq = r => { if (!/\.(js|css|png|svg|ico|woff2?)(\?|$)/.test(r.url())) requests++; }, onDlg = () => dialogs++;
        page.on('request', onReq); page.on('dialog', onDlg);
        await page.evaluate(() => { window.__mut = 0; window.__obs?.disconnect(); window.__obs = new MutationObserver(m => { window.__mut += m.length; }); window.__obs.observe(document, {subtree: true, childList: true, attributes: true, characterData: true}); });
        const before = page.url();
        const invalid = await el.evaluate(e => !!(e.form && e.type === 'submit' && !e.form.checkValidity())).catch(() => false);
        let blocked = false; await el.click({timeout: 3000}).catch(() => { blocked = true; }); clicks.n++;
        await page.waitForTimeout(350);
        const mut = await page.evaluate(() => window.__mut ?? 0).catch(() => 1);
        page.off('request', onReq); page.off('dialog', onDlg);
        const moved = page.url().split('#')[0] !== before.split('#')[0];
        if (blocked) dead.push(`${role} ${path}: "${b.key.split('@')[0]}" could not be clicked (covered or off screen)`);
        else if (!moved && !requests && !dialogs && !mut && !invalid) dead.push(`${role} ${path}: "${b.key.split('@')[0]}"`);
        if (moved) { await page.goto(start, {waitUntil: 'load'}); await page.waitForTimeout(400); prev = new Set(); }
      }
    }
  }
  console.log(`  swept ${clicks.n} button clicks and ${linkSeen.size} links`);
  if (dead.length) console.log('  buttons with no visible effect:\n   ' + dead.join('\n   '));
  expect(!broken.length, `${broken.length} broken link(s):\n` + broken.join('\n'));
});

await browser.close(); auth.close();
console.log(`\n${passed.length} steps passed, ${problems.length} problem(s).`);
for (const p of problems) console.log(' - ' + p);
process.exit(problems.length ? 1 : 0);
