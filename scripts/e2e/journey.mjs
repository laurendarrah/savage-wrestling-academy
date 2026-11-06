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
  const ctx = await browser.newContext({viewport, ...(viewport.width < 500 ? {isMobile: true, hasTouch: true} : {})});
  const c = sessionCookie(name, AUTH);
  await ctx.addCookies([{name: c.name, value: c.value, url: BASE}]);
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));
  page.on('pageerror', e => problems.push(`[${current}] page error on ${page.url()}: ${e.message}`));
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
const text = async (page, sel) => (await page.locator(sel).first().textContent({timeout: 8000})) ?? '';
const waitText = async (page, sel, re, ms = 8000) => { await page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent || ''), [sel, re.source], {timeout: ms}); };
const api = async (page, url, body) => page.evaluate(async ([u, b]) => { const r = await fetch(u, b ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b)} : {cache: 'no-store'}); return {status: r.status, body: await r.json().catch(() => null)}; }, [url, body]);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({path: `${SHOTS}/${name}.png`, fullPage: true}); };

const owner = await as('owner'), family = await as('family'), family2 = await as('family2'), coach = await as('coach');

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
  await family.selectOption('#plan', 'walkin'); await family.selectOption('#program', 'Intermediate');
  await family.waitForSelector('[data-day]'); await family.locator(`[data-day="${ny(1)}"]`).first().click();
  await family.waitForSelector('[data-slot]'); await family.locator('[data-slot]').first().click();
  await family.click('#reviewButton');
  await waitText(family, '#status', /needs a current USA Wrestling card/);
  expect(await family.isVisible('#cardHelp'), 'card help link not shown');
});
await step('family adds an expired card, then a current one', async () => {
  await family.goto(BASE + '/family'); await family.click('text=Edit family profile');
  await family.fill('#usaw0', 'ab-123456'); await family.fill('#usawExp0', ny(-3)); await family.click('#save');
  await waitText(family, '#savedDetails', /USA Wrestling card expired/);
  await family.click('text=Edit family profile'); await family.fill('#usawExp0', ny(200)); await family.click('#save');
  await waitText(family, '#savedDetails', /USA Wrestling card on file[\s\S]*Current through/);
});
await step('owner sees the card on /cards, marks it not valid; family is blocked with the reason', async () => {
  await owner.goto(BASE + '/cards'); await owner.selectOption('#show', 'all');
  await waitText(owner, '#rows', /Sam Example[\s\S]*AB-123456/);
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

// ---------- Walk-in review now passes ----------
await step('family reviews a walk-in once card and waiver are in order', async () => {
  await family.goto(BASE + '/register'); await family.waitForFunction(() => document.querySelectorAll('#wrestler option').length > 0);
  expect(await family.inputValue('#program') === 'Intermediate', 'a Grade 8 wrestler should start on SWA Intermediate');
  await family.selectOption('#plan', 'walkin'); await family.selectOption('#program', 'Intermediate');
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

// ---------- Waitlist ----------
await step('camp fills; family 2 joins the waitlist from the booking page; owner offers; family 2 can book', async () => {
  await family2.goto(BASE + '/family'); await family2.waitForSelector('#familyForm');
  await family2.fill('[name=parentName]', 'Riley Parent'); await family2.click('text=+ Add wrestler'); await family2.fill('#name0', 'Riley Two'); await family2.selectOption('#grade0', '8');
  await family2.fill('#usaw0', 'CD-5555'); await family2.fill('#usawExp0', ny(300)); await family2.click('#save'); await waitText(family2, '#status', /saved/);
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
  await family2.click('#submit'); await waitText(family2, '#status', /Join the waitlist/);
  await family2.click('#joinWaitlist'); await waitText(family2, '#status', /on the waitlist/);
  await owner.goto(BASE + '/waitlists'); await waitText(owner, '#events', /Riley Two/);
  await owner.locator('[data-offer]').first().click(); await waitText(owner, '#status', /Seat offered/);
  await family2.goto(BASE + '/family'); await waitText(family2, '#waitlistList', /Seat held for you/);
  await family2.goto(BASE + '/booking?type=event&id=winter-camp'); await family2.waitForSelector('#submit'); await family2.click('#submit');
  await family2.waitForFunction(() => /\$160\.00/.test(document.body.textContent), null, {timeout: 8000});
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
  await family.goto(BASE + '/family'); await waitText(family, '#inboxLink', /1 new/);
  await family.goto(BASE + '/inbox'); await waitText(family, '#announcements', /Practice moved/);
  await family.fill('#body', 'Thanks, see you there.'); await family.click('#reply button'); await waitText(family, '#thread', /see you there/);
  await family2.goto(BASE + '/inbox'); await waitText(family2, '#announcements', /No announcements/);
  await owner.goto(BASE + '/messages'); await owner.locator('[data-family]').filter({hasText: 'Pat Example'}).click();
  await waitText(owner, '#threadBox', /see you there/);
});

// ---------- Owner dashboard and backups ----------
await step('owner dashboard shows today\'s real numbers', async () => {
  await owner.goto(BASE + '/'); await waitText(owner, '#todayTiles', /Sessions today/);
  await waitText(owner, '#todayTiles', /Collected this month/);
  expect(!(await owner.isVisible('.sample-notice')), 'live dashboard must not show the sample-data notice');
  const bg = await owner.locator('a.button.primary').first().evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg !== 'rgb(255, 255, 255)' && bg !== 'rgba(0, 0, 0, 0)', 'primary button is invisible: ' + bg);
  await shot(owner, 'owner-dashboard');
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

// ---------- Isolation and phone layout ----------
await step('one family cannot see another family\'s data', async () => {
  const r = await api(family2, '/api/wrestler?id=' + samId); expect(r.status === 404, 'wrestler view of another family');
  const o = await api(family2, '/api/orders'); expect(!JSON.stringify(o.body).includes('Sam Example'), 'orders leak');
  const c = await api(family2, '/api/usaw-cards'); expect(c.status === 403, 'family reached owner cards');
});
await step('family pages fit a phone screen', async () => {
  const phone = await (async () => { const p = await (await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true})); const c = (await import('./fake-supabase.mjs')).sessionCookie('family', AUTH); await p.addCookies([{name: c.name, value: c.value, url: BASE}]); return p.newPage(); })();
  for (const path of ['/family', '/register', '/lesson', '/waiver', '/pass', '/wrestler?id=' + samId, '/inbox', '/booking?type=event&id=winter-camp']) {
    await phone.goto(BASE + path); await phone.waitForTimeout(700);
    const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over <= 1, `${path} scrolls sideways by ${over}px on a phone`);
    // Buttons and links must not break a word across lines (for example "Messa ges").
    const broken = await phone.evaluate(() => [...document.querySelectorAll('a,button')].filter(el => el.offsetParent && el.children.length === 0 && /^\S+$/.test(el.textContent.trim()) && el.textContent.trim().length > 3 && el.getClientRects().length && el.scrollHeight > parseFloat(getComputedStyle(el).lineHeight || '20') * 1.9 + parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom)).map(el => el.textContent.trim()));
    expect(!broken.length, `${path}: words broken across lines: ${broken.join(', ')}`);
    if (SHOTS) await phone.screenshot({path: `${SHOTS}/phone-${path.replace(/[^a-z]/g, '') || 'home'}.png`, fullPage: true});
  }
});

await browser.close(); auth.close();
console.log(`\n${passed.length} steps passed, ${problems.length} problem(s).`);
for (const p of problems) console.log(' - ' + p);
process.exit(problems.length ? 1 : 0);
