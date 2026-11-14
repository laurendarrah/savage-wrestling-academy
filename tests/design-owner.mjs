// Issue #341: the design pass on the owner screens. Page scripts are inline JavaScript, which the typecheck skips, so
// the functions changed in the pass run here in a small fake DOM: the dashboard's dates, empty states and the program
// card's save note; Backups, Program transfers, Data requests, Scholarships, the public website editor and Online
// payment setup saying what a button did next to it. The rest checks what every owner page now shares: one left edge
// inside the owner shell, the design system's tokens instead of copied fonts and colors, and empty tables as one
// sentence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {portalCode} from './fixtures/portal-script.mjs';

const read = f => readFileSync(f, 'utf8');
// A page's own stylesheet, without its comments (they name issues as #341).
const styleOf = html => (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1].replace(/\/\*[\s\S]*?\*\//g, '');
const scriptOf = html => html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
const tick = () => new Promise(r => setImmediate(r));
// A page's elements by id: whatever the script asks for exists, as in the other page tests.
function dom(preset = {}) {
  const nodes = new Map();
  const el = id => { if (!nodes.has(id)) nodes.set(id, {id, hidden: false, disabled: false, value: '', textContent: '', innerHTML: '', className: '', dataset: {}, files: [], focus() {}, select() {}, scrollIntoView() {}, replaceChildren() {}, append() {}, setAttribute() {}, removeAttribute() {}, ...(preset[id] || {})}); return nodes.get(id); };
  return el;
}

// ---------- The owner shell: one layout for every owner page ----------
const shell = read('public/owner-shell.css');
assert.match(shell, /html body\[data-swa-shell\] \.os-work>main\{margin-left:0;margin-right:auto;padding-top:24px;padding-left:16px;padding-right:16px\}/, 'every owner page starts at the same left edge');
assert.match(shell, /@media \(min-width:901px\)\{html body\[data-swa-shell\] \.os-work>main\{padding-top:32px;padding-left:32px;padding-right:32px\}\}/);
assert.match(shell, /html body\[data-swa-shell\] \.swa-table:has\(tbody>tr:only-child>td\[colspan\]\) thead\{display:none\}/, 'an empty table shows no column headings');

// ---------- Every owner page is on the design system: no font, color or button of its own ----------
const pages = ['app/portal.html', 'app/payment-setup/screen.html', 'app/backups/screen.html', 'app/site-health/screen.html', 'app/data-requests/screen.html', 'app/transfers/screen.html',
  'app/scholarships/screen.html', 'app/waivers/screen.html', 'app/approvals/screen.html', 'app/cards/screen.html', 'app/website/screen.html', 'app/accounts/route.ts', 'app/security-log/route.ts', 'app/account-setup/route.ts'];
for (const f of pages) {
  const css = styleOf(read(f));
  assert.ok(css.length > 200, f + ': has a stylesheet');
  assert.doesNotMatch(css, /\bArial\b|font:\s*\d+px|(^|[};])\s*(body|a|button)\{[^}]*(color|background):#/, f + ': no base font, link color or button color of its own');
  // The only raw colors left are white on a dark or red fill, the two plan dots, the switch's track and the field edge.
  const raw = [...new Set((css.match(/#[0-9A-Fa-f]{3,8}\b/g) || []).map(c => c.toUpperCase()))].filter(c => !['#FFFFFF', '#FFF', '#2E9E57', '#C98A00', '#E9EBEF', '#CDD0D6', '#FF7B82', '#FAFAFB', '#999'].includes(c));
  assert.deepEqual(raw, [], f + ': colors come from the tokens');
  assert.match(css, /var\(--swa-s-\d+\)/, f + ': spacing from the scale');
  assert.doesNotMatch(css, /font-size:\d+px(?<!font-size:12px)/, f + ': type from the scale (12px only for calendar cards and day names)');
}
// The pages that had their own look keep every id their scripts and the walkthrough use.
for (const [f, ids] of [['app/payment-setup/screen.html', ['setupTitle', 'modePill', 'accountLine', 'status', 'keyForm', 'testKey', 'save', 'keyNote', 'confirmBox', 'confirmText', 'confirmYes', 'confirmNo', 'checkSection', 'checkKey', 'checkNote', 'checkList', 'changeSection', 'changeAccount', 'resetBox', 'resetText', 'resetYes', 'resetNo', 'liveSection', 'liveForm', 'liveKey', 'saveLive', 'liveNote', 'catalogNote', 'nextNotice']],
  ['app/backups/screen.html', ['exportPassword', 'exportConfirm', 'download', 'file', 'importPassword', 'preview', 'summary', 'restore', 'snapshots', 'downloadSnapshot', 'status']],
  ['app/site-health/screen.html', ['status', 'now', 'signin', 'reminders', 'build', 'emailOff', 'alerts', 'emailFails', 'testAlert', 'testResult', 'noErrors', 'errorList', 'rows']],
  ['app/transfers/screen.html', ['status', 'form', 'q', 'order', 'to', 'date', 'reason', 'history']],
  ['app/scholarships/screen.html', ['status', 'offerForm', 'program', 'reference', 'create', 'invitation', 'inviteUrl', 'copy', 'awards']]])
  for (const id of ids) assert.ok(read(f).includes(`id="${id}"`), `${f}: keeps #${id}`);

// ---------- Online payment setup ----------
{
  const html = read('app/payment-setup/screen.html');
  assert.match(html, /<title>Online payment setup \| Savage Wrestling Academy<\/title>/, 'named like its place in the menu');
  assert.match(html, /<section class="state" aria-label="Connection"><p><span class="pill neutral" id="modePill">Test mode only · No live charges<\/span><\/p><p id="accountLine">/, 'the connection opens the page: mode, account, what to do next');
  assert.match(html, /<button id="save" class="primary">Verify test key<\/button><\/form><p id="keyNote" class="formnote"/, 'one red button, its note right under it');
  assert.match(html, /<button type="button" class="danger" id="resetYes">Yes, disconnect it<\/button>/);
  // Live mode turns the pill amber; test mode keeps it quiet.
  for (const [mode, cls, words] of [['test', 'pill neutral', 'Test mode only · No live charges'], ['live', 'pill warn', 'Live mode · Real charges']]) {
    const el = dom();
    vm.runInNewContext(scriptOf(html), {document: {getElementById: el}, JSON, Error, String, setTimeout, fetch: async () => ({ok: true, status: 200, json: async () => ({mode, configured: true, liveConfigured: false, account: {id: 'acct_x', name: 'Savage'}, webhookConfigured: true})})});
    await tick(); await tick();
    assert.equal(el('modePill').className, cls, mode); assert.equal(el('modePill').textContent, words);
  }
}

// ---------- Backups: what a button did shows right under that button ----------
{
  const html = read('app/backups/screen.html'), script = html.slice(html.indexOf('<script type="module">') + 22, html.lastIndexOf('</script>')).replace(/^import [^\n]*\n/, '');
  for (const id of ['exportNote', 'restoreNote', 'snapshotNote']) assert.match(html, new RegExp(`<p id="${id}" class="formnote"></p>`), id);
  assert.match(html, /A snapshot is encrypted with the passphrase entered under Create an encrypted backup\./, 'the snapshot button says which passphrase it uses');
  const el = dom({snapshots: {value: '', replaceChildren() {}, append() {}}});
  const ctx = vm.createContext({document: {getElementById: el, createElement: () => ({click() {}})}, JSON, Error, Date, Object, URL: {createObjectURL: () => 'blob:x', revokeObjectURL() {}}, setTimeout() {}, confirm: () => true, encodeURIComponent,
    openBackup: async () => { throw Error('That passphrase does not open this file.'); }, restoreLines: async () => ({}), encryptLines: async () => ({blob: {}, end: {}}), readLines: x => x, linesOf: x => x,
    fetch: async () => ({ok: true, body: [], json: async () => ({snapshots: [], fingerprint: 'f'})})});
  vm.runInContext(script, ctx);
  await tick();
  // No passphrase: the refusal is under the button that was pressed, and nowhere else.
  await el('download').onclick(); await tick();
  assert.equal(el('exportNote').textContent, 'Choose a backup passphrase with at least 12 characters.'); assert.equal(el('snapshotNote').textContent, ''); assert.equal(el('status').textContent, el('exportNote').textContent, 'the status line agrees, for screen readers');
  el('downloadSnapshot').onclick();
  assert.equal(el('snapshotNote').textContent, 'Choose a snapshot first.'); assert.equal(el('exportNote').textContent, '', 'the earlier note clears');
  el('exportPassword').value = el('exportConfirm').value = 'a long passphrase';
  await el('download').onclick(); await tick();
  assert.match(el('exportNote').textContent, /^Encrypted backup download started\./); assert.equal(el('exportPassword').value, '');
  el('file').files = [{}]; await el('preview').onclick(); await tick();
  assert.equal(el('restoreNote').textContent, 'That passphrase does not open this file.'); assert.equal(el('restore').hidden, true);
}

// ---------- Program transfers: the result under the Transfer button, and no empty table ----------
{
  const html = read('app/transfers/screen.html');
  assert.match(html, /<button class="primary">Transfer<\/button><p id="formNote" class="formnote" role="status" aria-live="polite"><\/p><\/form>/);
  const run = async data => {
    const el = dom({date: {value: '2026-12-01'}, to: {value: 'Advanced'}});
    const ctx = vm.createContext({document: {getElementById: el}, JSON, Error, Date, String, confirm: () => true, fetch: async (url, init) => ({ok: true, json: async () => init && init.method === 'POST' ? {...data, history: [{wrestler: 'Sam <b>', from_program: 'Intermediate', to_program: 'Advanced', effective_date: '2026-12-01', reason: 'Moved up'}]} : data})});
    vm.runInContext(scriptOf(html), ctx); await tick(); await tick();
    return el;
  };
  let el = await run({memberships: [], history: []});
  assert.equal(el('historyTable').hidden, true); assert.equal(el('noHistory').hidden, false, 'no transfers: one sentence instead of an empty table');
  assert.equal(el('history').innerHTML, ''); assert.equal(el('status').textContent, '');
  el = await run({memberships: [{orderId: 'o1', wrestler: 'Sam Example', parent: 'Pat', email: 'p@example.test', grade: '9', programToday: 'Intermediate', program: 'Intermediate', termEnd: '2026-12-31'}], history: []});
  el('order').value = 'o1'; el('date').value = '2026-12-01'; await el('form').onsubmit({preventDefault() {}}); await tick();
  assert.equal(el('formNote').textContent, 'Sam Example moves to SWA Advance from Dec 1, 2026.', 'the result shows under the button');
  assert.equal(el('historyTable').hidden, false); assert.equal(el('noHistory').hidden, true);
  assert.match(el('history').innerHTML, /^<tr><td>Sam &lt;b&gt;<\/td><td data-label="From">SWA Intermediate<\/td><td data-label="To">SWA Advance<\/td><td data-label="Effective">Dec 1, 2026<\/td><td>Moved up<\/td><\/tr>$/, 'cells are named for the phone layout, and escaped');
}

// ---------- Data requests: a status pill, an empty state, a toast ----------
{
  const html = read('app/data-requests/screen.html');
  const toasts = [], forms = [];
  const run = async requests => {
    const el = dom();
    const ctx = vm.createContext({document: {getElementById: el, querySelectorAll: () => forms}, JSON, Error, Date, String, encodeURIComponent, swaToast: (t, o) => toasts.push([t, o && o.kind]),
      fetch: async (url, init) => ({ok: true, json: async () => ({requests: init && init.method === 'POST' ? requests.map(r => ({...r, status: 'handled', resolvedAt: '2026-11-14T15:00:00Z', resolution: 'Closed.'})) : requests})})});
    vm.runInContext(scriptOf(html), ctx); await tick(); await tick();
    return el;
  };
  let el = await run([]);
  assert.match(el('list').innerHTML, /^<div class="empty"><svg[\s\S]*?<\/svg><p>No requests\. When a family asks to close their account, it shows here\.<\/p><\/div>$/);
  const form = {dataset: {id: 'r1'}, querySelector: () => ({value: 'Closed.'})}; forms.push(form);
  el = await run([{id: 'r1', status: 'open', parentName: 'Pat <i>', email: 'p@example.test', wrestlers: ['Sam'], createdAt: '2026-11-14T14:00:00Z', note: 'Moving'}]);
  assert.match(el('list').innerHTML, /^<section class="card request"><h2>Pat &lt;i&gt; <span class="pill warn">Open<\/span><\/h2>/); assert.match(el('list').innerHTML, /<blockquote>“Moving”<\/blockquote>/);
  await form.onsubmit({preventDefault() {}}); await tick();
  assert.match(el('list').innerHTML, /<span class="pill ok">Handled<\/span>/); assert.deepEqual(toasts.at(-1), ['Recorded.', 'ok'], 'saving says so in a toast');
}

// ---------- Scholarships: the status is a pill ----------
{
  const s = scriptOf(read('app/scholarships/screen.html'));
  const ctx = {esc: v => String(v)};
  vm.runInNewContext(s.slice(s.indexOf('function statusPill'), s.indexOf('function reference()')) + ';this.statusPill=statusPill', ctx);
  assert.equal(ctx.statusPill({status: 'offered', terms_ready: false}), '<span class="pill warn">Agreement not final</span>');
  assert.equal(ctx.statusPill({status: 'offered', terms_ready: true}), '<span class="pill ok">Ready to accept</span>');
  assert.equal(ctx.statusPill({status: 'active'}), '<span class="pill ok">Active</span>');
  assert.equal(ctx.statusPill({status: 'ended'}), '<span class="pill neutral">Ended</span>');
  assert.doesNotMatch(read('app/scholarships/screen.html'), /style="/, 'no inline styles in the offer cards');
}

// ---------- The public website editor: cards, and the save result beside the Save button ----------
{
  const html = read('app/website/screen.html');
  assert.equal((html.match(/<section class="card"/g) || []).length, 6, 'each part of the site is a card');
  assert.match(html, /<span class="saved" id="savedAt"><\/span><span class="save-note" id="saveNote" role="status" aria-live="polite"><\/span><\/div>/, 'the save bar holds the result');
  const s = scriptOf(html);
  const el = dom(), ctx = {document: {getElementById: el}};
  vm.runInNewContext('const $=id=>document.getElementById(id);' + s.slice(s.indexOf('function said('), s.indexOf('async function saveSite()')) + ';this.said=said', ctx);
  ctx.said('Saved and published. Visitors see the changes within a minute.');
  assert.equal(el('saveNote').textContent, 'Saved and published. Visitors see the changes within a minute.'); assert.equal(el('status').textContent, el('saveNote').textContent);
}

// ---------- No wall of zeros: tiles stay away when there is nothing to count ----------
{
  // Coach pay: a period with no paid lessons is one sentence.
  const html = read('app/coach-pay/screen.html');
  for (const [coaches, hidden] of [[[], true], [[{coach: 'Coach Dana', lessons: 1, wrestlers: 1, grossCents: 6000, splitPct: 65, owedCents: 3900, rows: []}], false]]) {
    const el = dom({preset: {value: 'this'}});
    vm.runInNewContext(scriptOf(html), {document: {getElementById: el}, JSON, Error, Date, String, Intl, window: {print() {}}, fetch: async () => ({ok: true, json: async () => ({from: '2026-11-01', to: '2026-11-30', coaches, totals: {lessons: coaches.length, grossCents: 0, refundedCents: 0, owedCents: 0, academyCents: 0, unsetCoaches: 0}})})});
    await tick(); await tick();
    assert.equal(el('tiles').hidden, hidden, 'coach pay tiles');
    if (hidden) assert.match(el('coaches').innerHTML, /No paid lessons were taught in this period\./);
  }
  // Cards and coach hours: the same rule, read from the page (their scripts run in tests/cards-today.mjs and tests/coach-time.mjs).
  assert.match(read('app/cards/screen.html'), /\$\('tiles'\)\.hidden=\$\('todayNote'\)\.hidden=!t\.all;/);
  assert.match(read('app/cards/screen.html'), /\(t\.all\?'No wrestlers match\.':'No wrestlers yet\. Each wrestler a family adds is listed here with their USA Wrestling card\.'\)/);
  assert.match(read('app/timesheets/screen.html'), /\$\('tiles'\)\.hidden=!d\.coaches\.length;/);
  for (const f of ['app/cards/screen.html', 'app/coach-pay/screen.html', 'app/timesheets/screen.html']) assert.match(read(f), /<div class="tiles" id="tiles">/, f);
  // Payments: nothing owed at the door is the one sentence beside the heading; no attempts is one sentence too.
  const pay = read('app/payments/screen.html');
  assert.match(pay, /#cashSection>\.table:has\(#cashRows td\[colspan\]\)\{display:none\}/);
  assert.match(pay, /\$\('attemptsSummary'\)\.textContent=!list\.length&&!q\?'':/);
  assert.match(pay, /html body #rows td\.right\{grid-column:2;grid-row:1;text-align:right;/, 'on a phone the amount sits beside the wrestler');
}

// ---------- The dashboard and its editors ----------
{
  const nodes = new Map(), node = s => { if (!nodes.has(s)) nodes.set(s, {value: '', style: {}, textContent: '', innerHTML: '', className: '', focus() {}, classList: {add() {}, remove() {}}, setAttribute() {}}); return nodes.get(s); };
  class Fields { constructor(f) { this.fields = f.fields; } *[Symbol.iterator]() { yield* this.fields; } }
  const ctx = vm.createContext({console, structuredClone, crypto, Intl, Date, JSON, Set, Map, Promise, FormData: Fields, location: {hash: '', href: ''},
    document: {querySelector: node, getElementById: () => null, addEventListener() {}}, window: {addEventListener() {}}, setTimeout() {}, confirm: () => true});
  vm.runInContext(portalCode, ctx);
  const run = s => vm.runInContext(s, ctx);
  run("hydratePrograms();render=()=>{};academyToday=()=>'2026-11-14';cloudReady=true;saves=0;save=()=>{saves++}");
  // Dates read "Wed, Dec 2", with the year only when it is not this year's or when a range asks for it.
  assert.equal(run("shortDate('2026-12-02')"), 'Wed, Dec 2'); assert.equal(run("shortDate('2027-03-14')"), 'Sun, Mar 14, 2027');
  assert.equal(run("shortDate('2026-10-15',true)"), 'Thu, Oct 15, 2026'); assert.equal(run("shortDate('soon')"), 'soon', 'anything else passes through');
  // Money always shows its cents.
  assert.deepEqual(JSON.parse(run('JSON.stringify([usd(4000),usd(1050),usd(0),usd(null)])')), ['$40.00', '$10.50', '$0.00', '$0.00']);
  // The empty state: an icon, one escaped sentence, and the action that fills it.
  assert.equal(run("emptyState('No <b> yet.','<button>Add</button>','tag')").replace(/<svg[\s\S]*?<\/svg>/, '<svg/>'), '<div class="empty"><svg/><p>No &lt;b&gt; yet.</p><button>Add</button></div>');
  // Every section opens with the shared title row, named like its tab; no eyebrow, no slogan.
  for (const [fn, h1] of [['calendar()', 'Practice calendar'], ['schedules()', 'Schedules'], ['events()', 'Camps &amp; events'], ['ownerPrograms()', 'Programs &amp; pricing']])
    assert.match(run(fn), new RegExp(`^<div class="swa-title"><div class="swa-title__text"><h1>${h1}</h1><p class="muted">[^<]+</p><p class="sync`), fn);
  assert.match(run('eventArchiveView=true;events()'), /<h1>Past camps &amp; events<\/h1>/); run('eventArchiveView=false');
  // Schedules: nothing saved is one sentence each, never an empty box; a saved semester reads as dates, not ISO text.
  let page = run('data.seasons=[];data.extraPractices=[];schedules()');
  assert.match(page, /<p>No semesters yet\. Plan one with the form and its practices appear on the calendar\.<\/p>/); assert.match(page, /<p>No extra practices yet\. Add Friday Night Live by selecting the Fridays you want in the form\.<\/p>/);
  assert.equal((page.match(/class="primary"/g) || []).length, 2, 'Save semester and Add practice; the title’s Add a practice is quiet');
  page = run("data.seasons=[{season:'Winter',program:'Elementary',start:'2026-12-01',end:'2027-02-28',weekly:[{day:'Monday',start:'18:00',end:'19:30'}],excludedDates:['2026-12-28']}];schedules()");
  assert.match(page, /<li><div class="what"><b>Winter · SWA Development<\/b><p>Tue, Dec 1, 2026 to Sun, Feb 28, 2027<\/p><p>Monday · 6:00 PM–7:30 PM<br><b>No practice:<\/b> Mon, Dec 28<\/p><\/div><div class="item-actions"><button type="button" class="sm" onclick="editSeason\(0\)">Edit<\/button><button type="button" class="sm quiet" onclick="removeSeason\(0\)">Remove<\/button><\/div><\/li>/);
  assert.doesNotMatch(page, /style="|Calendar schedule/, 'no inline styles, no badge that says nothing');
  // Programs & pricing: a white card a program with its color as a swatch; the grade rule is text, still sent with the form.
  page = run('programsSaved=true;ownerPrograms()');
  assert.equal((page.match(/<form class="card prog-card cal-(elementary|intermediate|advanced)" oninput="programEdited\(this\)"/g) || []).length, 3);
  assert.doesNotMatch(page, /program-color|class="primary"/, 'no filled grey and black cards, and no red button until something changed');
  assert.match(page, /<div class="fixed"><span>Grade eligibility<\/span><p>Grades K–6<\/p><input type="hidden" name="grades" value="Grades K–6"><\/div>/);
  assert.match(page, /<div class="save-row"><button class="save">Save program<\/button><span class="save-note" role="status" aria-live="polite"><\/span><\/div>/);
  assert.match(run('programsSaved=false;ownerPrograms()'), /<section class="card flag" id="publish-programs">[\s\S]*?<button type="button" class="primary" onclick="publishPrograms\(\)">Publish the programs<\/button>/, 'unpublished: Publish is the one red button');
  // Editing a card turns its Save red; saving says "Saving…" then "Saved" beside the button and renames the card.
  const classes = new Set(), note = {textContent: 'x', className: 'save-note'}, name = {textContent: ''}, button = {classList: {add: c => classes.add(c), remove: c => classes.delete(c)}};
  ctx.form = {fields: [['name', 'SWA Little Savages'], ['grades', 'Grades K–6'], ['description', 'New'], ['price', '210'], ['walkInPrice', '45']], querySelector: s => s === '.save' ? button : s === '.save-note' ? note : s === 'h2 span' ? name : null};
  run('programEdited(form)'); assert.ok(classes.has('primary')); assert.equal(note.textContent, '', 'the last result clears on a new edit');
  run('saveProgram(0,form)');
  assert.equal(run('saves'), 1); assert.equal(run('data.programs[0].priceCents'), 21000); assert.equal(name.textContent, 'SWA Little Savages'); assert.ok(!classes.has('primary'));
  assert.equal(note.textContent, 'Saving…'); await tick(); assert.equal(note.textContent, 'Saved'); assert.equal(note.className, 'save-note');
  // A refused value shows beside the button too, in the error color, and nothing is saved.
  ctx.form.fields = [['name', ''], ['grades', 'Grades K–6'], ['description', ''], ['price', '210'], ['walkInPrice', '']];
  run('saveProgram(0,form)');
  assert.equal(run('saves'), 1); assert.equal(note.className, 'save-note bad'); assert.ok(note.textContent.length > 5 && note.textContent !== 'Saved');
  // An unsaved change that could not be saved says so beside the button.
  ctx.form.fields = [['name', 'SWA Development'], ['grades', 'Grades K–6'], ['description', 'x'], ['price', '200'], ['walkInPrice', '40']];
  run('save=()=>{saveBlocked=true};saveProgram(0,form)'); await tick();
  assert.equal(note.textContent, 'Not saved. Check the save status under the page title.'); assert.equal(note.className, 'save-note bad'); run('saveBlocked=false');
  // Team codes: a row a code with its state as a pill; none is one sentence.
  assert.match(run('data.teamCodes=[];teamCodeManager()'), /<div class="empty"><svg[\s\S]*?<\/svg><p>No team codes yet\. Create a code to offer a team discount\.<\/p><\/div>/);
  assert.match(run("data.teamCodes=[{code:'HUNT10',name:'Huntington',percent:10,programs:['Elementary'],active:false}];teamCodeManager()"), /<b>HUNT10 · Huntington<\/b><p>10% off monthly · SWA Development<\/p><\/div><div class="item-actions"><span class="pill neutral">Inactive<\/span>/);
  // "Nothing needs you right now." shows only when neither list has a row.
  const none = {hidden: true};
  ctx.document.getElementById = id => id === 'needsNone' ? none : null;
  for (const [rows, hidden] of [[0, false], [2, true]]) { ctx.document.querySelectorAll = () => ({length: rows}); run('needsShown()'); assert.equal(none.hidden, hidden); }
}

console.log('Owner design pass: one left edge and empty tables as a sentence in the shell; owner pages on the design system’s tokens; Online payment setup, Backups, Program transfers, Data requests and the website editor say what a button did beside it; the dashboard’s dates, money, empty states, title rows, program cards and save notes');
