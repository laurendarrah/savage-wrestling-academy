// Issue #210 (decision Q11 in #197): a wrestler whose USA Wrestling card is missing, expired, not valid or not yet
// verified can't be checked in, by hand or by pass. The owner's card exception (issue #89) lets them in on the dates it
// covers, the same way it lets them book. Booking keeps its own card rules (tests/usaw-cards.mjs).
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }, async run() { return {meta: sqlite.prepare(sql).run(...a)}; },
  _execute() { const st = sqlite.prepare(sql); return st.columns().length ? {results: st.all(...a)} : {results: [], meta: st.run(...a)}; }}; },
  async batch(list) { sqlite.exec('BEGIN'); try { const r = list.map(x => x._execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }};

let actor = {kind: 'owner'};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, btoa, Intl, Date, URL, Response, Request, Headers, JSON, Map, Set, Object, Array, String, Number, Math, Uint8Array, TextEncoder, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env: {DB}};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test',
          ownerIdentity: async () => ({owner: actor.kind === 'owner' ? {userId: 'owner-id'} : null, headers: new Headers()}),
          strongAccount: async () => ({user: {id: actor.id ?? 'someone', email: 'x@example.test', email_confirmed_at: 'yes'}, strong: true, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin,
          accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/access-control')) return {accountRole: async () => actor.kind === 'coach' ? {role: 'coach', staff: {email: 'coach@example.test', name: 'Coach', programs: ['Intermediate']}} : {role: 'family', staff: null}};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}

const ny = n => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0), longDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'});
const all = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
sqlite.prepare('INSERT INTO academy_state VALUES (?,?,?,?,?)').run('academy', JSON.stringify({programNamingVersion: 2,
  programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000}],
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(60), weekly: all, excludedDates: []}],
  events: [{id: 'camp', name: 'Takedown Camp', type: 'Camp', dates: [today], price: 160}]}), 1, 'owner', today);

// One family, one wrestler per card situation, each a member of SWA Intermediate.
const wrestlers = [
  {id: 'ok', name: 'Vera Verified', grade: '8', usawNumber: 'AB1001', usawExpires: '2099-08-31'},
  {id: 'none', name: 'Nico Nocard', grade: '8'},
  {id: 'old', name: 'Eli Expired', grade: '8', usawNumber: 'AB1002', usawExpires: ny(-3)},
  {id: 'lapse', name: 'Lou Lapsed', grade: '8', usawNumber: 'AB1003', usawExpires: ny(-1)},
  {id: 'bad', name: 'Ira Invalid', grade: '8', usawNumber: 'AB1004', usawExpires: '2099-08-31'},
  {id: 'redo', name: 'Rae Recheck', grade: '8', usawNumber: 'AB1005', usawExpires: '2099-08-31'},
  {id: 'new', name: 'Ned Unverified', grade: '8', usawNumber: 'AB1006', usawExpires: '2099-08-31'}
];
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('p1', 'p1@example.test', JSON.stringify({parentName: 'Pat', phone: '555', wrestlers}), 1, today);
const review = (w, number, expires, status, note = '') => sqlite.prepare("INSERT OR REPLACE INTO usaw_reviews(user_id,wrestler_id,number,expires,status,note,reviewed_by,reviewed_at) VALUES ('p1',?,?,?,?,?,'owner-id','x')").run(w, number, expires, status, note);
review('ok', 'AB1001', '2099-08-31', 'valid');
review('lapse', 'AB1003', ny(-1), 'valid');                       // verified once, but expired before today
review('bad', 'AB1004', '2099-08-31', 'invalid', 'number not found');
review('redo', 'AB0000', '2099-08-31', 'invalid', 'wrong number'); // rejected, then the family changed the number
let n = 0;
for (const w of wrestlers) {
  sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end)
    VALUES (?,'p1','x',?,?,'monthly','Intermediate','Intermediate','label','[]',20000,0,20000,'usd','{}','{}','paid',?,0,?,?,?,?,?)`).run('m' + ++n, w.id, w.name, 'k' + n, today, today, today, ny(-10), ny(20));
  sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at)
    VALUES (?,'p1','x',?,?,'event',NULL,'camp','Camp',?,16000,0,16000,'usd','{}','{}','paid',?,0,?,?)`).run('e' + n, w.id, w.name, JSON.stringify([today]), 'ke' + n, today, today);
}

