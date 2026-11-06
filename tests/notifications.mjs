// Issue #105: automatic notices to families and coaches, each sent once, in-app and by email when set up.
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
    {module, exports: module.exports, fetch: (...a) => fetchMock(...a), crypto, btoa, TextEncoder, Uint8Array, Intl, Date, URL, Response, Request, Headers, JSON, Math, Number, String, Array, Set, Map, Object, console,
      require(name) {
        if (name === 'cloudflare:workers') return {env};
        if (name.endsWith('/account-auth')) return {
          ownerIdentity: async () => ({owner: actor.owner ? {userId: actor.id} : null, headers: new Headers()}),
          strongAccount: async () => ({user: {id: actor.id, email: actor.id + '@example.test', email_confirmed_at: 'y'}, strong: true, headers: new Headers()}),
          appOrigin: () => 'https://swa.example', sameOrigin: r => r.headers.get('origin') === new URL(r.url).origin, accountReply: (b, s = 200, h) => Response.json(b, {status: s, headers: h})};
        if (name.endsWith('/rate-limit')) return {rateLimited: async () => false};
        if (name.endsWith('/access-control')) return {accountRole: async () => actor.coach ? {role: 'coach', staff: {email: actor.coach, name: 'Coach Dana', programs: actor.programs ?? ['Intermediate']}} : {role: 'family', staff: null}};
        if (name.endsWith('/stripe-test')) return {storedStripeKeyFor: async () => null, stripeClientFor: () => null, stripeMode: () => 'test'};
        if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
        throw Error('unexpected import ' + name);
      }});
  return module.exports;
}










let fetchMock = async () => new Response('{}', {status: 200});
const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const all = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2,
  programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}, {id: 'Advanced', name: 'SWA Advance', priceCents: 20000, walkInPriceCents: 4000}],
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(90), weekly: all, excludedDates: []}],
  events: [{id: 'camp', name: 'Winter camp', type: 'Camp', dates: [ny(10), ny(11)], price: 160, slots: 1}]}));
const fam = (u, wrestlers) => sqlite.prepare('INSERT OR REPLACE INTO family_accounts VALUES (?,?,?,?,?)').run(u, u + '@example.test', JSON.stringify({parentName: 'P ' + u, phone: '', wrestlers}), 1, 'x');
fam('p1', [{id: 'w1', name: 'Sam', grade: '8', usawNumber: 'AB1234', usawExpires: ny(20)}, {id: 'w2', name: 'Kid', grade: '8', usawNumber: 'AB1235', usawExpires: ny(-3)}]);
fam('p2', [{id: 'w3', name: 'Jo', grade: '8', usawNumber: 'AB1236', usawExpires: '2099-12-31'}]);
sqlite.prepare("INSERT INTO staff_access VALUES ('dana@example.test','Coach Dana','[\"Intermediate\"]',1,'x')").run();

const notify = load(path.resolve('lib/notify.ts'));
const inbox = load(path.resolve('app/api/inbox/route.ts'));
const payments = load(path.resolve('app/api/payments/route.ts'));
const waitlistApi = load(path.resolve('app/api/waitlist/route.ts'));
const waitlistsApi = load(path.resolve('app/api/waitlists/route.ts'));
const waiversApi = load(path.resolve('app/api/waivers/route.ts'));
const cardsApi = load(path.resolve('app/api/usaw-cards/route.ts'));
const transfersApi = load(path.resolve('app/api/transfers/route.ts'));
const settingsApi = load(path.resolve('app/api/lesson-settings/route.ts'));
const webhook = load(path.resolve('lib/stripe-webhook.ts'));
const O = 'https://a.test';
const call = async (route, method, body) => { const r = await route[method](new Request(O + '/x', method === 'GET' ? {} : {method, headers: {'content-type': 'application/json', origin: O}, body: JSON.stringify(body)})); return {status: r.status, body: await r.json()}; };
const as = id => { actor = id === 'owner' ? {owner: true, id: 'owner-id'} : {owner: false, id}; };
const notices = (u, kind) => sqlite.prepare('SELECT * FROM notifications WHERE user_id IS ? AND kind=? ORDER BY created_at').all(u, kind);
const box = async u => { as(u); return (await call(inbox, 'GET')).body; };

