// Issue #177: partner and small-group lessons, priced per wrestler. Coach-hosted groups are listed for every family;
// family-requested private groups are joined only through their invite link. Every wrestler passes the card and waiver
// checks, one family cannot book the same wrestler twice, and paid orders and checkouts in progress count toward the spots.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const migrations = readdirSync('drizzle').filter(f => f.endsWith('.sql') && !f.includes('_starter_')).sort();
const sqlite = new DatabaseSync(':memory:');
for (const f of migrations) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {
  prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }, async run() { return {meta: sqlite.prepare(sql).run(...a)}; },
    _execute() { const s = sqlite.prepare(sql); return s.columns().length ? {results: s.all(...a)} : {results: [], meta: s.run(...a)}; }}; },
  async batch(list) { sqlite.exec('BEGIN'); try { const r = list.map(s => s._execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }
};
const env = {DB};
const one = (sql, ...a) => ({...sqlite.prepare(sql).get(...a)});
let actor = {owner: true, id: 'owner-id'};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, TextEncoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console, btoa,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test',
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, headers: new Headers()}),
          strongAccount: async () => ({user: {id: actor.id, email: actor.id + '@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.endsWith('/access-control')) return {coachAccess: async () => actor.coach ? {email: actor.coach, name: 'Coach Dana', programs: actor.programs ?? ['Intermediate'], owner: false} : null, accountRole: async () => actor.coach ? {role: 'coach', staff: {email: actor.coach, name: 'Coach Dana', programs: ['Intermediate']}} : {role: 'family', staff: null}};
        if (name.endsWith('/stripe-test')) return {storedStripeKeyFor: async () => null, stripeClientFor: () => null, stripeMode: () => 'test'};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}

// --- The migration adds the opening fields; invite codes are unique ---
{
  const cols = sqlite.prepare('PRAGMA table_info(coach_openings)').all().map(c => c.name);
  for (const c of ['format', 'capacity', 'closed', 'invite_code', 'organizer_id', 'organizer_wrestlers']) assert.ok(cols.includes(c), c);
  const migration = migrations.find(f => readFileSync('drizzle/' + f, 'utf8').includes('`organizer_wrestlers`'));
  assert.ok(migration, 'a generated migration adds the group fields');
  assert.match(readFileSync('drizzle/' + migration, 'utf8'), /CREATE UNIQUE INDEX `coach_openings_invite`/);
}

const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2, programs: [], seasons: [], events: []}));
const card = {usawNumber: 'AB1234', usawExpires: '2099-12-31'};
const families = {
  p1: [{id: 'w-p1', name: 'Sam', grade: '8', ...card}, {id: 'w-p1b', name: 'Sasha', grade: 'K', ...card}],
  p2: [{id: 'w-p2', name: 'Riley', grade: '8', ...card}],
  p3: [{id: 'w-p3', name: 'Max', grade: '9', ...card}],
  p4: [{id: 'w-p4', name: 'Jo', grade: '7', ...card}],
  p5: [{id: 'w-p5', name: 'Noa', grade: '10', ...card}],
  p6: [{id: 'w-p6', name: 'No Card', grade: '8'}]
};
for (const [u, wrestlers] of Object.entries(families)) sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test',
  JSON.stringify({parentName: 'Parent ' + u, phone: '555-01' + u.slice(1), wrestlers}), 1, 'x');
sqlite.prepare("INSERT INTO staff_access VALUES ('dana@example.test','Coach Dana','[\"Intermediate\"]',1,'x')").run();
sqlite.prepare("INSERT INTO academy_settings VALUES ('lessons',?,'x','o')").run(JSON.stringify({prices: {'one-on-one': 6000, partner: 4500, 'small-group': 3500}, splits: {}, defaultSplit: 50}));

