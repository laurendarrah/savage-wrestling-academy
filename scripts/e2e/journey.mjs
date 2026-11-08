// End-to-end walkthrough of the signed-in site in a real browser, against a local build with a stand-in for
// Supabase Auth (scripts/e2e/fake-supabase.mjs). Plays the owner, a coach and two families through every feature,
// and fails on any page error, console error or server error. Local only: never point it at production.
//
// Usage: see scripts/e2e/run.sh
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync} from 'node:fs';
import {start, sessionCookie, users} from './fake-supabase.mjs';
import {start as startUsaw} from './fake-usaw.mjs';
const require = createRequire(import.meta.url);
let playwright;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { playwright = require(p); break; } catch {} }
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8799', AUTH = process.env.E2E_SUPABASE || 'http://127.0.0.1:54321';
const SHOTS = process.env.E2E_SHOTS || '';
// When a step fails, every open page is saved here (gitignored), and CI keeps the folder with the walkthrough log (#247).
const FAILS = process.env.E2E_FAILURES || 'e2e-failures';
rmSync(FAILS, {recursive: true, force: true});
// The local database of the running site (run.sh), for records that can no longer be made through the site itself.
const PERSIST = process.env.E2E_PERSIST || '.wrangler/e2e';
const sql = q => JSON.parse(execFileSync('node', ['--import', './scripts/local-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--config', 'dist/server/wrangler.json', '--persist-to', PERSIST, '--json', '--command', q], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}))[0].results;
const auth = await start(+new URL(AUTH).port);
// USA Wrestling's verify page is a local stand-in (issue #202); the site is started with USAW_LOOKUP_BASE pointing here.
const USAW = process.env.E2E_USAW || 'http://127.0.0.1:54331';
const usaw = await startUsaw(+new URL(USAW).port);
const browser = await playwright.chromium.launch();
const ny = k => new Date(Date.now() + k * 864e5).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0);
// The weekly practice is 6:00–7:30 PM, or late in the evening when the walkthrough runs after 5 PM New York time, so
// today's practice is still ahead: Register stops offering a practice once it has started (#273).
const nyMinutes = (() => { const [h, m] = new Intl.DateTimeFormat('en-GB', {timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date()).split(':').map(Number); return h * 60 + m; })();
const PRACTICE = nyMinutes >= 17 * 60 ? {start: '23:30', end: '23:59', label: '11:30 PM–11:59 PM'} : {start: '18:00', end: '19:30', label: '6:00 PM–7:30 PM'};
const problems = [], passed = [];
let current = '';
const labels = new WeakMap();

async function as(name, viewport = {width: 1200, height: 900}) {
  const ctx = await browser.newContext({viewport, deviceScaleFactor: SHOTS ? 2 : 1, ...(viewport.width < 500 ? {isMobile: true, hasTouch: true} : {})});
  const c = sessionCookie(name, AUTH);
  await ctx.addCookies([{name: c.name, value: c.value, url: BASE}]);
  const page = await ctx.newPage(); labels.set(page, name + (viewport.width < 500 ? '-phone' : ''));
  page.on('dialog', d => d.accept().catch(() => {}));
  page.on('pageerror', e => { if (browserNoise(e.message)) return; problems.push(`[${current}] page error on ${page.url()}: ${e.message}`); if (process.env.E2E_SWEEP_LOG) console.log('    ERROR', e.message, (e.stack || '').split('\n')[1]); });
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) problems.push(`[${current}] console error on ${page.url()}: ${m.text().slice(0, 200)}`); });
  page.on('response', r => { if (r.status() >= 500) problems.push(`[${current}] HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  return page;
}
// A failed step names the walkthrough line it stopped on and saves a screenshot of every open page, so a failure in CI
// can be read from the log and the artifact without running it again (issue #247).
let stepNo = 0;
async function step(name, fn) {
  current = name; stepNo++;
  try { await fn(); passed.push(name); console.log('PASS', name); }
  catch (e) {
    const why = e.message.split('\n')[0] + where(e);
    problems.push(`[${name}] FAILED: ${why}`); console.log('FAIL', name, '-', why);
    await failureShots(name);
  }
}
// The walkthrough lines a failure came through, innermost first, up to the step itself: " (journey.mjs line 8, called from 19)".
function where(e) {
  const lines = [];
  for (const m of (e.stack || '').matchAll(/at (?:async )?(\S+ )?\(?[^\s()]*journey\.mjs:(\d+)/g)) {
    const fn = m[1]?.trim();
    if (fn === 'step') break;
    if (fn !== 'waitText' && !lines.includes(m[2])) lines.push(m[2]);
  }
  return lines.length ? ` (journey.mjs line ${lines[0]}${lines.length > 1 ? ', called from ' + lines.slice(1).join(', ') : ''})` : '';
}
async function failureShots(name) {
  const slug = String(stepNo).padStart(2, '0') + '-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/-$/, '');
  let n = 0;
  for (const page of browser.contexts().flatMap(c => c.pages())) {
    const file = `${FAILS}/${slug}-${++n}-${labels.get(page) || 'page'}.png`;
    try { mkdirSync(FAILS, {recursive: true}); await page.screenshot({path: file, fullPage: true, timeout: 10000}); console.log(`    screenshot ${file} (${page.url()})`); }
    catch (e) { console.log(`    no screenshot of ${page.url()}: ${e.message.split('\n')[0]}`); }
  }
}
// Chromium reports a cross-document View Transition it cancelled itself (a move out of the owner shell to a page that
// has not opted in, or a second click mid-fade) as a page error. The shell swallows the transition's promises and skips
// it on pageswap, so the owner sees nothing; it is browser noise, not a site error (issue #269).
const browserNoise = message => /Transition was aborted|ViewTransition opt-in|skipTransition/i.test(message || '');
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const text = async (page, sel) => (await page.locator(sel).first().textContent({timeout: 20000})) ?? '';
// Waits until the first element matching sel has text matching re. When it does not, the error names what it waited
// for and what the element said instead.
const waitText = async (page, sel, re, ms = 20000) => {
  try { await page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent || ''), [sel, re.source], {timeout: ms}); }
  catch (e) {
    const said = ((await page.locator(sel).first().textContent({timeout: 1000}).catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error(`${sel} never matched ${re}: "${said}" (${e.message.split('\n')[0]})`);
  }
};
const at = waitText;
const api = async (page, url, body) => page.evaluate(async ([u, b]) => { const r = await fetch(u, b ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b)} : {cache: 'no-store'}); return {status: r.status, body: await r.json().catch(() => null)}; }, [url, body]);
// Contact and safety details are required to save a profile (issue #188, #197 question 14). Wrestler i gets a birth
// date and "No allergies or medical notes".
const fillDetails = async (page, contact, kids = 1) => {
  await page.fill('#homeAddress', '20 Railroad St'); await page.fill('#homeCity', 'Huntington Station'); await page.fill('#homeState', 'NY'); await page.fill('#homeZip', '11746');
  await page.fill('#emergencyContactName', contact); await page.fill('#emergencyContactPhone', '631-555-0188');
  for (let i = 0; i < kids; i++) { await page.fill('#birth' + i, '2012-04-18'); await page.check('#none' + i); }
};
const shot = async (page, name) => { if (SHOTS) await page.screenshot({path: `${SHOTS}/${name}.png`, fullPage: true}); };
// Pages that load in the background are used only once they have loaded, never after a fixed wait (issue #220).
// /family turns its Save button back on when the profile is in; until then, typing is overwritten by the load.
const familyReady = page => page.waitForSelector('#save:not([disabled])', {state: 'attached'});
// A saved profile says so in a toast (public/toast.js), or in the status line when USA Wrestling had something to say
// about the card (issue #282). Either counts.
const saved = page => page.waitForFunction(() => /saved/.test((document.querySelector('#status')?.textContent || '') + (document.querySelector('#swa-toast')?.textContent || '')), null, {timeout: 20000});
const toastText = (page, re) => waitText(page, '#swa-toast', re);
// /cards, /waivers, /contracts and /consent-forms reload their list when the filter changes and mark it busy until the
// latest load has drawn it. Text from the first load can match before that, and the reload then redraws the list under
// whatever the walkthrough opened or typed.
const showAll = async page => { await page.selectOption('#show', 'all'); await page.waitForSelector('#rows:not([aria-busy])', {state: 'attached'}); };
// /payments has loaded when the payments table is filled and Check price is on. Earlier, the page is still loading
// and clears the status line when it finishes, which could hide "Payment recorded". The record form lives in a side
// panel (issue #283): Record a payment in the title row opens it.
const openPayments = async page => {
  await page.goto(BASE + '/payments');
  await page.waitForFunction(() => !/Loading/.test(document.querySelector('#rows')?.textContent ?? 'Loading') && !document.querySelector('#preview')?.disabled);
};
const openRecord = async page => {
  await page.click('#openRecord'); await page.waitForSelector('#recordSheet:not([hidden])');
  await page.waitForFunction(() => document.activeElement?.id === 'familySearch', null, {timeout: 5000}).catch(() => {});
  expect(await page.evaluate(() => document.activeElement?.id) === 'familySearch', 'the record panel opens on the family search');
};
// /financials keeps its entry form in a sheet (issue #283): Add an expense in the title row opens it on the amount
// field. Typing starts only once that focus has landed; a focus that arrived later took the typing from the note
// field, and the form refused the amount (issue #292).
const openEntry = async page => {
  await page.click('#openEntry'); await page.waitForSelector('#entrySection:not([hidden])');
  await page.waitForFunction(() => document.activeElement?.id === 'amount', null, {timeout: 5000}).catch(() => {});
  expect(await page.evaluate(() => document.activeElement?.id) === 'amount', 'the entry sheet opens on the amount field');
};

// The roster shows one session at a time behind its session tabs (issue #286): pick the session before acting on a
// row in it. Rows of the other sessions are in the page (textContent checks still see them) but not on screen.
const pickSession = async (page, re) => { await page.locator('#switcher [role=tab]', {hasText: re}).first().click(); await page.waitForSelector('.session:not([hidden])'); };
const shownRow = (page, name) => page.locator('.session:not([hidden]) .row', {hasText: name}).first();
// Saves, check-ins and clock actions answer with a toast (public/toast.js), which stays about four seconds.
const toast = (page, re) => waitText(page, '#swa-toast', re, 8000);
// Coach home keeps the one-hour opening form behind "Add a one-hour opening" under the lessons (issue #286).
const openOpening = async page => { await page.waitForSelector('#openingBox'); await page.evaluate(() => { document.getElementById('openingBox').open = true; }); await page.waitForSelector('#opening'); };
const openingForm = async page => { await page.goto(BASE + '/coach'); await openOpening(page); };

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
  expect(await owner.isVisible('.os-top nav.os-family a[href="/welcome"]') && await owner.isVisible('.os-top nav.os-family a[href="/calendar"]'), 'header links to what families see');
  await owner.click('#launch button:has-text("Publish the programs")');
  await waitText(owner, '#syncStatus', /All changes saved/);
  await owner.waitForSelector('[data-launch="programs"][data-status="done"]', {state: 'attached'});
  const after = await api(owner, '/api/public-schedule');
  // Monthly and walk-in prices only: a year paid upfront is not offered (#210).
  expect(JSON.stringify(after.body.programs.map(p => [p.name, p.monthlyCents, p.walkInCents, p.annualCents])) === JSON.stringify([['SWA Development', 20000, 4000, undefined], ['SWA Intermediate', 20000, 4000, undefined], ['SWA Advance', 20000, 4000, undefined]]), 'published programs: ' + JSON.stringify(after.body.programs));
  await pub.goto(BASE + '/welcome'); await waitText(pub, '#programs', /SWA Development[\s\S]*SWA Intermediate[\s\S]*SWA Advance/);
  await shot(pub, 'welcome-programs'); await pub.close();
});

// ---------- Setup through the owner's real save paths ----------
await step('owner saves the academy schedule, programs, camp and Friday Night Live', async () => {
  await owner.goto(BASE + '/');
  const weekly = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: PRACTICE.start, end: PRACTICE.end}));
  const state = {kids: [], bookings: [], messages: [], offers: [], staff: [], attendance: {}, settings: {},
    programs: [['Elementary', 'SWA Development'], ['Intermediate', 'SWA Intermediate'], ['Advanced', 'SWA Advance']].map(([id, name]) => ({id, name, description: '', priceCents: 20000, walkInPriceCents: 4000})),
    seasons: ['Elementary', 'Intermediate', 'Advanced'].map(program => ({program, start: ny(-30), end: ny(120), weekly, excludedDates: []})),
    events: [{id: 'winter-camp', name: 'Winter camp', type: 'Camp', dates: [ny(10), ny(11)], schedule: [{date: ny(10), start: '09:00', end: '12:00'}], price: 160, day: 90, slots: 1, gradeRange: '', description: ''},
      {id: 'spring-clinic', name: 'Spring clinic', type: 'Clinic', dates: [ny(12)], schedule: [{date: ny(12), start: '10:00', end: '12:00'}], price: 60, day: null, slots: 2, gradeRange: '', description: ''}],
    extraPractices: [{id: 'fnl', name: 'Friday Night Live', dates: [ny(2)], enabled: true, start: '16:00', end: '17:00', memberCents: 1000, nonMemberCents: 2000}]};
  const got = await api(owner, '/api/academy');
  const r = await owner.evaluate(async ([s, rev]) => { const x = await fetch('/api/academy', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({revision: rev, data: s})}); return {status: x.status, body: await x.json()}; }, [state, got.body.revision]);
  expect(r.status === 200, 'save failed: ' + JSON.stringify(r.body));
  const staff = await api(owner, '/api/staff', {action: 'grant', email: 'coach.dana@example.test', name: 'Coach Dana', programs: ['Intermediate']});
  expect(staff.status === 200, 'coach access: ' + JSON.stringify(staff.body));
});

// ---------- Calendars: camp day times, holidays as labels, today highlighted (issue #189) ----------
await step('camp times, holidays and today show on the public calendar and the coach home', async () => {
  const pub = await (await browser.newContext()).newPage();
  for (const month of [...new Set([today.slice(0, 7), ny(10).slice(0, 7)])]) {
    await pub.goto(BASE + '/calendar?month=' + month); await pub.waitForSelector('#calendar .grid');
    const grid = await pub.$eval('#calendar .grid', g => g.innerHTML);
    if (month === ny(10).slice(0, 7)) expect(/Winter camp<\/strong><span>9:00 AM–12:00 PM/.test(grid), 'the first camp day shows its time');
    if (month === ny(11).slice(0, 7)) expect(/Winter camp<\/strong><span>Time to be announced/.test(grid), 'a camp day without a time says so');
    if (month === today.slice(0, 7)) expect(await pub.$eval('#calendar .grid .day.is-today', d => d.textContent).then(t => /Today/.test(t)), 'today is highlighted');
    // Holidays are labels only: the practice that day is still on the calendar (only days off cancel practice).
    const {body} = await api(pub, '/api/public-schedule?month=' + month);
    for (const h of body.holidays) {
      const day = await pub.$$eval('#calendar .grid .day', (ds, [n, name]) => ds.find(d => d.firstChild?.textContent === n && d.textContent.includes(name))?.innerHTML ?? '', [String(Number(h.date.slice(-2))), h.name]);
      expect(day.includes('holiday-tag'), 'holiday label for ' + h.name);
      expect(!/No practice/i.test(day), 'no "No practice" card on ' + h.name);
      if (h.date >= today) expect(day.includes('SWA Development'), 'practice stays on ' + h.name);
    }
  }
  await shot(pub, 'calendar-times-holidays');
  await coach.goto(BASE + '/coach'); await coach.waitForSelector('#week .wday.is-today');
  expect(/Today/.test(await text(coach, '#week .wday.is-today')), 'coach week shows today');
  await shot(coach, 'coach-week'); await pub.close();
});

// ---------- Family: profile and USA Wrestling cards ----------
await step('family saves a profile and wrestler without a card, and sees booking blocked', async () => {
  await family.goto(BASE + '/family');
  await family.waitForSelector('#familyForm'); await familyReady(family);
  await family.fill('[name=parentName]', 'Pat Example'); await family.fill('[name=phone]', '555-0100');
  await family.click('text=+ Add wrestler'); await family.fill('#name0', 'Sam Example'); await family.selectOption('#grade0', '8');
  // Without the required contact and safety details the form does not save.
  await family.click('#save'); await family.waitForTimeout(300);
  expect(await family.isVisible('#editor') && await family.$eval('#homeAddress', el => !el.validity.valid), 'the street address is required');
  await fillDetails(family, 'Jordan Emergency');
  await family.click('#save');
  await saved(family);
  await waitText(family, '#savedDetails', /No USA Wrestling card[\s\S]*Booking is blocked/);
  await shot(family, 'family-no-card');
});
await step('family is refused a walk-in without a card, with a link to fix it', async () => {
  await family.goto(BASE + '/register');
  await family.waitForSelector('#wrestlerChips [data-wrestler]');
  await family.click('#plan-walkin'); await family.selectOption('#program', 'Intermediate');
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
  await family.goto(BASE + '/family'); await family.click('#editProfile');
  expect(await family.isHidden('#usawExpBox0'), 'the date box waits for "different date"');
  await family.fill('#usaw0', 'ab-123456'); await family.selectOption('#usawSeason0', 'other');
  await family.fill('#usawExp0', ny(-3)); await family.click('#save');
  await waitText(family, '#savedDetails', /USA Wrestling card expired/);
  await family.click('#editProfile');
  expect(await family.inputValue('#usawSeason0') === 'other' && await family.inputValue('#usawExp0') === ny(-3), 'a saved special date shows as "different date" with the date filled in');
  const season = await latestSeason(family); expect(season, 'a season to choose');
  await family.selectOption('#usawSeason0', season);
  expect(await family.isHidden('#usawExpBox0'), 'choosing a season hides the date box');
  await family.click('#save');
  // The site checked the number with USA Wrestling (a stand-in here), which has no card with it (issue #202).
  await waitText(family, '#savedDetails', /Check the card number[\s\S]*USA Wrestling has no card with this number/);
  await waitText(family, '#status', /Your changes are saved\. USA Wrestling has no card with the number you entered for Sam Example/);
  await family.click('#editProfile');
  expect(await family.inputValue('#usawSeason0') === season, 'the saved season is preselected');
  await family.click('#save'); await saved(family);
});
await step('owner sees the card on /cards, marks it not valid; family is blocked with the reason', async () => {
  await owner.goto(BASE + '/cards'); await showAll(owner);
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
  const r = await api(family, '/api/registration', {wrestlerId: (await api(family, '/api/family')).body.data.wrestlers[0].id, program: 'Intermediate', plan: 'monthly'});
  expect(r.status === 403 && /could not verify .*Number not found/.test(r.body.error), 'expected refusal, got ' + JSON.stringify(r));
  await shot(owner, 'owner-cards');
});
await step('family changes the card: still blocked until the owner checks it; owner verifies', async () => {
  await family.goto(BASE + '/family'); await family.click('#editProfile');
  await family.fill('#usaw0', 'AB-123457'); await family.click('#save');
  await waitText(family, '#savedDetails', /Waiting for the academy/);
  await owner.goto(BASE + '/cards');
  await waitText(owner, '#rows', /Changed after rejection/);
  await owner.click('#rows button:has-text("Verified")');
  await waitText(owner, '#status', /Marked verified/);
  await family.goto(BASE + '/family'); await waitText(family, '#savedDetails', /USA Wrestling card verified/);
});
// USA Wrestling lookup (issue #202): the site checks a new or changed number on USA Wrestling's public verify page (a
// local stand-in here, with fictional cards) and verifies it when the card is active and the name matches.
const seasonEnd = (() => { const [y, m] = today.split('-').map(Number); return (m >= 9 ? y + 1 : y) + '-08-31'; })();
await step('family enters a card USA Wrestling shows as not active, then an active one that verifies itself', async () => {
  const sent = usaw.seen.length;
  await family.goto(BASE + '/family'); await family.click('#editProfile');
  await family.fill('#usaw0', '2222222222'); await family.selectOption('#usawSeason0', seasonEnd); await family.click('#save');
  await waitText(family, '#status', /USA Wrestling shows Sam Example’s card isn’t active/);
  await waitText(family, '#savedDetails', /USA Wrestling card not active[\s\S]*Renew it, then choose Check my card[\s\S]*Get or renew a card/);
  expect(await family.isVisible('#savedDetails button:has-text("Check my card")'), 'Check my card button');
  await family.click('#savedDetails button:has-text("Check my card")');
  await waitText(family, '#status', /isn’t active/);
  expect(usaw.seen.length === sent + 1, 'the second check came from the one-day cache: ' + (usaw.seen.length - sent));
  await shot(family, 'family-card-not-active');
  const phone = await as('family', {width: 390, height: 844});
  await phone.goto(BASE + '/family'); await waitText(phone, '#savedDetails', /USA Wrestling card not active/);
  await shot(phone, 'phone-family-card-not-active');
  await family.click('#editProfile');
  await family.fill('#usaw0', '1234567890'); await family.click('#save');
  await waitText(family, '#status', /Sam Example’s USA Wrestling card is verified\./);
  await waitText(family, '#savedDetails', /USA Wrestling card verified[\s\S]*Checked with USA Wrestling on/);
  await shot(family, 'family-card-verified-by-lookup');
  await phone.goto(BASE + '/family'); await waitText(phone, '#savedDetails', /USA Wrestling card verified[\s\S]*Checked with USA Wrestling on/);
  await shot(phone, 'phone-family-card-verified-by-lookup'); await phone.context().close();
  // Only the card number ever went to USA Wrestling.
  for (const s of usaw.seen) expect(!/Sam|Pat|example\.test/.test(JSON.stringify(s.body)) && s.headers['user-agent'] === 'SavageWrestlingAcademy/1.0 (card check)', 'sent to USA Wrestling: ' + JSON.stringify(s.body).slice(0, 120));
});
await step('owner sees how each card was verified and can check one again', async () => {
  await owner.goto(BASE + '/cards'); await showAll(owner);
  await waitText(owner, '#rows', /Sam Example[\s\S]*1234567890[\s\S]*Verified[\s\S]*USA Wrestling lookup · /);
  await owner.click('#rows tr:has-text("Sam Example") button:has-text("Check with USA Wrestling")');
  await waitText(owner, '#status', /Sam Example: active and the name matches, so the card is verified/);
  await shot(owner, 'owner-cards-lookup');
  const phone = await as('owner', {width: 390, height: 844});
  await phone.goto(BASE + '/cards'); await showAll(phone); await waitText(phone, '#rows', /USA Wrestling lookup · /);
  await shot(phone, 'phone-owner-cards-lookup'); await phone.context().close();
  await owner.goto(BASE + '/security-log');
  expect(/USA Wrestling card verified by lookup/.test(await owner.content()), 'Security activity names the lookup verification');
});


const wid = async page => (await api(page, '/api/family')).body.data.wrestlers[0].id;
let samId = '';

// ---------- Waivers ----------
await step('owner publishes a waiver; family is blocked until they sign it on /waiver', async () => {
  samId = await wid(family);
  await owner.goto(BASE + '/waivers');
  await owner.fill('#wTitle', 'Participation waiver'); await owner.fill('#wBody', 'Sample waiver text for testing. '.repeat(10));
  await owner.click('#publish'); await waitText(owner, '#status', /Published/);
  const r = await api(family, '/api/registration', {wrestlerId: samId, program: 'Intermediate', plan: 'monthly'});
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
  const p = await ctx.newPage(); p.on('pageerror', e => { if (!browserNoise(e.message)) problems.push(`[${current}] page error on ${p.url()}: ${e.message}`); }); return p; };
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
  const over = await visitor.evaluate(() => document.documentElement.scrollWidth - 390); expect(over <= 1, `/welcome scrolls sideways by ${over}px`);
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
  await family.goto(BASE + '/register'); await family.waitForSelector('#wrestlerChips [data-wrestler]');
  expect(await family.inputValue('#program') === 'Intermediate', 'a Grade 8 wrestler should start on SWA Intermediate');
  expect(await family.getAttribute('#wrestlerChips [data-wrestler]', 'aria-pressed') === 'true', 'the one wrestler is the chosen chip');
  await family.click('#plan-walkin'); await family.selectOption('#program', 'Intermediate');
  await family.locator(`[data-day="${ny(1)}"]`).first().click(); await family.locator('[data-slot]').first().click();
  await family.click('#reviewButton');
  await family.waitForFunction(() => /\$40\.00/.test(document.body.textContent), null, {timeout: 8000});
  expect(!(await family.isVisible('#cardHelp')) && !(await family.isVisible('#waiverHelp')), 'help links should be hidden');
  await shot(family, 'register-review');
});

// ---------- Pay cash at the academy (issue #248) ----------
await step('family books today\'s walk-in to pay cash; the coach sees $40 due and taps Cash received; Payments shows it', async () => {
  await family.goto(BASE + `/register?plan=walkin&program=Intermediate&date=${today}`);
  await family.waitForFunction(() => document.querySelector('#wrestlerChips [data-wrestler]') && !document.querySelector('#reviewButton')?.disabled);
  await family.click('#reviewButton');
  await family.waitForSelector('#payChoice:not([hidden])');
  // Online checkout is closed in this walkthrough, so cash is the only way offered, and it is already chosen.
  expect(!(await family.isVisible('#payOnlineOption')) && await family.isVisible('#cashBox'), 'Pay cash at the academy is offered while online payment is closed');
  await at(family, '#cashHint', /Book now and pay \$40\.00 in cash at the practice/);
  await family.click('#cashButton');
  await at(family, '#cashDone', /Pay at the academy: \$40\.00 due[\s\S]*Sam Example/);
  await shot(family, 'register-cash-booked');
  const again = await api(family, '/api/cash-bookings', {action: 'book', source: 'membership', plan: 'walkin', wrestlerId: samId, program: 'Intermediate', date: today, practiceId: (await api(family, '/api/cash-bookings')).body.bookings[0].itemId});
  expect(again.status === 409, 'a second booking for the same practice is refused: ' + JSON.stringify(again.body));
  await family.goto(BASE + '/family'); await at(family, '#purchaseList', /Pay at the academy[\s\S]*\$40\.00 due/);
  // The coach sees it on today's roster, taps Cash received, and it counts as paid.
  await coach.goto(BASE + '/roster'); await at(coach, '#sessions', /Sam Example[\s\S]*\$40\.00 cash due/);
  await pickSession(coach, /SWA Intermediate/);
  await shownRow(coach, 'Sam Example').locator('[data-cash]').click();
  await toast(coach, /Cash received: \$40\.00 for Sam Example/);
  await at(coach, '#sessions', /Sam Example[\s\S]*Walk-in paid[\s\S]*Received by Coach Dana/);
  await shot(coach, 'roster-cash-received');
  await openPayments(owner);
  await at(owner, '#rows', /Sam Example[\s\S]*SWA Intermediate walk-in[\s\S]*Cash[\s\S]*\$40\.00/);
  await at(owner, '#cashSummary', /Nothing is waiting to be paid at the academy/);
  await owner.goto(BASE + '/security-log'); const log = await owner.content();
  expect(log.includes('Cash received at the academy') && log.includes('Sam Example'), 'the security log has the cash received');
});

// ---------- No year paid upfront; a membership paid upfront earlier still counts; roster, check-in and QR ----------
await step('no year paid upfront anywhere; a membership paid upfront before the change still counts', async () => {
  // Families are offered the monthly membership and walk-ins only (#210).
  await family.goto(BASE + '/register'); await family.waitForSelector('#wrestlerChips [data-wrestler]');
  expect(!(await family.$('#plan-annual')) && !/upfront/i.test(await family.locator('main').innerText()), 'the register page offers no upfront year');
  const refused = await api(family, '/api/registration', {wrestlerId: samId, program: 'Intermediate', plan: 'annual'});
  expect(refused.status === 400 && /no longer offered/.test(refused.body.error), 'upfront year refused: ' + JSON.stringify(refused.body));
  await owner.goto(BASE + '/payments');
  await owner.waitForFunction(() => [...document.querySelectorAll('#family option')].some(o => /Pat Example/.test(o.textContent)));
  expect(!(await owner.$$eval('#kind option', os => os.some(o => o.value === 'annual'))), 'the owner cannot record a year paid upfront');
  // Sam's membership was paid upfront in cash before #210, so it is already in the database; it stays valid.
  const start = ny(-20);
  sql(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
    VALUES ('e2e-upfront-sam','e2e-family-a','family.a@example.test','${samId}','Sam Example','annual','Intermediate','Intermediate','SWA Intermediate: 12-month membership, paid upfront','[]',240000,0,240000,'usd','{"method":"check","note":"Check 1042","recordedBy":"e2e-owner"}','{"offline":true}','paid','e2e-upfront-sam',0,'${start}T12:00:00.000Z','${start}T12:00:00.000Z','${start}T12:00:00.000Z','${start}','${ny(344)}','offline')`);
  // The table opens on this month (issue #283); the membership was paid 20 days ago, so the chip comes off first.
  await owner.goto(BASE + '/payments'); await owner.waitForSelector('#thisMonth[aria-pressed="true"]'); await owner.click('#thisMonth');
  await owner.waitForSelector('#thisMonth[aria-pressed="false"]');
  await waitText(owner, '#rows', /Sam Example[\s\S]*12-month membership, paid upfront[\s\S]*\$2,400\.00/);
});
await step('Sam is on today\'s roster; owner checks in, undoes, then a QR scan checks in once', async () => {
  await owner.goto(BASE + '/roster'); await waitText(owner, '#sessions', /Sam Example/);
  // Staff see allergies or medical notes and the emergency contact at check-in (issue #188, #197 question 14).
  await waitText(owner, '#sessions', /Sam Example[\s\S]*No allergies or medical notes[\s\S]*Emergency contact: Jordan Emergency · 631-555-0188/);
  await pickSession(owner, /SWA Intermediate/);
  await shownRow(owner, 'Sam Example').locator('[data-checkin]').click(); await toast(owner, /Sam Example checked in/);
  await at(owner, '#sessions', /Sam Example[\s\S]*Checked in \d{1,2}:\d{2} [AP]M/);
  await shownRow(owner, 'Sam Example').locator('[data-undo]').click(); await toast(owner, /Check-in removed/);
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
  await waitText(family, '#membershipCards', /\$2,400\.00 paid upfront on/);
  await waitText(family, '#paymentsPill', /^Paid$/);
  await waitText(family, '#purchaseList', /Paid/);
  // Set up, so the family home leads with the next session and the entry pass instead of the guided start (issue #132).
  await waitText(family, '#nextUpBody', /SWA Intermediate practice[\s\S]*Show entry pass/);
  expect(!(await family.isVisible('#start')), 'a family that is set up does not see the guided start');
  expect(await family.getAttribute('#nextUpBody a.primary', 'href') === '/pass?wrestler=' + samId, 'entry pass button');
  await waitText(family, '#savedDetails', /member through[\s\S]*USA Wrestling card verified[\s\S]*Waiver signed/);
  // The week card, the three doors and the payments line (issue #282).
  await waitText(family, '#weekRows', /SWA Intermediate practice/); expect(await family.locator('#doors .swa-door').count() === 3, 'three doors');
  await waitText(family, '#moneyLine', /due at the academy/);
  await shot(family, 'family-home');
});
await step('a coach sees today\'s roster for their program only and can check in', async () => {
  await coach.goto(BASE + '/roster'); await waitText(coach, '#sessions', /SWA Intermediate/);
  const t = await text(coach, '#sessions');
  expect(!/SWA Development|SWA Advance/.test(t), 'coach sees other programs');
  expect(!/family\.a@example\.test/.test(t), 'coach must not see family emails');
  expect(/Sam Example[\s\S]*No allergies or medical notes[\s\S]*Emergency contact: Jordan Emergency/.test(t), 'a coach sees allergies and the emergency contact for their program');
});

