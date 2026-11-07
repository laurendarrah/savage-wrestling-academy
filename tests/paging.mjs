// Issue #46: no list stops silently at a fixed number of rows. Keyset paging (cursor correctness, no repeats or gaps,
// filters combined with paging) on the owner's cards, waivers, payments and messages lists and the family inbox, and
// batch processing in the daily reminders, notices and the payments spreadsheet. The database is a local D1
// stand-in that enforces D1's per-statement limits (tests/fixtures/d1.mjs).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {makeDb, loader, call, D1_LIMITS} from './fixtures/d1.mjs';

const {sqlite, DB, stats} = makeDb();
const env = {DB};
const actor = {owner: true, id: 'owner-id'};
const load = loader(env, actor);
const paging = load('lib/paging.ts');
const plain = v => JSON.parse(JSON.stringify(v));

// --- Cursors ---
for (const key of [['2026-11-07T12:00:00Z', 'id-1'], [0, 'é & ü / ? =', 'Ωmega 🙂'], [-3.5, '']]) {
  const c = paging.encodeCursor(key);
  assert.match(c, /^[A-Za-z0-9_-]+$/, 'URL-safe');
  assert.deepEqual(plain(paging.decodeCursor(c, key.length)), key, 'round trip');
}
for (const bad of [null, '', 'a b', '!!!', paging.encodeCursor(['x']), paging.encodeCursor({a: 1}), paging.encodeCursor([{}, 'x']), 'x'.repeat(3000)])
  assert.equal(paging.decodeCursor(bad, 2), null, 'a damaged cursor is ignored: ' + bad);
assert.equal(paging.pageSize('abc'), 50); assert.equal(paging.pageSize('7'), 7); assert.equal(paging.pageSize('99999'), 200); assert.equal(paging.pageSize('-1'), 50);
assert.deepEqual(plain(paging.chunks([1, 2, 3, 4, 5], 2)), [[1, 2], [3, 4], [5]]);
const big = Array.from({length: 3000}, (_, i) => ({i, text: 'é'.repeat(400)}));
const parts = paging.jsonChunks(big, 100000);
assert.ok(parts.length > 1 && parts.every(p => Buffer.byteLength(JSON.stringify(p)) <= 100000), 'JSON parts stay under the size in bytes');
assert.equal(parts.flat().length, 3000);