const quotes = load(path.resolve('lib/quotes.ts'));
const lessons = load(path.resolve('lib/lessons.ts'));
const capacity = load(path.resolve('lib/capacity.ts'));
const backups = load(path.resolve('lib/backup-records.ts'));
const lessonsApi = load(path.resolve('app/api/lessons/route.ts'));
const coachApi = load(path.resolve('app/api/coach/route.ts'));
const payments = load(path.resolve('app/api/payments/route.ts'));
const coachPay = load(path.resolve('app/api/coach-pay/route.ts'));
const O = 'https://a.test';
const call = async (route, method, body, q = '') => { const r = await route[method](new Request(O + '/x' + q, method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const as = id => { actor = id === 'owner' ? {owner: true, id: 'owner-id'} : id === 'coach' ? {owner: false, id: 'coach-dana', coach: 'dana@example.test'} : {owner: false, id}; };
const quote = (u, openingId, extra = {}) => quotes.quoteBooking(u, {type: 'lesson', wrestlerId: 'w-' + u, openingId, ...extra});
const record = (u, openingId, wrestlerId = 'w-' + u) => { as('owner'); return call(payments, 'POST', {action: 'record', userId: u, wrestlerId, kind: 'lesson', openingId, method: 'cash'}); };
const idOf = (date, start) => sqlite.prepare('SELECT id FROM coach_openings WHERE date=? AND start=?').get(date, start).id;

// --- Coach posts openings with a lesson type and spots ---
as('coach');
const add = (date, start, extra = {}) => call(coachApi, 'POST', {action: 'add', date, start, end: String(+start.slice(0, 2) + 1).padStart(2, '0') + ':00', ...extra});
assert.equal((await add(ny(2), '10:00', {format: 'small-group', spots: 2})).status, 400, 'a small group has at least 3 spots');
assert.equal((await add(ny(2), '10:00', {format: 'small-group', spots: 7})).status, 400, 'and at most 6');
assert.equal((await add(ny(2), '10:00', {format: 'tag-team'})).status, 400);
assert.equal((await add(ny(2), '10:00', {format: 'small-group', spots: 4})).status, 200);
assert.equal((await add(ny(2), '12:00', {format: 'partner', spots: 5})).status, 200);
assert.equal((await add(ny(2), '14:00')).status, 200);
assert.equal((await add(ny(2), '16:00', {format: 'one-on-one'})).status, 200);
assert.equal((await add(ny(3), '16:00')).status, 200);
const group = idOf(ny(2), '10:00'), partner = idOf(ny(2), '12:00'), open = idOf(ny(2), '14:00'), oneOnly = idOf(ny(2), '16:00'), open2 = idOf(ny(3), '16:00');
assert.deepEqual(one('SELECT format,capacity,closed FROM coach_openings WHERE id=?', group), {format: 'small-group', capacity: 4, closed: 0});
assert.equal(sqlite.prepare('SELECT capacity FROM coach_openings WHERE id=?').get(partner).capacity, 2, 'a partner lesson is always 2');
assert.deepEqual(one('SELECT format,capacity FROM coach_openings WHERE id=?', open), {format: null, capacity: null});

// --- Families see coach-hosted groups with their spots ---
as('p1');
let r = await call(lessonsApi, 'GET');
const listed = id => r.body.openings.find(o => o.id === id);
assert.deepEqual([listed(group).format, listed(group).capacity, listed(group).spotsLeft], ['small-group', 4, 4]);
assert.equal(listed(open).capacity, 1); assert.equal(listed(open).format, null);
assert.deepEqual(r.body.mine, []);

// --- Per-wrestler pricing and dedupe ---
let q = await quote('p1', group);
assert.equal(q.ok, true); assert.equal(q.charge.amountCents, 3500, 'the small-group price is per wrestler'); assert.equal(q.charge.pricing.slots, 4);
assert.equal(q.charge.pricing.group, 'coach'); assert.equal(q.review.spotsLeft, 4); assert.equal(q.review.perWrestler, true);
assert.equal(q.charge.dedupeKey, `p1|w-p1|lesson|${group}`);
const sibling = await quotes.quoteBooking('p1', {type: 'lesson', wrestlerId: 'w-p1b', openingId: group});
assert.equal(sibling.charge.amountCents, 3500); assert.equal(sibling.charge.dedupeKey, `p1|w-p1b|lesson|${group}`, 'a second wrestler is a separate charge');
assert.match((await quote('p1', group, {format: 'one-on-one'})).error, /This time is a small-group lesson/);
assert.equal((await quote('p1', group, {format: 'small-group'})).ok, true);
assert.equal((await quote('p1', open, {format: 'one-on-one'})).charge.amountCents, 6000);
assert.match((await quote('p1', oneOnly, {format: 'partner'})).error, /This time is a one-on-one lesson/);
assert.match((await quote('p1', open, {format: 'partner'})).error, /ask for a private group first/);

// --- Capacity: paid orders and checkouts in progress count; one family cannot book a wrestler twice ---
assert.equal((await record('p1', group)).status, 200);
assert.match((await quote('p1', group)).error, /Sam is already booked into this lesson/);
assert.equal((await record('p1', group)).status, 409, 'no second payment for the same wrestler');
assert.equal((await record('p1', group, 'w-p1b')).status, 200, 'a family books each of their wrestlers');
// A checkout in progress holds a spot.
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at)
  VALUES ('hold','p3','p3@x','w-p3','Max','lesson',?,'Lesson',?,3500,0,3500,'usd','{"slots":4}','{}','pending',?,0,?,?)`).run(group, JSON.stringify([ny(2)]), `p3|w-p3|lesson|${group}`, new Date().toISOString(), new Date().toISOString());
as('p2'); r = await call(lessonsApi, 'GET'); assert.equal(listed(group).spotsLeft, 1, 'two paid and one checkout in progress');
assert.equal((await record('p2', group)).status, 200);
as('p4'); r = await call(lessonsApi, 'GET'); assert.equal(listed(group), undefined, 'a full group is not listed');
assert.match((await quote('p4', group)).error, /This lesson is full/);
assert.equal((await record('p4', group)).status, 409);
// The coach sees the roster with parents, spots left and that they host it.
as('coach'); r = await call(coachApi, 'GET');
let mine = r.body.openings.find(o => o.id === group);
assert.equal(mine.hosted, 'coach'); assert.equal(mine.spotsLeft, 0); assert.equal(mine.capacity, 4);
assert.deepEqual(mine.roster.map(x => [x.wrestler, x.parent, x.phone, x.status]), [['Sam', 'Parent p1', '555-011', 'paid'], ['Sasha', 'Parent p1', '555-011', 'paid'], ['Max', 'Parent p3', '555-013', 'paying'], ['Riley', 'Parent p2', '555-012', 'paid']]);
// Once booked, the type cannot change and the spots cannot drop below the wrestlers booked.
assert.equal((await call(coachApi, 'POST', {action: 'update', id: group, format: 'partner'})).status, 409);
assert.match((await call(coachApi, 'POST', {action: 'update', id: group, format: 'small-group', spots: 3})).body.error, /4 wrestlers are booked/);
assert.equal((await call(coachApi, 'POST', {action: 'update', id: group, format: 'small-group', spots: 5})).status, 200);
assert.equal(sqlite.prepare('SELECT capacity FROM coach_openings WHERE id=?').get(group).capacity, 5);
assert.equal((await call(coachApi, 'POST', {action: 'update', id: open2, format: 'partner'})).status, 200, 'nothing booked: any type');
assert.equal((await call(coachApi, 'POST', {action: 'update', id: open2, format: null})).status, 200);
assert.equal((await call(coachApi, 'POST', {action: 'remove', id: group})).status, 409);
sqlite.prepare("DELETE FROM orders WHERE id='hold'").run();

// --- Card and waiver checks for every joining wrestler ---
as('p6'); assert.match((await quote('p6', partner)).error, /needs a current USA Wrestling card/);
sqlite.prepare("INSERT INTO waiver_versions(id,title,body,sha256,published_at,published_by,retired_at) VALUES ('wv','Participation waiver','text','h',?,'o',NULL)").run(new Date().toISOString());
let wq = await quote('p5', partner); assert.equal(wq.ok, false); assert.match(wq.error, /needs a signed Participation waiver/); assert.equal(wq.extra.waiverRequired, true);
const sign = (u, w, name) => sqlite.prepare("INSERT INTO waiver_signatures VALUES (?, 'wv', ?, ?, ?, 'P', 'e', '{}', 'x')").run('sig-' + w, u, w, name);
for (const [u, w, n] of [['p1', 'w-p1', 'Sam'], ['p1', 'w-p1b', 'Sasha'], ['p2', 'w-p2', 'Riley'], ['p3', 'w-p3', 'Max'], ['p4', 'w-p4', 'Jo']]) sign(u, w, n);
assert.equal((await quote('p5', partner)).ok, false, 'Noa still has not signed');

// --- A family asks for a private partner lesson at an open time ---
as('p1');
const request = body => call(lessonsApi, 'POST', {action: 'request', ...body});
assert.equal((await request({openingId: open, format: 'partner', wrestlerIds: ['w-p1', 'w-p1b', 'w-p1', 'w-p1b', 'w-p1b']})).status, 200, 'a wrestler listed twice is one wrestler');
assert.equal(sqlite.prepare('SELECT organizer_wrestlers FROM coach_openings WHERE id=?').get(open).organizer_wrestlers, '["w-p1","w-p1b"]');
// Calling it off opens the time again; the rest of this test uses a fresh request.
assert.equal((await call(lessonsApi, 'POST', {action: 'cancel', openingId: open})).status, 200);
assert.deepEqual(one('SELECT format,capacity,closed,invite_code,organizer_id FROM coach_openings WHERE id=?', open), {format: null, capacity: null, closed: 0, invite_code: null, organizer_id: null}, 'calling off opens the time again');
assert.equal((await request({openingId: open, format: 'small-group', spots: 7, wrestlerIds: ['w-p1']})).status, 400);
assert.match((await request({openingId: partner, format: 'partner', wrestlerIds: ['w-p1']})).body.error, /no longer available/, 'not a coach-hosted group');
assert.match((await request({openingId: open, format: 'partner', wrestlerIds: ['w-p2']})).body.error, /not found in your account/, 'only your own wrestlers');
as('p6'); r = await request({openingId: open, format: 'partner', wrestlerIds: ['w-p6']});
assert.equal(r.status, 403); assert.match(r.body.error, /USA Wrestling card/); assert.equal(r.body.usawRequired, true, 'the organiser’s wrestlers pass the card check');
as('p5'); r = await request({openingId: open, format: 'partner', wrestlerIds: ['w-p5']}); assert.equal(r.status, 403); assert.equal(r.body.waiverRequired, true);
as('p1'); r = await request({openingId: open, format: 'partner', wrestlerIds: ['w-p1']});
assert.equal(r.status, 200);
const code = r.body.group.inviteCode;
assert.match(code, /^[A-Za-z0-9_-]{32}$/, '32 base64url characters: 192 random bits');
assert.equal(r.body.group.capacity, 2); assert.equal(r.body.group.spotsLeft, 1, 'the organiser’s wrestler takes a spot');
assert.deepEqual(r.body.group.roster, [{wrestler: 'Sam', status: 'kept', own: true}]);
assert.match((await request({openingId: open, format: 'partner', wrestlerIds: ['w-p1']})).body.error, /no longer available/, 'the time is taken by the group');

// --- A closed group is never listed, and its code is never shown to anyone but the organiser ---
for (const u of ['p2', 'p3', 'p4']) {
  as(u); r = await call(lessonsApi, 'GET');
  assert.equal(r.body.openings.some(o => o.id === open), false, 'not listed for ' + u);
  assert.ok(!JSON.stringify(r.body).includes(code), 'code not in ' + u + '’s listing');
}
as('owner'); r = await call(lessonsApi, 'GET');
assert.equal(listed(open).closed, true); assert.equal(listed(open).organizer, 'Parent p1'); assert.equal(listed(open).spotsLeft, 1);
assert.ok(!JSON.stringify(r.body).includes(code), 'the owner’s list has no invite codes either');
as('coach'); r = await call(coachApi, 'GET'); assert.ok(!JSON.stringify(r.body).includes(code), 'nor the coach’s');
mine = r.body.openings.find(o => o.id === open);
assert.equal(mine.hosted, 'family'); assert.equal(mine.organizer, 'Parent p1'); assert.deepEqual(mine.roster.map(x => [x.wrestler, x.status]), [['Sam', 'kept']]);
assert.equal((await call(coachApi, 'POST', {action: 'update', id: open, format: 'small-group', spots: 4})).status, 409, 'the coach cannot change a family’s group');
as('p1'); r = await call(lessonsApi, 'GET');
assert.equal(r.body.mine.length, 1); assert.equal(r.body.mine[0].inviteCode, code, 'the organiser sees their link again');

// --- Joining needs the invite link ---
assert.match((await quote('p2', open)).error, /no longer available/, 'without the link it looks like any unavailable time');
assert.match((await quote('p2', open, {invite: code.slice(0, 31) + (code[31] === 'A' ? 'B' : 'A')})).error, /no longer available/);
as('p2'); r = await call(lessonsApi, 'GET', null, '?join=' + code);
assert.equal(r.status, 200); assert.equal(r.body.invite.id, open); assert.equal(r.body.invite.spotsLeft, 1); assert.equal(r.body.invite.organizer, 'Parent p1');
assert.equal(r.body.invite.inviteCode, undefined); assert.equal(r.body.invite.roster, undefined, 'an invited family sees spots left, not the roster');
assert.equal((await call(lessonsApi, 'GET', null, '?join=nope')).status, 404);
q = await quote('p2', open, {invite: code});
assert.equal(q.ok, true); assert.equal(q.charge.amountCents, 4500, 'partner price, per wrestler'); assert.equal(q.charge.pricing.group, 'family'); assert.equal(q.review.spotsLeft, 1);
assert.match((await quote('p6', open, {invite: code})).error, /USA Wrestling card/, 'an invited wrestler passes the card check');
assert.match((await quote('p5', open, {invite: code})).error, /signed Participation waiver/, 'and the waiver check');
// The organiser's own kept spot: another invited family cannot take it.
assert.equal((await record('p2', open)).status, 200, 'the owner records the invited family’s payment without the code');
as('p3'); assert.match((await quote('p3', open, {invite: code})).error, /This lesson is full/, 'the last spot is kept for the organiser’s wrestler');
assert.equal((await record('p3', open)).status, 409);
assert.equal(await capacity.lessonReserved(open), 1);
// The owner still sees the group, with the spot kept for the organiser's wrestler, so that payment can be recorded.
as('owner'); r = await call(lessonsApi, 'GET'); assert.deepEqual([listed(open).spotsLeft, listed(open).kept], [0, 1]);
assert.equal(await capacity.lessonReserved(open, {userId: 'p1', wrestlerId: 'w-p1'}), 0, 'a kept spot is not counted against its own wrestler');
as('p1'); assert.match((await call(lessonsApi, 'POST', {action: 'cancel', openingId: open})).body.error, /already paid for/, 'no calling off once someone paid');
assert.equal((await quote('p1', open)).ok, true, 'the organiser books without the link');
assert.equal((await record('p1', open)).status, 200);
as('p1');
r = await call(lessonsApi, 'GET');
assert.deepEqual(r.body.mine[0].roster, [{wrestler: 'Riley', status: 'paid', own: false}, {wrestler: 'Sam', status: 'paid', own: true}]);
assert.equal(r.body.mine[0].spotsLeft, 0, 'the lesson is full');
as('coach'); r = await call(coachApi, 'GET'); mine = r.body.openings.find(o => o.id === open);
assert.deepEqual(mine.roster.map(x => [x.wrestler, x.parent, x.status]), [['Riley', 'Parent p2', 'paid'], ['Sam', 'Parent p1', 'paid']]);
assert.equal((await call(coachApi, 'POST', {action: 'remove', id: open})).status, 409);

// --- A coach removing an open time a family asked for calls the request off, and the family is told ---
as('p4'); r = await request({openingId: open2, format: 'small-group', spots: 3, wrestlerIds: ['w-p4']}); assert.equal(r.status, 200);
assert.equal(r.body.group.spotsLeft, 2);
as('coach'); assert.equal((await call(coachApi, 'POST', {action: 'remove', id: open2})).status, 200);
assert.equal(sqlite.prepare("SELECT count(*) n FROM notifications WHERE user_id='p4' AND kind='lesson_group_canceled'").get().n, 1);

// --- Coach pay: one lesson, summed per wrestler ---
as('owner');
let pay = (await call(coachPay, 'GET', null, `?from=${ny(0)}&to=${ny(5)}`)).body;
const dana = pay.coaches[0];
assert.equal(dana.lessons, 2, 'the small group and the partner lesson'); assert.equal(dana.wrestlers, 5);
assert.equal(dana.grossCents, 3 * 3500 + 2 * 4500); assert.equal(dana.owedCents, dana.lines.reduce((n, l) => n + Math.round(l.paidCents / 2), 0));

// --- Backups keep a group's type, spots and invite; older files without them still restore ---
{
  // The test's academy settings are a bare minimum, not a full saved state, so the file leaves them out.
  const file = {...await backups.readBackup(), academy: null};
  const saved = file.openings.find(o => o.id === open);
  assert.deepEqual([saved.format, saved.capacity, saved.closed, saved.invite_code, saved.organizer_id, JSON.parse(saved.organizer_wrestlers)], ['partner', 2, 1, code, 'p1', ['w-p1']]);
  assert.equal(backups.validBackup(file), true);
  assert.equal(backups.validBackup({...file, openings: file.openings.map(o => o.id === open ? {...o, invite_code: 'short'} : o)}), false);
  assert.equal(backups.validBackup({...file, openings: file.openings.map(o => o.id === open ? {...o, capacity: 9} : o)}), false);
  const {format, capacity: c, closed, invite_code, organizer_id, organizer_wrestlers, ...old} = saved;
  assert.equal(backups.validBackup({...file, openings: file.openings.map(o => o.id === open ? {...old, format: 'partner'} : o)}), false, 'all group fields or none');
  assert.equal(backups.validBackup({...file, openings: file.openings.map(({format, capacity, closed, invite_code, organizer_id, organizer_wrestlers, ...o}) => o)}), true, 'a file from before issue #177');
  sqlite.prepare('UPDATE coach_openings SET format=NULL,capacity=NULL,closed=0,invite_code=NULL,organizer_id=NULL,organizer_wrestlers=NULL WHERE id=?').run(open);
  await backups.restoreBackup(file, await backups.fingerprint(await backups.metadata()), 'owner-id');
  assert.deepEqual(one('SELECT format,capacity,closed,invite_code,organizer_id FROM coach_openings WHERE id=?', open), {format: 'partner', capacity: 2, closed: 1, invite_code: code, organizer_id: 'p1'});
}

// ================= Page scripts (inline JavaScript is not typechecked) =================
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(res => setImmediate(res)); };
const json = (body, ok = true) => ({ok, status: ok ? 200 : 404, json: async () => body});
function page(file, {fetch, search = ''}) {
  const nodes = new Map(), clicks = new Map();
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, checked: false, disabled: false, innerHTML: '', textContent: '', className: '', href: '', style: {}, dataset: {},
      replaceChildren() {}, focus() {}, select() {}, scrollIntoView() {}, setAttribute() {}, querySelector() { return null; }, classList: {add() {}, remove() {}, toggle() {}}});
    return nodes.get(id);
  };
  const calls = [];
  // A select's value is its selected option, read from the HTML up to the end of that select.
  const selected = html => { const m = /<option(?: value="([^"]*)")? selected>([^<]*)/.exec(html.slice(0, html.indexOf('</select>') + 1 || undefined)); return m ? m[1] ?? m[2] : ''; };
  // querySelectorAll finds buttons by their data attribute in the rendered HTML, so clicks run the page's handlers.
  const all = sel => {
    const m = /^\[data-([a-z-]+)(?:="([^"]*)")?\]$/.exec(sel); if (!m) return [];
    const out = [];
    for (const node of nodes.values()) for (const x of String(node.innerHTML).matchAll(new RegExp(`<(\\w+)[^>]*data-${m[1]}="([^"]*)"[^>]*>`, 'g'))) {
      if (m[2] !== undefined && x[2] !== m[2]) continue;
      const key = m[1] + ':' + x[2], camel = m[1].replace(/-(\w)/g, (_, c) => c.toUpperCase());
      if (!clicks.has(key)) clicks.set(key, {dataset: {[camel]: x[2]}, checked: /\bchecked\b/.test(x[0]), value: selected(String(node.innerHTML).slice(x.index))});
      out.push(clicks.get(key));
    }
    return out;
  };
  const ctx = vm.createContext({Intl, Date, JSON, URLSearchParams, Promise, setTimeout: f => setImmediate(f), console, encodeURIComponent,
    location: {search, href: '', origin: 'https://swa.test', pathname: '/' + file.split('/')[1], assign() {}}, confirm: () => true, navigator: {clipboard: {writeText: async t => { calls.push({copied: t}); }}},
    document: {getElementById: el, querySelectorAll: all, querySelector: sel => all(sel)[0] ?? null, createElement: () => ({})},
    fetch: async (url, options) => { calls.push({url, body: options?.body ? JSON.parse(options.body) : null}); return fetch(url, options); }});
  const html = readFileSync(file, 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], ctx);
  return {el, ctx, html, calls, button: (attr, v) => all(`[data-${attr}="${v}"]`)[0]};
}
const formats = [{id: 'one-on-one', name: 'One-on-one lesson', description: 'd', cents: 6000}, {id: 'partner', name: 'Partner lesson', description: 'd', cents: 4500}, {id: 'small-group', name: 'Small-group lesson', description: 'd', cents: 3500}];
const at = (id, extra) => ({id, date: '2026-11-09', start: '15:00', end: '16:00', coach: 'Coach Dana', coachKey: 'k', format: null, capacity: 1, spotsLeft: 1, ...extra});
const openings = [at('one'), at('grp', {start: '10:00', end: '11:00', format: 'small-group', capacity: 4, spotsLeft: 2})];
const wrestlers = [{id: 'w1', name: 'Sam'}, {id: 'w2', name: 'Sasha'}];
const myGroup = {id: 'pg', date: '2026-11-10', start: '09:30', end: '10:30', coach: 'Coach Dana', format: 'partner', capacity: 2, spotsLeft: 1, organizer: 'Pat', mine: true, booked: [], inviteCode: 'C'.repeat(32), roster: [{wrestler: 'Sam', status: 'kept', own: true}]};

