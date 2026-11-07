// Issue #202: USA Wrestling cards are checked automatically on USA Wrestling's public verify page. Covers the page
// parser (against sanitized samples in tests/fixtures/), the name match, the request the site sends, the verification
// flow over a local stand-in (never the real site), the rate limit and cache, and that a mismatched or inactive card
// never verifies. Booking rules are covered in tests/usaw-cards.mjs.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import {start as startStub, verifyPage, SNAPSHOT, CSRF} from '../scripts/e2e/fake-usaw.mjs';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {
  prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }, async run() { return {meta: sqlite.prepare(sql).run(...a)}; },
    _execute() { const s = sqlite.prepare(sql); return s.columns().length ? {results: s.all(...a)} : {results: [], meta: s.run(...a)}; }}; },
  async batch(list) { sqlite.exec('BEGIN'); try { const r = list.map(s => s._execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }
};
const env = {DB, USAW_LOOKUP_BASE: ''};
let actor = {owner: false, id: 'p1'};
// What the lookup code sees as fetch and AbortSignal; tests swap them.
const net = {fetch: (...a) => fetch(...a), AbortSignal};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console, TextEncoder, Uint8Array, Promise,
      fetch: (...a) => net.fetch(...a), AbortSignal: {timeout: ms => net.AbortSignal.timeout(ms)},
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test',
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, headers: new Headers()}),
          strongAccount: async () => ({user: {id: actor.id, email: actor.id + '@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}
const lookup = load(path.resolve('lib/usaw-lookup.ts'));
const check = load(path.resolve('lib/usaw-check.ts'));
const usaw = load(path.resolve('lib/usaw.ts'));
const familyApi = load(path.resolve('app/api/family/route.ts'));
const checkApi = load(path.resolve('app/api/usaw-check/route.ts'));
const cardsApi = load(path.resolve('app/api/usaw-cards/route.ts'));

const active = readFileSync('tests/fixtures/usaw-found-active.html', 'utf8');
const notFound = readFileSync('tests/fixtures/usaw-not-found.html', 'utf8');
const inactive = active.replace('#66ff33', '#a94442');

// ---------- Parser: the results table ----------
assert.deepEqual({...lookup.parseResults(active, '1234567890')}, {status: 'active', name: 'Sam Example', state: 'NY'});
assert.deepEqual({...lookup.parseResults(active, '1234-567-890')}, {status: 'active', name: 'Sam Example', state: 'NY'}, 'dashes in the number do not matter');
assert.deepEqual({...lookup.parseResults(inactive, '1234567890')}, {status: 'inactive', name: 'Sam Example', state: 'NY'});
assert.deepEqual({...lookup.parseResults(notFound, '1234567890')}, {status: 'not_found'});
// Any change in shape is "unavailable", never valid.
const unavailable = (html, why, id = '1234567890') => assert.equal(lookup.parseResults(html, id).status, 'unavailable', why);
unavailable(active, 'the table is about another number', '9999999999');
unavailable(active.replace('#66ff33', '#ffcc00'), 'an unknown dot colour');
unavailable(active.replace('#66ff33', '#66ff33"></div><div style="background-color: #a94442'), 'two dots in the Athlete cell');
unavailable(active.replace(/(#66ff33[^>]*><\/div>)/, '$1 Expired'), 'text in the Athlete cell');
unavailable(active.replace(/(wire:key="3">)\s*Athlete/, '$1 Member'), 'the Athlete column was renamed');
unavailable(active.replace(/<th class="text-center">[\s\S]*?<\/th>/, ''), 'a header cell is missing');
unavailable(active.replace(/(<tr wire:key="row-1"[\s\S]*?<\/tr>)/, '$1$1'), 'two rows for one number');
unavailable(active.replace(/<td class="text-center">[\s\S]*?<\/td>/, ''), 'a row with a missing cell');
unavailable(active.replace(/Sam Example/, ''), 'no name');
unavailable(active + notFound, 'a table and "no records" together');
unavailable(active + active, 'two tables');
unavailable('<div>Service temporarily unavailable</div>', 'an error page');
unavailable('', 'empty');
unavailable(undefined, 'missing');
unavailable(active.replace(/<thead[\s\S]*?<\/thead>/, ''), 'no header');
// Text is read safely: entities decode, tags never pass through.
assert.equal(lookup.parseResults(active.replace('Sam Example', 'Sam O&#039;Brien <b>x</b>'), '1234567890').name, "Sam O'Brien x");

// ---------- Parser: the verify page ----------
{
  const p = lookup.parseVerifyPage(verifyPage());
  assert.equal(p.csrf, CSRF); assert.equal(p.snapshot, SNAPSHOT, 'the snapshot goes back exactly as the page gave it'); assert.equal(p.updateUri, '/livewire-stub/update');
  assert.equal(lookup.parseVerifyPage(verifyPage().replace(/<meta name="csrf-token"[^>]*>/, '')), null, 'no CSRF token');
  assert.equal(lookup.parseVerifyPage(verifyPage().replace('verify-memberships', 'something-else')), null, 'not the verify component');
  assert.equal(lookup.parseVerifyPage(verifyPage().replace(/data-update-uri="[^"]*"/, '')), null, 'no update address');
  assert.equal(lookup.parseVerifyPage(verifyPage().replace('</body>', '<script data-update-uri="/other/update"></script></body>')), null, 'two different update addresses');
  const two = verifyPage().replace('</body>', verifyPage().match(/<div wire:snapshot[\s\S]*?<\/div>/)[0] + '</body>');
  assert.equal(lookup.parseVerifyPage(two), null, 'two verify components');
}

// ---------- Name match ----------
const yes = (a, b) => assert.equal(lookup.namesMatch(a, b), true, `${a} = ${b}`);
const no = (a, b) => assert.equal(lookup.namesMatch(a, b), false, `${a} ≠ ${b}`);
yes('Sam Example', 'Sam Example'); yes('sam example', 'SAM EXAMPLE'); yes('  Sam   Example ', 'Sam Example');
yes('José Núñez', 'Jose Nunez'); yes('Zoë Brontë', 'ZOE BRONTE');
yes('Sam Lee Example', 'Sam Example'); yes('Sam Example', 'Sam L Example'); yes('Sam L. Example', 'Sam Lee Example');
yes('Sam Example Jr.', 'Sam Example'); yes("Sam O'Brien", 'Sam OBrien'); yes('Sam Smith-Jones', 'Sam Smithjones');
yes('Example, Sam', 'Sam Example');
yes('Sam Example', 'Samuel Example'); yes('Mike Example', 'Michael Example'); yes('Katherine Example', 'Kate Example');
no('Sam Example', 'Samantha Examples'); no('Samuel Example', 'Samantha Example'); no('Sam Example', 'Pat Example');
no('Mike Example', 'Michael Exampel'); no('Sam Lee Example', 'Sam Kim Example'); no('Sam L Example', 'Sam K Example');
no('Sam', 'Sam Example'); no('Sam Example', 'Example'); no('S Example', 'Sam Example'); no('', 'Sam Example'); no('Sam Example', '');
no('Sam Smith-Jones', 'Sam Jones'); no('Bob Example', 'Bobby Examples');

// ---------- The request: only the card number goes out, with an honest User-Agent ----------
const stub = await startStub(0);
const BASE = 'http://127.0.0.1:' + stub.address().port;
env.USAW_LOOKUP_BASE = BASE;
assert.deepEqual({...await lookup.lookUpCard('1234567890')}, {status: 'active', name: 'Sam Example', state: 'NY'});
assert.deepEqual({...await lookup.lookUpCard('2222-222-222')}, {status: 'inactive', name: 'Sam Example', state: 'NY'});
assert.deepEqual({...await lookup.lookUpCard('5555555555')}, {status: 'not_found'});
{
  const sent = stub.seen[0];
  assert.equal(sent.headers['user-agent'], 'SavageWrestlingAcademy/1.0 (card check)');
  assert.ok(!/@/.test(sent.headers['user-agent']), 'no email address in the User-Agent');
  assert.equal(sent.headers.referer, BASE + '/verify_membership');
  assert.match(sent.headers['content-type'], /application\/json/);
  assert.deepEqual(sent.body.components[0].updates, {'filters.usaw_id': '1234567890'}, 'only the card number is sent');
  assert.deepEqual(Object.keys(sent.body).sort(), ['_token', 'components']);
  assert.equal(stub.seen[1].body.components[0].updates['filters.usaw_id'], '2222222222', 'sent without dashes');
}
assert.equal((await lookup.lookUpCard('<x>')).status, 'unavailable', 'nothing odd is sent');

// The base address: USA Wrestling by default; a stand-in only over https or on this machine.
env.USAW_LOOKUP_BASE = ''; assert.equal(lookup.lookupBase().toString(), 'https://www.usawmembership.com/');
env.USAW_LOOKUP_BASE = 'http://usaw.example.com'; assert.equal(lookup.lookupBase(), null, 'plain http elsewhere is refused');
env.USAW_LOOKUP_BASE = 'not a url'; assert.equal(lookup.lookupBase(), null);
{
  let calls = 0; net.fetch = async () => { calls++; throw Error('should not be called'); };
  env.USAW_LOOKUP_BASE = 'http://usaw.example.com';
  assert.equal((await lookup.lookUpCard('1234567890')).status, 'unavailable'); assert.equal(calls, 0, 'no request to a refused address');
  net.fetch = (...a) => fetch(...a);
}

// Fake network answers: every failure is "unavailable".
async function withFetch(answer, fn) {
  const calls = [];
  net.fetch = async (url, init) => { calls.push({url: String(url), init}); return answer(String(url), init, calls.length); };
  try { await fn(calls); } finally { net.fetch = (...a) => fetch(...a); }
}
env.USAW_LOOKUP_BASE = 'https://usaw.test';
const pageRes = (extra = {}) => new Response(verifyPage(extra.uri), {status: 200, headers: {'set-cookie': 'sess=abc; Path=/'}});
const updateRes = html => Response.json({components: [{snapshot: 'x', effects: {html}}]});
await withFetch((u, i, n) => n === 1 ? pageRes() : updateRes(active), async calls => {
  assert.equal((await lookup.lookUpCard('1234567890')).status, 'active');
  assert.equal(calls[0].url, 'https://usaw.test/verify_membership'); assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[1].url, 'https://usaw.test/livewire-stub/update', 'the update address comes from the page');
  assert.equal(calls[1].init.headers.Cookie, 'sess=abc', 'session cookies go back'); assert.equal(calls[1].init.headers['X-Livewire'], '1');
  assert.equal(calls[1].init.headers['X-CSRF-TOKEN'], CSRF); assert.ok(calls[1].init.signal, 'the request can time out');
});
await withFetch(() => new Response('busy', {status: 503}), async () => assert.equal((await lookup.lookUpCard('1234567890')).status, 'unavailable', 'page down'));
await withFetch(() => { throw new TypeError('network'); }, async () => assert.equal((await lookup.lookUpCard('1234567890')).status, 'unavailable', 'network error'));
await withFetch((u, i, n) => n === 1 ? pageRes() : new Response('<html>', {status: 200}), async () => assert.equal((await lookup.lookUpCard('1234567890')).status, 'unavailable', 'not JSON'));
await withFetch((u, i, n) => n === 1 ? pageRes() : Response.json({components: []}), async () => assert.equal((await lookup.lookUpCard('1234567890')).status, 'unavailable', 'no component'));
await withFetch((u, i, n) => n === 1 ? pageRes() : new Response('', {status: 419}), async () => assert.equal((await lookup.lookUpCard('1234567890')).status, 'unavailable', 'page expired'));
await withFetch(() => new Response('<html>no form</html>', {status: 200}), async () => assert.equal((await lookup.lookUpCard('1234567890')).status, 'unavailable', 'page changed'));
await withFetch((u, i, n) => n === 1 ? new Response(verifyPage('https://elsewhere.test/update')) : updateRes(active), async calls => {
  assert.equal((await lookup.lookUpCard('1234567890')).status, 'unavailable', 'an update address on another site'); assert.equal(calls.length, 1);
});
await withFetch((u, i, n) => n === 1 ? new Response(null, {status: 302, headers: {location: 'https://elsewhere.test/'}}) : pageRes(), async calls => {
  assert.equal((await lookup.lookUpCard('1234567890')).status, 'unavailable', 'a redirect to another site'); assert.equal(calls.length, 1);
});
await withFetch((u, i, n) => n === 1 ? new Response(null, {status: 302, headers: {location: '/verify_membership/', 'set-cookie': 'first=1'}}) : n === 2 ? pageRes() : updateRes(active), async calls => {
  assert.equal((await lookup.lookUpCard('1234567890')).status, 'active', 'a redirect on the same site is followed');
  assert.match(calls[2].init.headers.Cookie, /first=1/); assert.match(calls[2].init.headers.Cookie, /sess=abc/);
});
// Time out after about 8 seconds: the signal comes from AbortSignal.timeout(8000).
{
  let ms = 0; const ctrl = new AbortController();
  net.AbortSignal = {timeout: t => { ms = t; return ctrl.signal; }};
  await withFetch((u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')))), async () => {
    const pending = lookup.lookUpCard('1234567890'); setTimeout(() => ctrl.abort(), 5);
    assert.equal((await pending).status, 'unavailable', 'a slow answer is unavailable');
  });
  assert.equal(ms, 8000); net.AbortSignal = AbortSignal;
}
env.USAW_LOOKUP_BASE = BASE;

// ---------- Outcomes ----------
{
  const season = '2027-08-31', o = (r, name = 'Sam Example', exp = season) => check.outcomeFor(r, name, exp, season);
  assert.equal(o({status: 'active', name: 'Sam Example'}), 'verified');
  assert.equal(o({status: 'active', name: 'Pat Other'}), 'mismatch', 'an active card in someone else\'s name never verifies');
  assert.equal(o({status: 'inactive', name: 'Sam Example'}), 'inactive');
  assert.equal(o({status: 'inactive', name: 'Pat Other'}), 'mismatch');
  assert.equal(o({status: 'active', name: 'Sam Example'}, 'Sam Example', '2026-08-31'), 'season', 'active only proves the current season');
  assert.equal(o({status: 'active'}), 'mismatch', 'no name, no verification');
  assert.equal(o({status: 'not_found'}), 'not_found'); assert.equal(o({status: 'unavailable'}), 'unavailable');
}

// ---------- The flow: family save, "Check my card", the owner's check ----------
const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const SEASON = usaw.cardSeason(today).end;
const O = 'https://a.test';
const req = (method, body, origin = O) => new Request(O + '/x', method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin}, body: JSON.stringify(body)});
const call = async (route, method, body, origin) => { const r = await route[method](req(method, body, origin)); return {status: r.status, body: await r.json()}; };
const family = (id, wrestlers) => sqlite.prepare('INSERT OR REPLACE INTO family_accounts VALUES (?,?,?,?,?)').run(id, id + '@example.test', JSON.stringify({parentName: 'Pat', phone: '', wrestlers}), 1, 'x');
// A complete profile: contact and safety details are required to save (issue #188).
const details = {homeAddress: '1 Main St', homeCity: 'Huntington', homeState: 'NY', homeZip: '11746', emergencyContactName: 'Jordan Parent', emergencyContactPhone: '631-555-0100'};
const save = async (wrestlers) => { const rev = (await call(familyApi, 'GET')).body.revision; return call(familyApi, 'PUT', {revision: rev, data: {parentName: 'Pat Example', phone: '555', ...details, wrestlers: wrestlers.map(w => ({birthDate: '2012-04-18', allergies: 'None', ...w}))}}); };
const reviewRow = (u, w) => sqlite.prepare('SELECT * FROM usaw_reviews WHERE user_id=? AND wrestler_id=?').get(u, w);
const lookupsSent = () => stub.seen.length;
const sam = (number, expires = SEASON, name = 'Sam Example') => ({id: 'w1', name, grade: '8', usawNumber: number, usawExpires: expires});

// A family registers with an active card in Sam's name: verified automatically, no owner needed.
actor = {owner: false, id: 'p1'};
let before = lookupsSent();
let r = await save([sam('1234567890')]);
assert.equal(r.status, 200); assert.deepEqual(r.body.lookups, {w1: 'verified'});
assert.equal(lookupsSent(), before + 1);
let fam = (await call(familyApi, 'GET')).body.cards.w1;
assert.equal(fam.state, 'verified'); assert.equal(fam.verifiedBy, 'usaw-lookup'); assert.equal(fam.lookup.outcome, 'verified');
assert.equal(JSON.stringify(fam).includes('NY'), false, 'the family is not sent what USA Wrestling showed');
{
  const row = reviewRow('p1', 'w1');
  assert.equal(row.status, 'valid'); assert.equal(row.reviewed_by, 'usaw-lookup'); assert.equal(row.number, '1234567890'); assert.equal(row.expires, SEASON);
  const l = sqlite.prepare('SELECT * FROM usaw_lookups').all();
  assert.equal(l.length, 1); assert.deepEqual(Object.keys(l[0]).sort(), ['card_name', 'card_state', 'checked_at', 'expires', 'number', 'outcome', 'season', 'status', 'user_id', 'wrestler_id']);
  assert.equal(l[0].card_name, 'Sam Example'); assert.equal(l[0].card_state, 'NY'); assert.equal(l[0].season, SEASON);
  assert.ok(!Object.values(l[0]).some(v => /<|table|wire:/i.test(String(v))), 'none of their page is stored');
  const ev = sqlite.prepare("SELECT * FROM security_events WHERE action='usaw_card_lookup_verified'").all();
  assert.equal(ev.length, 1); assert.equal(ev[0].actor, 'p1'); assert.equal(ev[0].target, 'p1/w1');
}
r = await call(checkApi, 'POST', {wrestlerId: 'w1'}); assert.equal(r.status, 409); assert.match(r.body.error, /already verified/);
// Saving again without changing the card does not look it up again.
before = lookupsSent(); r = await save([sam('1234567890')]);
assert.deepEqual(r.body.lookups, {}); assert.equal(lookupsSent(), before);
// It counts exactly like the owner's "Verified" on the owner's page, and says where it came from.
actor = {owner: true, id: 'owner-id'};
let cards = (await call(cardsApi, 'GET')).body.cards;
assert.equal(cards[0].state, 'verified'); assert.equal(cards[0].verifiedBy, 'usaw-lookup'); assert.equal(cards[0].lookup.name, 'Sam Example');
// The owner can still override: "Not valid" wins and is logged as before.
r = await call(cardsApi, 'POST', {userId: 'p1', wrestlerId: 'w1', status: 'invalid', number: '1234567890', expires: SEASON, note: 'Wrong wrestler'});
assert.equal(r.status, 200);
cards = (await call(cardsApi, 'GET')).body.cards; assert.equal(cards[0].state, 'invalid'); assert.equal(cards[0].verifiedBy, 'owner');
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM security_events WHERE action='usaw_card_invalid'").get().n, 1);
// After a rejection, the family's own check waits for the owner (issue #97) ...
actor = {owner: false, id: 'p1'};
r = await call(checkApi, 'POST', {wrestlerId: 'w1'}); assert.equal(r.status, 409); assert.match(r.body.error, /academy will check/);
// ... and the owner's own check can verify it again.
actor = {owner: true, id: 'owner-id'};
r = await call(cardsApi, 'POST', {userId: 'p1', wrestlerId: 'w1', status: 'lookup', number: '1234567890', expires: SEASON});
assert.equal(r.status, 200); assert.equal(r.body.outcome, 'verified'); assert.equal(r.body.cached, true, 'from the cache: no second lookup within a day');
assert.equal(reviewRow('p1', 'w1').reviewed_by, 'usaw-lookup');
assert.equal(sqlite.prepare("SELECT actor FROM security_events WHERE action='usaw_card_lookup_verified' ORDER BY rowid DESC").get().actor, 'owner-id');
// Stale page and families are refused.
assert.equal((await call(cardsApi, 'POST', {userId: 'p1', wrestlerId: 'w1', status: 'lookup', number: 'OLD', expires: SEASON})).status, 409);
actor = {owner: false, id: 'p1'};
assert.equal((await call(cardsApi, 'POST', {userId: 'p1', wrestlerId: 'w1', status: 'lookup', number: '1234567890', expires: SEASON})).status, 403);

// Changing the number resets the verification, like an owner review.
r = await save([sam('2222222222')]);
assert.deepEqual(r.body.lookups, {w1: 'inactive'});
fam = (await call(familyApi, 'GET')).body.cards.w1;
assert.equal(fam.state, 'current', 'an inactive card is never verified, and booking rules do not change'); assert.equal(fam.lookup.outcome, 'inactive'); assert.equal(fam.verifiedBy, null);
assert.equal(reviewRow('p1', 'w1').number, '1234567890', 'the old verification no longer applies to the new number');
// "Check my card" on the inactive card: the cached answer, no new request.
before = lookupsSent();
r = await call(checkApi, 'POST', {wrestlerId: 'w1'});
assert.equal(r.status, 200); assert.equal(r.body.outcome, 'inactive'); assert.equal(r.body.card.state, 'current'); assert.equal(lookupsSent(), before);

// A number in someone else's name: never verified, and the family does not see whose it is.
family('p2', []); actor = {owner: false, id: 'p2'};
r = await save([{id: 'k1', name: 'Pat Other', grade: '9', usawNumber: '1234567890', usawExpires: SEASON}]);
assert.deepEqual(r.body.lookups, {k1: 'mismatch'});
fam = (await call(familyApi, 'GET')).body.cards.k1;
assert.equal(fam.state, 'current'); assert.equal(fam.lookup.outcome, 'mismatch'); assert.ok(!JSON.stringify(fam).includes('Sam'), 'never shows the other name');
assert.equal(reviewRow('p2', 'k1'), undefined);
// A card entered for another season or with a special date: active on USA Wrestling proves only this season, so it
// waits for the owner. The same number and season come from the cache, for any family.
{
  family('p7', []); actor = {owner: false, id: 'p7'};
  const nextSeason = usaw.cardSeason(today).end.replace(/^\d{4}/, y => String(Number(y) + 1));
  before = lookupsSent();
  r = await save([{id: 'q1', name: 'Sam Example', grade: '8', usawNumber: '1234567890', usawExpires: nextSeason}]);
  assert.deepEqual(r.body.lookups, {q1: 'season'}); assert.equal(lookupsSent(), before, 'answered from the cache');
  fam = (await call(familyApi, 'GET')).body.cards.q1; assert.equal(fam.state, 'current'); assert.equal(fam.lookup.outcome, 'season');
  assert.equal(reviewRow('p7', 'q1'), undefined);
  actor = {owner: false, id: 'p2'};
}
// Data export: the name on someone else's card is left out.
{
  const exp = load(path.resolve('lib/data-requests.ts'));
  const mine = await exp.familyExport('p2');
  assert.equal(mine.usaWrestlingCardChecks.length, 1); assert.equal(mine.usaWrestlingCardChecks[0].outcome, 'mismatch'); assert.equal(mine.usaWrestlingCardChecks[0].card_name, null);
}

// Not found: tell the family to check the number.
r = await save([{id: 'k1', name: 'Pat Other', grade: '9', usawNumber: '5555555555', usawExpires: SEASON}]);
assert.deepEqual(r.body.lookups, {k1: 'not_found'});
// No card, or an expired card: nothing is looked up.
before = lookupsSent();
r = await save([{id: 'k1', name: 'Pat Other', grade: '9', usawNumber: '7777777777', usawExpires: '2020-08-31'}, {id: 'k2', name: 'No Card', grade: 'K'}]);
assert.deepEqual(r.body.lookups, {}); assert.equal(lookupsSent(), before);
r = await call(checkApi, 'POST', {wrestlerId: 'k2'}); assert.equal(r.status, 409);
r = await call(checkApi, 'POST', {wrestlerId: 'w1'}); assert.equal(r.status, 404, 'another family\'s wrestler');
r = await call(checkApi, 'POST', {wrestlerId: 'k1'}, 'https://evil.test'); assert.equal(r.status, 403, 'other sites cannot trigger checks');

// USA Wrestling unavailable: nothing alarming, nothing verified, not cached.
{
  family('p3', []); actor = {owner: false, id: 'p3'};
  env.USAW_LOOKUP_BASE = 'http://127.0.0.1:9';   // nothing listens here
  r = await save([{id: 'm1', name: 'Sam Example', grade: '8', usawNumber: '8888888888', usawExpires: SEASON}]);
  assert.equal(r.status, 200, 'the save never fails because of USA Wrestling'); assert.deepEqual(r.body.lookups, {m1: 'unavailable'});
  fam = (await call(familyApi, 'GET')).body.cards.m1; assert.equal(fam.state, 'current'); assert.equal(fam.lookup.outcome, 'unavailable');
  env.USAW_LOOKUP_BASE = BASE;
  r = await call(checkApi, 'POST', {wrestlerId: 'm1'});
  assert.equal(r.body.outcome, 'not_found', '"unavailable" is not cached, so the next check asks again');
}

// Cache: one real lookup per card number and season per day.
{
  family('p4', []); actor = {owner: false, id: 'p4'};
  before = lookupsSent();
  await save([{id: 'n1', name: 'Sam Example', grade: '8', usawNumber: '2222222222', usawExpires: SEASON}]);
  assert.equal(lookupsSent(), before, '2222222222 was checked for another family today');
  sqlite.prepare("UPDATE usaw_lookups SET checked_at=? WHERE number='2222222222'").run(new Date(Date.now() - 25 * 3600e3).toISOString());
  r = await call(checkApi, 'POST', {wrestlerId: 'n1'});
  assert.equal(r.body.outcome, 'inactive'); assert.equal(lookupsSent(), before + 1, 'after a day it is checked again');
}

// Rate limit: a few real lookups per family per hour.
{
  family('p5', []); actor = {owner: false, id: 'p5'};
  sqlite.prepare('DELETE FROM auth_attempts').run();
  const outcomes = [];
  for (let i = 0; i < 7; i++) { r = await save([{id: 'r1', name: 'Rae Example', grade: '8', usawNumber: '60000000' + (10 + i), usawExpires: SEASON}]); outcomes.push(r.body.lookups.r1); }
  assert.deepEqual(outcomes, ['not_found', 'not_found', 'not_found', 'not_found', 'not_found', 'limited', 'limited']);
  r = await call(checkApi, 'POST', {wrestlerId: 'r1'}); assert.equal(r.status, 429); assert.match(r.body.error, /Try again later/);
  // Another family is not affected.
  family('p6', []); actor = {owner: false, id: 'p6'};
  r = await save([{id: 's1', name: 'Sam Example', grade: '8', usawNumber: '1234567890', usawExpires: SEASON}]);
  assert.deepEqual(r.body.lookups, {s1: 'verified'});
  const hourRows = sqlite.prepare('SELECT bucket FROM auth_attempts').all().map(x => x.bucket);
  assert.ok(hourRows.every(b => b % 60 === 0), 'hourly counters start on the hour');
}

// An automatic verification is taken back when the owner's later check finds the card no longer active; the owner's
// own "Verified" is never taken back by a lookup.
{
  sqlite.prepare("UPDATE usaw_lookups SET checked_at='2000-01-01T00:00:00Z'").run();
  sqlite.prepare("UPDATE family_accounts SET payload=? WHERE user_id='p6'").run(JSON.stringify({parentName: 'Pat', phone: '', wrestlers: [{id: 's1', name: 'Sam Example', grade: '8', usawNumber: '2222222222', usawExpires: SEASON}]}));
  sqlite.prepare("UPDATE usaw_reviews SET number='2222222222' WHERE user_id='p6'").run();
  actor = {owner: true, id: 'owner-id'};
  assert.equal((await call(cardsApi, 'GET')).body.cards.find(c => c.userId === 'p6').state, 'verified');
  r = await call(cardsApi, 'POST', {userId: 'p6', wrestlerId: 's1', status: 'lookup', number: '2222222222', expires: SEASON});
  assert.equal(r.body.outcome, 'inactive');
  let c = (await call(cardsApi, 'GET')).body.cards.find(c => c.userId === 'p6');
  assert.equal(c.state, 'current'); assert.equal(c.lookup.outcome, 'inactive');
  r = await call(cardsApi, 'POST', {userId: 'p6', wrestlerId: 's1', status: 'valid', number: '2222222222', expires: SEASON});
  assert.equal(r.status, 200, 'the owner can verify it anyway');
  sqlite.prepare("UPDATE usaw_lookups SET checked_at='2000-01-01T00:00:00Z'").run();
  r = await call(cardsApi, 'POST', {userId: 'p6', wrestlerId: 's1', status: 'lookup', number: '2222222222', expires: SEASON});
  c = (await call(cardsApi, 'GET')).body.cards.find(c => c.userId === 'p6');
  assert.equal(c.state, 'verified'); assert.equal(c.verifiedBy, 'owner', 'the owner\'s decision stands');
}

// Nothing in any request to USA Wrestling but the card number.
for (const s of stub.seen) {
  const text = JSON.stringify(s.body);
  assert.ok(!/example\.test|Pat|Rae|Sam/.test(text), 'no family details are sent: ' + text.slice(0, 80));
}
stub.close();

// ---------- Pages ----------
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const json = (body, ok = true, status = ok ? 200 : 400) => ({ok, status, json: async () => body});
function page(file, {fetch, hidden = []}) {
  const nodes = new Map();
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: hidden.includes(id), checked: false, disabled: false, innerHTML: '', textContent: '', className: '', style: {}, dataset: {},
      elements: {parentName: {value: '', focus() {}}, phone: {value: ''}}, focus() {}, scrollIntoView() {}, setAttribute() {}, querySelector() { return null; }, classList: {add() {}, remove() {}, toggle() {}}});
    return nodes.get(id);
  };
  const ctx = vm.createContext({Intl, Date, JSON, URLSearchParams, Promise, setTimeout: f => setImmediate(f), structuredClone, console, crypto: {randomUUID: () => 'new-id'},
    location: {search: '', href: '', assign() {}}, confirm: () => true, navigator: {}, window: {},
    document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => ({})}, fetch});
  vm.runInContext(readFileSync(file, 'utf8').match(/<script>([\s\S]*)<\/script>/)[1], ctx);
  return {el, ctx};
}

// Family page: what each result says, and "Check my card".
{
  const wrestlers = [sam('1234567890'), {id: 'w2', name: 'Lee Example', grade: '6', usawNumber: '2222222222', usawExpires: '2099-08-31'},
    {id: 'w3', name: 'Kai Example', grade: '5', usawNumber: '5555555555', usawExpires: '2099-08-31'}, {id: 'w4', name: 'Ash Example', grade: '4', usawNumber: '6666666666', usawExpires: '2099-08-31'},
    {id: 'w5', name: 'Bo Example', grade: '3', usawNumber: '7777777777', usawExpires: '2099-08-31'}];
  const base = (n, e) => ({number: n, expires: e, note: '', exceptionUntil: null, verifiedBy: null, verifiedAt: null});
  const cardsIn = {w1: {...base('1234567890', SEASON), state: 'verified', verifiedBy: 'usaw-lookup', verifiedAt: '2026-11-07T00:30:00Z', lookup: {outcome: 'verified', checkedAt: '2026-11-07T00:30:00Z'}},
    w2: {...base('2222222222', '2099-08-31'), state: 'current', lookup: {outcome: 'inactive', checkedAt: 'x'}},
    w3: {...base('5555555555', '2099-08-31'), state: 'current', lookup: {outcome: 'not_found', checkedAt: 'x'}},
    w4: {...base('6666666666', '2099-08-31'), state: 'current', lookup: {outcome: 'mismatch', checkedAt: 'x'}},
    w5: {...base('7777777777', '2099-08-31'), state: 'current', lookup: {outcome: 'unavailable', checkedAt: 'x'}}};
  const posted = [];
  const {el, ctx} = page('app/family/screen.html', {hidden: ['editor'], fetch: async (url, init) => {
    if (url === '/api/family') return json({email: 'pat@example.test', data: {parentName: 'Pat', phone: '1', wrestlers: structuredClone(wrestlers)}, revision: 1, updatedAt: '2026-11-06T12:00:00Z', cards: cardsIn, cardSeasons: []});
    if (url === '/api/usaw-check') { posted.push(JSON.parse(init.body)); return json({outcome: 'verified', card: {...base('7777777777', '2099-08-31'), state: 'verified', verifiedBy: 'usaw-lookup', verifiedAt: '2026-11-06T16:00:00Z', lookup: {outcome: 'verified'}}}); }
    return json({});
  }});
  await settle();
  const line = id => vm.runInContext(`cardLine(profile.wrestlers.find(w=>w.id==='${id}'))`, ctx);
  assert.match(line('w1'), /USA Wrestling card verified<\/span> Current through .*Checked with USA Wrestling on Nov 6, 2026\./);
  assert.doesNotMatch(line('w1'), /Check my card/, 'nothing to check on a verified card');
  assert.match(line('w2'), /USA Wrestling card not active<\/span> USA Wrestling shows this card isn’t active\. Renew it, then choose Check my card\. <a href="https:\/\/www\.usawmembership\.com" target="_blank" rel="noopener">Get or renew a card →<\/a>/);
  assert.match(line('w3'), /Check the card number<\/span> USA Wrestling has no card with this number\. Check the number on the card and save it again\./);
  assert.match(line('w4'), /The name on this USA Wrestling card doesn’t match Ash Example\. Check the number; it may belong to someone else\./);
  assert.match(line('w5'), /USA Wrestling card on file<\/span> Current through/, 'unavailable: nothing alarming');
  assert.doesNotMatch(line('w5'), /USA Wrestling (couldn|could not|has no|shows)/);
  assert.match(line('w5'), /<button type="button" class="card-check" data-wrestler="w5" onclick="checkMyCard\(this\.dataset\.wrestler\)">Check my card<\/button>/);
  assert.match(el('savedDetails').innerHTML, /Check my card/, 'the button is on the saved profile');
  await vm.runInContext("checkMyCard('w5')", ctx); await settle();
  assert.deepEqual(posted, [{wrestlerId: 'w5'}], 'only the wrestler id goes to the site');
  assert.equal(el('status').textContent, 'Bo Example’s USA Wrestling card is verified.');
  // "Get set up" does not call a card USA Wrestling flagged done.
  assert.match(el('startSteps').innerHTML, /Check the USA Wrestling card for Lee Example, Kai Example, Ash Example\./);
  assert.match(el('startSteps').innerHTML, />Check the card<\/button>/);
  assert.match(line('w5'), /USA Wrestling card verified/);
  // Messages after a save, in plain words.
  assert.equal(vm.runInContext("lookupMessage('Sam','inactive')", ctx), 'USA Wrestling shows Sam’s card isn’t active. Renew it at usawmembership.com, then choose Check my card.');
  assert.equal(vm.runInContext("lookupMessage('Sam','unavailable')", ctx), '', 'nothing alarming when USA Wrestling could not be reached');
  assert.equal(vm.runInContext("lookupMessage('Sam','skipped')", ctx), '');
}

// Owner's Cards page: how each card was verified, what USA Wrestling showed, and "Check with USA Wrestling".
{
  const row = (x) => ({userId: 'p1', email: 'p1@example.test', parentName: 'Pat', phone: '', wrestlerId: 'w1', wrestler: 'Sam Example', grade: '8', number: '1234567890', expires: SEASON, note: '', reviewedAt: null, verifiedBy: null, verifiedAt: null, lookup: null, ...x});
  const list = [row({state: 'verified', verifiedBy: 'usaw-lookup', verifiedAt: '2026-11-07T00:30:00Z', reviewedAt: '2026-11-06T15:00:00Z', lookup: {status: 'active', outcome: 'verified', name: 'Sam Example', state: 'NY', checkedAt: '2026-11-06T15:00:00Z'}}),
    row({wrestlerId: 'w2', wrestler: 'Lee', state: 'verified', verifiedBy: 'owner', verifiedAt: '2026-11-04T15:00:00Z', reviewedAt: '2026-11-04T15:00:00Z'}),
    row({wrestlerId: 'w3', wrestler: 'Kai', state: 'current', lookup: {status: 'active', outcome: 'mismatch', name: 'Someone Else', state: 'PA', checkedAt: '2026-11-06T15:00:00Z'}}),
    row({wrestlerId: 'w4', wrestler: 'Ash', state: 'current', lookup: {status: 'inactive', outcome: 'inactive', name: 'Ash Example', state: 'NY', checkedAt: '2026-11-06T15:00:00Z'}}),
    row({wrestlerId: 'w5', wrestler: 'Bo', state: 'current', lookup: {status: 'unavailable', outcome: 'unavailable', name: null, state: null, checkedAt: '2026-11-06T15:00:00Z'}}),
    row({wrestlerId: 'w6', wrestler: 'Cy', state: 'expired', expires: '2020-08-31'})];
  const posted = [], asked = [];
  const {el, ctx} = page('app/cards/screen.html', {fetch: async (url, init) => {
    if (url === '/api/exceptions') return json({exceptions: []});
    if (!init?.method) asked.push(url);
    if (init?.method === 'POST') { posted.push(JSON.parse(init.body)); return json({ok: true, outcome: 'inactive', cached: true}); }
    return json({today, date: today, cards: list, renewal: {august: false, ends: SEASON, count: 1, label: 'Cards expire Aug 31'}});
  }});
  el('show').value = 'all'; el('q').value = ''; await settle(); vm.runInContext('render()', ctx);
  const rows = el('rows').innerHTML.split('<tr>').slice(1);
  const of = name => rows.find(r => r.includes('<strong>' + name + '</strong>'));
  assert.match(of('Sam Example'), /<span class="muted source">USA Wrestling lookup · Nov 6<\/span>/, 'the academy\'s date, not UTC');
  assert.doesNotMatch(of('Sam Example'), /class="found/, 'no second line when the lookup verified it');
  assert.match(of('Lee'), /<span class="muted source">Owner · Nov 4<\/span>/);
  assert.match(of('Kai'), /<span class="found bad">USA Wrestling: name on the card is Someone Else, PA · Nov 6<\/span>/);
  assert.match(of('Ash'), /<span class="found bad">USA Wrestling: not active · Ash Example, NY · Nov 6<\/span>/);
  assert.match(of('Bo'), /<span class="found">USA Wrestling: could not be reached · Nov 6<\/span>/);
  for (const n of ['Sam Example', 'Lee', 'Kai', 'Ash', 'Bo']) assert.match(of(n), /onclick="checkUsaw\(\d+\)">Check with USA Wrestling<\/button>/, n);
  assert.doesNotMatch(of('Cy'), /Check with USA Wrestling/, 'not for an expired card');
  assert.match(of('Kai'), /Look up on USA Wrestling/, 'the manual lookup stays');
  // Flagged cards show under "Blocked or expiring soon" so the owner sees them. The server filters (issue #46): the
  // page asks for the chosen filter, and the filter keeps Kai and Ash but not Bo.
  el('show').value = 'problems'; el('show').onchange(); await settle();
  assert.match(asked.at(-1), /^\/api\/usaw-cards\?date=[\d-]+&show=problems$/);
  const problems = JSON.parse(JSON.stringify(load(path.resolve('lib/usaw.ts')).cardsPage(list, {show: 'problems', onDate: today}).cards)).map(c => c.wrestler);
  assert.deepEqual(problems, ['Cy', 'Ash', 'Kai'], 'blocked first, then by expiry and name');
  await vm.runInContext('checkUsaw(3)', ctx); await settle();
  assert.deepEqual(posted, [{userId: 'p1', wrestlerId: 'w4', number: '1234567890', expires: SEASON, status: 'lookup'}]);
  assert.equal(el('status').textContent, 'Ash: the card is not active (checked earlier today).');
}

// Help, the owner guide and the privacy policy draft say so in plain words.
assert.match(readFileSync('app/help/screen.html', 'utf8'), /checks the card number on USA Wrestling’s public membership check/);
assert.match(readFileSync('app/help/owner/screen.html', 'utf8'), /<strong>Check with USA Wrestling<\/strong>/);
assert.match(readFileSync('docs/policies/privacy-policy-draft.md', 'utf8'), /USA Wrestling's public membership verification page/);
assert.match(readFileSync('lib/security-log.ts', 'utf8'), /usaw_card_lookup_verified: 'USA Wrestling card verified by lookup'/);
console.log('USA Wrestling lookup tests passed');
