// Issue #169: Family accounts has a search box over parent, email, phone and wrestler names, and a count.
// Issue #188: a program filter sits next to it, and both narrow the list together.
// Issue #46: search, filter and paging run on the server over every family, 50 a page, with Previous and Next links
// (keyset paging): walking the pages shows every family once, in order, with or without a search or filter.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load, request, sqlite} from './accounts.mjs';

const src = readFileSync('app/accounts/route.ts', 'utf8');
assert.doesNotMatch(src, /LIMIT 500/, 'no fixed cap on the list');
assert.doesNotMatch(src, /sample families/, 'no mention of the removed sample families');
const accounts = load('app/accounts/route.ts');
const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York'}).format(new Date());
const plus = n => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// 130 families. Every third shares a save time with the one before it, so the user id has to break ties.
const N = 130, pad = i => String(i).padStart(3, '0');
for (let i = 0; i < N; i++) {
  const at = new Date(Date.UTC(2026, 9, 1, 0, 0, i - (i % 3 === 2 ? 1 : 0))).toISOString();
  sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('fam-' + pad(i), `parent${pad(i)}@load.test`,
    JSON.stringify({parentName: 'Parent ' + pad(i), phone: '555-' + pad(i), wrestlers: [{id: 'w' + i, name: (i === 7 ? 'Zed 100%' : 'Kid ' + pad(i)), grade: '8'}]}), 1, at);
  // Every fifth family has a wrestler in SWA Intermediate today.
  if (i % 5 === 0) sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
    VALUES (?,?,'e',?,'K','annual','Intermediate','Intermediate','M','[]',1,0,1,'usd','{}','{}','paid',?,0,'t','t','t',?,?,'offline')`).run('o' + i, 'fam-' + pad(i), 'w' + i, 'k' + i, plus(-5), plus(300));
}
const all = sqlite.prepare('SELECT user_id,email FROM family_accounts ORDER BY updated_at DESC, user_id DESC').all().map(r => r.email);
const total = all.length, wrestlers = sqlite.prepare("SELECT sum(json_array_length(payload,'$.wrestlers')) AS n FROM family_accounts").get().n;
assert.ok(total > 100);

const page = async (query = '') => {
  const html = await (await accounts.GET(request('/accounts' + query, 'GET', null, 'owner'))).text();
  const emails = [...html.matchAll(/<article data-programs="[^"]*"><h2>[^<]*<\/h2>(?:<p><span class="pill warn">Details missing<\/span><\/p>)?<p>([^<· ]+)/g)].map(m => m[1].trim());
  const href = rel => (html.match(new RegExp(`<a class="button" href="([^"]+)" rel="${rel}"`)) ?? [])[1]?.replace(/&amp;/g, '&');
  return {html, emails, next: href('next'), prev: href('prev'), count: html.match(/<p id="count"[^>]*>([^<]*)</)?.[1], shown: html.match(/<nav class="pager"[^>]*><p>([^<]*)</)?.[1]};
};
// Every page from the first, by Next links, then back again by Previous links.
async function walk(query = '') {
  const pages = [];
  let p = await page(query ? '?' + query : '');
  pages.push(p);
  while (p.next) { p = await page(p.next); pages.push(p); }
  const back = [p];
  while (back.at(-1).prev) back.push(await page(back.at(-1).prev));
  return {pages, back};
}