// --- Keyset SQL: mixed directions, ties and filters, forwards and back ---
sqlite.exec('CREATE TABLE t (id TEXT PRIMARY KEY, grp INTEGER, at TEXT, name TEXT)');
const T = 237;
for (let i = 0; i < T; i++) sqlite.prepare('INSERT INTO t VALUES (?,?,?,?)').run('id' + String(i).padStart(3, '0'), i % 4, '2026-11-' + String(1 + (i % 9)).padStart(2, '0'), 'n' + (i % 13));
const cols = [{expr: 'grp'}, {expr: 'at', desc: true}, {expr: 'id'}];
const expect = (where = '') => sqlite.prepare(`SELECT id FROM t ${where} ORDER BY grp ASC, at DESC, id ASC`).all().map(r => r.id);
async function walk(q, limit) {
  const pages = [];
  let page = await paging.keysetPage({...q, cols, keyOf: r => [r.grp, r.at, r.id], limit});
  pages.push(page);
  while (page.next) { page = await paging.keysetPage({...q, cols, keyOf: r => [r.grp, r.at, r.id], cursor: page.next, limit}); pages.push(page); }
  const back = [page];
  while (back.at(-1).prev) back.push(await paging.keysetPage({...q, cols, keyOf: r => [r.grp, r.at, r.id], before: back.at(-1).prev, limit}));
  return {pages, back};
}
for (const limit of [1, 10, 50, 236, 237, 500]) {
  const {pages, back} = await walk({select: 'id,grp,at', from: 'FROM t'}, limit);
  assert.deepEqual(pages.flatMap(p => p.rows.map(r => r.id)), expect(), `every row once, in order (pages of ${limit})`);
  assert.ok(pages.slice(0, -1).every(p => p.rows.length === limit));
  assert.equal(pages[0].prev, null);
  assert.deepEqual(back.reverse().map(p => p.rows.map(r => r.id)), pages.map(p => p.rows.map(r => r.id)), `Previous retraces the pages (${limit})`);
}
{
  const {pages} = await walk({select: 'id,grp,at', from: 'FROM t', where: "name IN (?,?) AND id<>?", args: ['n3', 'n7', 'id003']}, 4);
  assert.deepEqual(pages.flatMap(p => p.rows.map(r => r.id)), expect("WHERE name IN ('n3','n7') AND id<>'id003'"), 'a filter combines with paging');
}
// Rows added and removed between pages: nothing seen twice, nothing that stayed is skipped.
{
  let page = await paging.keysetPage({select: 'id,grp,at', from: 'FROM t', cols, keyOf: r => [r.grp, r.at, r.id], limit: 40});
  const seen = page.rows.map(r => r.id);
  sqlite.prepare("INSERT INTO t VALUES ('id000a',0,'2026-12-31','x')").run();   // sorts before the cursor
  sqlite.prepare('DELETE FROM t WHERE id=?').run(seen[5]);
  const after = [];
  while (page.next) { page = await paging.keysetPage({select: 'id,grp,at', from: 'FROM t', cols, keyOf: r => [r.grp, r.at, r.id], cursor: page.next, limit: 40}); after.push(...page.rows.map(r => r.id)); }
  assert.equal(new Set([...seen, ...after]).size, seen.length + after.length, 'no repeats after changes');
  assert.deepEqual([...seen, ...after].filter(id => id !== seen[5] && id !== 'id000a').sort(), expect().filter(id => id !== 'id000a').sort(), 'no gaps after changes');
}
// Batches cover the table, and composite keys work.
{
  let n = 0, batches = 0;
  for await (const rows of paging.eachBatch({select: 'id,grp', from: 'FROM t', key: ['grp', 'id'], size: 25})) { n += rows.length; batches++; assert.ok(rows.length <= 25); }
  assert.equal(n, sqlite.prepare('SELECT count(*) AS n FROM t').get().n); assert.equal(batches, Math.ceil(n / 25));
}
// In-memory keyset paging.
{
  const rows = Array.from({length: 103}, (_, i) => ({k: i % 7, id: 'r' + i}));
  const key = r => [r.k, r.id], out = [];
  let p = paging.pageOf(rows, key, null, 10);
  out.push(...p.rows); while (p.next) { p = paging.pageOf(rows, key, p.next, 10); out.push(...p.rows); }
  assert.deepEqual(out.map(r => r.id), [...rows].sort((a, b) => a.k - b.k || (a.id < b.id ? -1 : 1)).map(r => r.id));
  assert.equal(paging.pageOf(rows, key, 'garbage', 10).rows.length, 10, 'a bad cursor starts over');
}
console.log('Passed: cursors, keyset SQL with mixed directions, ties, filters, Previous and Next, changes between pages, batches.');