// The family lesson page: three ways to book, with spots left and prices per wrestler.
{
  const p = page('app/lesson/screen.html', {fetch: async url => json(url.startsWith('/api/lessons') ? {formats, openings, mine: []} : url === '/api/family' ? {data: {wrestlers}} : {review: {title: 'Small-group lesson', coach: 'Coach Dana', dates: ['2026-11-09'], start: '10:00', end: '11:00', wrestler: 'Sam', cents: 3500, capacity: 4, spotsLeft: 2, message: ''}, paymentsEnabled: false})});
  await settle();
  const paths = p.el('paths').innerHTML;
  assert.match(paths, /Book a one-on-one[\s\S]*\$60\.00 per wrestler[\s\S]*1 open time/);
  assert.match(paths, /Join a partner or small group[\s\S]*Partner \$45\.00 · Small-group \$35\.00 per wrestler[\s\S]*1 group with spots/);
  assert.match(paths, /Start a private group[\s\S]*1 open time/);
  assert.equal(p.ctx.path, undefined); assert.equal(vm.runInContext('path', p.ctx), '', 'with three ways to book, the family chooses');
  assert.equal(p.el('stepTime').hidden, true);
  p.button('path', 'group').onclick(); await settle();
  assert.match(p.el('times').innerHTML, /10:00 AM–11:00 AM[\s\S]*Small-group lesson[\s\S]*2 of 4 spots left/);
  assert.doesNotMatch(p.el('times').innerHTML, /3:00 PM/, 'open times are not groups');
  p.el('wrestler').value = 'w1'; p.button('opening', 'grp').onclick(); await settle();
  const review = p.calls.find(c => c.url === '/api/booking-review');
  assert.deepEqual(review.body, {type: 'lesson', wrestlerId: 'w1', openingId: 'grp'}, 'no price or format from the browser');
  assert.match(p.el('summary').innerHTML, /Small-group lesson[\s\S]*Mon, Nov 9 · 10:00 AM–11:00 AM[\s\S]*For Sam · 2 of 4 spots left[\s\S]*\$35\.00<\/strong> per wrestler/);
  assert.equal(p.el('notOpen').hidden, false, 'pay at the academy while lesson checkout is closed');
  p.button('path', 'one').onclick(); await settle();
  assert.match(p.el('times').innerHTML, /3:00 PM–4:00 PM/); assert.doesNotMatch(p.el('times').innerHTML, /10:00 AM/);
  p.button('opening', 'one').onclick(); await settle();
  assert.deepEqual(p.calls.filter(c => c.url === '/api/booking-review').at(-1).body, {type: 'lesson', wrestlerId: 'w1', openingId: 'one', format: 'one-on-one'});
  // Start a private group: choose partner or small group, your wrestlers and an open time, then ask for it.
  p.button('path', 'request').onclick(); await settle();
  assert.equal(p.el('requestOptions').hidden, false); assert.equal(p.el('wrestlerLabel').hidden, true);
  assert.match(p.el('ownWrestlers').innerHTML, /data-own="w1" checked[\s\S]*data-own="w2">/);
  assert.match(p.el('kinds').innerHTML, /Partner[\s\S]*2 wrestlers[\s\S]*\$45\.00 per wrestler[\s\S]*Small group[\s\S]*3 to 6 wrestlers/);
  p.button('kind', 'small-group').onclick(); await settle(); assert.equal(p.el('spotsLabel').hidden, false);
  p.el('spots').value = '4';
  assert.doesNotMatch(p.el('times').innerHTML, /10:00 AM/, 'only open times can become a private group');
  p.button('opening', 'one').onclick(); await settle();
  assert.match(p.el('summary').innerHTML, /Private small-group lesson[\s\S]*4 spots: Sam and 3 for families you invite[\s\S]*\$35\.00 per wrestler/);
  assert.equal(p.el('requestArea').hidden, false); assert.equal(p.el('payArea').hidden, true);
  await p.el('requestGroup').onclick(); await settle();
  assert.deepEqual(p.calls.find(c => c.body?.action === 'request').body, {action: 'request', openingId: 'one', format: 'small-group', spots: 4, wrestlerIds: ['w1']});
}
// Your private groups: the invite link with a Copy button, who has joined, and calling it off.
{
  const p = page('app/lesson/screen.html', {fetch: async url => json(url.startsWith('/api/lessons') ? {formats, openings: [], mine: [myGroup]} : url === '/api/family' ? {data: {wrestlers}} : {ok: true})});
  await settle();
  assert.equal(p.el('closed').hidden, true, 'a family with a group is not told there is nothing to book');
  assert.equal(p.el('mine').hidden, false);
  const g = p.el('mineList').innerHTML;
  assert.match(g, /Partner lesson<\/strong> with Coach Dana[\s\S]*1 of 2 spots left[\s\S]*Tue, Nov 10 · 9:30 AM–10:30 AM/);
  assert.match(g, new RegExp(`value="https://swa.test/lesson\\?join=${'C'.repeat(32)}"`));
  assert.match(g, /Copy link/); assert.match(g, /Sam<\/span><span class="state">Kept for you · pay the academy/);
  assert.match(g, /data-cancel="pg">Call off this group/);
  p.el('link-pg').value = 'https://swa.test/lesson?join=' + 'C'.repeat(32);
  await p.button('copy', 'pg').onclick(); await settle();
  assert.equal(p.calls.find(c => c.copied).copied, 'https://swa.test/lesson?join=' + 'C'.repeat(32)); assert.match(p.el('status').textContent, /Invite link copied/);
  await p.button('cancel', 'pg').onclick(); await settle();
  assert.deepEqual(p.calls.find(c => c.body?.action === 'cancel').body, {action: 'cancel', openingId: 'pg'});
  const paid = page('app/lesson/screen.html', {fetch: async url => json(url.startsWith('/api/lessons') ? {formats, openings: [], mine: [{...myGroup, spotsLeft: 0, roster: [{wrestler: 'Sam', status: 'paid'}, {wrestler: 'Riley', status: 'paid'}]}]} : {data: {wrestlers}})});
  await settle();
  assert.match(paid.el('mineList').innerHTML, />Full</); assert.doesNotMatch(paid.el('mineList').innerHTML, /Call off|Copy link/, 'a full, paid group has nothing to share or call off');
}
// An invite link opens straight to joining that group.
{
  const invite = {...myGroup, mine: false, organizer: 'Pat Example', inviteCode: undefined, roster: undefined};
  const p = page('app/lesson/screen.html', {search: '?join=' + 'C'.repeat(32), fetch: async url => json(url.startsWith('/api/lessons') ? {formats, openings: [], mine: [], invite} : url === '/api/family' ? {data: {wrestlers}} : {review: {title: 'Partner lesson', coach: 'Coach Dana', dates: ['2026-11-10'], start: '09:30', end: '10:30', wrestler: 'Sam', cents: 4500, capacity: 2, spotsLeft: 1, message: ''}, paymentsEnabled: false})});
  await settle();
  assert.equal(p.calls[0].url, '/api/lessons?join=' + 'C'.repeat(32));
  assert.equal(p.el('joinBox').hidden, false); assert.equal(p.el('stepType').hidden, true, 'no other choices in the way');
  assert.equal(p.el('joinHeading').textContent, 'Join Pat Example’s group');
  assert.match(p.el('joinInfo').innerHTML, /Private partner lesson<\/strong> with Coach Dana[\s\S]*1 of 2 spots left · \$45\.00 per wrestler/);
  assert.deepEqual(p.calls.find(c => c.url === '/api/booking-review').body, {type: 'lesson', wrestlerId: 'w1', openingId: 'pg', invite: 'C'.repeat(32)});
  assert.equal(p.el('reviewBox').hidden, false); assert.equal(p.el('reviewHeading').textContent, 'Review'); assert.equal(p.el('notOpen').hidden, false);
  const full = page('app/lesson/screen.html', {search: '?join=x', fetch: async url => json(url.startsWith('/api/lessons') ? {formats, openings: [], mine: [], invite: {...invite, spotsLeft: 0}} : {data: {wrestlers}})});
  await settle();
  assert.match(full.el('joinInfo').innerHTML, /This group is full/); assert.equal(full.el('joinWrestlerLabel').hidden, true);
  const broken = page('app/lesson/screen.html', {search: '?join=bad', fetch: async url => url.startsWith('/api/lessons?join') ? json({formats, openings, mine: [], error: 'This invite link isn’t working.'}, false) : json(url.startsWith('/api/lessons') ? {formats, openings, mine: []} : {data: {wrestlers}})});
  await settle();
  assert.equal(broken.el('status').textContent, 'This invite link isn’t working.'); assert.equal(broken.el('joinBox').hidden, true); assert.equal(broken.el('stepType').hidden, false);
}

