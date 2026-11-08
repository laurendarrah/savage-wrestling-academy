// Issue #259: the owner deletes a family account on /accounts (first for the test family of the launch test pass, #24).
// Payments stay for the books without the family; records whose retention isn't decided stay unless it is a test account.
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
    {module, exports: module.exports, crypto, btoa, atob, TextEncoder, TextDecoder, Uint8Array, Intl, Date, URL, URLSearchParams, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, Promise, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {appOrigin: () => 'https://swa.test', OWNER_EMAIL: 'savagewrestlingclub@gmail.com',
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, user: {id: actor.id}, headers: new Headers()}),
          sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}

const ins = (table, row) => sqlite.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
const count = (sql, ...a) => sqlite.prepare(`SELECT count(*) AS n FROM ${sql}`).get(...a).n;
const day = n => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = day(0), past = day(-5), soon = day(5), at = new Date().toISOString(), old = new Date(Date.now() - 3 * 86400000).toISOString();

const fam = (u, name, email = u + '@example.test') => ins('family_accounts', {user_id: u, email, revision: 1, updated_at: at,
  payload: JSON.stringify({parentName: name, phone: '555-0100', homeAddress: '1 Main St', homeCity: 'Huntington', homeState: 'NY', homeZip: '11746', emergencyContactName: 'Jordan', emergencyContactPhone: '631-555-0100',
    wrestlers: [{id: 'w-' + u, name: 'Wrestler ' + u, grade: '8', birthDate: '2012-04-18', allergies: 'Peanuts ' + u, usaw: '1234567890'}]})});
let orderN = 0;
const order = (u, o = {}) => { const id = o.id ?? 'o' + (++orderN); ins('orders', {id, user_id: u, email: u + '@example.test', wrestler_id: 'w-' + u, wrestler_name: 'Wrestler ' + u, kind: 'walkin', program: 'Intermediate',
  item_id: 'x', item_label: 'SWA Intermediate walk-in', dates: JSON.stringify([past]), base_cents: 4000, discount_cents: 0, amount_cents: 4000, currency: 'usd', pricing: '{}', terms_accepted: '{}',
  status: 'paid', dedupe_key: `${u}|w-${u}|walkin|${id}`, livemode: 0, created_at: old, updated_at: old, paid_at: old, source: 'stripe', ...o}); return id; };
