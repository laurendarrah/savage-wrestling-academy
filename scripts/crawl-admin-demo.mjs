// Clicks every control in the admin demo, in every view and screen, and reports any page error (issue #31).
// Each control is clicked from a fresh page. When a dialog opens, the crawler fills it the way a person would
// (first real option in each list, every checkbox ticked, text boxes filled) and presses each of its buttons in turn.
//
// Usage: node scripts/crawl-admin-demo.mjs [base-url]     (default http://127.0.0.1:8787)
// Needs Playwright and Chromium. Exit code 1 when any error is found.
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
let playwright;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { playwright = require(p); break; } catch {} }
if (!playwright) { console.error('Playwright is not installed.'); process.exit(2); }

const base = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const views = {admin: ['Dashboard', 'Families', 'Attendance', 'Calendar', 'Schedules', 'Events & waitlists', 'Private lessons', 'Messages', 'Programs & pricing', 'Staff & settings'],
  family: ['Overview', 'Programs', 'Calendar', 'Camps & clinics', 'Private lessons', 'My family', 'Messages'], child: ['My QR code', 'My messages'], public: ['Calendar', 'Cancellation policy']};
const browser = await playwright.chromium.launch();
const page = await browser.newPage({viewport: {width: 1280, height: 900}});
page.on('dialog', d => d.accept().catch(() => {}));
let errors = [];
page.on('pageerror', e => errors.push(e.message));
const found = new Map();
let clicks = 0;

async function open(view, screen) {
  await page.goto(base + '/admin-demo', {waitUntil: 'load'});
  await page.evaluate(([v, s]) => { setMode(v); go(s); }, [view, screen]);
  await page.waitForTimeout(30);
}
// Controls inside the screen (not the menu), identified by position so they can be found again after a reload.
const controls = (scope) => page.evaluate(scope => {
  const root = scope === 'modal' ? document.querySelector('#overlay .modal') : document.querySelector('#main');
  if (!root) return [];
  return [...root.querySelectorAll('button,[onclick],a[href^="#"],summary')].filter(el => el.offsetParent !== null && !el.disabled && !el.classList.contains('close'))
    .map((el, i) => ({i, label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40)}));
}, scope);
const clickAt = (scope, i) => page.evaluate(([scope, i]) => {
  const root = scope === 'modal' ? document.querySelector('#overlay .modal') : document.querySelector('#main');
  const el = [...root.querySelectorAll('button,[onclick],a[href^="#"],summary')].filter(el => el.offsetParent !== null && !el.disabled && !el.classList.contains('close'))[i];
  el?.click(); return !!el;
}, [scope, i]);
async function fillModal() {
  await page.evaluate(() => {
    const m = document.querySelector('#overlay .modal'); if (!m) return;
    for (const s of m.querySelectorAll('select')) { const o = [...s.options].find(o => o.value !== '' && !o.disabled); if (o) { s.value = o.value; s.dispatchEvent(new Event('change', {bubbles: true})); s.dispatchEvent(new Event('input', {bubbles: true})); } }
    for (const c of m.querySelectorAll('input[type=checkbox]')) { c.checked = true; c.dispatchEvent(new Event('change', {bubbles: true})); }
    for (const t of m.querySelectorAll('input:not([type]),input[type=text],input[type=email],input[type=tel],textarea')) if (!t.value) { t.value = t.type === 'email' ? 'crawler@example.test' : t.type === 'tel' ? '5550100' : 'Crawler test'; t.dispatchEvent(new Event('input', {bubbles: true})); }
    for (const n of m.querySelectorAll('input[type=number]')) if (!n.value) { n.value = n.min || '1'; n.dispatchEvent(new Event('input', {bubbles: true})); }
    for (const d of m.querySelectorAll('input[type=date]')) if (!d.value) { d.value = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10); d.dispatchEvent(new Event('change', {bubbles: true})); }
  });
}
const record = (where) => { for (const e of errors) { const k = e.split('\n')[0]; if (!found.has(k)) found.set(k, where); } errors = []; };

for (const [view, screens] of Object.entries(views)) {
  for (const screen of screens) {
    await open(view, screen); record(`${view} › ${screen}`);
    const list = await controls('main');
    for (const c of list) {
      await open(view, screen);
      if (!(await clickAt('main', c.i))) continue;
      clicks++; await page.waitForTimeout(40); record(`${view} › ${screen} › ${c.label}`);
      const inModal = await controls('modal');
      for (const m of inModal) {
        await open(view, screen); await clickAt('main', c.i); await page.waitForTimeout(40);
        await fillModal();
        if (!(await clickAt('modal', m.i))) continue;
        clicks++; await page.waitForTimeout(60); record(`${view} › ${screen} › ${c.label} › ${m.label}`);
        // One step deeper: a dialog that opens another (for example review, then confirm).
        await fillModal();
        for (const n of (await controls('modal')).slice(0, 4)) { if (await clickAt('modal', n.i)) { clicks++; await page.waitForTimeout(40); record(`${view} › ${screen} › ${c.label} › ${m.label} › ${n.label}`); break; } }
      }
    }
  }
}
await browser.close();
console.log(`Clicked ${clicks} controls across ${Object.values(views).flat().length} screens.`);
if (found.size) { console.log(`${found.size} distinct error(s):`); for (const [e, where] of found) console.log(`- ${e}\n    at ${where}`); process.exit(1); }
console.log('No page errors.');
