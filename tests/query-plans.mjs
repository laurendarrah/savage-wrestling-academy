// Issue #274: the indexes added for the roster, payments, books and security log. Runs each page's real queries through
// the same code paths as the site (recording the SQL and its bound values), then asks SQLite for each query plan and
// fails if any of them still scans a whole indexed table instead of using an index.
import assert from 'node:assert/strict';
import {makeDb, loader, call} from './fixtures/d1.mjs';

const {sqlite, DB} = makeDb();
// Every statement the code runs, with its bound values, so the plans below are for the real SQL.
const seen = [];
const prepare = DB.prepare.bind(DB);
DB.prepare = sql => { const s = prepare(sql); const bind = s.bind.bind(s); let args = []; s.bind = (...v) => { args = v; return bind(...v); };
  const note = () => seen.push({sql, args}); for (const m of ['first', 'all', 'run']) { const f = s[m].bind(s); s[m] = (...x) => { note(); return f(...x); }; } const ex = s._execute.bind(s); s._execute = (...x) => { note(); return ex(...x); }; return s; };
const load = loader({DB});

const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0);
sqlite.exec('BEGIN');
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2,
  programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}],
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(90), weekly: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'})), excludedDates: []}],
  events: [{id: 'camp', name: 'Winter camp', type: 'Camp', dates: [today], price: 160, slots: 20}], liveClasses: []}));
const order = sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,'usd','{}','{}',?,?,0,?,?,?,?,?,?)`);
for (let i = 0; i < 300; i++) {
  const u = 'user-' + i, e = `p${i}@example.test`, at = new Date(Date.UTC(2026, 8, 1) + i * 3600000).toISOString();
  sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(u, e, JSON.stringify({parentName: 'P' + i, phone: '', wrestlers: [{id: 'w' + i, name: 'W' + i, grade: '8', usawNumber: 'AB' + i, usawExpires: '2099-08-31'}]}), 1, at);
  order.run('m' + i, u, e, 'w' + i, 'W' + i, 'annual', 'Intermediate', 'Intermediate', 'Membership', '[]', 240000, 240000, i % 20 ? 'paid' : 'refunded', 'km' + i, at, at, at, ny(-30), ny(330), i % 3 ? 'stripe' : 'offline');
  order.run('x' + i, u, e, 'w' + i, 'W' + i, i % 2 ? 'walkin' : 'event', 'Intermediate', i % 2 ? `Intermediate:${today}:18:00` : 'camp', 'Session', JSON.stringify([today]), 4000, 4000, 'paid', 'kx' + i, at, at, at, null, null, 'stripe');
  sqlite.prepare('INSERT INTO security_events VALUES (?,?,?,?,?)').run('ev' + i, 'owner-id', 'backup_exported', 'm' + i, at);
  sqlite.prepare('INSERT INTO stripe_events VALUES (?,?,?,?,?)').run('evt' + i, 'checkout.session.completed', 'm' + i, i % 20 ? 'paid' : 'refunded', at);
}
sqlite.exec('COMMIT');

// --- Run the pages ---
const roster = load('lib/roster.ts');
await roster.rosterFor(today, {role: 'owner'});
await call(load('app/api/payments/route.ts'), '/api/payments');
await call(load('app/api/payments/route.ts'), '/api/payments?status=paid&from=2026-09-01&to=2026-12-31');
await call(load('app/api/financials/route.ts'), '/api/financials?month=2026-09');
await load('lib/security-log.ts').securityLogPage(['owner-id']);
await call(load('app/accounts/route.ts'), '/accounts');
await load('lib/launch-checklist.ts').launchChecklist(DB, {}, today);

// --- Ask SQLite how it runs each statement that reads an indexed table ---
const TABLES = ['orders', 'security_events', 'stripe_events', 'family_accounts'];
const plans = [];
for (const {sql, args} of seen) {
  if (!/^\s*(SELECT|WITH)/i.test(sql) || !TABLES.some(t => new RegExp(`\\b${t}\\b`, 'i').test(sql))) continue;
  let rows;
  try { rows = sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args); } catch (e) { assert.fail(`could not explain: ${e.message}\n${sql}`); }
  plans.push({sql, plan: rows.map(r => r.detail)});
}
assert.ok(plans.length >= 8, 'the pages ran their queries: ' + plans.length);
// Whole-table scans of the indexed tables are not allowed, except where the query really wants every row: the security
// log's name lookups over every order and family (that is what those queries are for), counts over all families, and
// the checklist's "last backup" read of security_events (one row, by action, a few thousand rows at most).
const wholeTable = /^(SELECT (DISTINCT )?(id,wrestler_name,item_label|user_id AS userId,email|json_extract\(pricing,'\$\.recordedBy'\) AS id,[^;]* FROM orders|f\.user_id,f\.email,f\.payload) FROM (orders|family_accounts)|SELECT DISTINCT json_extract\(pricing|SELECT (COUNT|count)\(\*\) AS (n|families)[^;]* FROM family_accounts|SELECT user_id,email,payload FROM family_accounts WHERE user_id IN|SELECT created_at FROM security_events WHERE action='backup_exported')/;
const scanned = plans.filter(p => !wholeTable.test(p.sql.replace(/\s+/g, ' ').trim()) && p.plan.some(d => TABLES.some(t => new RegExp(`^SCAN ${t}( AS \\w+)?$`).test(d) || d.startsWith(`SCAN ${t} `) && !d.includes('USING'))));
if (scanned.length) console.log(scanned.map(p => p.sql.replace(/\s+/g, ' ').slice(0, 220) + '\n    ' + p.plan.join('\n    ')).join('\n'));
assert.deepEqual(scanned.map(p => p.sql.replace(/\s+/g, ' ').slice(0, 120)), [], 'these queries scan a table that has an index for them');

// The index each page relies on is in use.
const used = plans.flatMap(p => p.plan).join('\n');
// (The roster's member query names the program through PROGRAM_ON, an expression, so it walks orders_status_item by
// status and kind; orders_status_program serves the direct program lookups in lib/transfers.ts and lib/quotes.ts.)
for (const index of ['orders_status_item', 'orders_status_paid', 'security_events_created', 'family_accounts_updated']) assert.match(used, new RegExp(index), index + ' is used');
console.log(`Query plans: ${plans.length} statements from the roster, payments, books, security log, accounts and checklist use their indexes`);