const roster = load(path.resolve('lib/roster.ts'));
const api = load(path.resolve('app/api/roster/route.ts'));
const exceptionsApi = load(path.resolve('app/api/exceptions/route.ts'));
const passes = load(path.resolve('lib/passes.ts'));
const ORIGIN = 'https://savage.test';
const post = async (route, b) => { const r = await route.POST(new Request(ORIGIN + '/x', {method: 'POST', headers: {'content-type': 'application/json', origin: ORIGIN}, body: JSON.stringify(b)})); return {status: r.status, body: await r.json()}; };
const owner = {role: 'owner'}, coach = {role: 'coach', programs: ['Intermediate']};
const practiceOf = async (scope = owner) => (await roster.rosterFor(today, scope)).find(s => s.key.startsWith('practice:Intermediate:'));
const entryOf = async (id, scope = owner) => (await practiceOf(scope)).entries.find(e => e.wrestlerId === id);
const checkin = async (id, as = {kind: 'owner'}) => { actor = as; const s = await practiceOf(as.kind === 'coach' ? coach : owner); return post(api, {action: 'checkin', date: today, sessionKey: s.key, userId: 'p1', wrestlerId: id}); };
const attended = id => sqlite.prepare('SELECT count(*) n FROM attendance WHERE wrestler_id=?').get(id).n;

// --- The rule itself, with the reason staff see ---
const why = {
  none: "Nico Nocard can't be checked in: there is no USA Wrestling card on file.",
  old: `Eli Expired can't be checked in: the USA Wrestling card expired ${longDate(ny(-3))}.`,
  lapse: `Lou Lapsed can't be checked in: the USA Wrestling card expired ${longDate(ny(-1))}.`,
  bad: "Ira Invalid can't be checked in: the academy marked the USA Wrestling card not valid (number not found).",
  redo: "Rae Recheck can't be checked in: the USA Wrestling card was changed and the academy has not checked it yet.",
  new: "Ned Unverified can't be checked in: the USA Wrestling card has not been verified yet."
};
const fixOwner = {none: 'The family needs to update the card. To let the wrestler in meanwhile, allow an exception on the USA Wrestling cards page.', new: 'Check it and mark it verified on the USA Wrestling cards page.'};
const fixCoach = {none: 'Ask the family to update the card, or the owner to allow an exception.', new: 'Ask the owner to verify the card.'};
const ownerFix = id => ['redo', 'new'].includes(id) ? fixOwner.new : fixOwner.none;
const coachFix = id => ['redo', 'new'].includes(id) ? fixCoach.new : fixCoach.none;

assert.equal((await entryOf('ok')).checkInBlocked, null, 'a verified, current card checks in');
for (const id of Object.keys(why)) {
  assert.equal((await entryOf(id)).checkInBlocked, why[id] + ' ' + ownerFix(id), id + ' (owner wording)');
  assert.equal((await entryOf(id, coach)).checkInBlocked, why[id] + ' ' + coachFix(id), id + ' (coach wording)');
}
assert.equal(roster.checkInBlock({name: 'A', card: 'verified', cardExpires: null, cardNote: '', exceptions: []}, owner), null);
assert.equal(roster.checkInBlock({name: 'A', card: 'missing', cardExpires: null, cardNote: '', exceptions: ['waiver']}, owner) !== null, true, 'a waiver exception does not cover the card');
assert.equal(roster.checkInBlock({name: 'A', card: 'missing', cardExpires: null, cardNote: '', exceptions: ['usaw']}, owner), null, 'a card exception does');