// Coach home: each lesson's roster, spots left, and coach-hosted or family-requested; posting sets the type and spots.
{
  const roster = [{wrestler: 'Sam', parent: 'Pat Example', phone: '555-0100', email: 'pat@example.test', status: 'paid'}, {wrestler: 'Riley', parent: 'Riley Parent', phone: '555-0200', email: 'r@example.test', status: 'paying'}];
  const list = [{id: 'g', date: '2026-11-09', start: '10:00', end: '11:00', format: 'small-group', formatName: 'Small-group lesson', capacity: 4, spotsLeft: 2, hosted: 'coach', organizer: null, roster},
    {id: 'f', date: '2026-11-10', start: '15:00', end: '16:00', format: 'partner', formatName: 'Partner lesson', capacity: 2, spotsLeft: 1, hosted: 'family', organizer: 'Pat Example', roster: [{wrestler: 'Sam', parent: 'Pat Example', phone: '555-0100', email: '', status: 'kept'}]},
    {id: 'o', date: '2026-11-11', start: '15:00', end: '16:00', format: null, formatName: '', capacity: 1, spotsLeft: 1, hosted: null, organizer: null, roster: []}];
  const p = page('app/coach/screen.html', {fetch: async u => json(u === '/api/roster' ? {sessions: []} : u === '/api/coach' ? {name: 'Coach Dana', programs: [], openings: list} : {ok: true})});
  await settle();
  const html = p.el('slots').innerHTML, articles = html.split('<article').slice(1);
  assert.match(articles[0], /Small-group lesson[\s\S]*2 of 4 spots left[\s\S]*Coach-hosted[\s\S]*<b>Sam<\/b><br>Parent: Pat Example · <a href="tel:555-0100">555-0100<\/a>[\s\S]*<b>Riley<\/b> <span class="tag">Paying now/);
  assert.doesNotMatch(articles[0], /data-slot/, 'a booked lesson cannot be removed');
  assert.match(articles[0], /data-edit="g"/);
  assert.match(articles[1], /Partner lesson[\s\S]*1 of 2 spots left[\s\S]*Family-requested private group, organised by Pat Example[\s\S]*Sam<\/b> <span class="tag">Not paid yet/);
  assert.doesNotMatch(articles[1], /data-edit/, 'a family’s group is theirs'); assert.match(articles[1], /data-slot="f" data-family="1"/);
  assert.match(articles[2], /A family can book a one-on-one or ask for a private partner or small group[\s\S]*data-slot="o"/);
  // Saving a lesson type change sends the type and spots.
  await p.button('edit', 'g').onclick(); await settle();
  assert.deepEqual(p.calls.find(c => c.body?.action === 'update').body, {action: 'update', id: 'g', format: 'small-group', spots: 4});
  // Posting: the spots field shows only for a small group; the form sends type and spots.
  p.el('format').value = 'small-group'; p.el('format').onchange(); assert.equal(p.el('spotsLabel').hidden, false);
  p.el('format').value = 'partner'; p.el('format').onchange(); assert.equal(p.el('spotsLabel').hidden, true);
  const fd = {date: '2026-11-12', start: '10:00', end: '11:00', format: 'small-group', spots: '5'};
  vm.runInContext('globalThis.FormData=function(){return Object.entries(globalThis.__fd)}', p.ctx); p.ctx.__fd = fd;
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('openingInput({})', p.ctx))), {action: 'add', date: '2026-11-12', start: '10:00', end: '11:00', format: 'small-group', spots: 5});
  p.ctx.__fd = {...fd, format: ''};
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('openingInput({})', p.ctx))), {action: 'add', date: '2026-11-12', start: '10:00', end: '11:00', format: null});
}