// ---------- Coaches collect cash for extra practices too, and the site shows who received it (issue #250) ----------
await step('a coach records Friday Night Live cash; the owner sees Collected by Coach Dana; the family sees paid in cash', async () => {
  // Friday Night Live runs today as well for this step. Once Sam has paid for it, today's date can no longer be taken
  // away (issue #272): the owner's save is refused and names the session, so the extra date stays.
  const saveFnl = async (dates, expected = 200) => {
    const got = await api(owner, '/api/academy');
    const data = {...got.body.data, extraPractices: got.body.data.extraPractices.map(x => x.id === 'fnl' ? {...x, dates} : x)};
    const r = await owner.evaluate(async ([s, rev]) => { const x = await fetch('/api/academy', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({revision: rev, data: s})}); return {status: x.status, body: await x.json()}; }, [data, got.body.revision]);
    expect(r.status === expected, 'saving Friday Night Live: ' + JSON.stringify(r.body));
    return r;
  };
  await saveFnl([today, ny(2)]);
  try {
    const booked = await api(family, '/api/cash-bookings', {action: 'book', source: 'booking', type: 'live', id: 'fnl', date: today, wrestlerId: samId});
    expect(booked.status === 200 && booked.body.booking.amountCents === 1000, 'Sam books Friday Night Live at the member price to pay cash: ' + JSON.stringify(booked.body));
    // Coach Dana coaches SWA Intermediate only, and Friday Night Live belongs to no program: she sees it anyway.
    await coach.goto(BASE + '/roster'); await at(coach, '#sessions', /Friday Night Live[\s\S]*Sam Example[\s\S]*\$10\.00 cash due/);
    await pickSession(coach, /Friday Night Live/);
    await shownRow(coach, 'Sam Example').locator('[data-cash]').click();
    await toast(coach, /Cash received: \$10\.00 for Sam Example/);
    await at(coach, '#sessions', /Friday Night Live[\s\S]*Sam Example[\s\S]*Received by Coach Dana · \d{1,2}:\d{2} [AP]M[\s\S]*Only the owner can undo cash/);
    await shot(coach, 'roster-fnl-cash-received');
    const paid = (await api(coach, '/api/roster')).body.sessions.find(x => x.type === 'live').entries.find(x => x.name === 'Sam Example').cash;
    expect(paid.status === 'paid' && paid.collectedBy === 'Coach Dana', 'the roster says Coach Dana received it: ' + JSON.stringify(paid));
    const undo = await api(coach, '/api/roster', {action: 'cash-undo', date: today, orderId: paid.orderId});
    expect(undo.status === 403, 'only the owner can undo cash: ' + JSON.stringify(undo.body));
    // The owner sees who collected it: the Payments list, the per-coach total for today, the filter and the spreadsheet.
    await openPayments(owner); await openRecord(owner); await owner.keyboard.press('Escape'); await owner.waitForSelector('#recordSheet', {state: 'hidden'});
    expect(await owner.evaluate(() => document.activeElement?.id) === 'openRecord', 'Escape closes the record panel and returns focus to the button');
    await at(owner, '#rows', /Sam Example[\s\S]*Friday Night Live[\s\S]*Cash[\s\S]*Coach Dana/);
    // The Today chip sets the dates; the detailed filters sit behind "More filters" (issue #283).
    await owner.click('#today'); await owner.waitForSelector('#today[aria-pressed="true"]'); await at(owner, '#byCollector', /Coach Dana[\s\S]*\$50\.00 cash · 2 payments/);
    await owner.click('details.filters summary'); await owner.selectOption('#fCollector', {label: 'Coach Dana'});
    await owner.waitForFunction(() => [...document.querySelectorAll('#rows tr')].every(tr => /Coach Dana/.test(tr.textContent)) && document.querySelectorAll('#rows tr').length === 2);
    await at(owner, '#tOffline', /\$50\.00/);
    await at(owner, '#collectedRows', /Sam Example[\s\S]*Friday Night Live[\s\S]*Coach Dana/);
    await shot(owner, 'payments-collected-by');
    const csv = await owner.evaluate(async () => (await fetch(document.querySelector('#csv').href)).text());
    expect(/^Paid on,Status,Paid via,Method,Collected by,/.test(csv) && /,cash,Coach Dana,live,/.test(csv) && !/coach\.dana@example\.test/.test(csv), 'the spreadsheet has Collected by: ' + csv.slice(0, 200));
    const books = await api(owner, '/api/financials');
    expect(books.body.lines.some(l => /Friday Night Live/.test(l.description) && l.collectedBy === 'Coach Dana'), 'Income and expenses shows who collected it');
    // The family sees it was paid in cash at the academy, not who took it.
    await family.goto(BASE + '/family'); await at(family, '#purchaseList', /Friday Night Live[\s\S]*Paid in cash at the academy on/);
    expect(!/Coach Dana/.test(await text(family, '#purchaseList')), 'the family is not told which coach took the cash');
    const refused = await saveFnl([ny(2)], 409);
    expect(refused.body.blocked.length === 1 && /^Friday Night Live on .* has 1 paid booking$/.test(refused.body.blocked[0]), 'removing a paid date is refused in plain words: ' + JSON.stringify(refused.body));
    await owner.goto(BASE + '/security-log'); await at(owner, 'main', /Academy settings saved[\s\S]*extra practice added: Friday Night Live|Friday Night Live: dates changed/);
  } finally {
    await saveFnl([today, ny(2)]);
  }
});