// --- Seed: 260 families (more than five pages), wrestlers with cards, a waiver, payments and messages ---
const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0), F = 260, pad = i => String(i).padStart(3, '0');
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2, programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}], seasons: [], events: []}));
sqlite.prepare("INSERT INTO waiver_versions VALUES ('wv','Participation waiver','text','h',?, 'o', NULL, 'waiver')").run(new Date().toISOString());
for (let i = 0; i < F; i++) {
  const u = 'u' + pad(i);
  const wrestlers = [{id: 'a' + i, name: 'Alex ' + pad(i), grade: '8', ...(i % 3 ? {usawNumber: '12345' + pad(i), usawExpires: i % 3 === 1 ? ny(-2) : ny(10)} : {})}];
  if (i % 2) wrestlers.push({id: 'b' + i, name: 'Blair ' + pad(i), grade: 'K'});
  sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, `fam${pad(i)}@example.test`, JSON.stringify({parentName: 'Parent ' + pad(i), phone: '555-' + pad(i), wrestlers}), 1, '2026-10-01T00:00:00Z');
  if (i % 4 === 0) sqlite.prepare('INSERT INTO waiver_signatures VALUES (?,?,?,?,?,?,?,?,?,0)').run('s' + i, 'wv', u, 'a' + i, 'Alex ' + pad(i), 'P', 'e', '{}', 't');
  // Two payments each, some on the same second, so the id breaks ties.
  for (const n of [0, 1]) sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
    VALUES (?,?,?,?,?,?,'Intermediate','Intermediate','Walk-in','[]',?,0,?,'usd',?,'{}',?,?,0,'t','t',?,NULL,NULL,?)`).run(`o${pad(i)}${n}`, u, `fam${pad(i)}@example.test`, 'a' + i, 'Alex ' + pad(i), 'walkin', 4000 + n * 100, 4000 + n * 100,
    JSON.stringify({method: 'cash'}), i % 10 === 9 && n ? 'refunded' : 'paid', `k${i}-${n}`, `2026-10-${String(1 + (i % 20)).padStart(2, '0')}T12:00:00Z`, n ? 'offline' : 'stripe');
  if (i % 5 === 0) sqlite.prepare("INSERT INTO family_messages(id,user_id,sender_role,body,created_at,read_at,email_status,email_error) VALUES (?,?,'family','Hi',?,NULL,'skipped',NULL)").run('m' + i, u, `2026-11-0${1 + (i % 5)}T1${i % 10}:00:00Z`);
}

// --- Cards: counts over every wrestler, pages without repeats, filter and search combined ---
const cardsApi = load('app/api/usaw-cards/route.ts');
async function walkApi(route, base, listKey, idOf) {
  const seen = [];
  let r = await call(route, base), pages = 1;
  seen.push(...r.body[listKey].map(idOf));
  while (r.body.next) { r = await call(route, base + (base.includes('?') ? '&' : '?') + 'cursor=' + r.body.next); seen.push(...r.body[listKey].map(idOf)); pages++; }
  return {seen, first: (await call(route, base)).body, pages};
}
const wrestlerCount = sqlite.prepare("SELECT sum(json_array_length(payload,'$.wrestlers')) AS n FROM family_accounts").get().n;
{
  const {seen, first, pages} = await walkApi(cardsApi, '/api/usaw-cards?show=all', 'cards', c => c.userId + '/' + c.wrestlerId);
  assert.equal(seen.length, wrestlerCount, 'every wrestler, more than 2,000-style caps would allow per page');
  assert.equal(new Set(seen).size, seen.length, 'no repeats');
  assert.equal(pages, Math.ceil(wrestlerCount / 50)); assert.equal(first.cards.length, 50);
  assert.equal(first.totals.all, wrestlerCount); assert.equal(first.matched, wrestlerCount);
  const blocked = first.totals.blocked;
  const problems = await walkApi(cardsApi, '/api/usaw-cards?show=problems', 'cards', c => c.wrestler);
  assert.equal(problems.first.totals.all, wrestlerCount, 'counts do not depend on the filter');
  assert.equal(problems.seen.length, problems.first.matched); assert.ok(problems.seen.length >= blocked);
  const search = await walkApi(cardsApi, '/api/usaw-cards?show=problems&q=blair%2001', 'cards', c => c.wrestler);
  assert.deepEqual(search.seen, ['Blair 011', 'Blair 013', 'Blair 015', 'Blair 017', 'Blair 019'], 'search within a filter (no card on file is blocked)');
  assert.equal((await call(cardsApi, '/api/usaw-cards?show=all&limit=500')).body.cards.length, Math.min(500, wrestlerCount), 'the page can reload as many rows as it showed');
}
// --- Waivers ---
{
  const waiversApi = load('app/api/waivers/route.ts');
  const all = await walkApi(waiversApi, '/api/waivers?show=all', 'wrestlers', w => w.userId + '/' + w.wrestlerId);
  assert.equal(all.seen.length, wrestlerCount); assert.equal(new Set(all.seen).size, wrestlerCount);
  const signed = sqlite.prepare('SELECT count(*) AS n FROM waiver_signatures').get().n;
  assert.deepEqual(plain(all.first.totals), {all: wrestlerCount, signed, missing: wrestlerCount - signed});
  const missing = await walkApi(waiversApi, '/api/waivers?show=missing&q=fam1', 'wrestlers', w => w.email);
  assert.ok(missing.seen.length > 50, 'more than a page of matches');
  assert.ok(missing.seen.every(e => e.startsWith('fam1')), 'search and filter combine across pages');
  assert.equal(missing.seen.length, missing.first.matched);
  // The page script asks the server for the filter and the next page, and appends it.
  const html = readFileSync('app/waivers/screen.html', 'utf8');
  assert.doesNotMatch(html, /\.filter\(x=>show==='all'/, 'no client-side filter over a partial list');
  assert.match(html, /id="more">Show more<\/button>/);
}
console.log('Passed: cards and waivers count every wrestler and page through all of them, with filters and search.');

// --- Payments: totals over every match, pages, CSV of every row, family picker ---
{
  const payApi = load('app/api/payments/route.ts');
  const all = await walkApi(payApi, '/api/payments', 'payments', p => p.id);
  const rows = sqlite.prepare("SELECT id FROM orders WHERE status IN ('paid','refunded') ORDER BY paid_at DESC, id DESC").all().map(r => r.id);
  assert.deepEqual(all.seen, rows, 'newest first, every payment once');
  assert.equal(all.first.payments.length, 100); assert.equal(all.first.matched, rows.length);
  const paid = sqlite.prepare("SELECT count(*) AS n, sum(amount_cents) AS c FROM orders WHERE status='paid'").get();
  assert.equal(all.first.totals.count, paid.n, 'totals cover every payment, not one page'); assert.equal(all.first.totals.collectedCents, paid.c);
  const offline = await walkApi(payApi, '/api/payments?source=offline&status=paid', 'payments', p => p.id);
  assert.deepEqual(offline.seen, sqlite.prepare("SELECT id FROM orders WHERE status='paid' AND source='offline' ORDER BY paid_at DESC, id DESC").all().map(r => r.id), 'filters combine with paging');
  const csv = (await call(payApi, '/api/payments?format=csv')).body.trim().split('\r\n');
  assert.equal(csv.length - 1, rows.length, 'the spreadsheet has every payment');
  let fam = (await call(payApi, '/api/payments?families=1')).body;
  assert.equal(fam.families.length, 50); assert.equal(fam.more, true, 'the picker says there are more');
  fam = (await call(payApi, '/api/payments?families=1&q=blair%20013')).body;
  assert.deepEqual(fam.families.map(f => f.email), ['fam013@example.test']); assert.equal(fam.more, false);
  assert.match(readFileSync('app/payments/screen.html', 'utf8'), /Showing the first '\+families\.length\+' families\. Type more of a name or email to narrow the list\./);
}
console.log('Passed: payments page through every row with filters, totals and the spreadsheet cover every payment, the family picker says when there are more.');

// --- Owner messages: families searched and paged on the server; conversations and sent announcements page ---
{
  const msgApi = load('app/api/messages/route.ts');
  const first = (await call(msgApi, '/api/messages')).body;
  assert.equal(first.families.length, 30); assert.equal(first.familiesMatched, F);
  const seen = [...first.families.map(f => f.userId)];
  let next = first.familiesNext;
  while (next) { const r = (await call(msgApi, '/api/messages?families=1&cursor=' + next)).body; seen.push(...r.families.map(f => f.userId)); next = r.familiesNext; }
  assert.equal(seen.length, F); assert.equal(new Set(seen).size, F, 'every family once');
  const withMessages = sqlite.prepare('SELECT DISTINCT user_id FROM family_messages').all().map(r => r.user_id);
  assert.deepEqual(seen.slice(0, withMessages.length).sort(), withMessages.sort(), 'latest conversations first');
  const search = (await call(msgApi, '/api/messages?families=1&q=Alex%20012')).body;
  assert.deepEqual(search.families.map(f => f.userId), ['u012']); assert.equal(search.familiesMatched, 1);
  // A long conversation: the latest 100, then earlier ones, in time order, nothing missed.
  for (let n = 0; n < 230; n++) sqlite.prepare("INSERT INTO family_messages(id,user_id,sender_role,body,created_at,read_at,email_status,email_error) VALUES (?,?,?,?,?,NULL,'skipped',NULL)")
    .run('t' + String(n).padStart(3, '0'), 'u001', n % 2 ? 'owner' : 'family', 'Message ' + n, new Date(Date.UTC(2026, 9, 1) + Math.floor(n / 2) * 1000).toISOString());   // pairs share a second; the id breaks the tie
  let t = (await call(msgApi, '/api/messages?family=u001')).body, thread = t.thread;
  assert.equal(thread.length, 100); assert.equal(thread.at(-1).body, 'Message 229', 'the newest message is shown');
  while (t.earlier) { t = (await call(msgApi, '/api/messages?family=u001&cursor=' + t.earlier)).body; thread = t.thread.concat(thread); }
  assert.deepEqual(thread.map(m => m.body), Array.from({length: 230}, (_, n) => 'Message ' + n), 'every message once, oldest first');
  // Sent announcements: 60 sent, shown 25 at a time.
  for (let n = 0; n < 60; n++) sqlite.prepare("INSERT INTO announcements VALUES (?,?,?,?,?,?,?,?)").run('an' + n, 'Subject ' + n, 'b', '{"type":"all"}', 'All families', 'owner', `2026-09-01T00:00:${String(n).padStart(2, '0')}Z`, 0);
  let s = first.sent.length ? first : (await call(msgApi, '/api/messages')).body, sent = s.sent.map(a => a.id), sn = s.sentNext;
  while (sn) { const r = (await call(msgApi, '/api/messages?sent=1&cursor=' + sn)).body; sent.push(...r.sent.map(a => a.id)); sn = r.sentNext; }
  assert.equal(sent.length, 60); assert.equal(new Set(sent).size, 60);
}
// --- Family inbox: unread counts cover everything; older notices, announcements and messages load on request ---
{
  actor.owner = false; actor.id = 'u002';
  for (let n = 0; n < 75; n++) sqlite.prepare("INSERT INTO notifications(id,user_id,email,kind,subject,body,dedupe_key,created_at,read_at,email_status,email_error) VALUES (?,?,?,?,?,?,?,?,NULL,'skipped',NULL)")
    .run('nt' + n, 'u002', 'e', 'k', 'Notice ' + n, 'b', 'dk' + n, `2026-10-02T00:${String(n).padStart(2, '0')}:00Z`);
  for (let n = 0; n < 60; n++) sqlite.prepare("INSERT INTO announcement_recipients(announcement_id,user_id,email,read_at,email_status,email_error) VALUES (?,?,?,NULL,'skipped',NULL)").run('an' + n, 'u002', 'e');
  const inbox = load('app/api/inbox/route.ts');
  const box = (await call(inbox, '/api/inbox')).body;
  assert.equal(box.notices.length, 50); assert.equal(box.announcements.length, 50);
  // Opening the inbox also runs the morning reminders, which may add this family's own notices.
  const notices = sqlite.prepare("SELECT count(*) AS n FROM notifications WHERE user_id='u002'").get().n;
  assert.ok(notices >= 75);
  assert.equal(box.unread, notices + 60, 'unread counts every notice and announcement, not just the ones shown');
  const more = (await call(inbox, '/api/inbox?more=notices&cursor=' + box.noticesNext)).body;
  assert.equal(more.notices.length, notices - 50); assert.equal(more.noticesNext, null);
  assert.equal(new Set([...box.notices, ...more.notices].map(n => n.id)).size, notices);
  const ann = (await call(inbox, '/api/inbox?more=announcements&cursor=' + box.announcementsNext)).body;
  assert.equal(ann.announcements.length, 10);
  // The page script appends older items and keeps the newest at the top.
  const script = readFileSync('app/inbox/screen.html', 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {hidden: false, innerHTML: '', textContent: '', dataset: {}}); return nodes.get(id); };
  const buttons = [{dataset: {more: 'notices'}}];
  const ctx = vm.createContext({document: {getElementById: el, querySelectorAll: s => s === '[data-more]' ? buttons : []}, location: {}, Date, Intl,
    fetch: async url => ({ok: true, status: 200, json: async () => url === '/api/inbox' ? box : more})});
  vm.runInContext(script, ctx);
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  assert.equal(el('noticesMore').hidden, false);
  await buttons[0].onclick(); for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  assert.equal((el('notices').innerHTML.match(/data-notice=/g) || []).length, notices, 'older notices appended');
  assert.equal(el('noticesMore').hidden, true, 'no more to load');
  actor.owner = true; actor.id = 'owner-id';
}
console.log('Passed: owner messages page families, conversations and announcements; the family inbox counts everything and loads older items.');

// --- Daily reminders in batches: every family, within D1's per-run query limit, never twice ---
{
  const notify = load('lib/notify.ts');
  sqlite.exec("DELETE FROM notifications; DELETE FROM academy_settings WHERE id LIKE 'reminders:%'");
  const extra = 1100;   // 1,360 families in all: three batches of 500
  for (let i = 0; i < extra; i++) sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('x' + i, `x${i}@example.test`,
    JSON.stringify({parentName: 'X', phone: '', wrestlers: [{id: 'xw' + i, name: 'Xan ' + i, grade: '9', usawNumber: '9999' + i, usawExpires: ny(5)}]}), 1, 't');
  const families = sqlite.prepare('SELECT user_id,payload FROM family_accounts').all();
  assert.ok(families.length > 2 * notify.REMINDER_BATCH);
  let expected = 0;
  const due = new Set();
  for (const f of families) for (const w of JSON.parse(f.payload).wrestlers) {
    if (w.usawNumber && w.usawExpires) { expected++; due.add(f.user_id); }   // expiring soon or expired
    if (!sqlite.prepare('SELECT 1 FROM waiver_signatures WHERE user_id=? AND wrestler_id=?').get(f.user_id, w.id)) { expected++; due.add(f.user_id); }
  }
  assert.ok(due.size > 2 * notify.REMINDER_BATCH);
  stats.queries = 0;
  const sent = await notify.dailyReminders(false, today);
  assert.equal(sent, expected, 'one notice per card and unsigned waiver, for every family');
  assert.deepEqual(sqlite.prepare('SELECT DISTINCT user_id FROM notifications').all().map(r => r.user_id).sort(), [...due].sort(), 'no family left out');
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM notifications WHERE user_id LIKE 'x%' AND kind='card_expiring'").get().n, extra);
  assert.ok(stats.queries < D1_LIMITS.queriesPerRun / 4, `the run used ${stats.queries} queries for ${families.length} families`);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM notifications WHERE email_status='skipped'").get().n, expected, 'email status recorded per notice');
  assert.equal(await notify.dailyReminders(false, today), 0, 'once a day');
  assert.equal(await notify.dailyReminders(true, today), 0, 'never twice, even when forced');
  // notify() itself: the same event twice in one list is one notice.
  const n = await notify.notify([{userId: 'u000', email: 'e', kind: 'k', subject: 's', body: 'b', dedupeKey: 'dup'}, {userId: 'u000', email: 'e', kind: 'k', subject: 's', body: 'b', dedupeKey: 'dup'}]);
  assert.equal(n, 1);
}
console.log('Passed: daily reminders cover every family in batches, within D1 limits, and never send twice.');