// Everything a family can have, for family u.
function seed(u, name) {
  fam(u, name);
  const paid = order(u, {stripe_session_id: 'cs_' + u, stripe_payment_intent: 'pi_' + u});
  order(u, {status: 'refunded'}); order(u, {status: 'canceled', source: 'offline', pricing: '{"method":"cash","voidReason":"test"}'});
  ins('payment_refunds', {id: 're_' + u, order_id: paid, payment_intent: 'pi_' + u, charge_id: 'ch_' + u, amount_cents: 4000, refunded_cents: 1000, refunded_at: old, livemode: 0, received_at: old});
  ins('stripe_events', {id: 'evt_' + u, type: 'checkout.session.completed', order_id: paid, outcome: 'paid', received_at: old});
  ins('cash_bookings', {id: 'cb-' + u, user_id: u, email: u + '@example.test', wrestler_id: 'w-' + u, wrestler_name: 'Wrestler ' + u, kind: 'walkin', program: 'Intermediate', item_id: 'p', item_label: 'Walk-in',
    session_date: past, base_cents: 4000, discount_cents: 0, amount_cents: 4000, pricing: '{}', dedupe_key: 'cb-' + u, status: 'canceled', created_at: old, updated_at: old});
  ins('usaw_reviews', {user_id: u, wrestler_id: 'w-' + u, number: '1234567890', expires: soon, status: 'valid', note: '', reviewed_by: 'owner-id', reviewed_at: old});
  ins('usaw_lookups', {user_id: u, wrestler_id: 'w-' + u, number: '1234567890', expires: soon, season: '2027', status: 'active', outcome: 'verified', card_name: name, card_state: 'NY', checked_at: old});
  ins('wrestler_passes', {id: 'pass-' + u, user_id: u, wrestler_id: 'w-' + u, token: ('T' + u).padEnd(32, 'x'), created_at: old});
  ins('booking_exceptions', {id: 'ex-' + u, user_id: u, wrestler_id: 'w-' + u, rule: 'usaw', starts_on: past, ends_on: soon, reason: 'Paper card', created_by: 'owner-id', created_at: old});
  ins('family_messages', {id: 'm-' + u, user_id: u, sender_role: 'family', body: 'Hello from ' + name, created_at: old, email_status: 'skipped'});
  ins('announcement_recipients', {announcement_id: 'ann', user_id: u, email: u + '@example.test', email_status: 'sent'});
  ins('notifications', {id: 'n-' + u, user_id: u, email: u + '@example.test', kind: 'payment_recorded', subject: 'Payment received', body: 'For Wrestler ' + u, dedupe_key: 'n-' + u, created_at: old, email_status: 'sent'});
  ins('data_requests', {id: 'dr-' + u, user_id: u, email: u + '@example.test', kind: 'close', note: 'Moving', status: 'open', created_at: old});
  ins('waiver_signatures', {id: 'sig-' + u, version_id: 'wv', user_id: u, wrestler_id: 'w-' + u, wrestler_name: 'Wrestler ' + u, signer: name, email: u + '@example.test', signature_record: '{}', signed_at: old});
  ins('signature_reissues', {signature_id: 'sig-' + u, user_id: u, reason: 'New text', reissued_by: 'owner-id', reissued_at: old});
  ins('scholarship_awards', {id: 'sch-' + u, token_hash: 'h1' + u, recipient_email: u + '@example.test', wrestler_name: 'Wrestler ' + u, program: 'Intermediate', reference_cents: 20000, terms_text: 'Terms', terms_ready: 1, revision: 1, status: 'ended', user_id: u, wrestler_id: 'w-' + u, signer: name, accepted_at: old, ended_at: old, expires_at: soon, created_at: old, created_by: 'owner-id'});
  ins('scholarship_awards', {id: 'offer-' + u, token_hash: 'h2' + u, recipient_email: (u + '@Example.test'), wrestler_name: 'Wrestler ' + u, program: 'Intermediate', reference_cents: 20000, terms_text: 'Terms', terms_ready: 1, revision: 1, status: 'offered', expires_at: soon, created_at: old, created_by: 'owner-id'});
  ins('attendance', {id: 'att-' + u, session_key: 'practice:Intermediate:' + past + ':18:00', session_date: past, user_id: u, wrestler_id: 'w-' + u, wrestler_name: 'Wrestler ' + u, source: 'Member', checked_in_at: old, checked_in_by: 'owner-id'});
  ins('program_approvals', {id: 'ap-' + u, user_id: u, wrestler_id: 'w-' + u, program: 'Advanced', wrestler_name: 'Wrestler ' + u, grade: '8', status: 'approved', created_at: old, updated_at: old});
  ins('approval_messages', {id: 'am-' + u, approval_id: 'ap-' + u, sender_id: u, sender_role: 'parent', body: 'Please', created_at: old});
  // A private group they asked for: one past, one to come that nobody paid for, and one to come another family paid for.
  for (const [id, date] of [['g-past-' + u, past], ['g-open-' + u, soon], ['g-paid-' + u, soon]])
    ins('coach_openings', {id, user_id: 'coach', date, start: '16:00', end: '17:00', coach_email: 'coach@example.test', format: 'partner', capacity: 2, closed: 1, invite_code: ('I' + id).padEnd(32, 'y').slice(0, 32), organizer_id: u, organizer_wrestlers: JSON.stringify(['w-' + u])});
}
ins('announcements', {id: 'ann', subject: 'Hi', body: 'Hello', audience: '{}', audience_label: 'Everyone', sent_by: 'owner-id', sent_at: old, recipients: 3});
ins('waiver_versions', {id: 'wv', title: 'Participation waiver', body: 'Text', sha256: 'x', published_at: old, published_by: 'owner-id', kind: 'waiver'});
seed('tf', 'Terry Test'); seed('of', 'Olive Other'); seed('t2', 'Tess Two');
order('of', {kind: 'lesson', item_id: 'g-paid-tf', dates: JSON.stringify([soon])});
ins('notifications', {id: 'owner-notice', user_id: null, email: 'savagewrestlingclub@gmail.com', kind: 'owner', subject: 'Owner notice', body: 'x', dedupe_key: 'owner-notice', created_at: old, email_status: 'sent'});