// ---------- Private lessons ----------
await step('coach adds an opening; owner sets prices; family reviews a lesson; owner records it; coach sees the booking', async () => {
  await openingForm(coach);
  await coach.fill('#opening [name=date]', ny(3)); await coach.fill('#opening [name=start]', '15:00'); await coach.fill('#opening [name=end]', '16:00');
  await coach.click('#opening button'); await toast(coach, /Opening saved/);
  await owner.goto(BASE + '/lesson-settings'); await owner.waitForSelector('[data-price="one-on-one"]');
  await owner.fill('[data-price="one-on-one"]', '60'); await owner.click('#prices button'); await waitText(owner, '#status', /prices saved/);
  // Only one-on-ones have a price so far, so that is the one way to book and it is already chosen (issue #177).
  await family.goto(BASE + '/lesson'); await family.waitForSelector('[data-path="one"][aria-pressed="true"]');
  expect(await family.isDisabled('[data-path="group"]') && await family.isDisabled('[data-path="request"]'), 'unpriced group lessons are not offered');
  await family.locator('[data-opening]').first().click();
  await waitText(family, '#summary', /One-on-one lesson[\s\S]*Coach Dana[\s\S]*\$60\.00/);
  expect(await family.isVisible('#notOpen'), 'lesson payment should say not open yet');
  const body = await family.content(); expect(!body.includes('coach.dana@example.test'), 'coach email leaked to family page');
  await shot(family, 'lesson-review');
  await openPayments(owner); await openRecord(owner); await owner.waitForFunction(() => [...document.querySelectorAll('#family option')].some(o => /Pat Example/.test(o.textContent)));
  await owner.selectOption('#family', {label: 'Pat Example · family.a@example.test'}); await owner.selectOption('#kind', 'lesson');
  await owner.waitForFunction(() => [...document.querySelectorAll('#opening option')].some(o => o.value));
  await owner.click('#preview'); await owner.waitForSelector('#previewBox:not([hidden])'); await owner.click('#record');
  await waitText(owner, '#status', /recorded/i);
  await coach.goto(BASE + '/coach'); await waitText(coach, '#slots', /Booked: One-on-one lesson with Sam Example/);
  await owner.goto(BASE + '/coach-pay'); await waitText(owner, '#coaches', /Coach Dana[\s\S]*1 lesson/);
});

await step('coach removes an opening nobody booked; the booked one stays', async () => {
  await openingForm(coach);
  await coach.fill('#opening [name=date]', ny(4)); await coach.fill('#opening [name=start]', '17:00'); await coach.fill('#opening [name=end]', '18:00');
  await coach.click('#opening button'); await toast(coach, /Opening saved/);
  const before = await coach.locator('[data-slot]').count();
  expect(before >= 1, 'the new opening should be removable');
  await coach.locator('[data-slot]').last().click(); await toast(coach, /Opening removed/);
  await coach.waitForFunction(n => document.querySelectorAll('[data-slot]').length === n - 1, before);
});

// ---------- The owner manages a coach's openings; families see a month view (issue #239) ----------
await step('owner adds an opening for a coach; the coach and families see it, in a list or a month; owner removes it', async () => {
  await owner.goto(BASE + '/staff'); await owner.waitForSelector('#staff [data-coach="coach.dana@example.test"]');
  await owner.click('#staff [data-coach="coach.dana@example.test"] a[href^="/coach-openings"]');
  await at(owner, 'h1', /Lesson openings: Coach Dana/); await owner.waitForSelector('#weeks option[value="12"]', {state: 'attached'});
  await owner.fill('#date', ny(8)); await owner.fill('#start', '12:00'); await owner.dispatchEvent('#start', 'change');
  expect(await owner.inputValue('#end') === '13:00', 'the end time follows the start');
  await owner.click('#save'); await toast(owner, /Opening saved/);
  await at(owner, '#slots', /Open for families to book/);
  await shot(owner, 'owner-coach-openings');
  // The coach sees it on coach home; families can choose it, from the list or the month.
  await coach.goto(BASE + '/coach'); await at(coach, '#slots', /Open for families to book/);
  await family.goto(BASE + '/lesson'); await family.waitForSelector('[data-path="one"][aria-pressed="true"]');
  await family.click('#viewMonth'); await family.waitForSelector('#times .cal-item[data-opening]');
  const month = await text(family, '#times');
  expect(/Coach Dana/.test(month) && /\$60\.00/.test(month), 'the month shows the coach and the price: ' + month.slice(0, 160));
  await family.selectOption('#monthSel', ny(8).slice(0, 7));
  await family.locator(`#times .cal-item:has-text("12:00 PM")`).first().click();
  await at(family, '#summary', /One-on-one lesson[\s\S]*Coach Dana[\s\S]*\$60\.00/);
  await shot(family, 'lesson-month');
  const phone = await phoneAs('family'); await phone.goto(BASE + '/lesson'); await phone.waitForSelector('[data-path="one"][aria-pressed="true"]');
  await phone.click('#viewMonth'); await phone.waitForSelector('#times .cal-item');
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); expect(over <= 1, `/lesson month scrolls sideways by ${over}px on a phone`);
  expect(await phone.$eval('#times .cal-dow', d => getComputedStyle(d).display === 'none'), 'phones get a list of days, not the 7-column grid');
  if (SHOTS) await phone.screenshot({path: `${SHOTS}/phone-lesson-month.png`, fullPage: true});
  await phone.close();
  // The owner removes it again (nobody booked it); the change is in the security log.
  await owner.goto(BASE + '/coach-openings?email=coach.dana%40example.test'); await owner.waitForSelector('#slots [data-slot]');
  const before = await owner.locator('#slots [data-slot]').count();
  await owner.locator('#slots article', {hasText: '12:00 PM'}).locator('[data-slot]').click(); await toast(owner, /Opening removed/);
  await owner.waitForFunction(n => document.querySelectorAll('#slots [data-slot]').length === n - 1, before);
  await owner.goto(BASE + '/security-log'); const log = await owner.content();
  expect(log.includes('Lesson openings added for a coach') && log.includes('A coach’s lesson opening removed') && log.includes('Coach Dana'), 'owner changes are in the security log');
});

// ---------- A full camp is full: no waitlist (#210) ----------
await step('camp fills; family 2 sees it is full, with no waitlist to join', async () => {
  await family2.goto(BASE + '/family'); await family2.waitForSelector('#familyForm');
  await familyReady(family2); await family2.fill('[name=parentName]', 'Riley Parent'); await family2.click('text=+ Add wrestler'); await family2.fill('#name0', 'Riley Two'); await family2.selectOption('#grade0', '8');
  await fillDetails(family2, 'Casey Emergency');
  await family2.fill('#usaw0', 'CD-5555'); await family2.selectOption('#usawSeason0', await latestSeason(family2)); await family2.click('#save'); await saved(family2);
  const rid = await wid(family2);
  await owner.goto(BASE + '/waivers'); await showAll(owner);
  await waitText(owner, '#rows', /Riley Two/);
  await owner.locator('summary:has-text("Allow booking anyway")').first().click();
  await owner.locator('[data-exc-until]').first().fill(ny(30)); await owner.locator('[data-exc-reason]').first().fill('Paper waiver at the door');
  await owner.locator('[data-exc-grant]').first().click(); await waitText(owner, '#status', /Exception saved/);
  // Sam takes the only camp seat.
  await openPayments(owner); await openRecord(owner); await owner.waitForFunction(() => [...document.querySelectorAll('#family option')].some(o => /Pat Example/.test(o.textContent)));
  await owner.selectOption('#family', {label: 'Pat Example · family.a@example.test'}); await owner.selectOption('#kind', 'event');
  await owner.waitForFunction(() => [...document.querySelectorAll('#event option')].some(o => o.value === 'winter-camp'));
  await owner.click('#preview'); await owner.waitForSelector('#previewBox:not([hidden])'); await owner.click('#record'); await waitText(owner, '#status', /recorded/i);
  await family2.goto(BASE + '/booking?type=event&id=winter-camp'); await family2.waitForSelector('#wrestlerChips [data-wrestler]');
  expect(!/\d{4}-\d{2}-\d{2}/.test(await family2.locator('main').innerText()), 'camp dates should be readable, not 2026-11-15');
  await waitText(family2, '#description', /9:00 AM–12:00 PM[\s\S]*Time to be announced/);
  // The page is titled with the event and says where each wrestler stands (issue #132).
  await waitText(family2, 'h1', /Winter camp/); await waitText(family2, '#wrestlerStatus', /Riley Two is not registered yet/);
  // The receipt reviews itself once the wrestler is chosen (issue #282); a full event says so at once.
  await waitText(family2, '#status', /^This event is full\.$/);
  expect(!(await family2.$('#joinWaitlist')) && !/waitlist/i.test(await family2.locator('main').innerText()), 'no waitlist on the booking page');
  await family.goto(BASE + '/booking?type=event&id=winter-camp'); await waitText(family, '#wrestlerStatus', /Sam Example is already registered/);
  await family2.goto(BASE + '/calendar'); expect(!/waitlist/i.test(await family2.locator('body').innerText()), 'no waitlist on the calendar');
  const gone = await owner.request.get(BASE + '/waitlists', {maxRedirects: 0}); expect(gone.status() === 404, 'the owner waitlist page is gone: ' + gone.status());
  const api404 = await family2.request.get(BASE + '/api/waitlist'); expect(api404.status() === 404, 'the family waitlist API is gone: ' + api404.status());
  await family2.goto(BASE + '/family'); expect(!(await family2.$('#waitlist')), 'no waitlist section in the family account');
  expect(rid, 'riley id');
});