// Payments: the owner picks the time or group (with spots left and private groups named), and the lesson type follows it.
{
  const lessonsList = {formats, openings: [at('one', {coach: 'Coach Dana'}), at('grp', {format: 'small-group', capacity: 4, spotsLeft: 2, closed: false}), at('pg', {format: 'partner', capacity: 2, spotsLeft: 0, kept: 1, closed: true, organizer: 'Pat Example'})]};
  const p = page('app/payments/screen.html', {fetch: async u => json(u === '/api/lessons' ? lessonsList : u.startsWith('/api/public-schedule') ? {programs: [], practices: [], events: [], liveClasses: []} : u.startsWith('/api/payments?families') ? {families: []} : {payments: [], totals: {collectedCents: 0, onlineCents: 0, offlineCents: 0, refundedCents: 0, count: 0}})});
  await settle();
  p.el('kind').value = 'lesson'; p.el('opening').value = 'pg';
  await vm.runInContext('renderItemFields()', p.ctx);
  assert.match(p.el('opening').innerHTML, /open time[\s\S]*Small-group lesson · 2 of 4 spots left[\s\S]*Partner lesson, private group of Pat Example · 0 of 2 spots left, 1 kept for their wrestlers/);
  assert.match(p.el('format').innerHTML, /^<option value="partner">Partner lesson · \$45\.00 per wrestler<\/option>$/, 'a group’s type is fixed');
  p.el('opening').value = 'one'; await vm.runInContext('renderItemFields()', p.ctx);
  assert.match(p.el('format').innerHTML, /^<option value="one-on-one">One-on-one lesson · \$60\.00 per wrestler<\/option>$/, 'an open time is a one-on-one');
}

// Lesson settings and coach pay say "per wrestler".
assert.match(readFileSync('app/lesson-settings/screen.html', 'utf8'), /<h2>Price per wrestler<\/h2>[\s\S]*\(\$ per wrestler\)/);
assert.match(readFileSync('app/coach-pay/screen.html', 'utf8'), /c\.wrestlers>c\.lessons\?' · '\+c\.wrestlers\+' wrestlers'/);
// Sign-in keeps an invite link.
assert.match(readFileSync('app/lesson/route.ts', 'utf8'), /redirect='\/login\?next='\+next/);
assert.match(readFileSync('public/registration-return.js', 'utf8'), /\['\/register','\/booking','\/lesson'\]/);

console.log('Group lesson tests passed');