// --- The server refuses, owner and coach alike, and nothing is recorded ---
let r = await checkin('ok'); assert.equal(r.status, 200); assert.equal(attended('ok'), 1);
for (const id of Object.keys(why)) {
  r = await checkin(id); assert.equal(r.status, 409, id); assert.equal(r.body.error, why[id] + ' ' + ownerFix(id));
  r = await checkin(id, {kind: 'coach', id: 'coach-id'}); assert.equal(r.status, 409, id + ' (coach)'); assert.equal(r.body.error, why[id] + ' ' + coachFix(id));
  assert.equal(attended(id), 0, id + ' not checked in');
}
// Camps, clinics and events follow the same rule.
actor = {kind: 'owner'};
const camp = (await roster.rosterFor(today, owner)).find(s => s.key.startsWith('event:camp:'));
assert.equal((await post(api, {action: 'checkin', date: today, sessionKey: camp.key, userId: 'p1', wrestlerId: 'new'})).status, 409);
assert.equal((await post(api, {action: 'checkin', date: today, sessionKey: camp.key, userId: 'p1', wrestlerId: 'ok'})).status, 200);
// Undo still works, so a mistaken check-in can always be removed.
r = await post(api, {action: 'undo', date: today, sessionKey: camp.key, userId: 'p1', wrestlerId: 'ok'}); assert.equal(r.status, 200);

// --- Scanning a pass gets the same answer ---
sqlite.prepare("INSERT INTO wrestler_passes(id,user_id,wrestler_id,token,created_at) VALUES ('pass-new','p1','new',?,'x')").run('N'.repeat(32));
r = await passes.scanCheckIn(today, 'SWA1:' + 'N'.repeat(32), owner, 'owner-id', 18 * 60);
assert.equal(r.status, 409); assert.equal(r.error, why.new + ' ' + fixOwner.new);
assert.equal(attended('new'), 0);

// --- Owner exceptions are honored exactly as booking honors them (issue #89) ---
actor = {kind: 'owner'};
const grant = (wrestlerId, extra = {}) => post(exceptionsApi, {action: 'grant', userId: 'p1', wrestlerId, rule: 'usaw', endsOn: ny(7), reason: 'Renewal pending with USA Wrestling', ...extra});
assert.equal((await grant('old')).status, 200);
assert.equal((await entryOf('old')).checkInBlocked, null, 'an exception covering today lets the wrestler in');
assert.deepEqual([...(await entryOf('old')).exceptions], ['usaw']);
r = await checkin('old'); assert.equal(r.status, 200); assert.equal(attended('old'), 1);
assert.equal((await grant('none', {startsOn: ny(1)})).status, 200);
assert.match((await entryOf('none')).checkInBlocked, /no USA Wrestling card on file/, 'an exception that starts tomorrow does not cover today');
assert.equal((await checkin('none')).status, 409);
sqlite.prepare("INSERT INTO booking_exceptions VALUES ('x-ended','p1','bad','usaw',?,?,'Old exception','owner-id','x',NULL,NULL)").run(ny(-10), ny(-1));
assert.match((await entryOf('bad')).checkInBlocked, /not valid/, 'an exception that has ended does not cover today');
sqlite.prepare("INSERT INTO booking_exceptions VALUES ('x-waiver','p1','new','waiver',?,?,'Paper waiver','owner-id','x',NULL,NULL)").run(ny(-1), ny(7));
assert.match((await entryOf('new')).checkInBlocked, /not been verified/, 'a waiver exception does not let a card through');
assert.equal((await grant('new')).status, 200);
r = await checkin('new', {kind: 'coach', id: 'coach-id'}); assert.equal(r.status, 200, 'coaches can check in a wrestler under the owner exception');
actor = {kind: 'owner'};
const ex = sqlite.prepare("SELECT id FROM booking_exceptions WHERE wrestler_id='redo' AND rule='usaw'").get();
assert.equal(ex, undefined);
assert.equal((await grant('redo')).status, 200);
const redoId = sqlite.prepare("SELECT id FROM booking_exceptions WHERE wrestler_id='redo' AND rule='usaw'").get().id;
assert.equal((await post(exceptionsApi, {action: 'remove', id: redoId})).status, 200);
assert.match((await entryOf('redo')).checkInBlocked, /has not checked it yet/, 'a removed exception blocks again');