// --- Daily reminders: card expiring soon and expired, once per day and once per card ---
let b = await box('p1');   // the first visit of the day runs the reminders
assert.equal(notices('p1', 'card_expiring').length, 1, 'Sam: expires in 20 days');
assert.match(notices('p1', 'card_expiring')[0].subject, /Sam's USA Wrestling card expires/);
assert.equal(notices('p1', 'card_expired').length, 1, 'Kid: expired');
assert.equal(notices('p2', 'card_expiring').length + notices('p2', 'card_expired').length, 0, 'Jo is fine');
assert.equal(b.notices.length, 2); assert.equal(b.unread, 2);
assert.equal(await notify.dailyReminders(), 0, 'already ran today');
assert.equal(await notify.dailyReminders(true), 0, 'even when forced, nothing is sent twice');
as('p1'); b = (await call(inbox, 'POST', {action: 'read', noticeId: b.notices[0].id})).body; assert.equal(b.unread, 1);
assert.equal((await box('p2')).notices.length, 0, 'notices are private to the family');

// --- Waiver published: every unsigned wrestler's family is told ---
as('owner'); assert.equal((await call(waiversApi, 'POST', {action: 'publish', title: 'Participation waiver', body: 'Wrestling is a contact sport. '.repeat(10)})).status, 200);
assert.equal(notices('p1', 'waiver_needed').length, 2); assert.equal(notices('p2', 'waiver_needed').length, 1);
assert.match(notices('p2', 'waiver_needed')[0].body, /Jo cannot book until it is signed/);
sqlite.prepare("DELETE FROM waiver_versions").run();   // keep the rest of this test independent of the waiver

// --- Card rejected by the owner ---
as('owner'); assert.equal((await call(cardsApi, 'POST', {userId: 'p2', wrestlerId: 'w3', status: 'invalid', number: 'AB1236', expires: '2099-12-31', note: 'Number not found'})).status, 200);
assert.match(notices('p2', 'card_rejected')[0].body, /could not verify Jo's USA Wrestling card \(Number not found\)/);
sqlite.prepare("DELETE FROM usaw_reviews").run();

// --- Offline payment recorded; transfer ---
as('owner'); let r = await call(payments, 'POST', {action: 'record', userId: 'p2', wrestlerId: 'w3', kind: 'annual', program: 'Intermediate', method: 'check'});
assert.equal(r.status, 200);
assert.match(notices('p2', 'payment_recorded')[0].body, /recorded your payment of \$2400\.00 for SWA Intermediate: 12-month membership, paid upfront \(Jo\)/);
sqlite.prepare("INSERT INTO program_approvals(id,user_id,wrestler_id,program,wrestler_name,grade,status,created_at,updated_at,decided_by) VALUES ('a1','p2','w3','Advanced','Jo','8','approved','t','t','owner')").run();
r = await call(transfersApi, 'POST', {orderId: r.body.orderId, toProgram: 'Advanced', effectiveDate: ny(3), reason: 'Moved up'});
assert.equal(r.status, 200); assert.match(notices('p2', 'transfer')[0].subject, /Jo moves to SWA Advance/);

// --- Waitlist offer ---
r = await call(payments, 'POST', {action: 'record', userId: 'p1', wrestlerId: 'w1', kind: 'event', eventId: 'camp', method: 'cash'});
sqlite.prepare("UPDATE family_accounts SET payload=json_set(payload,'$.wrestlers[0].usawExpires','2099-12-31') WHERE user_id='p2'").run();
as('p2'); assert.equal((await call(waitlistApi, 'POST', {action: 'join', eventId: 'camp', wrestlerId: 'w3'})).status, 200);
const entry = (await call(waitlistApi, 'GET')).body.entries[0].id;
as('owner'); assert.equal((await call(waitlistsApi, 'POST', {action: 'offer', id: entry, hours: 24})).status, 200);
assert.match(notices('p2', 'waitlist_offer')[0].subject, /A seat in Winter camp is held for Jo/);
// Automatic pass-on to the next family also notifies.
sqlite.prepare("UPDATE waitlist_entries SET status='waiting',offered_at=NULL,offer_expires_at=NULL WHERE id=?").run(entry);
fam('p3', [{id: 'w4', name: 'Lee', grade: '8', usawNumber: 'AB1237', usawExpires: '2099-12-31'}]);
as('p3'); await call(waitlistApi, 'POST', {action: 'join', eventId: 'camp', wrestlerId: 'w4'});
as('owner'); await call(waitlistsApi, 'POST', {action: 'offer', id: entry, hours: 1, autoNext: true});
sqlite.prepare("UPDATE waitlist_entries SET offer_expires_at=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), entry);
await call(waitlistsApi, 'GET');
assert.equal(notices('p3', 'waitlist_offer').length, 1, 'the next family is told');

// --- Lesson paid online: coach and family both told; email sent once a provider is set ---
env.EMAIL_API_KEY = 'k'; env.MAIL_FROM = 'SWA <a@swa.example>';
const sent = []; fetchMock = async (url, init) => { sent.push(...JSON.parse(init.body)); return new Response('{}', {status: 200}); };
sqlite.prepare("INSERT INTO coach_openings(id,user_id,date,start,end,coach_email) VALUES ('o1','c',?,'15:00','16:00','dana@example.test')").run(ny(4));
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,stripe_session_id)
  VALUES ('L1','p1','p1@example.test','w1','Sam','lesson','o1','One-on-one lesson with Coach Dana',?,6000,0,6000,'usd',?,'{}','pending','kl',0,'t','t','cs_L1')`).run(JSON.stringify([ny(4)]), JSON.stringify({formatName: 'One-on-one lesson', coachEmail: 'dana@example.test', coachName: 'Coach Dana', start: '15:00', slots: 1}));
r = await webhook.applyStripeEvent({id: 'evt_L1', type: 'checkout.session.completed', data: {object: {id: 'cs_L1', client_reference_id: 'L1', payment_status: 'paid', livemode: false, amount_total: 6000, currency: 'usd'}}});
assert.equal(r.outcome, 'paid');
assert.equal(notices('p1', 'lesson_booked').length, 1);
const coachNotice = sqlite.prepare("SELECT * FROM notifications WHERE kind='lesson_booked_coach'").get();
assert.equal(coachNotice.email, 'dana@example.test'); assert.equal(coachNotice.user_id, null); assert.equal(coachNotice.email_status, 'sent');
assert.ok(sent.some(m => m.to[0] === 'dana@example.test' && /New lesson: Sam/.test(m.subject)), 'coach emailed');
// Times read as people say them (issue #127): "Mon, Nov 9 · 3:00 PM", never the raw "15:00".
assert.match(notices('p1', 'lesson_booked')[0].body, /is booked for [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} · 3:00 PM\.$/);
assert.match(coachNotice.subject, /^New lesson: Sam, [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} · 3:00 PM$/);
assert.ok(!/15:00/.test(coachNotice.body + coachNotice.subject), 'no 24-hour clock in lesson notices');
assert.ok(sent.every(m => m.text.includes('https://swa.example/')), 'links use appOrigin');
// The same webhook again does nothing more.
const before = sqlite.prepare('SELECT count(*) n FROM notifications').get().n;
await webhook.applyStripeEvent({id: 'evt_L1', type: 'checkout.session.completed', data: {object: {id: 'cs_L1', client_reference_id: 'L1', payment_status: 'paid', livemode: false, amount_total: 6000, currency: 'usd'}}});
assert.equal(sqlite.prepare('SELECT count(*) n FROM notifications').get().n, before);

// --- A failing notice never breaks the action ---
fetchMock = async () => { throw Error('network down'); };
as('owner'); r = await call(payments, 'POST', {action: 'record', userId: 'p1', wrestlerId: 'w1', kind: 'annual', program: 'Intermediate', method: 'cash'});
assert.equal(r.status, 200, 'payment recorded even though email failed');
assert.equal(notices('p1', 'payment_recorded').at(-1).email_status, 'failed');

// --- Inbox page helper (inline JavaScript is not typechecked) ---
{
  const html = readFileSync('app/inbox/screen.html', 'utf8');
  assert.match(html, /id="noticesBox" hidden/); assert.match(html, /data-notice=/); assert.match(html, /noticeId:el\.dataset\.notice/);
}
console.log('Notification tests passed');