const api = load(path.resolve('app/api/accounts/route.ts'));
const lib = load(path.resolve('lib/family-deletion.ts'));
const O = 'https://a.test';
const post = (body, origin = O) => api.POST(new Request(O + '/api/accounts', {method: 'POST', headers: {'content-type': 'application/json', origin}, body: JSON.stringify(body)}));
const snapshot = () => sqlite.prepare("SELECT (SELECT count(*) FROM family_accounts) f,(SELECT count(*) FROM orders) o,(SELECT group_concat(user_id) FROM orders) u").get();

// --- Only the owner, from the site itself ---
actor = {owner: false, id: 'tf'};
assert.equal((await post({action: 'delete', userId: 'of', confirm: 'Olive Other'})).status, 403, 'a family cannot delete an account');
actor = {owner: true, id: 'owner-id'};
assert.equal((await post({action: 'delete', userId: 'tf', confirm: 'Terry Test'}, 'https://evil.test')).status, 403, 'another site cannot');
assert.equal((await post({action: 'erase', userId: 'tf', confirm: 'Terry Test'})).status, 400);
assert.equal((await post({action: 'delete', userId: 'nobody', confirm: 'x'})).status, 404);

// --- The typed name must match the family's name as shown ---
const before = snapshot();
let r = await post({action: 'delete', userId: 'tf', confirm: 'Terry'});
assert.equal(r.status, 400); assert.match((await r.json()).error, /type Terry Test exactly as shown/);
assert.equal((await post({action: 'delete', userId: 'tf', confirm: 'Olive Other'})).status, 400, 'another family’s name does not delete this one');
assert.deepEqual(snapshot(), before, 'nothing changed');
assert.equal(lib.confirmMatches('  terry   TEST ', 'Terry Test'), true, 'case and spacing do not matter');
assert.equal(lib.confirmMatches('', ''), false);
assert.equal(lib.familyLabel({email: 'e@x.test', payload: '{"parentName":"  "}'}), 'e@x.test', 'no parent name: the email');

