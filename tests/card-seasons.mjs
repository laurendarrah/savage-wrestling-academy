// Issue #131: USA Wrestling cards expire on a season basis. The membership year runs September 1 to August 31 and every
// card expires on August 31 of its season. Covers the season helpers, the family's season choice, the August reminder
// wording, the owner's renewal count and the "Look up on USA Wrestling" button. Page scripts run with a fake DOM,
// because inline JavaScript is not typechecked.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {
  prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }, async run() { return {meta: sqlite.prepare(sql).run(...a)}; },
    _execute() { const s = sqlite.prepare(sql); return s.columns().length ? {results: s.all(...a)} : {results: [], meta: s.run(...a)}; }}; },
  async batch(list) { sqlite.exec('BEGIN'); try { const r = list.map(s => s._execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }
};
const env = {DB};
let today = '2027-08-10';   // the academy's date, set per test through the public-schedule stand-in
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/public-schedule')) return {academyToday: () => today};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test',
          ownerIdentity: async () => ({owner: {userId: 'owner-id'}, headers: new Headers()}),
          strongAccount: async () => ({user: {id: 'p1', email: 'p1@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}),
          sameOrigin: () => true, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
const usaw = load(path.resolve('lib/usaw.ts'));
const notify = load(path.resolve('lib/notify.ts'));
const cardsApi = load(path.resolve('app/api/usaw-cards/route.ts'));
const familyApi = load(path.resolve('app/api/family/route.ts'));
// Objects made inside the vm have their own prototypes, so compare plain copies.
const same = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b, m);
const get = async route => (await route.GET(new Request('https://a.test/x'))).json();

// ---------- Season helpers ----------
same(usaw.cardSeason('2026-09-01'), {start: '2026-09-01', end: '2027-08-31', label: '2026–27 season'}, 'September starts a new season');
assert.equal(usaw.cardSeason('2026-12-31').end, '2027-08-31');
assert.equal(usaw.cardSeason('2027-01-15').end, '2027-08-31', 'a card bought in January expires that August 31');
assert.equal(usaw.cardSeason('2027-05-20').end, '2027-08-31', 'a card bought in May expires that August 31');
assert.equal(usaw.cardSeason('2027-08-31').end, '2027-08-31', 'August 31 is the last day of its season');
assert.equal(usaw.cardSeason('2026-08-31').label, '2025–26 season');
assert.equal(usaw.seasonLabel('2030-08-31'), '2029–30 season');
assert.equal(usaw.seasonLabel('2100-08-31'), '2099–00 season');
assert.equal(usaw.isSeasonEnd('2027-08-31'), true); assert.equal(usaw.isSeasonEnd('2027-08-30'), false); assert.equal(usaw.isSeasonEnd(''), false);
// Families choose the current season, plus the next one from August 1 on.
same(usaw.seasonOptions('2026-11-06'), [{expires: '2027-08-31', label: '2026–27 season'}]);
same(usaw.seasonOptions('2027-07-31'), [{expires: '2027-08-31', label: '2026–27 season'}], 'July: the current season only');
same(usaw.seasonOptions('2027-08-01'), [{expires: '2027-08-31', label: '2026–27 season'}, {expires: '2028-08-31', label: '2027–28 season'}], 'from August 1, the next season too');
same(usaw.seasonOptions('2027-08-31').map(s => s.expires), ['2027-08-31', '2028-08-31']);
same(usaw.seasonOptions('2027-09-01'), [{expires: '2028-08-31', label: '2027–28 season'}], 'September: only the new season');

// A season card works with the existing card rules: current through August 31, expired from September 1.
const W = {id: 'w1', name: 'Sam', usawNumber: 'AB1234', usawExpires: '2027-08-31'};
assert.equal(usaw.cardStatus(W, null, '2027-08-31').state, 'current');
assert.equal(usaw.cardStatus(W, null, '2027-09-01').state, 'expired');

// Owner summary: in August, cards still ending this August 31 have not been renewed for the new season.
const list = [{number: 'A1', expires: '2027-08-31'}, {number: 'A2', expires: '2027-08-31'}, {number: 'A3', expires: '2028-08-31'}, {number: 'A4', expires: '2027-03-01'}, {number: '', expires: '2027-08-31'}];
same(usaw.cardRenewal(list, '2027-08-01'), {august: true, ends: '2027-08-31', count: 2, label: 'Not yet renewed for 2027–28'});
assert.equal(usaw.cardRenewal(list, '2027-08-31').count, 2);
same(usaw.cardRenewal(list, '2027-07-31'), {august: false, ends: '2027-08-31', count: 2, label: 'Cards expire Aug 31, 2027'}, 'outside August, the quiet count');
same(usaw.cardRenewal(list, '2027-09-01'), {august: false, ends: '2028-08-31', count: 1, label: 'Cards expire Aug 31, 2028'});

// ---------- Owner cards API: the count comes from the server ----------
const saveFamily = (id, email, wrestlers) => sqlite.prepare('INSERT OR REPLACE INTO family_accounts VALUES (?,?,?,?,?)').run(id, email, JSON.stringify({parentName: 'Pat', phone: '', wrestlers}), 1, 'x');
saveFamily('p1', 'p1@example.test', [{id: 'w1', name: 'Sam', grade: '8', usawNumber: 'AB1234', usawExpires: '2027-08-31'}, {id: 'w2', name: 'Kai', grade: '5', usawNumber: 'AB1235', usawExpires: '2028-08-31'}]);
saveFamily('p2', 'p2@example.test', [{id: 'w3', name: 'Jo', grade: '9', usawNumber: 'CD5555', usawExpires: '2027-08-31'}, {id: 'w4', name: 'Lee', grade: '9'}]);
today = '2027-08-20';
let r = await get(cardsApi);
same(r.renewal, {august: true, ends: '2027-08-31', count: 2, label: 'Not yet renewed for 2027–28'}, 'Sam and Jo have not renewed');
assert.equal(r.cards.length, 4);
r = await cardsApi.GET(new Request('https://a.test/x?date=2027-09-15')); r = await r.json();
assert.equal(r.renewal.count, 2, 'the summary is about today, whatever date the owner checks');
assert.equal(r.cards.find(c => c.wrestler === 'Sam').state, 'expired');
today = '2027-03-01';
same((await get(cardsApi)).renewal, {august: false, ends: '2027-08-31', count: 2, label: 'Cards expire Aug 31, 2027'});

// ---------- Family API: the seasons a family can choose ----------
today = '2027-08-18';
same((await get(familyApi)).cardSeasons, [{expires: '2027-08-31', label: '2026–27 season'}, {expires: '2028-08-31', label: '2027–28 season'}]);
today = '2026-11-06';
same((await get(familyApi)).cardSeasons, [{expires: '2027-08-31', label: '2026–27 season'}]);

// ---------- Reminders ----------
// A card ending August 31 says to renew for the next season and that new-season cards open in mid-August.
{
  const n = notify.cardExpiringNotice('Sam', '2027-08-31');
  assert.equal(n.subject, "Sam's USA Wrestling card expires Aug 31, 2027");
  assert.match(n.body, /expires on Aug 31, 2027, at the end of the 2026–27 season\. Renew for the 2027–28 season by Aug 31 at usawmembership\.com\. New-season cards usually open in mid-August\./);
  assert.match(n.body, /choose the 2027–28 season for Sam in your family account/);
  const other = notify.cardExpiringNotice('Sam', '2027-03-01');
  assert.match(other.body, /^Sam's USA Wrestling card expires on Mar 1, 2027\. Renew it at usawmembership\.com and update the new expiration date/);
  assert.doesNotMatch(other.body, /season/, 'a special card with another date keeps the plain wording');
  assert.match(notify.cardExpiredNotice('Sam', '2026-08-31', '2026-11-06').body, /expired on Aug 31, 2026, at the end of the 2025–26 season\. Booking is paused until you renew for the 2026–27 season/);
  assert.match(notify.cardExpiredNotice('Sam', '2024-08-31', '2026-11-06').body, /renew for the 2026–27 season/, 'renew for the season the academy is in now');
  assert.match(notify.cardExpiredNotice('Sam', '2026-10-01', '2026-11-06').body, /expired on Oct 1, 2026\. Booking is paused until a current card is added/);
}
// The daily run: same 30-day window and dedupe keys as before. (Opening the family API above already ran it once.)
sqlite.exec('DELETE FROM notifications');
{
  saveFamily('p1', 'p1@example.test', [{id: 'w1', name: 'Sam', grade: '8', usawNumber: 'AB1234', usawExpires: '2027-08-31'},
    {id: 'w2', name: 'Kai', grade: '5', usawNumber: 'AB1235', usawExpires: '2027-09-11'}]);
  saveFamily('p2', 'p2@example.test', [{id: 'w3', name: 'Jo', grade: '9', usawNumber: 'CD5555', usawExpires: '2026-08-31'}]);
  const notices = kind => sqlite.prepare('SELECT * FROM notifications WHERE kind=? ORDER BY user_id').all(kind);
  await notify.dailyReminders(true, '2027-07-31');
  assert.equal(notices('card_expiring').length, 0, 'Aug 31 is 31 days after July 31: outside the window');
  await notify.dailyReminders(true, '2027-08-01');
  const soon = notices('card_expiring');
  assert.equal(soon.length, 1, 'only Sam: Kai\'s card ends 41 days later');
  assert.equal(soon[0].dedupe_key, 'card-soon:p1:w1:2027-08-31');
  assert.match(soon[0].body, /Renew for the 2027–28 season by Aug 31[\s\S]*New-season cards usually open in mid-August/);
  const expired = notices('card_expired');
  assert.equal(expired.length, 1); assert.equal(expired[0].dedupe_key, 'card-expired:p2:w3:2026-08-31');
  assert.match(expired[0].body, /renew for the 2026–27 season/, 'on Aug 1, 2027 the academy is still in the 2026–27 season');
  await notify.dailyReminders(true, '2027-08-20');
  assert.deepEqual(notices('card_expiring').map(n => n.dedupe_key).sort(), ['card-soon:p1:w1:2027-08-31', 'card-soon:p1:w2:2027-09-11'], 'Sam once; Kai\'s card comes into the window');
  assert.match(notices('card_expiring').find(n => n.dedupe_key.endsWith('w2:2027-09-11')).body, /update the new expiration date/, 'a special card keeps the plain wording');
  await notify.dailyReminders(true, '2027-09-01');
  assert.equal(notices('card_expiring').length, 2, 'nothing sent twice');
  assert.equal(notices('card_expired').length, 2, 'Sam\'s card has now expired');
  assert.match(notices('card_expired').find(n => n.dedupe_key === 'card-expired:p1:w1:2027-08-31').body, /renew for the 2027–28 season/);
}

// ---------- Page runner ----------
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const json = (body, ok = true) => ({ok, status: ok ? 200 : 400, json: async () => body});
function page(file, {fetch, hidden = [], extra = {}}) {
  const nodes = new Map();
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: hidden.includes(id), checked: false, disabled: false, innerHTML: '', textContent: '', className: '', href: '', style: {}, dataset: {},
      elements: {parentName: {value: '', focus() {}}, phone: {value: ''}},
      replaceChildren() {}, focus() { el('__focus').textContent = id; }, scrollIntoView() {}, setAttribute() {}, removeAttribute() {}, querySelector() { return null; }, classList: {add() {}, remove() {}, toggle() {}}});
    return nodes.get(id);
  };
  const ctx = vm.createContext({Intl, Date, JSON, URLSearchParams, Promise, setTimeout: f => setImmediate(f), structuredClone, console, crypto: {randomUUID: () => 'new-id'},
    location: {search: '', href: '', assign() {}}, confirm: () => true,
    document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({})}, fetch, ...extra});
  const html = readFileSync(file, 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], ctx);
  return {el, ctx, html};
}

