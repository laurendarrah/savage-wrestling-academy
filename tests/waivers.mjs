// Issue #69: owner-published waivers must be signed per wrestler before any booking.
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
    {module, exports: module.exports, crypto, TextEncoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test',
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, headers: new Headers()}),
          strongAccount: async () => ({user: {id: actor.id, email: actor.id + '@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}



const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0);
const all = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2,
  programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}],
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(60), weekly: all, excludedDates: []}],
  events: [{id: 'camp', name: 'Camp', type: 'Camp', dates: [ny(10)], price: 160}],
  extraPractices: [{id: 'fnl', name: 'Friday Night Live', dates: [ny(3)], enabled: true, start: '17:00', end: '18:00', memberCents: 1000, nonMemberCents: 2000}]}));
const card = {usawNumber: 'AB1234', usawExpires: '2099-12-31'};
for (const u of ['p1', 'p2']) sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test',
  JSON.stringify({parentName: 'Parent ' + u, phone: '', wrestlers: [{id: 'w-' + u, name: 'Wrestler ' + u, grade: '8', ...card}]}), 1, 'x');

const quotes = load(path.resolve('lib/quotes.ts'));
const waivers = load(path.resolve('lib/waivers.ts'));
const familyApi = load(path.resolve('app/api/waiver/route.ts'));
const ownerApi = load(path.resolve('app/api/waivers/route.ts'));
const payments = load(path.resolve('app/api/payments/route.ts'));
const roster = load(path.resolve('lib/roster.ts'));
const O = 'https://a.test';
const call = async (route, method, body, origin = O) => { const r = await route[method](new Request(O + '/x', method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const as = id => { actor = id === 'owner' ? {owner: true, id: 'owner-id'} : {owner: false, id}; };
const walkin = (u = 'p1') => quotes.quoteMembership(u, {wrestlerId: 'w-' + u, program: 'Intermediate', plan: 'walkin', date: ny(1), practiceId: `Intermediate:${ny(1)}:18:00`});
const everything = async u => [await walkin(u), await quotes.quoteMembership(u, {wrestlerId: 'w-' + u, program: 'Intermediate', plan: 'monthly'}),
  await quotes.quoteBooking(u, {type: 'live', wrestlerId: 'w-' + u, id: 'fnl', date: ny(3)}), await quotes.quoteBooking(u, {type: 'event', wrestlerId: 'w-' + u, id: 'camp'}),
  await quotes.quoteBooking(u, {type: 'lesson', wrestlerId: 'w-' + u, format: 'one-on-one'})];
const TEXT = 'I understand that wrestling is a contact sport with a risk of injury. '.repeat(5);
const strokes = [[[0.1, 0.5], [0.3, 0.4], [0.5, 0.6]]];
let current = null;
const sign = (extra = {}) => call(familyApi, 'POST', {versionId: current, wrestlerId: 'w-p1', signer: 'Parent p1', accepted: true, electronicConsent: true, signature: {method: 'drawn', strokes}, ...extra});

// --- No waiver published: nothing is required ---
for (const q of await everything('p1')) assert.equal(q.ok, true, 'no waiver, no block: ' + q.error);
as('p1'); assert.equal((await call(familyApi, 'GET')).body.waiver, null);
assert.equal((await sign({versionId: 'x'})).status, 409, 'nothing to sign');

// --- Owner publishes ---
as('p1'); assert.equal((await call(ownerApi, 'POST', {action: 'publish', title: 'Waiver', body: TEXT})).status, 403, 'families cannot publish');
as('owner');
assert.equal((await call(ownerApi, 'POST', {action: 'publish', title: 'Waiver', body: TEXT}, 'https://evil.test')).status, 403);
assert.equal((await call(ownerApi, 'POST', {action: 'publish', title: 'Waiver', body: 'too short'})).status, 400);
assert.equal((await call(ownerApi, 'POST', {action: 'publish', title: '2026 Participation waiver', body: TEXT})).status, 200);
assert.equal((await call(ownerApi, 'POST', {action: 'publish', title: '2026 Participation waiver', body: TEXT})).status, 409, 'same text twice');
current = (await call(ownerApi, 'GET')).body.current.id;

// --- Every purchase type now needs the signature, offline payments too ---
for (const q of await everything('p1')) { assert.equal(q.ok, false); assert.equal(q.status, 403); assert.equal(q.extra.waiverRequired, true); assert.match(q.error, /Wrestler p1 needs a signed 2026 Participation waiver before booking/); }
as('owner');
let r = await call(payments, 'POST', {action: 'record', userId: 'p1', wrestlerId: 'w-p1', kind: 'walkin', program: 'Intermediate', date: today, practiceId: `Intermediate:${today}:18:00`, method: 'cash'});
assert.equal(r.status, 403); assert.match(r.body.error, /needs a signed/);

// --- Family signs ---
as('p1');
r = await call(familyApi, 'GET'); assert.equal(r.body.waiver.id, current); assert.equal(r.body.waiver.body, TEXT.trim()); assert.deepEqual(r.body.signatures, []);
assert.equal((await sign({versionId: 'old'})).status, 409, 'must sign the version in force');
assert.equal((await sign({wrestlerId: 'w-p2'})).status, 404, 'cannot sign for another family');
assert.equal((await sign({accepted: false})).status, 400);
assert.equal((await sign({electronicConsent: false})).status, 400);
assert.equal((await sign({signer: 'x'})).status, 400);
assert.equal((await sign({signature: {method: 'typed'}})).status, 400, 'drawn signature required');
assert.equal((await sign({signature: {method: 'drawn', strokes: [[[0.5, 0.5], [0.5, 0.5]]]}})).status, 400, 'a dot is not a signature');
r = await sign(); assert.equal(r.status, 200); const sigId = r.body.id;
assert.equal((await sign()).status, 409, 'once per wrestler per version');
for (const q of await everything('p1')) assert.equal(q.ok, true, 'signed: ' + q.error);
assert.equal((await walkin('p2')).ok, false, 'the other family still needs to sign');
r = await call(familyApi, 'GET'); assert.equal(r.body.signatures.length, 1); assert.equal(r.body.signatures[0].current, true);

// --- Signed copies: owner and the signing family only, and tamper-evident ---
let copy = await waivers.signedCopy(sigId, {userId: 'p1', owner: false});
assert.equal(copy.signature.wrestler_name, 'Wrestler p1'); assert.equal(copy.record.accountEmail, 'p1@example.test');
assert.equal(await waivers.signedCopy(sigId, {userId: 'p2', owner: false}), null);
assert.ok((await waivers.signedCopy(sigId, {userId: 'owner-id', owner: true})).signature);
const html = waivers.waiverCopyHtml(copy, 'n1'); assert.match(html, /<polyline/); assert.match(html, /Wrestler p1/); assert.match(html, /nonce="n1"/);
assert.ok(!waivers.waiverCopyHtml({...copy, signature: {...copy.signature, signer: '<script>'}}, 'n').includes('<script>alert'), 'escaped');
sqlite.prepare('UPDATE waiver_versions SET body=body||? WHERE id=?').run(' edited', current);
assert.match((await waivers.signedCopy(sigId, {userId: 'p1', owner: false})).error, /needs review/, 'edited text is detected');
sqlite.prepare('UPDATE waiver_versions SET body=substr(body,1,length(body)-7) WHERE id=?').run(current);
assert.ok((await waivers.signedCopy(sigId, {userId: 'p1', owner: false})).signature);

// --- Owner view and roster ---
as('owner');
r = (await call(ownerApi, 'GET')).body;
assert.equal(r.wrestlers.length, 2); assert.equal(r.wrestlers.find(w => w.wrestlerId === 'w-p1').signed, true); assert.equal(r.wrestlers.find(w => w.wrestlerId === 'w-p2').signed, false);
assert.equal(r.versions[0].signed, 1);
assert.equal((await call(payments, 'POST', {action: 'record', userId: 'p1', wrestlerId: 'w-p1', kind: 'walkin', program: 'Intermediate', date: today, practiceId: `Intermediate:${today}:18:00`, method: 'cash'})).status, 200);
let entry = (await roster.rosterFor(today, {role: 'owner'})).find(s => s.key.startsWith('practice:Intermediate:')).entries[0];
assert.equal(entry.waiverSigned, true);

// --- A new version needs new signatures; old copies are kept ---
assert.equal((await call(ownerApi, 'POST', {action: 'publish', title: '2027 Participation waiver', body: TEXT + ' Updated.'})).status, 200);
assert.match((await walkin('p1')).error, /2027 Participation waiver/);
entry = (await roster.rosterFor(today, {role: 'owner'})).find(s => s.key.startsWith('practice:Intermediate:')).entries[0];
assert.equal(entry.waiverSigned, false, 'roster flags the member who has not signed the new version');
as('p1'); r = await call(familyApi, 'GET'); assert.equal(r.body.signatures[0].current, false);
current = r.body.waiver.id; assert.equal((await sign()).status, 200);
assert.equal((await walkin('p1')).ok, true);

// --- Retiring stops the requirement ---
as('owner');
assert.equal((await call(ownerApi, 'POST', {action: 'retire'})).status, 200);
assert.equal((await call(ownerApi, 'POST', {action: 'retire'})).status, 409);
assert.equal((await walkin('p2')).ok, true, 'nothing required after retiring');
assert.equal((await call(ownerApi, 'GET')).body.current, null);
assert.deepEqual(sqlite.prepare("SELECT action FROM security_events WHERE action LIKE 'waiver%' ORDER BY rowid").all().map(x => x.action),
  ['waiver_published', 'waiver_signed', 'waiver_published', 'waiver_signed', 'waiver_retired']);

// --- Family page helper (inline JavaScript is not typechecked) ---
{
  const page = readFileSync('app/family/screen.html', 'utf8'), script = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));
  const fn = script.slice(script.indexOf('function waiverLine'), script.indexOf('async function refreshCards'));
  const ctx = {}; vm.runInNewContext('var waiverInfo=null;' + fn + ';this.line=waiverLine;this.set=v=>{waiverInfo=v}', ctx);
  assert.equal(ctx.line({id: 'a'}), '', 'nothing shown when no waiver is required');
  ctx.set({waiver: {id: 'v2'}, signatures: [{id: 's1', wrestlerId: 'a', current: false}]});
  assert.match(ctx.line({id: 'a'}), /Waiver not signed.*\/waiver\?wrestler=a/, 'an old version does not count');
  ctx.set({waiver: {id: 'v2'}, signatures: [{id: 's2', wrestlerId: 'a', current: true}]});
  assert.match(ctx.line({id: 'a'}), /Waiver signed.*waiver-copy\?id=s2/);
}
console.log('Waiver tests passed');