// --- Verifying the card lets the wrestler in ---
review('redo', 'AB1005', '2099-08-31', 'valid');
assert.equal((await entryOf('redo')).checkInBlocked, null);
assert.equal((await checkin('redo')).status, 200);
console.log('Passed: check-in blocked for missing, expired, not valid, changed and unverified cards (by hand, by pass, owner and coach, practices and camps) with a plain reason; owner card exceptions honored on their dates only; verifying the card lets the wrestler in.');

// --- Roster page: the reason is shown and there is no Check in button (inline JavaScript is not typechecked) ---
{
  const html = readFileSync('app/roster/screen.html', 'utf8'), script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', textContent: '', innerHTML: '', hidden: false, style: {}, set onclick(f) {}, set onchange(f) {}, set oninput(f) {}}); return nodes.get(id); };
  actor = {kind: 'coach', id: 'coach-id'};
  const data = {date: today, today, role: 'coach', sessions: await roster.rosterFor(today, coach)};
  const ctx = vm.createContext({document: {getElementById: el, querySelectorAll: () => [], createElement: () => ({getContext: () => null})}, window: {addEventListener() {}},
    location: {search: ''}, URLSearchParams, Date, Intl, JSON, Promise, confirm: () => true, navigator: {},
    fetch: async () => ({ok: true, json: async () => data})});
  vm.runInContext(script, ctx);
  await new Promise(r => setTimeout(r, 10));
  const out = el('sessions').innerHTML;
  // One wrestler's row: from its opening tag to the next row or the end of the session.
  const row = name => { const at = out.indexOf(name), next = [out.indexOf('<div class="row', at), out.indexOf('</section>', at)].filter(i => i > 0); return out.slice(out.lastIndexOf('<div class="row', at), Math.min(...next)); };
  assert.match(row('Nico Nocard'), /<p class="block-reason" id="why0-(\d+)">Nico Nocard can&#39;t be checked in: there is no USA Wrestling card on file\. Ask the family to update the card, or the owner to allow an exception\.<\/p>/);
  assert.match(row('Nico Nocard'), /<span class="badge warn">No USA Wrestling card<\/span>/, 'badge');
  const i = row('Ira Invalid').match(/id="why0-(\d+)"/)[1];
  assert.match(row('Ira Invalid'), new RegExp(`<button class="blocked" type="button" disabled aria-describedby="why0-${i}">Hold</button>`), 'the disabled Hold points to its reason');
  assert.match(row('Ira Invalid'), /<details class="why"><summary>Why\?<\/summary><p class="block-reason" id="why0-\d+">/, 'the reason opens behind Why? (issue #286)');
  assert.match(row('Ira Invalid'), /^<div class="row card-problem hold"/, 'a held row is outlined');
  assert.doesNotMatch(row('Ira Invalid'), /data-checkin=/, 'no Check in button while blocked');
  assert.match(row('Lou Lapsed'), /USA Wrestling card expired/);
  assert.match(row('Vera Verified'), /Checked in/, 'already checked in');
  assert.match(row('Ned Unverified'), /Checked in/, 'checked in under the owner exception');
  assert.doesNotMatch(row('Ned Unverified'), /block-reason/);
  assert.match(out, /· 3 can’t be checked in until their USA Wrestling card is sorted out/, 'Nico, Lou and Ira');
  assert.match(html, /A wrestler can be checked in only with a USA Wrestling card the academy has verified/);
  console.log('Passed: roster page shows why a wrestler can’t be checked in, with no Check in button.');
}

{
  // A card verified by the automatic USA Wrestling lookup (#202) counts the same as the owner's check.
  sqlite.prepare("INSERT OR REPLACE INTO usaw_reviews(user_id,wrestler_id,number,expires,status,note,reviewed_by,reviewed_at) VALUES ('p1','bad','AB1004','2099-08-31','valid','','usaw-lookup','x')").run();
  assert.equal((await entryOf('bad')).checkInBlocked, null, 'verified by the lookup');
  assert.equal((await checkin('bad')).status, 200);
  console.log('Passed: a card verified by the USA Wrestling lookup checks in like one the owner verified.');
}