// ---------- Camps and clinics can be paid cash at the academy (#273) ----------
await step('family books a clinic to pay cash; the seat is held; the owner sees it under Cash due and records the cash', async () => {
  await family.goto(BASE + '/booking?type=event&id=spring-clinic'); await family.waitForSelector('#wrestlerChips [data-wrestler]');
  await waitText(family, 'h1', /Spring clinic/); await waitText(family, '#wrestlerStatus', /Sam Example is not registered yet/);
  await family.waitForSelector('#payChoice:not([hidden])');
  await at(family, '#details', /Event\s*Spring clinic[\s\S]*Wrestler\s*Sam Example[\s\S]*Total\s*\$60\.00/);
  // Online checkout is closed in this walkthrough, so cash is the one way offered, already chosen; no disabled button is left.
  expect(!(await family.isVisible('#payOnlineOption')) && await family.isVisible('#cashBox'), 'Pay cash at the academy is offered for a clinic while online payment is closed');
  expect(!(await family.$('#payPending')) && !/To book, pay the academy/.test(await family.locator('#review').innerText()), 'no "isn’t open yet" dead end on the clinic');
  await at(family, '#cashHint', /Book now and pay \$60\.00 in cash at the academy on the first day/);
  await at(family, '#details', /2 spots left/);
  await family.click('#cashButton');
  await at(family, '#cashDone', /Pay at the academy: \$60\.00 due[\s\S]*Sam Example[\s\S]*Spring clinic/);
  await shot(family, 'clinic-cash-booked');
  // The unpaid booking holds a seat: the other family sees one spot left.
  const seat = await api(family2, '/api/booking-review', {type: 'event', id: 'spring-clinic', wrestlerId: await wid(family2)});
  expect(seat.status === 200 && seat.body.review.seatsLeft === 1, 'a cash booking takes a seat: ' + JSON.stringify(seat.body));
  const again = await api(family, '/api/cash-bookings', {action: 'book', source: 'booking', type: 'event', id: 'spring-clinic', wrestlerId: samId});
  expect(again.status === 409, 'a second cash booking for the same clinic is refused: ' + JSON.stringify(again.body));
  await family.goto(BASE + '/family'); await at(family, '#purchaseList', /Spring clinic[\s\S]*\$60\.00 due[\s\S]*Bring the cash to the academy on the first day/);
  await family.goto(BASE + '/inbox'); await at(family, 'main', /Booked: Spring clinic/);
  // The owner's Cash due list has it; Cash received turns it into a paid order and the seat stays taken.
  await openPayments(owner); await at(owner, '#cashRows', /Sam Example[\s\S]*Spring clinic[\s\S]*\$60\.00 due/);
  await owner.locator('#cashRows [data-cash-paid]').first().click();
  await at(owner, '#status', /Cash received for Sam Example/);
  await at(owner, '#rows', /Sam Example[\s\S]*Spring clinic[\s\S]*Cash[\s\S]*\$60\.00/);
  const after = await api(family2, '/api/booking-review', {type: 'event', id: 'spring-clinic', wrestlerId: await wid(family2)});
  expect(after.status === 200 && after.body.review.seatsLeft === 1, 'the paid order keeps the seat: ' + JSON.stringify(after.body));
  await family.goto(BASE + '/booking?type=event&id=spring-clinic'); await waitText(family, '#wrestlerStatus', /Sam Example is already registered/);
});

// ---------- No dead ends while a purchase type is closed online (#273) ----------
await step('a membership review offers "Tell the academy I want this"; the owner gets the message; a second send the same day is refused', async () => {
  // Family 2 (Riley): Sam already holds a membership, so his review would be refused.
  const rileyId = await wid(family2);
  await family2.goto(BASE + '/register?plan=monthly&program=Intermediate');
  await family2.waitForFunction(() => document.querySelector('#wrestlerChips [data-wrestler]') && !document.querySelector('#reviewButton')?.disabled);
  await family2.click('#reviewButton'); await family2.waitForSelector('#review:not([hidden])');
  await at(family2, '#reviewDetails', /Each month[\s\S]*\$200\.00/);
  expect(await family2.isVisible('#interestButton') && !(await family2.$('#payPending')), 'one real action, no disabled "isn’t open yet" button');
  await at(family2, '#contactLine', /20 Railroad St, Huntington Station, NY 11746/);
  await family2.click('#interestButton'); await at(family2, '#interestDone', /Sent\.[\s\S]*Riley Two’s SWA Intermediate membership/);
  await shot(family2, 'register-tell-academy');
  const inbox = (await api(family2, '/api/inbox')).body, mine = (inbox.thread || []).find(m => /Request from the website: a 12-month SWA Intermediate membership, paid monthly, for Riley Two \(grade 8\)/.test(m.body));
  expect(mine && mine.from === 'you', 'the request is in the family’s own conversation: ' + JSON.stringify(inbox.thread));
  const families = await api(owner, '/api/messages?families=1&q=family.b');
  const fam = (families.body.families || []).find(f => f.email === 'family.b@example.test');
  expect(fam && fam.unread >= 1, 'the owner sees an unread message from the family: ' + JSON.stringify(families.body));
  const thread = await api(owner, '/api/messages?family=' + encodeURIComponent(fam.userId));
  expect((thread.body.thread || []).some(m => m.from === 'family' && /12-month SWA Intermediate membership/.test(m.body)), 'the owner reads the request: ' + JSON.stringify(thread.body));
  const twice = await api(family2, '/api/interest', {kind: 'membership', wrestlerId: rileyId, program: 'Intermediate'});
  expect(twice.status === 409 && /already told the academy/.test(twice.body.error), 'one request per item per day: ' + JSON.stringify(twice.body));
});

// ---------- USA Wrestling card at check-in (#210) ----------
await step('a wrestler whose card is not verified can\'t be checked in; the roster says why; an owner exception lets them in', async () => {
  const rid = await wid(family2);
  // Riley's card is on file but not verified. Booking still works (with the waiver exception above); check-in does not.
  const practice = (await api(owner, '/api/roster')).body.sessions.find(s => s.key.startsWith('practice:Intermediate:'));
  expect(practice, 'an SWA Intermediate practice today');
  const r = await api(owner, '/api/payments', {action: 'record', userId: 'e2e-family-b', wrestlerId: rid, kind: 'walkin', program: 'Intermediate', date: today, practiceId: `Intermediate:${today}:${practice.start}`, method: 'cash'});
  expect(r.status === 200, 'walk-in recorded: ' + JSON.stringify(r.body));
  await owner.goto(BASE + '/roster'); await waitText(owner, '#sessions', /Riley Two can.t be checked in: the USA Wrestling card has not been verified yet\. Check it and mark it verified on the USA Wrestling cards page\./);
  await pickSession(owner, /SWA Intermediate/);
  const row = shownRow(owner, 'Riley Two');
  // A held wrestler: the red-outlined row, a disabled Hold where Check in would be, and the reason behind "Why?".
  expect(await row.locator('button:has-text("Hold")').isDisabled() && !(await row.locator('[data-checkin]').count()), 'no Check in button for Riley');
  expect(await row.evaluate(el => el.classList.contains('hold')) && await row.locator('details.why summary').isVisible(), 'the held row is marked and has Why?');
  await shot(owner, 'roster-card-blocked');
  const pass = (await api(family2, '/api/passes')).body.passes[0].code;
  let s = await api(owner, '/api/roster', {action: 'scan', date: today, code: pass});
  expect(s.status === 409 && /Riley Two can.t be checked in/.test(s.body.error), 'scan refused: ' + JSON.stringify(s.body));
  // The coach sees the same reason, with what to do next.
  await coach.goto(BASE + '/roster'); await waitText(coach, '#sessions', /Riley Two can.t be checked in[^.]*\. Ask the owner to verify the card\./);
  // The owner's card exception covers check-in the same way it covers booking.
  const g = await api(owner, '/api/exceptions', {action: 'grant', userId: 'e2e-family-b', wrestlerId: rid, rule: 'usaw', endsOn: ny(7), reason: 'Card being checked with USA Wrestling'});
  expect(g.status === 200, 'exception ' + JSON.stringify(g.body));
  s = await api(owner, '/api/roster', {action: 'scan', date: today, code: pass});
  expect(s.status === 200 && !s.body.scan.already, 'scan under the exception: ' + JSON.stringify(s.body).slice(0, 200));
  await owner.goto(BASE + '/roster'); await waitText(owner, '#sessions', /Riley Two[\s\S]*Owner exception: card/);
});

