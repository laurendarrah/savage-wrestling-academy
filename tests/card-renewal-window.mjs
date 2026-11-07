// Issue #210 (decision Q13 in #197): a USA Wrestling card appears on the owner's renewal list 30 days before it expires.
// The window is one named constant, CARD_RENEWAL_DAYS in lib/usaw.ts, used by the owner's cards page, the family page and
// the daily "card expires soon" reminder.
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
let actor = {owner: true, id: 'owner-id'};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, fetch: async () => new Response('{}'), crypto, btoa, TextEncoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, headers: new Headers()}),
          strongAccount: async () => ({user: {id: actor.id, email: actor.id + '@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}),
          appOrigin: () => 'https://swa.example', sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

const usaw = load(path.resolve('lib/usaw.ts'));
const notify = load(path.resolve('lib/notify.ts'));

// --- One named constant, set to 30 ---
assert.equal(usaw.CARD_RENEWAL_DAYS, 30);
assert.equal(usaw.renewalDue('2026-11-07'), '2026-12-07');
assert.equal(usaw.renewalDue('2027-08-01'), '2027-08-31', 'the renewal window before a season ends opens on August 1');
assert.equal(usaw.renewalDue('2027-03-01'), '2027-03-31');
// No page or reminder keeps its own copy of the window.
assert.doesNotMatch(readFileSync('app/cards/screen.html', 'utf8'), /addDays\(data\.date,30\)|Expire within 30 days<\/span><b id="tSoon">[\s\S]*Expire within 30/);
assert.match(readFileSync('app/cards/screen.html', 'utf8'), /addDays\(data\.date,data\.renewalDays\)/);
assert.doesNotMatch(readFileSync('app/family/screen.html', 'utf8'), /30\*864e5/);
assert.match(readFileSync('app/family/screen.html', 'utf8'), /renewalDays\*864e5/);
assert.doesNotMatch(readFileSync('lib/notify.ts', 'utf8'), /30 \* 86400000/);
assert.match(readFileSync('lib/notify.ts', 'utf8'), /const soon = renewalDue\(today\);/);

// --- The season count on the cards page opens with the same window ---
const list = [{number: 'A', expires: '2027-08-31'}];
assert.equal(usaw.cardRenewal(list, '2027-08-01').august, true, '30 days before Aug 31');
assert.equal(usaw.cardRenewal(list, '2027-07-31').august, false, '31 days before');

// --- The daily reminder: a card expiring in 30 days gets it; 31 days does not ---
const today = '2026-11-07';
const fam = (u, wrestlers) => sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test', JSON.stringify({parentName: 'P', phone: '', wrestlers}), 1, 'x');
fam('p1', [{id: 'w30', name: 'Thirty', grade: '8', usawNumber: 'AB1', usawExpires: addDays(today, 30)},
           {id: 'w31', name: 'ThirtyOne', grade: '8', usawNumber: 'AB2', usawExpires: addDays(today, 31)},
           {id: 'w0', name: 'Today', grade: '8', usawNumber: 'AB3', usawExpires: today}]);
await notify.dailyReminders(true, today);
const expiring = sqlite.prepare("SELECT subject FROM notifications WHERE kind='card_expiring' ORDER BY subject").all().map(n => n.subject);
assert.deepEqual(expiring, [`Thirty's USA Wrestling card expires Dec 7, 2026`, `Today's USA Wrestling card expires Nov 7, 2026`]);

// --- The owner's cards API and the family account send the window to their pages ---
const cardsApi = load(path.resolve('app/api/usaw-cards/route.ts'));
actor = {owner: true, id: 'owner-id'};
let r = await (await cardsApi.GET(new Request('https://a.test/api/usaw-cards'))).json();
assert.equal(r.renewalDays, 30);
const familyApi = load(path.resolve('app/api/family/route.ts'));
actor = {owner: false, id: 'p1'};
r = await (await familyApi.GET(new Request('https://a.test/api/family'))).json();
assert.equal(r.cardRenewalDays, 30);

// --- The owner's renewal list on the cards page follows the server's window ---
// The server filters, counts and pages the cards (issue #46); the page shows the server's counts and the window's
// length, and marks the cards on the renewal list.
{
  const card = (wrestler, expires) => ({userId: 'p', email: 'e', parentName: '', phone: '', wrestlerId: wrestler, wrestler, grade: '8', state: 'verified', number: 'AB', expires, note: '', reviewedAt: null, lookup: null});
  const cards = [card('In30', addDays(today, 30)), card('In31', addDays(today, 31))];
  const usawLib = load(path.resolve('lib/usaw.ts'));
  const listed = JSON.parse(JSON.stringify(usawLib.cardsPage(cards, {show: 'problems', onDate: today})));
  assert.equal(listed.totals.soon, 1); assert.deepEqual(listed.cards.map(c => c.wrestler), ['In30'], 'In31 is not on the list yet');
  const html = readFileSync('app/cards/screen.html', 'utf8'), script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', textContent: '', innerHTML: '', hidden: false, className: '', previousElementSibling: {textContent: 'Expire within 30 days'}, setAttribute() {}, removeAttribute() {}}); return nodes.get(id); };
  const run = async (renewalDays, page) => {
    nodes.clear(); el('show').value = 'problems';
    const data = {today, date: today, renewal: null, renewalDays, ...page};
    const ctx = vm.createContext({document: {getElementById: el, querySelectorAll: () => []}, window: {}, navigator: {}, Date, Intl, JSON, Promise, Number, String, URLSearchParams, encodeURIComponent,
      setTimeout, clearTimeout, fetch: async url => ({ok: true, json: async () => url === '/api/exceptions' ? {exceptions: []} : data})});
    vm.runInContext(script, ctx); await new Promise(r => setTimeout(r, 10));
    return el;
  };
  let page = await run(30, listed);
  assert.equal(page('tSoon').textContent, 1); assert.equal(page('tSoon').previousElementSibling.textContent, 'Expire within 30 days');
  assert.match(page('rows').innerHTML, /In30/); assert.match(page('rows').innerHTML, /expires soon/); assert.doesNotMatch(page('rows').innerHTML, /In31/, 'not on the list yet');
  page = await run(45, {cards, totals: {all: 2, blocked: 0, soon: 2, verified: 2}, matched: 2, next: null});
  assert.equal(page('tSoon').textContent, 2, 'changing the constant moves the list'); assert.equal(page('tSoon').previousElementSibling.textContent, 'Expire within 45 days');
  assert.equal((page('rows').innerHTML.match(/expires soon/g) || []).length, 2, 'both marked with a 45-day window');
}
console.log('Passed: one 30-day renewal window (CARD_RENEWAL_DAYS) for the owner cards page, the family page and the daily reminder.');