// --- Every family, in order, once ---
let {pages, back} = await walk();
const seen = pages.flatMap(p => p.emails);
assert.equal(pages.length, Math.ceil(total / 50));
assert.ok(pages.slice(0, -1).every(p => p.emails.length === 50), 'full pages of 50');
assert.deepEqual(seen, all, 'every family once, newest changes first, no gaps or repeats');
assert.equal(pages[0].count, `${total} families · ${wrestlers} wrestlers`, 'the count covers every family, not one page');
assert.equal(pages[0].shown, `Showing 1–50 of ${total} families`);
assert.equal(pages[1].shown, `Showing 51–100 of ${total} families`);
assert.equal(pages[0].prev, undefined, 'no Previous on the first page');
assert.equal(pages.at(-1).next, undefined, 'no Next on the last page');
assert.match(pages[0].html, new RegExp(`rel="next">Next 50 →`));
assert.deepEqual(back.map(p => p.emails).reverse(), pages.map(p => p.emails), 'Previous walks back through the same pages');
assert.match(pages[1].html, /rel="prev">← Previous 50/);
// A damaged cursor shows the first page rather than an error.
assert.deepEqual((await page('?after=not*a*cursor')).emails, pages[0].emails);
assert.deepEqual((await page('?after=' + 'A'.repeat(40))).emails, pages[0].emails);

// --- Search: parent, email, phone or wrestler, any case; % and _ are plain characters ---
assert.deepEqual((await page('?q=PARENT%20042')).emails, ['parent042@load.test']);
assert.deepEqual((await page('?q=parent043%40load')).emails, ['parent043@load.test']);
assert.deepEqual((await page('?q=555-044')).emails, ['parent044@load.test']);
assert.deepEqual((await page('?q=kid%20045')).emails, ['parent045@load.test']);
assert.deepEqual((await page('?q=100%25')).emails, ['parent007@load.test'], '% is matched literally');
assert.deepEqual((await page('?q=Kid_0')).emails, [], '_ is matched literally');
let p = await page('?q=nobody-here');
assert.deepEqual(p.emails, []); assert.match(p.html, /<p id="none">No family matches that search and program\.<\/p>/);
assert.equal(p.count, `0 of ${total} families match`);
assert.match(p.html, /<input id="find" name="q" type="search" value="nobody-here"/, 'the search stays in the box');
// A search with more than a page of matches pages too, and the links keep the search.
({pages} = await walk('q=parent0'));
assert.deepEqual(pages.flatMap(p => p.emails), all.filter(e => e.startsWith('parent0')));
assert.equal(pages.length, 2); assert.match(pages[0].next, /^\?q=parent0&after=/);
assert.equal(pages[0].count, `100 of ${total} families match`);

// --- Program filter, alone and with a search, across pages ---
const members = all.filter(e => /^parent\d+@load/.test(e) && Number(e.slice(6, 9)) % 5 === 0);
({pages} = await walk('program=Intermediate'));
assert.deepEqual(pages.flatMap(p => p.emails), members, 'only families with a wrestler in the program today');
assert.ok(pages.flatMap(p => p.emails).length === 26);
assert.match(pages[0].html, /<option value="Intermediate" selected>/, 'the chosen program stays selected');
({pages} = await walk('program=none'));
const none = pages.flatMap(p => p.emails);
assert.deepEqual(none, all.filter(e => !members.includes(e)), 'every other family, in order');
assert.equal(new Set(none).size, none.length, 'no repeats under a filter');
({pages} = await walk('program=Intermediate&q=parent1'));
assert.deepEqual(pages.flatMap(p => p.emails), members.filter(e => e.startsWith('parent1')), 'search and program combine');
assert.equal((await page('?program=Intermediate&q=parent1')).count, `${members.filter(e => e.startsWith('parent1')).length} of ${total} families match`);
// An unknown program is ignored.
assert.deepEqual((await page('?program=Bogus')).emails, (await page()).emails);

// --- The program menu submits the form on its own; the page has no client-side filtering left ---
const script = pages[0].html.match(/<script>([\s\S]*?)<\/script>/)[1];
let submitted = false;
const select = {};
new Function('document', script)({getElementById: id => (assert.equal(id, 'program'), select)});
select.onchange({target: {form: {requestSubmit() { submitted = true; }}}});
assert.ok(submitted, 'choosing a program reloads the list');
assert.doesNotMatch(src, /data-search=/, 'no hidden client-side filter');
console.log(`accounts-search ok: ${total} families over ${Math.ceil(total / 50)} pages`);