// ---------- Family card entry: choose a season, or a different date ----------
{
  const wrestlers = [
    {id: 'a', name: 'Season card', grade: '8', usawNumber: 'AB-1234', usawExpires: '2099-08-31'},
    {id: 'b', name: 'Special card', grade: '8', usawNumber: 'AB-1235', usawExpires: '2099-03-15'},
    {id: 'c', name: 'Last season', grade: '8', usawNumber: 'AB-1236', usawExpires: '2020-08-31'},
    {id: 'd', name: 'No card', grade: 'K'}];
  const seasons = [{expires: '2099-08-31', label: '2098–99 season'}, {expires: '2100-08-31', label: '2099–00 season'}];
  const {el, ctx, html} = page('app/family/screen.html', {hidden: ['summary'], fetch: async url => url === '/api/family'
    ? json({email: 'pat@example.test', data: {parentName: 'Pat', phone: '1', wrestlers: structuredClone(wrestlers)}, revision: 1, updatedAt: null, cards: {}, cardSeasons: seasons, cardRenewalDays: 30})
    : json({})});
  await settle();
  const form = el('wrestlers').innerHTML;
  const block = i => form.split('<div class="athlete">')[i + 1];
  // A saved season date preselects that season; the date box stays hidden.
  assert.match(block(0), /<select id="usawSeason0" onchange="seasonPicked\(0\)" aria-describedby="usawHint0"><option value="">Choose the season on the card<\/option><option value="2099-08-31" selected>2098–99 season · expires Aug 31, 2099<\/option><option value="2100-08-31">2099–00 season · expires Aug 31, 2100<\/option><option value="other">My card has a different expiration date<\/option><\/select>/);
  assert.match(block(0), /<label id="usawExpBox0" hidden>Expiration date on the card<input id="usawExp0" type="date" value=""><\/label>/);
  // Any other saved date shows as "different date", with the date filled in.
  assert.match(block(1), /<option value="other" selected>My card has a different expiration date/);
  assert.match(block(1), /<label id="usawExpBox1">Expiration date on the card<input id="usawExp1" type="date" value="2099-03-15"><\/label>/);
  // A season that is no longer offered still shows as that season, so an expired card reads correctly.
  assert.match(block(2), /<option value="2020-08-31" selected>2019–20 season · expired Aug 31, 2020<\/option><option value="2099-08-31">/);
  // No card yet: nothing is chosen for the family.
  assert.doesNotMatch(block(3).slice(block(3).indexOf('usawSeason3')), /selected/);
  assert.match(block(3), /<label id="usawExpBox3" hidden>/);
  // One helpful sentence near the field.
  assert.match(block(0), /id="usawHint0">Every USA Wrestling card expires on August 31, whatever month it was bought\. New-season cards usually open in mid-August at <a href="https:\/\/www\.usawmembership\.com" target="_blank" rel="noopener">usawmembership\.com<\/a>\.<\/p>/);
  assert.doesNotMatch(form, /type="date" value="2099-08-31"/, 'no free date input for a season card');

  // Saving: a season stores its August 31; "different date" stores the date typed in; nothing chosen stores nothing.
  for (const [i, w] of wrestlers.entries()) { el('name' + i).value = w.name; el('grade' + i).value = w.grade; el('usaw' + i).value = w.usawNumber || ''; }
  el('usawSeason0').value = '2100-08-31';
  el('usawSeason1').value = 'other'; el('usawExp1').value = '2099-04-01';
  el('usawSeason2').value = '2099-08-31';
  el('usawSeason3').value = '';
  vm.runInContext('readFields()', ctx);
  same(vm.runInContext('profile.wrestlers.map(w=>w.usawExpires)', ctx), ['2100-08-31', '2099-04-01', '2099-08-31', '']);
  // Choosing "different date" shows the date box and moves to it; choosing a season hides it again.
  el('usawSeason0').value = 'other'; vm.runInContext('seasonPicked(0)', ctx);
  assert.equal(el('usawExpBox0').hidden, false); assert.equal(el('__focus').textContent, 'usawExp0');
  el('usawSeason0').value = '2099-08-31'; vm.runInContext('seasonPicked(0)', ctx);
  assert.equal(el('usawExpBox0').hidden, true);

  // The page's season helpers match the server's for every day of several years.
  for (let t = Date.parse('2025-01-01T12:00:00Z'); t <= Date.parse('2029-12-31T12:00:00Z'); t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10), s = usaw.cardSeason(d);
    assert.equal(vm.runInContext(`seasonEndOn('${d}')`, ctx), s.end, d);
    assert.equal(vm.runInContext(`seasonName('${s.end}')`, ctx), s.label, d);
  }
  // Status lines for season cards.
  assert.match(vm.runInContext("cardLine({id:'x',usawNumber:'AB12',usawExpires:'2099-08-31'})", ctx), /Current through Aug 31, 2099, the end of the 2098–99 season\./);
  const academyNow = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
  assert.match(vm.runInContext("cardLine({id:'x',usawNumber:'AB12',usawExpires:'2020-08-31'})", ctx),
    new RegExp('Expired Aug 31, 2020\\. Renew for the ' + usaw.cardSeason(academyNow).label + ', then choose it here\\.'));
  assert.match(vm.runInContext("cardLine({id:'x',usawNumber:'AB12'})", ctx), /Add the card number and the card’s season\./);
  // A season card in its last 30 days: renew for the next season.
  const end = usaw.cardSeason(academyNow).end, days = (Date.parse(end) - Date.parse(academyNow)) / 864e5;
  if (days <= 29) assert.match(vm.runInContext(`cardLine({id:'x',usawNumber:'AB12',usawExpires:'${end}'})`, ctx), /Renew for the \d{4}–\d{2} season by Aug 31\. New-season cards usually open in mid-August\./);
  assert.doesNotMatch(html, /id="usawExp\$\{i\}" type="date" value="\$\{esc\(w\.usawExpires/, 'the free date input is gone');
}

