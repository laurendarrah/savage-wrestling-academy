// Issue #22: real roster from paid orders and scholarships, with idempotent check-in and staff access rules.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }, async run() { return {meta: sqlite.prepare(sql).run(...a)}; },
  _execute() { const st = sqlite.prepare(sql); return st.columns().length ? {results: st.all(...a)} : {results: [], meta: st.run(...a)}; }}; },
  async batch(list) { sqlite.exec('BEGIN'); try { const r = list.map(x => x._execute()); sqlite.exec('COMMIT'); return r; } catch (e) { sqlite.exec('ROLLBACK'); throw e; } }};

let actor = {kind: 'owner'};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, crypto, Intl, Date, URL, Response, Request, Headers, JSON, Map, Set, Object, Array, String, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env: {DB}};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test',
          ownerIdentity: async () => ({owner: actor.kind === 'owner' && actor.strong !== false ? {userId: 'owner-id'} : null, mfaRequired: actor.kind === 'owner' && actor.strong === false, headers: new Headers()}),
          strongAccount: async () => ({user: actor.kind === 'none' ? null : {id: actor.id ?? 'someone', email: 'x@example.test', email_confirmed_at: 'yes'}, strong: actor.strong !== false, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin,
          accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/access-control')) return {accountRole: async () => actor.kind === 'coach' ? {role: 'coach', staff: {email: 'coach@example.test', name: 'Coach', programs: actor.programs}} : {role: actor.kind === 'family' ? 'family' : 'anonymous', staff: null}};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}

const ny = n => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0), tomorrow = ny(1);
const all = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
const state = {programNamingVersion: 2,
  programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000}, {id: 'Advanced', name: 'SWA Advance', priceCents: 20000}],
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(60), weekly: all, excludedDates: []}, {program: 'Advanced', start: ny(-30), end: ny(60), weekly: all.map(w => ({...w, start: '19:30', end: '21:00'})), excludedDates: []}],
  events: [{id: 'camp-1', name: 'Takedown Camp', type: 'Camp', dates: [today, tomorrow], price: 160, slots: 20}],
  extraPractices: [{id: 'fnl', name: 'Friday Night Live', dates: [today], enabled: true, start: '17:00', end: '18:00', memberCents: 1000, nonMemberCents: 2000}]};
