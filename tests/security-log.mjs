// Issue #127: the owner's Security activity page reads in plain words, with names instead of internal ids and
// New York times instead of raw timestamps.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import ts from 'typescript';

const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/' + f, 'utf8'));
const DB = {prepare(sql) { let a = []; return {bind(...v) { a = v; return this; }, async all() { return {results: sqlite.prepare(sql).all(...a)}; }, async first() { return sqlite.prepare(sql).get(...a) ?? null; }}; }};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = {exports: {}}; cache.set(file, module.exports);
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
    {module, exports: module.exports, Intl, Date, Number, String, Object, Array, JSON, require(name) {
      if (name === 'cloudflare:workers') return {env: {DB}};
      return load('lib/' + name.replace('./', '') + '.ts');
    }});
  return cache.get(file);
}
const {describeSecurityEvent, securityLog} = load('lib/security-log.ts');

const at = '2026-11-06T19:13:22.069Z', now = new Date('2026-11-06T20:00:00Z');
const run = (sql, ...v) => sqlite.prepare(sql).run(...v);
run("INSERT INTO family_accounts(user_id,email,payload,revision,updated_at) VALUES ('fam-a','pat@example.test',?,1,?)", JSON.stringify({parentName: 'Pat Example', wrestlers: [{id: 'w1', name: 'Sam Example', grade: '8'}]}), at);
run("INSERT INTO staff_access(email,name,programs,active,updated_at) VALUES ('dana@example.test','Coach Dana','[\"Intermediate\"]',1,?)", at);
run("INSERT INTO coach_openings(id,user_id,date,start,end,coach_email) VALUES ('op1','coach-1','2026-11-09','15:00','16:00','dana@example.test')");
run("INSERT INTO waiver_versions(id,title,body,sha256,published_at,published_by) VALUES ('wv1','Participation waiver','text','x',?,'owner')", at);
run(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,source)
  VALUES ('ord1','fam-a','pat@example.test','w1','Sam Example','event','camp','Winter camp','[]',14400,0,14400,'usd','{}',0,'paid','k1',0,?,?,'offline')`, at, at);

const events = [
  ['supabase:owner-1', 'offline_payment_recorded', 'ord1 event 14400'],
  ['fam-a', 'waiver_signed', 'wv1/w1'],
  ['coach-1', 'coach_opening_added', ''],
  ['owner-1', 'coach_access_granted', 'dana@example.test'],
  ['owner-1', 'practice_plan_shared', 'Intermediate:2026-11-06'],
  ['supabase:owner-1', 'membership_transferred', 'ord1 Intermediate->Advanced 2026-11-11'],
  ['supabase:owner-1', 'booking_exception_granted', 'waiver fam-a/w1 until 2026-12-06'],
  ['supabase:owner-1', 'announcement_sent', 'a1 1'],
  ['owner-1', 'backup_restored', 'v3:' + 'practice_curriculum_groups+'.repeat(40)],
  ['stripe', 'stripe_event_rejected', 'evt_1 rejected:amount-mismatch'],
  ['someone-gone', 'mfa_verified', ''],
];
for (const [i, [actor, action, target]] of events.entries()) run('INSERT INTO security_events(id,actor,action,target,created_at) VALUES (?,?,?,?,?)', 'e' + i, actor, action, target, new Date(Date.parse(at) - i * 1000).toISOString());

const log = await securityLog(['supabase:owner-1', 'owner-1']);
const byTitle = Object.fromEntries(log.map(e => [e.title, e]));
assert.equal(log.length, events.length);
assert.equal(byTitle['Offline payment recorded'].detail, 'Sam Example · Winter camp · $144.00');
assert.equal(byTitle['Offline payment recorded'].who, 'You');
assert.equal(byTitle['Waiver signed'].detail, 'Participation waiver · Sam Example');
assert.equal(byTitle['Waiver signed'].who, 'Pat Example (pat@example.test)');
assert.equal(byTitle['Lesson opening added'].who, 'Coach Dana (dana@example.test)', 'a coach is named, not shown as an id');
assert.equal(byTitle['Coach access given'].detail, 'Coach Dana (dana@example.test)');
assert.equal(byTitle['Practice plan shared with coaches'].detail, 'SWA Intermediate · Fri, Nov 6');
assert.equal(byTitle['Membership moved to another program'].detail, 'Sam Example: SWA Intermediate → SWA Advance from Nov 11, 2026');
assert.equal(byTitle['Booking allowed anyway'].detail, 'Sam Example may book without a signed waiver until Dec 6, 2026');
assert.equal(byTitle['Announcement sent'].detail, 'Sent to 1 family');
assert.equal(byTitle['Backup restored'].detail, '', 'no list of internal table names');
assert.equal(byTitle['Stripe message refused'].who, 'Stripe');
assert.match(byTitle['Stripe message refused'].detail, /amount paid did not match/);
assert.equal(byTitle['Authenticator code verified'].who, 'Another account');
for (const e of log) {
  assert.match(e.at, /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}(, \d{4})? · \d{1,2}:\d{2} [AP]M$/, 'readable New York time: ' + e.at);
  assert.ok(!/supabase:|owner-1|fam-a|ord1|wv1|_/.test(e.title + e.detail + e.who), 'no internal ids or action codes: ' + JSON.stringify(e));
}
// An action this page does not know yet still reads as words.
assert.equal(describeSecurityEvent({actor: 'x', action: 'something_new', target: '', created_at: at}, {people: {}, you: [], approvals: {}, waitlist: {}, orders: {}, waivers: {}, wrestlers: {}, requests: {}, curricula: {}, coaches: {}}, now).title, 'Something new');

// The page wraps long values instead of scrolling sideways.
const route = readFileSync('app/security-log/route.ts', 'utf8');
assert.match(route, /article\{[^}]*overflow-wrap:anywhere/);
assert.ok(!/Account \$\{/.test(route), 'no raw account ids on the page');

console.log('Security activity tests passed');