// ---------- Owner cards page: renewal tile and "Look up on USA Wrestling" ----------
const seasonCards = [{userId: 'p1', email: 'p1@example.test', parentName: 'Pat', phone: '', wrestlerId: 'w1', wrestler: 'Sam', grade: '8', state: 'current', number: 'AB-1234', expires: '2027-08-31', note: '', reviewedAt: null},
    {userId: 'p2', email: 'p2@example.test', parentName: 'Riley', phone: '', wrestlerId: 'w4', wrestler: 'Lee', grade: '9', state: 'missing', number: '', expires: '', note: '', reviewedAt: null}];
async function cardsPage({renewal, clipboard}) {
  const cards = seasonCards;
  const selection = {ranges: [], removeAllRanges() { this.ranges = []; }, addRange(r) { this.ranges.push(r); }};
  const p = page('app/cards/screen.html', {fetch: async url => json(url === '/api/exceptions' ? {exceptions: []} : {today: '2027-08-20', date: '2027-08-20', cards, renewal, renewalDays: 30, totals: {all: 2, blocked: 1, soon: 1, verified: 0}, matched: 2, next: null}),
    extra: {navigator: clipboard === undefined ? {} : {clipboard}, window: {getSelection: () => selection}}});
  p.ctx.document.createRange = () => ({selectNodeContents(n) { this.node = n; }});
  p.el('show').value = 'all'; p.el('q').value = '';
  await settle();
  return {...p, selection};
}
{
  let copied = null;
  const {el, ctx, html} = await cardsPage({renewal: {august: true, ends: '2027-08-31', count: 2, label: 'Not yet renewed for 2027–28'}, clipboard: {writeText: async v => { copied = v; }}});
  assert.equal(el('tRenewLabel').textContent, 'Not yet renewed for 2027–28'); assert.equal(el('tRenew').textContent, 2);
  assert.equal(el('renewTile').className, 'tile', 'August: a normal tile');
  const rows = el('rows').innerHTML;
  // The renewal list (#210): Sam's card ends Aug 31, within 30 days of Aug 20.
  assert.match(rows, /<span class="badge soon">On file · expires soon<\/span>/); assert.equal(el('tSoon').textContent, 1);
  // The server counts the renewal list over every card (issue #46): Sam is on it, Lee (no card) is not.
  {const usaw = load(path.resolve('lib/usaw.ts')); assert.equal(usaw.cardsPage(seasonCards, {show: 'all', onDate: '2027-08-20'}).totals.soon, 1);}
  assert.match(rows, /<span class="usaw-id" id="num0">AB-1234<\/span>/);
  assert.match(rows, /<a class="button lookup" href="https:\/\/www\.usawmembership\.com\/verify_membership" target="_blank" rel="noopener" data-lookup="0">Look up on USA Wrestling<\/a>/);
  assert.equal((rows.match(/data-lookup=/g) || []).length, 1, 'no lookup for a wrestler without a card number');
  assert.match(html, /id="lookupHelp"><strong>Check with USA Wrestling<\/strong> checks one card on USA Wrestling’s verify page now and shows what it found\. To check by hand, choose <strong>Look up on USA Wrestling<\/strong>\. It copies the card number and opens USA Wrestling’s membership check in a new tab\. Paste the number as the USAW ID there, check the card is current, then come back and mark it <strong>Verified<\/strong> or <strong>Not valid<\/strong>\.<\/p>/);
  vm.runInContext('lookUp(0)', ctx); await settle();
  assert.equal(copied, 'AB-1234');
  assert.equal(el('status').textContent, 'Copied AB-1234 for Sam. Paste it as the USAW ID on the USA Wrestling page, then come back and mark the card.');
  vm.runInContext('lookUp(1)', ctx); await settle();
  assert.equal(copied, 'AB-1234', 'nothing to copy without a number');
  // The lookup never reads or automates the USA Wrestling site.
  assert.doesNotMatch(html, /fetch\([^)]*usawmembership/);
}
{
  // Clipboard refused: the number is selected on the page instead.
  const {el, ctx, selection} = await cardsPage({renewal: {august: false, ends: '2027-08-31', count: 5, label: 'Cards expire Aug 31, 2027'}, clipboard: {writeText: async () => { throw Error('denied'); }}});
  assert.equal(el('renewTile').className, 'tile quiet', 'outside August the count is quiet');
  assert.equal(el('tRenewLabel').textContent, 'Cards expire Aug 31, 2027'); assert.equal(el('tRenew').textContent, 5);
  vm.runInContext('lookUp(0)', ctx); await settle();
  assert.equal(selection.ranges.length, 1); assert.equal(selection.ranges[0].node, el('num0'));
  assert.match(el('status').textContent, /could not be copied automatically, so AB-1234 is selected on this page\. Copy it and paste it as the USAW ID/);
}
{
  // No clipboard at all (an older browser): the same fallback.
  const {el, ctx, selection} = await cardsPage({renewal: {august: false, ends: '2027-08-31', count: 0, label: 'Cards expire Aug 31, 2027'}});
  vm.runInContext('lookUp(0)', ctx); await settle();
  assert.equal(selection.ranges.length, 1); assert.match(el('status').textContent, /is selected on this page/);
}

// Help pages explain the season and the lookup.
assert.match(readFileSync('app/help/screen.html', 'utf8'), /Every USA Wrestling card expires on August 31, whatever month it was bought\. New-season cards usually open in mid-August/);
assert.match(readFileSync('app/help/owner/screen.html', 'utf8'), /<strong>Look up on USA Wrestling<\/strong> copies the card number[\s\S]*in August the page counts the wrestlers who haven’t renewed/);

console.log('Card season tests passed');