// --- Refused while anything is still going on ---
const refused = async (setup, undo, re) => {
  setup(); const res = await post({action: 'delete', userId: 'tf', confirm: 'Terry Test'});
  assert.equal(res.status, 409); assert.match((await res.json()).error, re); undo();
  assert.deepEqual(snapshot(), before, 'nothing changed while refused');
};
await refused(() => order('tf', {id: 'up', dates: JSON.stringify([past, soon])}), () => sqlite.exec("DELETE FROM orders WHERE id='up'"), /paid session that hasn't happened yet[\s\S]*refund it in Stripe/);
await refused(() => order('tf', {id: 'today', dates: JSON.stringify([today])}), () => sqlite.exec("DELETE FROM orders WHERE id='today'"), /paid session/);
await refused(() => order('tf', {id: 'mem', kind: 'monthly', term_start: past, term_end: soon}), () => sqlite.exec("DELETE FROM orders WHERE id='mem'"), /membership that is still running/);
await refused(() => { order('tf', {id: 'sub', kind: 'monthly', status: 'refunded', term_start: past, term_end: past}); ins('subscriptions', {order_id: 'sub', stripe_subscription_id: 'sub_1', status: 'active', payments_made: 1, payments_total: 12, term_start: past, term_end: soon, paid_through: soon, cancel_at: '', updated_at: old}); },
  () => sqlite.exec("DELETE FROM subscriptions; DELETE FROM orders WHERE id='sub'"), /membership/);
await refused(() => order('tf', {id: 'pend', status: 'pending', created_at: at, dates: JSON.stringify([past])}), () => sqlite.exec("DELETE FROM orders WHERE id='pend'"), /card payment in progress/);
await refused(() => ins('cash_bookings', {id: 'due', user_id: 'tf', email: 'e', wrestler_id: 'w-tf', wrestler_name: 'W', kind: 'walkin', item_id: 'p', item_label: 'Walk-in', session_date: soon, base_cents: 4000, discount_cents: 0, amount_cents: 4000, pricing: '{}', dedupe_key: 'due', status: 'due', created_at: old, updated_at: old}),
  () => sqlite.exec("DELETE FROM cash_bookings WHERE id='due'"), /pay at the academy that is still to come/);
await refused(() => sqlite.exec("UPDATE scholarship_awards SET status='active' WHERE id='sch-tf'"), () => sqlite.exec("UPDATE scholarship_awards SET status='ended' WHERE id='sch-tf'"), /active scholarship/);
await refused(() => sqlite.exec("UPDATE program_approvals SET status='pending' WHERE id='ap-tf'"), () => sqlite.exec("UPDATE program_approvals SET status='approved' WHERE id='ap-tf'"), /SWA Advance request/);
// A checkout abandoned long ago does not block.
order('tf', {id: 'stale', status: 'pending', created_at: old});

// --- A real family's closure: the profile and everyday records go; payments stay without the family; the rest stays ---
const otherBefore = sqlite.prepare("SELECT * FROM orders WHERE user_id='of' ORDER BY id").all();
const refundsBefore = count('payment_refunds'), eventsBefore = count('stripe_events'), ordersBefore = count('orders');
r = await post({action: 'delete', userId: 'tf', confirm: 'terry test'});
assert.equal(r.status, 200); const done = await r.json();
assert.equal(done.paymentsKept, 4, 'every order of the family is kept');
assert.equal(count("family_accounts WHERE user_id='tf'"), 0, 'profile gone');
for (const t of ['cash_bookings', 'usaw_reviews', 'usaw_lookups', 'wrestler_passes', 'booking_exceptions', 'family_messages', 'announcement_recipients', 'notifications', 'data_requests'])
  assert.equal(count(`${t} WHERE user_id='tf'`), 0, t + ' deleted');
assert.equal(count('orders'), ordersBefore, 'no payment deleted'); assert.equal(count('payment_refunds'), refundsBefore); assert.equal(count('stripe_events'), eventsBefore);
const kept = sqlite.prepare("SELECT * FROM orders WHERE user_id LIKE 'deleted-family-%'").all();
assert.equal(kept.length, 4); assert.equal(new Set(kept.map(o => o.user_id)).size, 1, 'one key for the family');
for (const o of kept) { assert.equal(o.email, ''); assert.equal(o.wrestler_name, 'Deleted family'); assert.equal(o.wrestler_id, o.user_id); assert.ok(!o.dedupe_key.includes('tf'), 'dedupe key without the account: ' + o.dedupe_key); }
assert.equal(sqlite.prepare("SELECT sum(amount_cents) s FROM orders WHERE user_id LIKE 'deleted-family-%' AND status='paid'").get().s, 4000, 'the books add up the same');
assert.equal(sqlite.prepare("SELECT order_id FROM payment_refunds WHERE id='re_tf'").get().order_id, kept.find(o => o.stripe_payment_intent === 'pi_tf').id, 'the refund still belongs to its payment');
assert.equal(count("orders WHERE user_id='tf'"), 0);
// Undecided retention: kept as they were.
for (const t of ['waiver_signatures', 'signature_reissues', 'program_approvals']) assert.equal(count(`${t} WHERE user_id='tf'`), 1, t + ' kept');
// Check-ins stay for the roster's history but no longer name the account (issue #272).
assert.equal(count("attendance WHERE user_id='tf'"), 0, 'no check-in points at the deleted account');
{ const a = sqlite.prepare("SELECT user_id,wrestler_id,wrestler_name FROM attendance WHERE id='att-tf'").get();
  assert.equal(a.user_id, kept[0].user_id); assert.equal(a.wrestler_name, 'Deleted family'); assert.equal(a.wrestler_id, 'w-tf', 'the wrestler id stays, so two wrestlers in one session stay distinct'); }
assert.equal(count("scholarship_awards WHERE id IN ('sch-tf','offer-tf')"), 2); assert.equal(count("approval_messages WHERE approval_id='ap-tf'"), 1);
// Private groups: the open one to come is released; the others stay without the family.
assert.deepEqual({...sqlite.prepare("SELECT closed,format,organizer_id,invite_code FROM coach_openings WHERE id='g-open-tf'").get()}, {closed: 0, format: null, organizer_id: null, invite_code: null});
for (const id of ['g-past-tf', 'g-paid-tf']) { const g = sqlite.prepare('SELECT * FROM coach_openings WHERE id=?').get(id); assert.equal(g.closed, 1); assert.equal(g.organizer_id, kept[0].user_id); assert.equal(g.organizer_wrestlers, '[]'); }
// Nobody else is touched.
assert.deepEqual(sqlite.prepare("SELECT * FROM orders WHERE user_id='of' ORDER BY id").all(), otherBefore);
for (const t of ['family_accounts', 'cash_bookings', 'usaw_reviews', 'wrestler_passes', 'family_messages', 'notifications', 'waiver_signatures', 'attendance']) assert.equal(count(`${t} WHERE user_id='of'`), 1, t + ' of another family kept');
assert.equal(count("notifications WHERE id='owner-notice'"), 1, 'the owner’s own notices stay');
assert.equal(count("coach_openings WHERE organizer_id='of' AND closed=1"), 3);
// Security activity: counts only.
let log = sqlite.prepare("SELECT * FROM security_events WHERE action='family_account_deleted'").all();
assert.equal(log.length, 1); assert.equal(log[0].actor, 'owner-id');
assert.match(log[0].target, /^deleted-family-[0-9a-f-]{36} deleted:\d+ payments-kept:4 test:0$/);
assert.ok(!/Terry|tf@|\btf\b/.test(log[0].target), 'no name, email or account in the log: ' + log[0].target);
assert.equal(Number(/deleted:(\d+)/.exec(log[0].target)[1]), done.deleted);
assert.equal(done.deleted, 1 + 9 + 0, 'profile and one row in each everyday table: ' + done.deleted);
// Twice: already gone.
assert.equal((await post({action: 'delete', userId: 'tf', confirm: 'Terry Test'})).status, 404);

// --- A test account: signed documents, scholarships, check-ins and approvals go too ---
r = await post({action: 'delete', userId: 't2', confirm: 'Tess Two', test: true});
assert.equal(r.status, 200);
for (const t of ['waiver_signatures', 'signature_reissues', 'attendance', 'program_approvals', 'family_accounts']) assert.equal(count(`${t} WHERE user_id='t2'`), 0, t + ' deleted for a test account');
assert.equal(count("scholarship_awards WHERE id IN ('sch-t2','offer-t2')"), 0, 'accepted and waiting scholarship offers deleted');
assert.equal(count("approval_messages WHERE approval_id='ap-t2'"), 0);
assert.equal(count("orders WHERE user_id='t2'"), 0); assert.equal(count("orders WHERE wrestler_name='Deleted family'"), 7, 'payments of a test account stay too');
assert.equal(count("waiver_signatures WHERE user_id='of'"), 1, 'other families keep theirs');
log = sqlite.prepare("SELECT target FROM security_events WHERE action='family_account_deleted' ORDER BY rowid").all();
assert.match(log[1].target, /test:1$/);

// --- Security activity says it plainly ---
const {describeSecurityEvent} = load(path.resolve('lib/security-log.ts'));
const names = {people: {}, you: ['owner-id'], approvals: {}, waitlist: {}, orders: {}, waivers: {}, wrestlers: {}, requests: {}, curricula: {}, coaches: {}, cash: {}};
let e = describeSecurityEvent({actor: 'owner-id', action: 'family_account_deleted', target: 'deleted-family-1 deleted:12 payments-kept:3 test:1', created_at: at}, names);
assert.equal(e.title, 'Family account deleted'); assert.equal(e.who, 'You');
assert.equal(e.detail, 'A test account · 12 records deleted · 3 payments kept for the books as “Deleted family”');
e = describeSecurityEvent({actor: 'owner-id', action: 'family_account_deleted', target: 'deleted-family-1 deleted:1 payments-kept:0 test:0', created_at: at}, names);
assert.equal(e.detail, '1 record deleted');

// --- Kept rows still back up and restore (lib/backup-records.ts checks every row) ---
const backup = load(path.resolve('lib/backup-records.ts'));
const cols = t => backup.RECORD_TABLES[t].map(c => c[0]).join(',');
assert.ok(backup.validRows('orders', sqlite.prepare(`SELECT ${cols('orders')} FROM orders`).all().map(o => ({...o}))), 'kept payments are valid backup rows');
assert.ok(backup.validRows('openings', sqlite.prepare('SELECT id,user_id,date,start,end,coach_email,format,capacity,closed,invite_code,organizer_id,organizer_wrestlers FROM coach_openings').all().map(o => ({...o}))), 'private groups are valid backup rows');

// --- /accounts: the form for each family, with the name to type, escaped ---
fam('q1', 'Pat "Quote" O\'Brien <b>');
const page = load(path.resolve('app/accounts/route.ts'));
const html = await (await page.GET(new Request(O + '/accounts'))).text();
assert.ok(!html.includes('Terry Test') && !html.includes('Tess Two'), 'deleted families are gone from the list');
assert.match(html, /<summary>Delete this family account<\/summary>/);
assert.match(html, /data-user="q1" data-label="Pat &quot;Quote&quot; O&#39;Brien &lt;b&gt;"/, 'the label is escaped in the attribute');
assert.match(html, /Type <strong>Pat &quot;Quote&quot; O&#39;Brien &lt;b&gt;<\/strong> to confirm/);
assert.match(html, /<button type="submit" class="danger" disabled>Delete this family account<\/button>/);
assert.ok(html.includes(lib.DELETE_SCRIPT), 'the page runs the tested script');
const ids = [...html.matchAll(/id="(confirm\d+)"/g)].map(m => m[1]); assert.equal(new Set(ids).size, ids.length, 'each confirm box has its own id');
actor = {owner: false, id: 'of'}; assert.equal((await page.GET(new Request(O + '/accounts'))).status, 403); actor = {owner: true, id: 'owner-id'};

// --- The page script, in a small stand-in for the browser ---
function browser(label, user, reply) {
  const calls = [], card = {innerHTML: '<h2>Family</h2>', focus() { this.focused = true; }};
  const button = {disabled: true}, status = {textContent: ''}, input = {value: ''}, test = {checked: false};
  const form = {dataset: {label, user}, elements: {confirm: input, test}, querySelector: s => s === 'button' ? button : status, closest: () => card};
  const document = {querySelectorAll: s => s === 'form.delete-form' ? [form] : []};
  const fetch = async (url, opts) => { calls.push({url, ...opts, body: JSON.parse(opts.body)}); return {ok: reply.status === 200, json: async () => reply.body}; };
  vm.runInNewContext(lib.DELETE_SCRIPT, {document, fetch, JSON, String, Number, Error});
  return {form, button, status, input, test, card, calls, type(v) { input.value = v; input.oninput(); }, submit: () => form.onsubmit({preventDefault() {}})};
}
let b = browser('Terry Test', 'tf', {status: 200, body: {ok: true, deleted: 11, paymentsKept: 1}});
b.type('Terry'); assert.equal(b.button.disabled, true, 'button waits for the full name');
await b.submit(); assert.equal(b.calls.length, 0, 'nothing sent before the name matches');
b.type('  terry  test '); assert.equal(b.button.disabled, false);
b.test.checked = true; await b.submit();
assert.deepEqual(b.calls[0].body, {action: 'delete', userId: 'tf', confirm: '  terry  test ', test: true}); assert.equal(b.calls[0].url, '/api/accounts'); assert.equal(b.calls[0].method, 'POST');
assert.match(b.card.innerHTML, /Family account deleted[\s\S]*11 records deleted\. 1 payment stays on Payments as “Deleted family”\.[\s\S]*delete it there too/);
assert.ok(b.card.focused, 'focus moves to the result');
b = browser('Terry Test', 'tf', {status: 409, body: {error: 'This family still has a paid session.'}});
b.type('Terry Test'); await b.submit();
assert.equal(b.status.textContent, 'This family still has a paid session.'); assert.equal(b.button.disabled, false, 'can try again after a refusal');
assert.equal(b.card.innerHTML, '<h2>Family</h2>');
b = browser('', 'x', {status: 200, body: {}}); b.type(''); assert.equal(b.button.disabled, true, 'an empty label never matches');

console.log('Family deletion tests passed');