// ---------- Partner and small-group lessons (issue #177) ----------
// The owner records a lesson payment for a family's wrestler in the lesson whose label matches.
async function recordLesson(familyLabel, wrestler, lesson) {
  await openPayments(owner); await openRecord(owner); await owner.waitForFunction(l => [...document.querySelectorAll('#family option')].some(o => o.textContent === l), familyLabel);
  await owner.selectOption('#family', {label: familyLabel});
  await owner.selectOption('#wrestler', {label: (await owner.$$eval('#wrestler option', (os, w) => os.map(o => o.textContent).find(t => t.startsWith(w)), wrestler))});
  await owner.selectOption('#kind', 'lesson');
  await owner.waitForFunction(re => [...document.querySelectorAll('#opening option')].some(o => new RegExp(re).test(o.textContent)), lesson.source);
  const value = await owner.$$eval('#opening option', (os, re) => os.find(o => new RegExp(re).test(o.textContent)).value, lesson.source);
  await owner.selectOption('#opening', value);
  // Choosing a time reloads the lesson types in the background, and Check price stays off until they are in (issue
  // #220). The type must also match this time, or the preview would go out with the first time's type and be refused.
  await owner.waitForFunction(() => {
    const time = document.querySelector('#opening option:checked')?.textContent || '', type = document.querySelector('#format option');
    return !!type?.value && type.textContent.startsWith((time.match(/Partner lesson|Small-group lesson/) || ['One-on-one lesson'])[0]);
  });
  await owner.click('#preview'); await owner.waitForSelector('#previewBox:not([hidden])'); await owner.click('#record');
  await waitText(owner, '#status', /recorded/i);
}
await step('coach posts a small group with 4 spots; two families each book a wrestler; the roster shows both', async () => {
  await owner.goto(BASE + '/lesson-settings'); await owner.waitForSelector('[data-price="small-group"]');
  await waitText(owner, 'h2', /Price per wrestler/);
  await owner.fill('[data-price="partner"]', '45'); await owner.fill('[data-price="small-group"]', '35'); await owner.click('#prices button'); await waitText(owner, '#status', /prices saved/);
  await openingForm(coach);
  await coach.fill('#opening [name=date]', ny(5)); await coach.fill('#opening [name=start]', '10:00'); await coach.fill('#opening [name=end]', '11:00');
  await coach.selectOption('#format', 'small-group'); await coach.selectOption('#spots', '4');
  await coach.click('#opening button'); await toast(coach, /Opening saved/);
  await waitText(coach, '#slots', /Small-group lesson[\s\S]*4 of 4 spots left[\s\S]*Coach-hosted/);
  // Each family sees the group with its spots and books their own wrestler at the price per wrestler.
  for (const [page, name, left] of [[family, 'Sam Example', '4 of 4'], [family2, 'Riley Two', '3 of 4']]) {
    await page.goto(BASE + '/lesson'); await page.waitForSelector('[data-path="group"]:not([disabled])');
    await waitText(page, '#paths', /Join a partner or small group[\s\S]*1 group with spots/);
    await page.click('[data-path="group"]'); await waitText(page, '#times', new RegExp(`Small-group lesson[\\s\\S]*${left} spots left`));
    await page.locator('[data-opening]').first().click();
    // The receipt (issue #282): "For" is the line's label, the wrestler and the spots its value.
    await waitText(page, '#summary', new RegExp(`Small-group lesson[\\s\\S]*Coach Dana[\\s\\S]*For\\s*${name} · ${left} spots left[\\s\\S]*\\$35\\.00[\\s\\S]*per wrestler`));
    expect(await page.isVisible('#notOpen'), 'pay at the academy while lesson checkout is closed');
    if (page === family) await shot(family, 'lesson-join-group');
    await recordLesson(page === family ? 'Pat Example · family.a@example.test' : 'Riley Parent · family.b@example.test', name, /Small-group lesson · \d of 4 spots left/);
  }
  await coach.goto(BASE + '/coach');
  await waitText(coach, '#slots', /Small-group lesson[\s\S]*2 of 4 spots left[\s\S]*Coach-hosted[\s\S]*Sam Example[\s\S]*Parent: Pat Example · 555-0100[\s\S]*Riley Two[\s\S]*Parent: Riley Parent/);
  await shot(coach, 'coach-group-roster');
  // Coach pay sums per wrestler: the one-on-one and the small group are 2 lessons with 3 wrestlers.
  const pay = await api(owner, `/api/coach-pay?from=${ny(0)}&to=${ny(30)}`);
  expect(pay.body.coaches[0]?.lessons === 2 && pay.body.coaches[0]?.wrestlers === 3 && pay.body.coaches[0]?.grossCents === 6000 + 2 * 3500, 'coach pay: ' + JSON.stringify(pay.body.coaches[0]));
});
await step('a family starts a private partner lesson; a second family joins through the invite link; the lesson is full', async () => {
  await openingForm(coach);
  await coach.fill('#opening [name=date]', ny(6)); await coach.fill('#opening [name=start]', '16:00'); await coach.fill('#opening [name=end]', '17:00');
  await coach.click('#opening button'); await toast(coach, /Opening saved/);
  await family.goto(BASE + '/lesson'); await family.waitForSelector('[data-path="request"]:not([disabled])');
  await family.click('[data-path="request"]'); await family.click('[data-kind="partner"]');
  expect(await family.isChecked('[data-own]'), 'the family’s wrestler is in the group');
  await family.locator('[data-opening]').first().click();
  await waitText(family, '#summary', /Private partner lesson[\s\S]*2 spots: Sam Example and 1 for families you invite[\s\S]*\$45\.00 per wrestler/);
  await shot(family, 'lesson-request');
  await family.click('#requestGroup'); await waitText(family, '#status', /private group is set up/);
  await waitText(family, '#mineList', /Partner lesson[\s\S]*1 of 2 spots left[\s\S]*Sam Example[\s\S]*Kept for you/);
  const link = await family.inputValue('#mineList input');
  expect(/\/lesson\?join=[A-Za-z0-9_-]{32}$/.test(link), 'invite link: ' + link);
  await family.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: BASE});
  await family.click('#mineList [data-copy]'); await waitText(family, '#status', /Invite link copied|link is selected/);
  await shot(family, 'lesson-my-group');
  // Never listed: another family sees no sign of it until they open the link.
  const listing = await api(family2, '/api/lessons');
  expect(!JSON.stringify(listing.body).includes(link.split('join=')[1]) && listing.body.openings.every(o => o.date !== ny(6)), 'a private group must not be listed');
  await family2.goto(link); await family2.waitForSelector('#joinBox:not([hidden])');
  await waitText(family2, '#joinHeading', /Join Pat Example’s group/);
  await waitText(family2, '#summary', /Partner lesson[\s\S]*For\s*Riley Two · 1 of 2 spots left[\s\S]*\$45\.00[\s\S]*per wrestler/);
  expect(!(await family2.isVisible('#stepType')), 'an invite link opens straight to joining');
  await shot(family2, 'lesson-invite-join');
  await recordLesson('Riley Parent · family.b@example.test', 'Riley Two', /Partner lesson, private group of Pat Example · 1 of 2 spots left, 1 kept for their wrestlers/);
  // Sam's spot is kept for him, so the owner can still record it although no other family can take it.
  await recordLesson('Pat Example · family.a@example.test', 'Sam Example', /Partner lesson, private group of Pat Example · 0 of 2 spots left, 1 kept for their wrestlers/);
  await family.goto(BASE + '/lesson'); await waitText(family, '#mineList', /Partner lesson[\s\S]*Full[\s\S]*Riley Two[\s\S]*Paid[\s\S]*Sam Example[\s\S]*Paid/);
  const joined = await api(family2, '/api/lessons?join=' + link.split('join=')[1]);
  expect(joined.body.invite?.spotsLeft === 0, 'the lesson is full: ' + JSON.stringify(joined.body.invite));
  await coach.goto(BASE + '/coach');
  await waitText(coach, '#slots', /Partner lesson[\s\S]*0 of 2 spots left[\s\S]*Family-requested private group, organised by Pat Example[\s\S]*Riley Two[\s\S]*Sam Example/);
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
  await owner.waitForSelector('#emailNote:not([hidden])'); expect(!(await owner.isVisible('#failedEmails')), 'no failed-email list when nothing failed');
  // Each choice asks the server for a count; the page shows only the latest choice's (issue #220).
  await owner.selectOption('#audType', 'program'); await owner.selectOption('#program', 'Intermediate'); await at(owner, '#audCount', /^SWA Intermediate members: 1 family$/);
  await owner.fill('#subject', 'Practice moved'); await owner.fill('#body', 'Practice starts at 6:30 tonight.'); await owner.click('#send');
  await waitText(owner, '#status', /Sent to 1 family/);
  await family.goto(BASE + '/family'); await waitText(family, '#inboxLink', /\d+ new/);
  await family.goto(BASE + '/inbox'); await waitText(family, '#announcements', /Practice moved/);
  // Automatic notices from earlier steps (issue #105).
  await waitText(family, '#notices', /Payment received[\s\S]*/); await waitText(family, '#notices', /Lesson booked/); await waitText(family, '#notices', /Please sign the Participation waiver/);
  await family.fill('#body', 'Thanks, see you there.'); await family.click('#reply button'); await waitText(family, '#thread', /see you there/);
  // The newest notice opens by itself, and one button marks everything read (issue #132).
  expect(await family.locator('#notices details[open]').count() === 1 && await family.locator('#notices details').first().getAttribute('open') !== null, 'newest notice is open');
  await family.waitForSelector('#markAll:not([hidden])'); await family.click('#markAll'); await toastText(family, /All messages are marked as read/);
  expect(await family.locator('#notices .unread, #announcements .unread').count() === 0 && !(await family.isVisible('#markAll')), 'nothing left unread');
  expect(!((await api(family, '/api/inbox')).body.unread), 'server agrees nothing is unread');
  // The Messages link counts what /api/inbox says is unread: check that answer, not a fixed wait.
  const inbox = family.waitForResponse(r => new URL(r.url()).pathname === '/api/inbox');
  await family.goto(BASE + '/family'); await family.waitForSelector('#summary:not([hidden])');
  expect(!(await (await inbox).json()).unread, 'the family page is told nothing is unread');
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
// ---------- Coach invitation and onboarding (issue #190) ----------
let lee;
await step('owner invites a coach; the coach accepts, sets up the authenticator and lands on coach home', async () => {
  await owner.goto(BASE + '/staff'); await owner.waitForSelector('#inviteForm');
  await owner.fill('#inviteForm [name=name]', 'Coach Lee'); await owner.fill('#inviteForm [name=email]', 'coach.lee@example.test');
  await owner.check('#inviteForm [name=programs][value=Elementary]'); await owner.click('#sendInvite');
  await owner.waitForFunction(() => document.querySelector('#inviteLink')?.value, null, {timeout: 8000});
  const link = await owner.inputValue('#inviteLink');
  expect(link.startsWith(BASE + '/coach-join#invite=') && /#invite=[a-f0-9]{64}$/.test(link), 'invite link from appOrigin(): ' + link);
  await waitText(owner, '#inviteNote', /Email isn’t set up yet[\s\S]*Copy the link/);
  await waitText(owner, '#invites', /Coach Lee[\s\S]*Waiting/);
  await shot(owner, 'staff-invite');
  lee = await as('invitee');
  await lee.goto(link); await lee.waitForSelector('#acceptInvite', {state: 'visible'});
  await waitText(lee, '#details', /Coach Lee[\s\S]*SWA Development/);
  await shot(lee, 'coach-join');
  await lee.click('#acceptInvite'); await lee.waitForURL(/\/security$/);
  const reuse = await api(lee, '/api/coach-invite', {action: 'accept', token: link.split('#invite=')[1]});
  expect(reuse.status === 410, 'an invite works once: ' + reuse.status);
  // The stand-in cannot check a real authenticator code, so the walkthrough plays a finished setup.
  users.invitee.factors = [{id: 'f-lee', status: 'verified', factor_type: 'totp'}]; users.invitee.aal = 'aal2';
  const c = sessionCookie('invitee', AUTH); await lee.context().addCookies([{name: c.name, value: c.value, url: BASE}]);
  await lee.goto(BASE + '/security'); await lee.waitForSelector('#continue', {state: 'visible'}); await lee.click('#continue');
  await lee.waitForURL(/\/coach$/); await waitText(lee, '#heading', /Coach Lee/);
  await waitText(lee, '#programs', /SWA Development/);
  await owner.goto(BASE + '/staff'); await waitText(owner, '#staff', /Coach Lee[\s\S]*SWA Development/);
  expect(!(await owner.isVisible('#invitesBox')), 'the accepted invite leaves the waiting list');
});
await step('the new coach writes a profile and posts a weekly opening; families see the bio beside the times', async () => {
  // The form stays disabled until the saved profile is in, so nothing typed is overwritten by the load (issue #220).
  await lee.goto(BASE + '/coach'); await lee.click('text=Your profile'); await lee.waitForSelector('#profileFields:not([disabled])');
  await at(lee, '#saved', /^Not saved yet$/);
  await lee.fill('#displayName', 'Lee Tran'); await lee.fill('#bio', 'Ten years coaching folkstyle. Former state qualifier.');
  await lee.fill('#specialties', 'Takedowns, Mat returns'); await lee.fill('#phone', '(631) 555-0199');
  await lee.click('#saveProfile'); await toast(lee, /Profile saved/);
  await at(lee, '#preview', /Lee Tran[\s\S]*Takedowns[\s\S]*Ten years/);
  await shot(lee, 'coach-profile');
  await openingForm(lee);
  await lee.fill('#opening [name=date]', ny(9)); await lee.fill('#opening [name=start]', '17:00'); await lee.fill('#opening [name=end]', '18:00');
  await lee.selectOption('#weeks', '3'); await at(lee, '#repeatHelp', /Adds 3 openings/);
  await lee.click('#opening button'); await toast(lee, /3 openings saved/);
  expect((await lee.locator('[data-slot]').count()) === 3, 'three weekly openings');
  await shot(lee, 'coach-weekly');
  const listing = await api(family, '/api/lessons');
  const mine = listing.body.openings.filter(o => o.coach === 'Lee Tran');
  expect(mine.length === 3 && JSON.stringify(listing.body).indexOf('555-0199') < 0 && JSON.stringify(listing.body).indexOf('coach.lee@example.test') < 0, 'family sees the openings, not the phone or email');
  await family.goto(BASE + '/lesson'); await family.click('[data-path="one"]');
  await family.selectOption('#coach', {label: 'Lee Tran'});
  await at(family, '#coachAbout', /About Lee Tran[\s\S]*Ten years coaching folkstyle[\s\S]*Takedowns/);
  await shot(family, 'lesson-coach-about');
});
await step('the owner adds himself as a coach, opens Coach view and posts an opening', async () => {
  await owner.goto(BASE + '/staff'); await owner.waitForSelector('#selfAdd');
  await owner.fill('#selfName', 'Justin'); await owner.check('#self [name=self][value=Advanced]'); await owner.click('#selfAdd');
  await waitText(owner, '#status', /You are now a coach too/);
  // The owner's own row on Coaches opens Coach view (issue #283); it is also a tab of Coaches & lessons.
  await owner.goto(BASE + '/staff'); await owner.waitForSelector('#self a[href="/coach"]');
  expect(await owner.isVisible('.os-tabs a[href="/coach"]'), 'Coach view is a tab of Coaches & lessons');
  await owner.click('#self a[href="/coach"]'); await owner.waitForURL(/\/coach$/);
  await waitText(owner, '#heading', /Justin/); expect(await owner.isVisible('#ownerNote'), 'owner note in Coach view');
  await openOpening(owner);
  await owner.fill('#opening [name=date]', ny(10)); await owner.fill('#opening [name=start]', '08:00'); await owner.fill('#opening [name=end]', '09:00');
  await owner.click('#opening button'); await toast(owner, /Opening saved/);
  await shot(owner, 'owner-coach-view');
  const listing = await api(family, '/api/lessons');
  expect(listing.body.openings.some(o => o.coach === 'Justin' && o.date === ny(10)), 'families can book the owner');
});
// ---------- The public website (issue #196): the owner edits and publishes; visitors see names only, no photos ----------
await step('owner edits the public website; a visitor sees the headline, mission, coaches, achievements and alumni', async () => {
  let visitor = await phoneAs(null);
  await visitor.goto(BASE + '/team'); await at(visitor, '.hero', /listed here soon/);
  expect(!(await visitor.isVisible('#coaches')), 'no coach is listed until the owner chooses them');
  await owner.goto(BASE + '/'); await owner.click('.os-nav a[href="/website"]'); await owner.waitForURL(/\/website$/);
  // The editor is disabled until the published site is in, so nothing typed is overwritten by the load (issue #220).
  await owner.waitForSelector('#editor:not([disabled])'); await at(owner, '#achList', /No achievements yet/); await at(owner, '#alumList', /No alumni yet/);
  await owner.fill('#headline', 'Built on the mat'); await owner.fill('#intro', 'Wrestling for kindergarten through 12th grade in Huntington Station.');
  await owner.fill('#mission', 'Build tough, coachable wrestlers and good teammates.');
  // Ticking a coach redraws the list, so click rather than check (which re-reads the old box).
  await owner.click('#coachList label:has-text("Lee Tran") input'); await at(owner, '#coachList', /1Lee Tran/);
  await owner.click('#coachList label:has-text("Justin") input');
  await at(owner, '#coachList', /1[\s\S]*Lee Tran[\s\S]*2[\s\S]*Justin/);
  await owner.click('text=Add an achievement');
  await owner.fill('[aria-label="Wrestler’s name, achievement 1"]', 'Sam Example'); await owner.fill('[aria-label="Achievement, achievement 1"]', 'County champion, 1st place');
  await owner.fill('[aria-label="Season or year, achievement 1"]', '2025–26');
  await owner.click('text=Add an alumni entry');
  await owner.fill('[aria-label="Name, alumni entry 1"]', 'Alex Moore'); await owner.fill('[aria-label="Years with the academy, alumni entry 1"]', '2014–2020');
  await owner.fill('[aria-label="Where they went or what they did, alumni entry 1"]', 'Wrestles in college');
  await owner.click('text=Preview team page'); await owner.waitForSelector('#previewBox:not([hidden])');
  await at(owner, '#previewNote', /Not published until you save/);
  await visitor.reload(); expect(!(await visitor.isVisible('#achievements')), 'the preview publishes nothing');
  await owner.click('#saveButton'); await at(owner, '#status', /Saved and published/);
  await shot(owner, 'website-editor');
  // A new visitor: public pages may be cached for 20 seconds.
  await visitor.context().close(); visitor = await phoneAs(null);
  await visitor.goto(BASE + '/'); expect(new URL(visitor.url()).pathname === '/welcome', 'signed-out home is still /welcome');
  await at(visitor, 'h1', /Built on the mat/); await at(visitor, '.mission', /Build tough, coachable wrestlers/);
  await at(visitor, '#programs', /SWA Development/);
  expect(await visitor.isVisible('.actions a[href="/login"]'), 'sign in stays on the home page');
  expect(/Built on the mat \| Savage Wrestling Academy/.test(await visitor.title()), 'title from the headline');
  expect((await visitor.getAttribute('link[rel=canonical]', 'href')) === BASE + '/welcome', 'canonical address from APP_ORIGIN');
  await visitor.click('.teaser a[href="/team"]'); await visitor.waitForURL(/\/team$/);
  await at(visitor, '#coaches', /Lee Tran[\s\S]*Ten years coaching folkstyle[\s\S]*Justin/);
  await at(visitor, '#achievements', /2025–26[\s\S]*Sam Example[\s\S]*County champion/); await at(visitor, '#alumni', /Alex Moore[\s\S]*Wrestles in college/);
  const body = await visitor.content();
  expect(!/555-0199|@example\.test|savagewrestlingclub@/.test(body), 'no coach phone or email on the team page');
  expect(!(await visitor.locator('main img').count()), 'no photos on the team page');
  const over = await visitor.evaluate(() => document.documentElement.scrollWidth - 390); expect(over <= 1, `/team scrolls sideways by ${over}px`);
  if (SHOTS) await visitor.screenshot({path: `${SHOTS}/phone-team.png`, fullPage: true});
  await visitor.context().close();
});
// ---------- Coach hours and time off (issue #193) ----------
await step('a coach clocks in and out of today\'s practice from coach home on a phone', async () => {
  const phone = await as('coach', {width: 390, height: 844});
  await phone.goto(BASE + '/coach'); await phone.waitForSelector('#clockCard [data-duty="head"]');
  await at(phone, '#clockCard', new RegExp('SWA Intermediate · ' + PRACTICE.label));
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over <= 1, `coach home scrolls sideways by ${over}px on a phone`);
  await phone.click('#clockCard [data-cc="in"]'); await at(phone, '#clockCard .cc-status', /Choose Head coach or Assistant coach first/);
  // The practice's own button: the card offers the session running or next first, which before 3 PM is Friday Night Live.
  await phone.click('#clockCard [data-duty="head"]'); await phone.click('#clockCard [data-cc="in"][data-session^="practice:Intermediate:"]');
  await at(phone, '#clockCard', /On the clock[\s\S]*SWA Intermediate[\s\S]*Head coach/);
  const big = await phone.locator('#clockCard [data-cc="out"]').boundingBox();
  expect(big && big.height >= 70 && big.width >= 300, 'a big clock-out button on a phone: ' + JSON.stringify(big));
  await shot(phone, 'coach-clocked-in');
  await phone.click('#clockCard [data-cc="out"]'); await toast(phone, /Clocked out/);
  await phone.goto(BASE + '/coach-time'); await at(phone, '#shifts', new RegExp('SWA Intermediate · ' + PRACTICE.label + ' · Head coach'));
  await at(phone, '#submitHelp', /its last day|Sends every shift/);
  const over2 = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over2 <= 1, `/coach-time scrolls sideways by ${over2}px on a phone`);
  await shot(phone, 'coach-hours'); await phone.context().close();
});
// The last day of last month, in New York time: always on or after its last day, so it can be sent.
const lastMonthEnd = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, 0)).toISOString().slice(0, 10);
await step('the coach adds a missed shift for last month and sends it; the owner corrects, approves and downloads the hours', async () => {
  const month = lastMonthEnd.slice(0, 7);
  await coach.goto(BASE + '/coach-time'); await coach.waitForSelector('#addBox');
  await coach.click('#addBox summary'); await coach.fill('#addDate', lastMonthEnd);
  await coach.waitForFunction(() => !/Choose a date first/.test(document.querySelector('#addSession').textContent));
  await coach.selectOption('#addDuty', 'head'); await coach.fill('#addForm [name=in]', '18:00'); await coach.fill('#addForm [name=out]', '19:30');
  await coach.fill('#addForm [name=reason]', 'Phone died at practice');
  await coach.click('#addForm button[type=submit]'); await toast(coach, /Shift added/);
  await coach.click('#prev'); await at(coach, '#shifts', /Added by hand, not clocked: Phone died at practice/);
  await coach.click('#submit'); await toast(coach, /1 shift sent to the academy/);
  await at(coach, '#monthState', /Sent to the academy/);
  await owner.goto(BASE + '/timesheets?month=' + month); await at(owner, '#coaches', /Coach Dana[\s\S]*Sent, waiting for you/);
  const dana = owner.locator('section.coach', {hasText: 'Coach Dana'});
  await dana.locator('summary', {hasText: 'Correct'}).click();
  await dana.locator('select[id^="h-"]').selectOption('1'); await dana.locator('select[id^="m-"]').selectOption('30');
  await dana.locator('select[id^="d-"]').selectOption('head'); await dana.locator('input[id^="r-"]').fill('Confirmed with the coach');
  await dana.locator('[data-correct]').click(); await at(owner, '#status', /Correction saved/);
  await owner.click('[data-approve="coach.dana@example.test"]'); await at(owner, '#status', /Approved 1 shift \(\$60\.00\)/);
  await at(owner, '#coaches', /Coach Dana[\s\S]*Approved/);
  const csv = await owner.evaluate(async m => (await fetch('/api/timesheets?format=csv&month=' + m)).text(), month);
  expect(/Coach Dana,coach\.dana@example\.test,[\d-]+,Practice,[\d-]+,[^,]*,Head coach,1\.50,40\.00 per hour,60\.00,Confirmed with the coach/.test(csv), 'the file has the approved shift: ' + csv.slice(0, 400));
  expect(!/wage|invoice|overtime|withhold/i.test(csv), 'hours and amounts only');
  await shot(owner, 'owner-timesheets');
});
await step('a coach asks for time off; the owner approves; only coaches in the same program are told and practices are listed for cover', async () => {
  // Lee coaches SWA Intermediate with Dana for this step; the owner coaches SWA Advance only.
  expect((await api(owner, '/api/staff', {action: 'grant', email: 'coach.lee@example.test', name: 'Coach Lee', programs: ['Elementary', 'Intermediate']})).status === 200, 'Lee joins SWA Intermediate');
  await coach.goto(BASE + '/coach-time'); await coach.waitForSelector('#offForm');
  await coach.fill('#offForm [name=start]', ny(30)); await coach.fill('#offForm [name=end]', ny(31)); await coach.fill('#offForm [name=reason]', 'Family wedding');
  await coach.click('#offForm button[type=submit]'); await toast(coach, /Time off requested/);
  await at(coach, '#offList', /Waiting for the academy/);
  await owner.goto(BASE + '/timesheets'); await at(owner, '#offPending', /Coach Dana[\s\S]*Family wedding[\s\S]*SWA Intermediate practice/);
  await owner.click('#offPending [data-decision="approve"]'); await at(owner, '#status', /Time off approved\. 1 coach was told/);
  await at(owner, '#offApproved', /Coach Dana[\s\S]*SWA Intermediate practice/);
  const toldLee = await api(lee, '/api/coach-time');
  expect(toldLee.body.notices.some(n => /^Coach Dana is away/.test(n.subject) && !/wedding/i.test(n.body)), 'Lee is told, without the reason');
  const toldOwner = await api(owner, '/api/coach-time');
  expect(!toldOwner.body.notices.some(n => /Coach Dana/.test(n.subject)), 'the owner (another program) is not told');
  await coach.goto(BASE + '/coach-time'); await at(coach, '#offList', /Approved/); await at(coach, '#notices', /Time off approved/);
  expect((await api(owner, '/api/staff', {action: 'grant', email: 'coach.lee@example.test', name: 'Coach Lee', programs: ['Elementary']})).status === 200, 'Lee back to SWA Development');
});
// ---------- Coach contracts and the Parent Consent Form (issue #195) ----------
await step('owner publishes a coach contract; the coach sees a to-do, signs it on /contract, and the owner sees who signed', async () => {
  await owner.goto(BASE + '/contracts'); await at(owner, 'h1', /Coach contracts/);
  await owner.fill('#wTitle', 'Coach contract 2026'); await owner.fill('#wBody', 'Sample contract text for testing only. '.repeat(8));
  await owner.click('#publish'); await at(owner, '#status', /Published/);
  await coach.goto(BASE + '/coach'); await at(coach, '#contractTodo', /To do:[\s\S]*Coach contract 2026/);
  expect(await coach.isVisible('#openingBox'), 'an unsigned contract does not block coaching');
  await coach.click('#contractTodo a'); await coach.waitForURL(/\/contract$/); await coach.waitForSelector('#signatureCanvas');
  expect(!(await coach.isVisible('#wrestlerField')), 'a coach signs for themselves, with no wrestler to choose');
  await coach.fill('#signer', 'Dana Coach'); await draw(coach, '#signatureCanvas');
  await coach.check('#accepted'); await coach.check('#electronicConsent'); await coach.click('#sign');
  await at(coach, '#status', /Signed\. A copy is saved below/);
  const copy = await coach.locator('a:has-text("View / print")').first().getAttribute('href');
  const res = await coach.request.get(BASE + copy), page = await res.text();
  expect(res.status() === 200 && /Coach contract 2026/.test(page) && /<strong>Coach<\/strong> Dana Coach/.test(page), 'signed contract copy');
  const other = await family.request.get(BASE + copy); expect(other.status() === 404, 'a family cannot open a coach contract, got ' + other.status());
  await shot(coach, 'contract-signed');
  await coach.goto(BASE + '/coach'); await coach.waitForSelector('#slots article, #slots p'); await coach.waitForTimeout(600);
  expect(!(await coach.isVisible('#contractTodo')), 'the to-do goes away once signed');
  await owner.goto(BASE + '/contracts'); await showAll(owner);
  await at(owner, '#rows', /coach\.dana@example\.test/);
  expect(/Signed/.test(await owner.locator('#rows tr', {hasText: 'coach.dana@example.test'}).textContent()), 'the owner sees the coach signed');
  expect(/Not signed/.test(await owner.locator('#rows tr', {hasText: 'coach.lee@example.test'}).textContent()), 'and who has not');
  expect(!(await owner.locator('#rows').textContent()).includes('savagewrestlingclub@gmail.com'), 'the owner does not sign a coach contract');
  await shot(owner, 'contracts-owner');
  await owner.goto(BASE + '/contract'); await at(owner, '#noneText', /As the owner/);
});
await step('owner publishes the Parent Consent Form; booking waits until a parent signs it on /consent', async () => {
  // Until the owner publishes it (after the attorney's review), the launch checklist lists it and nothing changes for families.
  await owner.goto(BASE + '/'); await owner.waitForSelector('[data-launch="consent"]');
  expect(await owner.getAttribute('[data-launch="consent"]', 'data-status') === 'todo', 'consent form is a launch to-do');
  await at(owner, '[data-launch="consent"]', /Publish the Parent Consent Form \(after attorney review\)/);
  // A lesson inquiry passes every other check for Sam (card, waiver), so only the form can refuse it.
  const quote = () => api(family, '/api/booking-review', {type: 'lesson', wrestlerId: samId, format: 'one-on-one'});
  const open = await quote(); expect(open.status === 200, 'nothing blocks Sam before the form is published: ' + JSON.stringify(open.body));
  await owner.goto(BASE + '/consent-forms'); await at(owner, '#publishNotice', /attorney has not reviewed/);
  expect(await owner.inputValue('#wTitle') === 'Parent Consent Form', 'default title');
  await owner.fill('#wBody', 'Sample consent form text for testing only. '.repeat(8)); await owner.click('#publish'); await at(owner, '#status', /Published/);
  const blocked = await quote();
  expect(blocked.status === 403 && /Sam Example needs a signed Parent Consent Form before booking/.test(blocked.body.error), 'expected consent block: ' + JSON.stringify(blocked.body));
  await family.goto(BASE + '/family'); await at(family, '#savedDetails', /Parent Consent Form not signed/);
  await family.goto(BASE + '/waiver'); await at(family, '#also', /Also needed[\s\S]*Parent Consent Form/);
  await family.goto(BASE + '/consent?wrestler=' + samId); await family.waitForSelector('#signatureCanvas'); await at(family, 'h1', /Parent Consent Form/);
  // Decision Q16: a parent or guardian signs, never the wrestler.
  await family.fill('#signer', 'Sam Example'); await draw(family, '#signatureCanvas');
  await family.check('#accepted'); await family.check('#electronicConsent'); await family.click('#sign');
  await at(family, '#status', /parent or guardian signs for every wrestler/);
  await family.fill('#signer', 'Pat Example'); await family.click('#sign'); await at(family, '#status', /Signed for Sam Example/);
  const after = await quote(); expect(after.status === 200, 'signed: the form no longer blocks booking: ' + JSON.stringify(after.body));
  await shot(family, 'consent-signed');
  await owner.goto(BASE + '/consent-forms'); await showAll(owner);
  await at(owner, '#rows', /Sam Example/);
  expect(/Signed/.test(await owner.locator('#rows tr', {hasText: 'Sam Example'}).textContent()), 'the owner sees the signature');
  await shot(owner, 'consent-forms-owner');
  // The rest of the walkthrough runs without the form, as the live site will until the attorney has reviewed it.
  await owner.click('#retire'); await at(owner, '#status', /Form retired/);
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
  // Create stays off until the offers list has loaded, so a late list cannot hide the new offer (issue #247).
  await owner.goto(BASE + '/scholarships'); await owner.waitForSelector('#create:not([disabled])');
  await owner.fill('#offerForm [name=email]', 'family.b@example.test'); await owner.fill('#offerForm [name=wrestlerName]', 'Riley Two');
  await owner.selectOption('#program', 'Intermediate'); await owner.click('#create');
  await owner.waitForFunction(() => document.querySelector('#inviteUrl')?.value, null, {timeout: 8000});
  const invite = await owner.inputValue('#inviteUrl');
  // Acceptance opens only once the owner saves the attorney-reviewed terms.
  await owner.locator('summary:has-text("attorney-reviewed terms")').first().click();
  await owner.locator('[data-finalize] [name=terms]').first().fill('Sample scholarship terms for testing only. '.repeat(8));
  await owner.locator('[data-finalize] [name=reviewed]').first().check(); await owner.locator('[data-finalize] button').first().click();
  await at(owner, '#status', /Final agreement saved/);
  // The form shows with the agreement but stays disabled until the family's wrestlers are in and the signature pad
  // listens. A signature drawn before that was lost, so Sign was refused (issue #247).
  await family2.goto(invite.replace(/^https?:\/\/[^/]+/, BASE)); await family2.waitForSelector('#acceptFields:not([disabled])');
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
  await owner.click('#save'); await at(owner, '#status', /saved|shared|published/i);
  await coach.goto(BASE + '/coach'); await coach.click('text=Your month and practice plans');
  await coach.waitForFunction(() => /Leg attacks and finishes/.test(document.body.textContent), null, {timeout: 10000});
});
// ---------- The coach's month calendar (issue #191) ----------
await step('coach month calendar: practices, camp, today and the shared plan; fits a phone', async () => {
  await coach.goto(BASE + '/practice-plans'); await coach.waitForSelector('#calendar .cal-day.is-today');
  const todayCell = await text(coach, '#calendar .cal-day.is-today');
  expect(/Today/.test(todayCell) && /Plan shared/.test(todayCell), 'today is ringed and shows the shared plan: ' + todayCell);
  expect(!(await coach.locator('#calendar .p-Elementary').count()), 'only the coach’s own programs');
  if (ny(10).slice(0, 7) === today.slice(0, 7)) expect(/Winter camp/.test(await text(coach, '#calendar')), 'the camp is on the calendar');
  await coach.click(`#calendar [data-practice="Intermediate|${today}"]`); await waitText(coach, '#detail', /Leg attacks and finishes/);
  await shot(coach, 'coach-practice-month');
  const phone = await phoneAs('coach'); await phone.goto(BASE + '/practice-plans'); await phone.waitForSelector('#calendar .cal-day.is-today');
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); expect(over <= 1, `/practice-plans scrolls sideways by ${over}px on a phone`);
  expect(await phone.$eval('#calendar .cal-dow', d => getComputedStyle(d).display === 'none'), 'phones get a list of days, not the 7-column grid');
  if (SHOTS) await phone.screenshot({path: `${SHOTS}/phone-coach-practice-month.png`, fullPage: true});
  await phone.close();
});
await step('owner adds a curriculum lesson on /curricula', async () => {
  // Saving does nothing until the library has loaded, which the status line says.
  await owner.goto(BASE + '/curricula'); await owner.waitForSelector('#groupName'); await at(owner, '#curriculumStatus', /This program has/);
  await owner.selectOption('#curriculumProgram', 'Intermediate').catch(() => {});
  await owner.fill('#groupName', 'Foundations'); await owner.click('#saveGroup'); await at(owner, '#curriculumStatus', /Curriculum saved/);
  await owner.fill('#curriculumName', 'Stance and motion'); await owner.fill('#lessonOrder', '1').catch(() => {});
  await owner.fill('#planForm [name=title]', 'Stance and motion');
  if (!(await owner.locator('#sections input, #sections textarea').count())) await owner.click('#resetOrder');
  await owner.click('#saveCurriculum').catch(async () => owner.click('#save')); await at(owner, '#curriculumStatus', /Lesson saved in/);
  const r = await api(owner, '/api/practice-curricula');
  expect(JSON.stringify(r.body).includes('Stance and motion'), 'curriculum lesson not saved: ' + JSON.stringify(r.body).slice(0, 200));
});
await step('payment setup, security log and family accounts load with real records', async () => {
  await owner.goto(BASE + '/payment-setup'); await owner.waitForFunction(() => /test mode/i.test(document.body.textContent), null, {timeout: 8000});
  await owner.goto(BASE + '/security-log'); expect(/offline_payment_recorded|waiver_published|Offline payment/i.test(await owner.content()), 'security log shows recent actions');
  await owner.goto(BASE + '/accounts'); const acc = await owner.content(); expect(/Pat Example/.test(acc) && /Riley Parent/.test(acc), 'accounts list both families');
  const fam = await family.request.get(BASE + '/accounts'); expect(fam.status() !== 200 || !/Riley Parent/.test(await fam.text()), 'a family opened the accounts list');
});
// Issue #188: contact and safety details. The family updates them on their profile; the owner sees them on Family
// accounts, where the program filter narrows the list; coaches see allergies and the emergency contact on the roster.
await step('family updates the address, emergency contact and allergies; the owner sees them on Family accounts', async () => {
  await family.goto(BASE + '/family'); await family.click('#editProfile'); await family.waitForSelector('#homeAddress');
  expect(/needs these details for every family/i.test(await text(family, '#detailsWhy')), 'the form says why the academy needs the details');
  expect(await family.isChecked('#none0') && await family.isDisabled('#allergies0'), '"No allergies or medical notes" was saved');
  await family.fill('#homeState', 'ny');
  await family.fill('#emergencyContactName', 'Jordan Example'); await family.fill('#emergencyContactPhone', '(631) 555-0199');
  await family.uncheck('#none0'); await family.fill('#allergies0', 'Peanut allergy. EpiPen in the blue bag.');
  // A ZIP code that is not 5 digits is stopped in the browser, and the server refuses it too.
  await family.fill('#homeZip', '117'); await family.click('#save'); await family.waitForTimeout(400);
  expect(await family.isVisible('#editor') && await family.$eval('#homeZip', el => !el.validity.valid), 'a short ZIP code is not accepted');
  const bad = await family.evaluate(async () => { const g = await (await fetch('/api/family', {cache: 'no-store'})).json(); const r = await fetch('/api/family', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({revision: g.revision, data: {...g.data, homeZip: '117'}})}); return {status: r.status, body: await r.json()}; });
  expect(bad.status === 400 && /ZIP/.test(bad.body.error), 'the server refuses a bad ZIP code: ' + JSON.stringify(bad));
  await family.fill('#homeZip', '11746'); await family.click('#save');
  await saved(family);
  await waitText(family, '#contactRows', /Jordan Example · \(631\) 555-0199[\s\S]*Huntington Station, NY 11746/);
  expect(/Peanut allergy[\s\S]*Born Apr 18, 2012/.test(await text(family, '#savedDetails')), 'the allergy leads the wrestler card, with the birth date');
  await shot(family, 'family-contact-safety');
  await owner.goto(BASE + '/accounts'); await owner.waitForSelector('#program');
  const pat = owner.locator('#families article', {hasText: 'Pat Example'});
  expect(/Medical note/.test(await pat.textContent()), 'the owner sees a medical-note marker');
  await pat.locator('summary', {hasText: 'Contact and safety details'}).click();
  const details = await pat.locator('.family-details').textContent();
  expect(/20 Railroad St[\s\S]*Huntington Station, NY 11746/.test(details) && /Jordan Example · \(631\) 555-0199/.test(details) && /April 18, 2012 · age \d+/.test(details) && /Peanut allergy/.test(details), 'the owner sees the details: ' + details.slice(0, 200));
  const programs = (await pat.getAttribute('data-programs')).split(' ');
  expect(programs[0] !== 'none', 'Pat\'s wrestler is in a program today');
  // The filter and search run on the server (issue #46): choosing a program reloads the list with it.
  const choose = async value => { await Promise.all([owner.waitForURL(u => new URL(u).searchParams.get('program') === value), owner.selectOption('#program', value)]); await owner.waitForSelector('#count'); };
  await choose('none'); expect(await pat.count() === 0, 'a family in a program is not listed under "No current program"');
  await choose(programs[0]); expect(await pat.isVisible(), 'the family shows under its program');
  expect(/families match/.test(await text(owner, '#count')), 'the count follows the filter');
  await owner.fill('#find', 'Pat Example'); await Promise.all([owner.waitForURL(/q=Pat\+Example/), owner.click('#filters button[type=submit]')]);
  expect(await pat.isVisible() && /1 of \d+ famil/.test(await text(owner, '#count')), 'search and program combine on the server');
  await shot(owner, 'owner-accounts-details');
  await owner.goto(BASE + '/accounts');
  const coachView = await coach.request.get(BASE + '/accounts'); expect(coachView.status() !== 200 || !/Peanut allergy/.test(await coachView.text()), 'a coach opened Family accounts');
  const otherFamily = await family2.request.get(BASE + '/accounts'); expect(otherFamily.status() !== 200 || !/Peanut allergy/.test(await otherFamily.text()), 'another family saw the details');
});
await step('owner downloads an encrypted backup and previews and restores it from the file', async () => {
  await owner.goto(BASE + '/backups'); await owner.waitForSelector('#exportPassword');
  await owner.fill('#exportPassword', 'correct horse battery staple 2026'); await owner.fill('#exportConfirm', 'correct horse battery staple 2026');
  const [dl] = await Promise.all([owner.waitForEvent('download', {timeout: 15000}), owner.click('#download')]);
  const file = await dl.path(); expect(file, 'no backup file');
  // The compressed, streamed format (issue #221): one line naming it, then the encrypted data.
  const first = readFileSync(file).subarray(0, 300).toString('latin1').split('\n')[0];
  expect(/^\{"format":"savage-encrypted-backup-v2"/.test(first) && !readFileSync(file).toString('latin1').includes('Pat Example'), 'backup file format: ' + first.slice(0, 60));
  await owner.setInputFiles('#file', file); await owner.fill('#importPassword', 'correct horse battery staple 2026'); await owner.click('#preview');
  await waitText(owner, '#summary', /payments/, 15000);
  // Wait for the page's own result: the restore uploads in parts and applies them in one step.
  await owner.click('#restore'); await waitText(owner, '#status', /^Backup restored\.|^(?!Uploading)(?!Preview ready).+/, 30000);
  expect(/^Backup restored\./.test(await text(owner, '#status')), 'restore from the file: ' + await text(owner, '#status'));
});

// ---------- Owner dashboard and backups ----------
await step('owner dashboard shows today\'s real numbers', async () => {
  // The dashboard is today (issue #283): the date, the facts, four tiles, tonight's sessions, what needs the owner.
  await owner.goto(BASE + '/'); await waitText(owner, 'main h1', /^[A-Z][a-z]+day, [A-Z][a-z]{2} \d{1,2}$/);
  await waitText(owner, '#todayFacts', /\d sessions? tonight · \d coach(es)? clocked in/);
  await waitText(owner, '#todayTiles', /Checked in today/); await waitText(owner, '#todayTiles', /Cash due at the door/);
  await waitText(owner, '#todayTiles', /Collected in [A-Z][a-z]+/); await waitText(owner, '#todayTiles', /Families/);
  expect(await owner.locator('#todayTiles a.tile').count() === 4, 'four tiles, each a link');
  await waitText(owner, '#tonightBody', /SWA Intermediate/); await at(owner, '#tonightBody', /Open check-in/);
  expect(!/Site errors/.test(await text(owner, '#launch')), 'site health is not on the home while nothing is wrong');
  await waitText(owner, '#monthBody', /Owed to coaches/); await waitText(owner, '#comingBody', /Winter camp/);
  expect(await owner.locator('main .primary, main .button.primary').count() === 1, 'one red button on the dashboard: Open check-in');
  expect(await owner.locator('.os-nav a[href="/cards"] .os-badge').count() === 0 || /^\d+$/.test(await text(owner, '.os-nav a[href="/cards"] .os-badge')), 'the cards badge is a count or nothing');
  // Launch checklist: by now the walkthrough has set programs, schedules, website, waiver, coach and lesson prices.
  await waitText(owner, '#launchCount', /\d+ of \d+ ready|Everything is set up/);
  for (const k of ['programs', 'schedule', 'website', 'waiver', 'coaches', 'lessons', 'address', 'signin'])
    expect(await owner.getAttribute(`[data-launch="${k}"]`, 'data-status') === 'done', `launch checklist: ${k} should be ready`);
  expect(await owner.getAttribute('[data-launch="email"]', 'data-status') === 'waiting', 'launch checklist: email waits on its setup');
  await at(owner, '[data-launch="events"]', /1 camp and 1 clinic coming up/); await at(owner, '[data-launch="live"]', /Switch to live when you’re ready/);
  const h = await owner.request.get(BASE + '/api/health'); expect(h.status() === 200 && (await h.json()).ok === true, 'health check');
  expect(!(await owner.isVisible('.sample-notice')) && !(await owner.isVisible('#previewMenu')), 'the dashboard has no sample notices or previews');
  const bg = await owner.locator('#tonightBody a.button.primary').first().evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg !== 'rgb(255, 255, 255)' && bg !== 'rgba(0, 0, 0, 0)', 'primary button is invisible: ' + bg);
  await shot(owner, 'owner-dashboard');
  await owner.goto(BASE + '/site-health'); await waitText(owner, '#now', /Site and database are answering/);
  // Email is not set up locally: the page says so instead of promising alerts (issues #47, #35).
  await waitText(owner, '#emailOff', /Email isn’t set up yet, so families aren’t getting emails/); expect(await owner.isVisible('#emailOff'), 'email-off notice on site health');
  // Send a test alert (issue #263): with no email locally, the button says so and sends nothing.
  await owner.click('#testAlert'); await waitText(owner, '#testResult', /Email isn’t set up yet, so no test alert was sent/);
  expect(await owner.isEnabled('#testAlert'), 'the test alert button is usable again');
  expect(!sql("SELECT 1 FROM security_events WHERE action='owner_test_alert'").length, 'nothing logged when nothing was sent');
});
// ---------- One owner shell (issue #261): the sidebar and header stay, only the middle changes ----------
// What the shell looks like on a page: one sidebar and header, where they sit, what is marked, and the sidebar's links.
const shellState = page => page.evaluate(() => {
  const side = document.querySelector('.os-side'), top = document.querySelector('.os-top');
  const box = e => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round).join(','); };
  return {sides: document.querySelectorAll('.os-side').length, tops: document.querySelectorAll('.os-top').length, side: box(side), top: box(top),
    current: [...document.querySelectorAll('.os-nav [aria-current="page"]')].map(a => a.getAttribute('href')).join(' '), crumb: document.querySelector('#swa-os-crumb')?.textContent,
    h1: document.querySelector('main h1')?.textContent.trim(), focused: document.activeElement?.tagName, open: document.body.classList.contains('os-open'),
    // The count badges (issue #283) are filled by the page after it loads, so they are left out of the comparison.
    names: getComputedStyle(side).viewTransitionName + ' ' + getComputedStyle(top).viewTransitionName, links: side.querySelector('.os-nav').innerHTML.replace(/ aria-current="page"/g, '').replace(/<span class="os-badge"[^>]*>[^<]*<\/span>/g, ''),
    stayed: window.__swaStayed === true, over: document.documentElement.scrollWidth - innerWidth};
});
await step('owner moves through the owner shell with the sidebar: dashboard, Payments, Income and expenses, a dashboard section', async () => {
  for (const viewport of [{width: 1280, height: 860}, {width: 390, height: 844}]) {
    const page = await as('owner', viewport), phone = viewport.width < 500, tag = phone ? 'phone' : 'desktop';
    // Whether the browser ran a cross-document View Transition into each page.
    await page.addInitScript(() => addEventListener('pagereveal', e => {
      window.__swaTransition = !!e.viewTransition; window.__swaSettled = !e.viewTransition;
      e.viewTransition?.finished.catch(() => {}).finally(() => { window.__swaSettled = true; });
    }));
    await page.goto(BASE + '/'); await waitText(page, 'main h1', /^[A-Z][a-z]+day, [A-Z][a-z]{2} \d{1,2}$/);
    const first = await shellState(page);
    expect(first.sides === 1 && first.tops === 1 && first.current === '/', `${tag}: the dashboard has one shell with Dashboard marked: ` + JSON.stringify(first).slice(0, 200));
    expect(first.names === 'swa-owner-side swa-owner-top', `${tag}: the sidebar and header are named for View Transitions: ${first.names}`);
    // Opens a sidebar item (through the Menu drawer on a phone) and checks that only the middle changed.
    const open = async (href, url, heading, crumb, samePage = false, prefetch = false) => {
      if (phone) {
        await page.click('#swa-os-menu');
        await page.waitForFunction(() => document.body.classList.contains('os-open') && getComputedStyle(document.querySelector('.os-side')).visibility === 'visible');
        expect(await page.getAttribute('#swa-os-menu', 'aria-expanded') === 'true' && await page.getAttribute('#swa-os-side', 'aria-modal') === 'true', `${tag}: the drawer is open as a dialog`);
        expect(await page.evaluate(() => document.querySelector('.os-side').contains(document.activeElement)), `${tag}: focus moved into the drawer`);
      }
      if (samePage) await page.evaluate(() => { window.__swaStayed = true; });
      // Hovering an owner link prefetches its page (Speculation Rules), and the click then uses it.
      if (prefetch) await Promise.all([page.waitForRequest(r => r.url() === BASE + href && r.headers()['sec-purpose'] === 'prefetch', {timeout: 5000}), page.hover(`.os-nav a[href="${href}"]`)]);
      await page.click(`.os-nav a[href="${href}"]`);
      await page.waitForURL(url); await waitText(page, 'main h1', heading);
      await page.waitForFunction(h => document.querySelector('.os-nav [aria-current="page"]')?.getAttribute('href') === h, href);
      const s = await shellState(page);
      expect(s.sides === 1 && s.tops === 1, `${tag} ${href}: one sidebar and one header`);
      expect(s.current === href, `${tag} ${href}: the current item is ${s.current}`);
      expect(s.crumb === crumb, `${tag} ${href}: the breadcrumb says ${s.crumb}`);
      expect(s.links === first.links, `${tag} ${href}: the same sidebar`);
      expect(s.top === first.top && (phone || s.side === first.side), `${tag} ${href}: the header${phone ? '' : ' and sidebar'} stayed where they were (${s.top} / ${first.top})`);
      await page.waitForFunction(() => document.activeElement?.matches('main h1'), null, {timeout: 5000}).catch(() => {});
      expect((await shellState(page)).focused === 'H1', `${tag} ${href}: focus moved to the page heading`);
      expect(!s.open, `${tag} ${href}: the drawer closed`);
      expect(s.over <= 1, `${tag} ${href}: scrolls sideways by ${s.over}px`);
      if (samePage) expect(s.stayed, `${tag} ${href}: the dashboard section opened without loading the page again`);
      // Browsers skip the cross-fade on purpose when the next page is slow or the prefetch isn't ready (a busy CI
      // runner), and the page still opens in the same shell, so these two are noted, not failed (issue #265).
      else if (!(await page.evaluate(() => window.__swaTransition))) console.log(`    note: ${tag} ${href} opened without a View Transition (the browser skipped it)`);
      if (prefetch && (await page.evaluate(() => performance.getEntriesByType('navigation')[0].deliveryType)) !== 'navigational-prefetch') console.log(`    note: ${tag} ${href} wasn't served from the hover prefetch`);
      // Screenshots wait for the cross-fade and the drawer's slide to finish.
      await page.waitForFunction(() => window.__swaSettled !== false && getComputedStyle(document.querySelector('.os-side')).visibility === (innerWidth > 900 ? 'visible' : 'hidden'));
      await shot(page, `shell-${tag}-${href.replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '') || 'dashboard'}`);
    };
    await open('/payments', /\/payments$/, /^Payments$/, 'Today / Payments');
    await open('/financials', /\/financials$/, /^Income and expenses$/, 'Academy / Money', false, !phone);
    // Money's switch (issue #283): Coach pay is a sister page under the same sidebar item.
    expect(await page.locator('.os-tabs a[href="/coach-pay"]').count() === 1 && await page.getAttribute('.os-tabs a[href="/financials"]', 'aria-current') === 'page', `${tag}: the money switch marks Income & expenses`);
    await open('/#programs', /\/#programs$/, /PROGRAMS & PRICING/, 'Academy / Programs, schedules & events');
    // Camps & events has no sidebar item of its own: the section's switch opens it, and the sidebar keeps marking its parent.
    await page.click('.os-tabs a[href="/#events"]'); await page.waitForURL(/\/#events$/); await waitText(page, 'main h1', /CAMPS & CLINICS/);
    await page.waitForFunction(() => document.querySelector('.os-nav [aria-current="page"]')?.getAttribute('href') === '/#programs');
    expect((await shellState(page)).crumb === 'Academy / Programs, schedules & events', `${tag}: /#events keeps its parent in the breadcrumb`);
    expect(await page.getAttribute('.os-tabs a[href="/#events"]', 'aria-current') === 'page', `${tag}: the section switch marks Camps & events`);
    await open('/#practice-calendar', /\/#practice-calendar/, /PLAN FROM YOUR CALENDAR/, 'Academy / Calendar & plans', true);
    // The calendar (issue #283): a month grid of bars on a desktop, the week list on a phone; a day opens its panel.
    if (phone) { expect(await page.locator('.week .wk-day').count() === 7, 'phones open on the week list'); await page.click('.view-switch button:has-text("Month")'); }
    await page.waitForSelector('.cal .day:not(.blank)');
    await page.locator('.cal .day[aria-label*="SWA Intermediate"]').first().click(); await page.waitForSelector('.day-panel');
    // The page moves focus as it draws the panel (issue #292); the wait only covers the browser reporting it.
    await page.waitForFunction(() => document.activeElement?.matches('.day-panel h2'), null, {timeout: 5000}).catch(() => {});
    expect(await page.evaluate(() => document.activeElement?.matches('.day-panel h2')), `${tag}: focus moves to the day panel`);
    await at(page, '.day-panel', /SWA Intermediate[\s\S]*(Add plan|View plan)/);
    // Escape closes the panel; the close button does too.
    await page.keyboard.press('Escape'); await page.waitForSelector('.day-panel', {state: 'detached'});
    await page.locator('.cal .day[aria-label*="SWA Intermediate"]').first().click(); await page.click('.day-panel .close'); await page.waitForSelector('.day-panel', {state: 'detached'});
    await open('/', /\/$/, /^[A-Z][a-z]+day, [A-Z][a-z]{2} \d{1,2}$/, 'Dashboard', true);
    if (phone) {
      // Escape closes the drawer and puts focus back on Menu.
      await page.click('#swa-os-menu'); await page.waitForFunction(() => document.body.classList.contains('os-open'));
      await page.keyboard.press('Escape');
      expect(!(await page.evaluate(() => document.body.classList.contains('os-open'))) && await page.evaluate(() => document.activeElement?.id) === 'swa-os-menu', 'Escape closes the drawer');
    }
    await page.context().close();
  }
  // Coaches keep their own pages: no owner shell on the roster they share with the owner.
  await coach.goto(BASE + '/roster'); await coach.waitForSelector('main h1');
  expect(!(await coach.$('.os-side')) && !!(await coach.$('.swa-bar')), 'a coach sees the roster without the owner shell');
});
// Signed documents: Sam's waiver and Parent Consent Form, and the coach's contract (issue #195).
await step('backup export includes payments and signed waivers', async () => {
  const r = await api(owner, '/api/backups');
  const b = r.body?.backup;
  expect(r.status === 200 && b?.version === 3 && b.records.orders.length >= 3 && b.records.waiver_signatures.length === 3 && b.records.wrestler_passes.length >= 1, 'backup export ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  // Restoring the same backup is accepted (real data passes validation) and changes nothing.
  const fp = (await api(owner, '/api/backups?mode=preview')).body.fingerprint;
  const back = await api(owner, '/api/backups', {action: 'restore', fingerprint: fp, backup: b});
  expect(back.status === 200 && Object.values(back.body.restored).every(n => n === 0), 'restore round trip ' + JSON.stringify(back.body).slice(0, 300));
});

// ---------- Family data requests ----------
await step('family downloads their data and asks to close the account; owner records how it was handled', async () => {
  // The download and the close-account request live in the Account menu (issue #282).
  await family.goto(BASE + '/family'); await family.waitForSelector('#summary:not([hidden])'); await family.click('#accountMenu summary');
  expect(await family.$eval('#accountMenu', d => d.open), 'the Account menu opens');
  const dlLink = family.locator('#accountMenu a[download]'); await dlLink.waitFor({state: 'visible'});
  expect(/Download my family's data/.test(await dlLink.textContent()), 'the menu offers the data download');
  const [dl] = await Promise.all([family.waitForEvent('download'), dlLink.evaluate(a => a.click())]);
  const why = await dl.failure(); expect(!why, 'download failed: ' + why + ' ' + dl.url());
  const data = JSON.parse((await import('node:fs')).readFileSync(await dl.path(), 'utf8'));
  expect(data.profile.parentName === 'Pat Example' && data.payments.length >= 3 && !JSON.stringify(data).includes('Riley'), 'export contents');
  if (!await family.$eval('#accountMenu', d => d.open)) await family.click('#accountMenu summary');
  await family.click('#accountMenu button:has-text("Ask to close my account")'); await family.waitForSelector('#yourData:not([hidden])'); await family.fill('#closeNote', 'Moving away');
  await family.click('#closeForm button'); await waitText(family, '#requestStatus', /The academy will contact you/);
  await owner.goto(BASE + '/'); await waitText(owner, '#needsNow', /1 data request/);
  await owner.goto(BASE + '/data-requests'); await waitText(owner, '#list', /Pat Example[\s\S]*Moving away/);
  await owner.fill('#list textarea', 'Kept payment records; family is staying after all.'); await owner.click('#list form button');
  await waitText(owner, '#list', /Handled/);
});

// ---------- Delete a test family account (issue #259, the last step of docs/LAUNCH_TEST_PASS.md) ----------
await step('owner deletes a test family account; a family with a lesson still to come is refused', async () => {
  const fresh = await as('newfam');
  await fresh.goto(BASE + '/family');
  const saved = await fresh.evaluate(async () => { const g = await (await fetch('/api/family', {cache: 'no-store'})).json(); const r = await fetch('/api/family', {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({revision: g.revision, data: {parentName: 'Taylor Testfamily', phone: '555-0142', homeAddress: '1 Test Lane', homeCity: 'Huntington', homeState: 'NY', homeZip: '11746', emergencyContactName: 'Casey Test', emergencyContactPhone: '631-555-0142', wrestlers: [{id: 'w-test', name: 'Toby Testfamily', grade: '5', birthDate: '2015-05-05', allergies: 'None'}]}})}); return r.status; });
  expect(saved === 200, 'the test family saves a profile: ' + saved);
  const remove = async (name, typed) => {
    await owner.goto(BASE + '/accounts?q=' + encodeURIComponent(name));
    const card = owner.locator('#families article', {hasText: name});
    await card.locator('summary', {hasText: 'Delete this family account'}).click();
    const button = card.locator('button.danger');
    await card.locator('input[name=confirm]').fill(name.split(' ')[0]); expect(await button.isDisabled(), 'the button waits for the whole name');
    await card.locator('input[name=confirm]').fill(typed); await card.locator('input[name=test]').check();
    await button.click(); return card;
  };
  // Riley has paid lessons still to come, so nothing is deleted and the page says why.
  let card = await remove('Riley Parent', 'riley parent');
  await at(owner, '#families article .delete-status', /still has a paid session that hasn't happened yet/);
  expect(await card.locator('button.danger').isEnabled(), 'the owner can try again after fixing it');
  card = await remove('Taylor Testfamily', 'Taylor Testfamily');
  await at(owner, '#families article', /Family account deleted[\s\S]*records deleted[\s\S]*delete it there too/);
  await shot(owner, 'owner-family-deleted');
  await owner.goto(BASE + '/accounts'); const list = await owner.content();
  expect(!list.includes('Taylor Testfamily') && list.includes('Riley Parent'), 'the test family is gone and Riley stays');
  await owner.goto(BASE + '/security-log'); await at(owner, 'main', /Family account deleted[\s\S]*A test account · \d+ records? deleted/);
  expect(!(await owner.content()).includes('Taylor Testfamily'), 'Security activity names no one');
  // Signing in again with the same login starts an empty family account.
  await fresh.goto(BASE + '/family'); await fresh.waitForSelector('#start:not([hidden])');
  await fresh.context().close();
});

// ---------- Guides ----------
await step('each role has a guide linked from its home page; guides are role-only', async () => {
  await family.goto(BASE + '/family'); await family.click('#accountMenu summary'); await family.click('#accountMenu a:has-text("Help")'); await waitText(family, 'h1', /Help for families/);
  await coach.goto(BASE + '/coach'); await coach.click('text=Coach help'); await waitText(coach, 'h1', /Help for coaches/);
  await owner.goto(BASE + '/'); await owner.click('.os-fold summary'); await owner.click('.os-nav a[href="/help/owner"]'); await waitText(owner, 'h1', /Owner guide/);
  const fc = await family.request.get(BASE + '/help/coach', {maxRedirects: 0}); expect(fc.status() !== 200, 'family opened the coach guide');
  const fo = await family.request.get(BASE + '/help/owner', {maxRedirects: 0}); expect(fo.status() !== 200, 'family opened the owner guide');
});

// ---------- Isolation and phone layout ----------
await step('one family cannot see another family\'s data', async () => {
  const r = await api(family2, '/api/wrestler?id=' + samId); expect(r.status === 404, 'wrestler view of another family');
  const o = await api(family2, '/api/orders'); expect(!JSON.stringify(o.body).includes('Pat Example'), 'orders leak');
  const c = await api(family2, '/api/usaw-cards'); expect(c.status === 403, 'family reached owner cards');
});
await step('family pages fit a phone screen', async () => {
  const phone = await (async () => { const p = await (await browser.newContext({viewport: {width: 390, height: 844}, deviceScaleFactor: SHOTS ? 3 : 1, isMobile: true, hasTouch: true})); const c = (await import('./fake-supabase.mjs')).sessionCookie('family', AUTH); await p.addCookies([{name: c.name, value: c.value, url: BASE}]); return p.newPage(); })();
  for (const path of ['/welcome', '/help', '/calendar', '/family', '/register', '/lesson', '/waiver', '/consent', '/pass', '/wrestler?id=' + samId, '/inbox', '/booking?type=event&id=winter-camp', '/booking?type=event&id=spring-clinic']) {
    await phone.goto(BASE + path); await phone.waitForTimeout(700);
    // Against the 390px screen, not innerWidth: a phone widens innerWidth to fit content that pokes out (issue #222).
    const over = await phone.evaluate(() => document.documentElement.scrollWidth - 390);
    expect(over <= 1, `${path} scrolls sideways by ${over}px on a phone`);
    // Buttons and links must not break a word across lines (for example "Messa ges").
    const broken = await phone.evaluate(() => [...document.querySelectorAll('a,button')].filter(el => el.offsetParent && el.children.length === 0 && /^\S+$/.test(el.textContent.trim()) && el.textContent.trim().length > 3 && el.getClientRects().length && el.scrollHeight > parseFloat(getComputedStyle(el).lineHeight || '20') * 1.9 + parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom)).map(el => el.textContent.trim()));
    expect(!broken.length, `${path}: words broken across lines: ${broken.join(', ')}`);
    if (SHOTS) await phone.screenshot({path: `${SHOTS}/phone-${path.replace(/[^a-z]/g, '') || 'home'}.png`, fullPage: true});
  }
  // The profile editor with the card season choice, and the "different date" box open (issue #131).
  await phone.goto(BASE + '/family'); await phone.click('#editProfile'); await phone.waitForSelector('#usawSeason0');
  await phone.selectOption('#usawSeason0', 'other');
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over <= 1, `/family editor scrolls sideways by ${over}px on a phone`);
  if (SHOTS) { await phone.locator('#editor').scrollIntoViewIfNeeded(); await phone.screenshot({path: `${SHOTS}/phone-family-editor.png`, fullPage: true}); }
});

// ---------- The books (issue #194): payments appear on their own; the owner adds an expense ----------
await step('owner sees payments in the books and adds an expense', async () => {
  expect((await api(family, '/api/financials')).status === 403, 'families cannot read the books');
  await owner.goto(BASE + '/financials'); await waitText(owner, '#lines', /Offline payment/);
  const before = await api(owner, '/api/financials');
  expect(before.status === 200 && before.body.totals.incomeCents > 0, 'offline payments recorded earlier are income: ' + JSON.stringify(before.body?.totals));
  expect(before.body.lines.filter(l => l.source !== 'owner').every(l => /^(payment|installment|refund):/.test(l.id)), 'automatic lines come from payments');
  // The form is in a sheet (issue #283): Add an expense in the title row opens it, and it closes once the entry is in.
  await openEntry(owner);
  await owner.check('input[name=kind][value=expense]'); await owner.fill('#amount', '1,250.00'); await owner.fill('#category', 'Rent'); await owner.fill('#note', 'Mat room rent');
  await owner.click('#saveEntry');
  // An entry the form refuses says why in #formError and never reaches #status: fail on the reason, not on a wait.
  await owner.waitForFunction(() => /Entry added/.test(document.querySelector('#status')?.textContent || '') || document.querySelector('#formError')?.textContent, null, {timeout: 20000}).catch(() => {});
  const refused = (await text(owner, '#formError')).trim(); expect(!refused, 'the entry was refused: ' + refused);
  await waitText(owner, '#status', /Entry added/); await waitText(owner, '#lines', /Mat room rent/);
  await owner.waitForSelector('#entrySection', {state: 'hidden'});
  // Editing opens the sheet on the entry; Cancel closes it.
  await owner.click('#lines [data-edit]'); await owner.waitForSelector('#entrySection:not([hidden])'); await waitText(owner, '#formHeading', /Edit entry/);
  await owner.click('#stopEditing'); await owner.waitForSelector('#entrySection', {state: 'hidden'});
  const after = await api(owner, '/api/financials');
  expect(after.body.totals.expensesCents === before.body.totals.expensesCents + 125000, 'the expense is counted once in cents: ' + JSON.stringify(after.body.totals));
  expect(after.body.totals.incomeCents === before.body.totals.incomeCents, 'income unchanged');
  const csv = await owner.request.get(BASE + '/api/financials?format=csv');
  expect(csv.status() === 200 && /Mat room rent/.test(await csv.text()), 'the download has the expense');
  await shot(owner, 'financials');
  const phone = await as('owner', {width: 390, height: 844});
  await phone.goto(BASE + '/financials'); await waitText(phone, '#lines', /Mat room rent/);
  // Against the 390px screen, not innerWidth, which a phone widens to fit content that pokes out (issues #222, #232).
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - 390);
  expect(over <= 1, `/financials scrolls sideways by ${over}px on a phone`);
  await shot(phone, 'phone-financials'); await phone.context().close();
});

// ---------- Accessibility (axe-core) on every page, as each role ----------
const axeSource = (await import('node:fs')).readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const a11yPages = {
  public: ['/welcome', '/team', '/calendar', '/login', '/membership-terms', '/help', '/coach-join'],
  family: ['/family', '/register', '/booking?type=event&id=winter-camp', '/lesson', '/waiver', '/consent', '/pass', '/wrestler?id=' + samId, '/inbox', '/security'],
  coach: ['/coach', '/roster', '/help/coach', '/coach-profile', '/contract', '/coach-time'],
  owner: ['/', '/roster', '/payments', '/cards', '/waivers', '/consent-forms', '/contracts', '/lesson-settings', '/coach-pay', '/timesheets', '/transfers', '/messages', '/staff', '/coach-openings?email=coach.dana%40example.test', '/approvals', '/scholarships', '/accounts', '/payment-setup', '/backups', '/security-log', '/site-health', '/data-requests', '/financials', '/help/owner', `/practice-plans?program=Intermediate&date=${today}`, '/curricula', '/website'],
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

// ---------- Screenshots of the owner's screens (only with a screenshot folder): a desktop and a 2x phone of each ----------
if (SHOTS) await step('owner screens at 1280 and 390 for the design record', async () => {
  const screens = {dashboard: '/', calendar: '/#practice-calendar', programs: '/#programs', schedules: '/#schedules', events: '/#events', payments: '/payments', financials: '/financials',
    messages: '/messages', staff: '/staff', timesheets: `/timesheets?month=${today.slice(0, 7)}`, 'coach-pay': '/coach-pay', cards: '/cards', accounts: '/accounts', waivers: '/waivers', 'consent-forms': '/consent-forms', contracts: '/contracts'};
  for (const [tag, viewport] of [['1280', {width: 1280, height: 860}], ['390', {width: 390, height: 844}]]) {
    const page = await as('owner', viewport);
    for (const [name, path] of Object.entries(screens)) {
      await page.goto(BASE + path, {waitUntil: 'load'}); await page.waitForTimeout(path === '/' ? 1500 : 700);
      if (path === '/') { await page.waitForSelector('#tonightBody a.button.primary'); await page.waitForTimeout(400); }
      await page.screenshot({path: `${SHOTS}/owner-${name}-${tag}.png`, fullPage: true});
    }
    // The dashboard's calendar day panel, and Payments with its record panel open.
    await page.goto(BASE + '/#practice-calendar', {waitUntil: 'load'}); await page.waitForTimeout(700);
    if (viewport.width < 500) await page.click('.view-switch button:has-text("Month")');
    await page.locator('.cal .day[aria-label*="SWA"]').first().click(); await page.waitForSelector('.day-panel'); await page.waitForTimeout(300);
    await page.screenshot({path: `${SHOTS}/owner-calendar-day-panel-${tag}.png`, fullPage: viewport.width >= 500});
    await page.goto(BASE + '/payments#record', {waitUntil: 'load'}); await page.waitForSelector('#recordSheet:not([hidden])'); await page.waitForTimeout(500);
    await page.screenshot({path: `${SHOTS}/owner-payments-record-${tag}.png`, fullPage: false});
    await page.context().close();
  }
});

await browser.close(); auth.close(); usaw.close();
console.log(`\n${passed.length} steps passed, ${problems.length} problem(s).`);
for (const p of problems) console.log(' - ' + p);
process.exit(problems.length ? 1 : 0);