sqlite.prepare('INSERT INTO academy_state VALUES (?,?,?,?,?)').run('academy', JSON.stringify(state), 1, 'owner', today);
const fam = (uid, parent, phone, wrestlers) => sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(uid, uid + '@example.test', JSON.stringify({parentName: parent, phone, wrestlers}), 1, today);
fam('p1', 'Pat One', '555-0101', [{id: 'w1', name: 'Avery Member', grade: '9'}]);
fam('p2', 'Pat Two', '555-0102', [{id: 'w2', name: 'Blake Walkin', grade: '8'}]);
fam('p3', 'Pat Three', '', [{id: 'w3', name: 'Casey Refunded', grade: '10'}]);
fam('p4', 'Pat Four', '555-0104', [{id: 'w4', name: 'Dana Scholar', grade: 'K'}]);
let n = 0;
const order = (uid, wid, name, kind, status, o = {}) => sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end)
  VALUES (?,?,?,?,?,?,?,?,?,?,1000,0,1000,'usd','{}','{}',?,?,0,?,?,?,?,?)`).run('o' + ++n, uid, 'x', wid, name, kind, o.program ?? null, o.item ?? 'x', 'label', JSON.stringify(o.dates ?? []), status, 'k' + n, today, today, today, o.start ?? null, o.end ?? null);
order('p1', 'w1', 'Avery Member', 'annual', 'paid', {program: 'Intermediate', item: 'Intermediate', start: ny(-10), end: ny(355)});
order('p2', 'w2', 'Blake Walkin', 'walkin', 'paid', {program: 'Intermediate', item: `Intermediate:${tomorrow}:18:00`, dates: [tomorrow]});
order('p3', 'w3', 'Casey Refunded', 'annual', 'refunded', {program: 'Intermediate', item: 'Intermediate', start: ny(-10), end: ny(355)});
order('p1', 'w1', 'Avery Member', 'live', 'paid', {item: 'fnl', dates: [today]});
order('p2', 'w2', 'Blake Walkin', 'event', 'paid', {item: 'camp-1', dates: [today, tomorrow]});
order('p3', 'w3', 'Casey Refunded', 'event', 'pending', {item: 'camp-1', dates: [today, tomorrow]});
sqlite.prepare(`INSERT INTO scholarship_awards(id,token_hash,recipient_email,wrestler_name,program,reference_cents,terms_text,terms_ready,revision,status,user_id,wrestler_id,signer,accepted_at,expires_at,created_at,created_by)
  VALUES ('s1',?,?,'Dana Scholar','Intermediate',20000,'t',1,1,'active','p4','w4','Pat Four',?,?,?,'owner')`).run('h'.repeat(64), 'p4@example.test', ny(-5) + 'T12:00:00Z', ny(30), ny(-6));

const api = load(path.resolve('app/api/roster/route.ts'));
const ORIGIN = 'https://savage.test';
const get = async q => { const r = await api.GET(new Request(ORIGIN + '/api/roster' + q)); return {status: r.status, body: await r.json()}; };
const post = async (b, origin = ORIGIN) => { const r = await api.POST(new Request(ORIGIN + '/api/roster', {method: 'POST', headers: {'content-type': 'application/json', origin}, body: JSON.stringify(b)})); return {status: r.status, body: await r.json()}; };
const names = s => s.entries.map(e => e.name);
const find = (sessions, prefix) => sessions.find(s => s.key.startsWith(prefix));

// --- Owner, today ---
let r = await get('');
assert.equal(r.status, 200); assert.equal(r.body.date, today); assert.equal(r.body.role, 'owner');
let practice = find(r.body.sessions, 'practice:Intermediate:');
assert.deepEqual(names(practice), ['Avery Member', 'Dana Scholar'], 'member and scholarship; refunded excluded; tomorrow\'s walk-in not today');
assert.deepEqual([...practice.entries.find(e => e.name === 'Dana Scholar').sources], ['Scholarship']);
assert.equal(practice.entries.find(e => e.name === 'Avery Member').phone, '555-0101');
assert.equal(practice.entries.find(e => e.name === 'Avery Member').email, 'p1@example.test', 'owner sees email');
assert.equal(practice.entries.find(e => e.name === 'Dana Scholar').grade, 'K');
assert.deepEqual(names(find(r.body.sessions, 'live:fnl:')), ['Avery Member'], 'Friday Night Live: paid only');
assert.deepEqual(names(find(r.body.sessions, 'event:camp-1:')), ['Blake Walkin'], 'camp: paid only, pending excluded');
assert.ok(find(r.body.sessions, 'practice:Advanced:'), 'other program practice listed');
assert.deepEqual(names(find(r.body.sessions, 'practice:Advanced:')), []);

// --- Owner, tomorrow: walk-in appears on its own date ---
r = await get('?date=' + tomorrow);
assert.deepEqual(names(find(r.body.sessions, 'practice:Intermediate:')), ['Avery Member', 'Blake Walkin', 'Dana Scholar']);
assert.deepEqual([...find(r.body.sessions, 'practice:Intermediate:').entries.find(e => e.name === 'Blake Walkin').sources], ['Walk-in paid']);
assert.equal((await get('?date=2026-02-30')).status, 400);

// --- Check-in ---
const key = practice.key;
r = await post({action: 'checkin', date: today, sessionKey: key, userId: 'p1', wrestlerId: 'w1'});
assert.equal(r.status, 200);
let entry = find(r.body.sessions, 'practice:Intermediate:').entries.find(e => e.wrestlerId === 'w1');
assert.ok(entry.checkedInAt); assert.equal(entry.checkedInBy, 'owner-id');
assert.equal(find(r.body.sessions, 'practice:Intermediate:').checkedIn, 1);
await post({action: 'checkin', date: today, sessionKey: key, userId: 'p1', wrestlerId: 'w1'});
assert.equal(sqlite.prepare('SELECT count(*) n FROM attendance').get().n, 1, 'double tap records once');
assert.equal((await post({action: 'checkin', date: today, sessionKey: key, userId: 'p3', wrestlerId: 'w3'})).status, 409, 'refunded wrestler cannot be checked in');
assert.equal((await post({action: 'checkin', date: today, sessionKey: key, userId: 'p2', wrestlerId: 'w2'})).status, 409, 'walk-in for another day cannot be checked in today');
assert.equal((await post({action: 'checkin', date: today, sessionKey: 'practice:Intermediate:1999-01-01:18:00', userId: 'p1', wrestlerId: 'w1'})).status, 404);
assert.equal((await post({action: 'checkin', date: today, sessionKey: key, userId: 'p1', wrestlerId: 'w1'}, 'https://evil.test')).status, 403);
assert.equal((await post({action: 'teleport', date: today, sessionKey: key, userId: 'p1', wrestlerId: 'w1'})).status, 400);
r = await post({action: 'undo', date: today, sessionKey: key, userId: 'p1', wrestlerId: 'w1'});
assert.equal(r.status, 200); assert.equal(sqlite.prepare('SELECT count(*) n FROM attendance').get().n, 0);
await post({action: 'checkin', date: today, sessionKey: key, userId: 'p4', wrestlerId: 'w4'});
const row = sqlite.prepare('SELECT * FROM attendance').get();
assert.equal(row.wrestler_name, 'Dana Scholar'); assert.equal(row.source, 'Scholarship'); assert.equal(row.session_date, today);

// --- Coach: assigned programs, today only, no email ---
actor = {kind: 'coach', id: 'coach-id', programs: ['Advanced']};
r = await get('');
assert.equal(r.status, 200); assert.equal(r.body.role, 'coach');
assert.deepEqual(r.body.sessions.map(s => s.key.split(':').slice(0, 2).join(':')), ['practice:Advanced'], 'coach sees only assigned program practices');
assert.equal((await get('?date=' + tomorrow)).status, 403, 'coach cannot open other dates');
assert.equal((await post({action: 'checkin', date: today, sessionKey: key, userId: 'p1', wrestlerId: 'w1'})).status, 404, 'coach cannot check in for an unassigned program');
actor = {kind: 'coach', id: 'coach-id', programs: ['Intermediate']};
r = await get('');
assert.equal(find(r.body.sessions, 'practice:Intermediate:').entries.every(e => e.email === null && e.checkedInBy === null), true, 'coach does not see parent email or who checked in');
r = await post({action: 'checkin', date: today, sessionKey: key, userId: 'p1', wrestlerId: 'w1'});
assert.equal(r.status, 200);
assert.equal(sqlite.prepare("SELECT checked_in_by FROM attendance WHERE wrestler_id='w1'").get().checked_in_by, 'coach-id');
assert.equal((await post({action: 'checkin', date: tomorrow, sessionKey: key, userId: 'p1', wrestlerId: 'w1'})).status, 403);

// --- Everyone else ---
actor = {kind: 'coach', id: 'coach-id', programs: ['Intermediate'], strong: false};
assert.equal((await get('')).status, 403, 'coach without authenticator refused');
actor = {kind: 'owner', strong: false};
assert.match((await get('')).body.error, /Authenticator/);
actor = {kind: 'family', id: 'p1'};
assert.equal((await get('')).status, 403, 'families cannot see rosters');
assert.equal((await post({action: 'checkin', date: today, sessionKey: key, userId: 'p1', wrestlerId: 'w1'})).status, 403);
actor = {kind: 'none'};
assert.equal((await get('')).status, 403);

console.log('Passed: roster lists members, paid walk-ins for their own date, scholarships, paid Friday Night Live and camp registrations, excludes refunded and unpaid; check-in is idempotent, refuses non-entitled wrestlers, supports undo; coaches see only assigned programs today without parent email; families and anonymous users are refused.');
