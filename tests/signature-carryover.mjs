// Issue #271 (audit E2): a signed waiver or Parent Consent Form belongs to the wrestler entry, so fixing a typo in the
// name keeps it. The one exception is the renamed-entry case from issue #97: the old name now belongs to another
// wrestler in the family, so the entry was probably reused for a different child. For that case the owner can carry the
// signature over with a reason. Booking, the owner's page, the family's page, the wrestler view, the daily reminders and
// the roster all decide with the same function. Runs the real routes with the Supabase stand-in from tests/accounts.mjs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {load, request, sqlite, users} from './accounts.mjs';

const familyApi = load('app/api/waiver/route.ts'), ownerApi = load('app/api/waivers/route.ts');
const quotes = load('lib/quotes.ts'), docs = load('lib/documents.ts'), notify = load('lib/notify.ts'), roster = load('lib/roster.ts'), log = load('lib/security-log.ts');
const reply = async r => ({status: r.status, body: await r.json()});
const post = (route, path, body, who) => route.POST(request(path, 'POST', body, who)).then(reply);
const get = (route, path, who) => route.GET(request(path, 'GET', null, who)).then(reply);
const now = new Date().toISOString(), ny = k => new Date(Date.now() + k * 864e5).toLocaleDateString('en-CA', {timeZone: 'America/New_York'}), today = ny(0);
const strokes = [[[0.1, 0.5], [0.3, 0.4], [0.5, 0.6]]];
const TEXT = 'Test text for the automated check only. It is not a real document and is never shown to families. '.repeat(3);
users.kim = {id: 'kim-uuid', email: 'kim@example.test', email_confirmed_at: '2026-10-15', factors: []};
const card = {usawNumber: 'AB1234', usawExpires: '2099-12-31'};
const family = (...wrestlers) => sqlite.prepare('INSERT OR REPLACE INTO family_accounts(user_id,email,payload,revision,updated_at) VALUES (?,?,?,1,?)').run('kim-uuid', 'kim@example.test', JSON.stringify({parentName: 'Robin Kim', phone: '555-0101', wrestlers}), now);
family({id: 'k1', name: 'Kai Kim', grade: '8', ...card});
const all = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
sqlite.prepare("INSERT OR REPLACE INTO academy_state(id,payload,revision,updated_by,updated_at) VALUES ('academy',?,1,'owner',?)").run(JSON.stringify({programNamingVersion: 2,
  programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}], seasons: [{program: 'Intermediate', start: ny(-30), end: ny(60), weekly: all, excludedDates: []}]}), now);
// A membership, so the roster lists Kai today.
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end)
  VALUES ('m-kai','kim-uuid','kim@example.test','k1','Kai Kim','monthly','Intermediate','Intermediate','label','[]',20000,0,20000,'usd','{}','{}','paid','m-kai',0,?,?,?,?,?)`).run(now, now, now, ny(-10), ny(300));
const book = (id, name) => quotes.quoteMembership('kim-uuid', {wrestlerId: id, program: 'Intermediate', plan: 'walkin', date: ny(1), practiceId: `Intermediate:${ny(1)}:18:00`}).then(q => q.ok ? null : q.error);
const version = () => sqlite.prepare("SELECT id FROM waiver_versions WHERE kind='waiver' AND retired_at IS NULL").get()?.id;
const sign = (wrestlerId, extra = {}) => post(familyApi, '/api/waiver', {versionId: version(), wrestlerId, signer: 'Robin Kim', accepted: true, electronicConsent: true, signature: {method: 'drawn', strokes}, ...extra}, 'kim');
const ownerRow = async id => (await get(ownerApi, '/api/waivers?show=all', 'owner')).body.wrestlers.find(w => w.wrestlerId === id);
const rosterSigned = async id => (await roster.rosterFor(today, {role: 'owner'})).find(s => s.key.startsWith('practice:Intermediate:')).entries.find(e => e.wrestlerId === id)?.waiverSigned;
const reminders = kind => { sqlite.prepare("DELETE FROM notifications WHERE kind=?").run(kind); return notify.dailyReminders(true).then(() => sqlite.prepare('SELECT wrestler_name FROM waiver_signatures WHERE 0').all() && sqlite.prepare("SELECT body FROM notifications WHERE kind=? AND user_id='kim-uuid'").all(kind).map(n => n.body)); };

// ---------- The pure rule ----------
{
  const sig = {wrestler_id: 'k1', wrestler_name: 'Kai Kim'};
  assert.equal(docs.signatureCounts(sig, {id: 'k1', name: 'Kai Kim'}, [{id: 'k1', name: 'Kai Kim'}]), true);
  assert.equal(docs.signatureCounts(sig, {id: 'k1', name: 'Kai Kimm'}, [{id: 'k1', name: 'Kai Kimm'}]), true, 'a typo fix keeps it');
  assert.equal(docs.signatureCounts(sig, {id: 'k1', name: 'Ari Kim'}, [{id: 'k1', name: 'Ari Kim'}, {id: 'k3', name: 'kai kim'}]), false, 'another wrestler now has the old name: the entry was reused');
  assert.equal(docs.signatureCounts({...sig, carried_name: 'Ari Kim'}, {id: 'k1', name: 'Ari Kim'}, [{id: 'k1', name: 'Ari Kim'}, {id: 'k3', name: 'Kai Kim'}]), true, 'unless the owner carried it over');
  assert.equal(docs.signatureCounts(sig, {id: 'k2', name: 'Kai Kim'}, [{id: 'k2', name: 'Kai Kim'}]), false, 'never another wrestler id');
}

// ---------- Signed, then a typo fixed: still signed everywhere ----------
assert.equal((await post(ownerApi, '/api/waivers', {action: 'publish', title: 'Participation waiver', body: TEXT}, 'owner')).status, 200);
assert.match(await book('k1'), /Kai Kim needs a signed Participation waiver/);
const signed = await sign('k1'); assert.equal(signed.status, 200);
assert.equal(await book('k1'), null);
family({id: 'k1', name: 'Kai Kimm', grade: '8', ...card});
assert.equal(await book('k1'), null, 'booking: the corrected name keeps the signature');
assert.equal((await ownerRow('k1')).signed, true); assert.equal((await ownerRow('k1')).carriedFrom, 'Kai Kim', 'the owner sees which name it was signed under');
assert.equal((await get(familyApi, '/api/waiver', 'kim')).body.signatures[0].current, true, 'the family page: still the current signature');
assert.ok(await docs.signatureFor(version(), 'kim-uuid', 'k1', 'Kai Kimm'), 'signatureFor, which the wrestler view asks, agrees');
assert.equal(await rosterSigned('k1'), true, 'the roster agrees');
assert.deepEqual(await reminders('waiver_needed'), [], 'no reminder to sign again');
assert.equal((await sign('k1')).status, 409, 'cannot sign twice');

// ---------- The renamed-entry case (issue #97): the signed child is now another wrestler ----------
family({id: 'k1', name: 'Ari Kim', grade: '8', ...card}, {id: 'k3', name: 'Kai Kim', grade: '8', ...card});
assert.match(await book('k1'), /Ari Kim needs a signed Participation waiver/, 'the signature does not carry over to the reused entry');
assert.match(await book('k3'), /Kai Kim needs a signed Participation waiver/, 'and the signed child, under a new id, is unsigned too');
let row = await ownerRow('k1');
assert.equal(row.signed, false); assert.equal(row.carryable.signatureId, signed.body.id); assert.equal(row.carryable.name, 'Kai Kim');
assert.equal((await ownerRow('k3')).carryable, null);
assert.equal((await get(familyApi, '/api/waiver', 'kim')).body.signatures[0].current, false);
assert.equal(await docs.signatureFor(version(), 'kim-uuid', 'k1', 'Ari Kim'), null);
assert.equal(await rosterSigned('k1'), false);
assert.equal((await reminders('waiver_needed')).length, 2, 'both are reminded');

// ---------- The owner carries it over, with a reason ----------
const carry = (signatureId, reason, who = 'owner') => post(ownerApi, '/api/waivers', {action: 'carry', signatureId, reason}, who);
assert.equal((await carry(signed.body.id, 'Same child, name corrected', 'kim')).status, 403, 'families cannot');
assert.equal((await carry(signed.body.id, '')).status, 400, 'a reason is required');
assert.match((await carry(signed.body.id, 'x')).body.error, /Say why the signature belongs to the renamed wrestler/);
assert.equal((await carry('nope', 'Same child')).status, 404);
assert.equal((await post(ownerApi, '/api/waivers', {action: 'carry', kind: 'coach_contract', signatureId: signed.body.id, reason: 'Same child'}, 'owner')).status, 400, 'only family documents');
const carried = await carry(signed.body.id, 'Same child: Kai was renamed Ari and a cousin added as Kai');
assert.equal(carried.status, 200); assert.equal(carried.body.wrestler, 'Ari Kim'); assert.equal(carried.body.from, 'Kai Kim');
assert.equal(await book('k1'), null, 'Ari books again');
assert.match(await book('k3'), /Kai Kim needs/, 'the other child still signs');
row = await ownerRow('k1'); assert.equal(row.signed, true); assert.equal(row.carriedFrom, 'Kai Kim'); assert.equal(row.carryable, null);
assert.equal((await get(familyApi, '/api/waiver', 'kim')).body.signatures[0].current, true);
assert.equal(await rosterSigned('k1'), true);
assert.deepEqual((await reminders('waiver_needed')).length, 1, 'only Kai is reminded now');
assert.equal((await sign('k1')).status, 409, 'Ari’s is already signed');
assert.equal((await sign('k3')).status, 200, 'Kai signs under the new id');
assert.equal((await carry(signed.body.id, 'Again')).status, 409, 'already counts; nothing to carry');
const stored = sqlite.prepare('SELECT * FROM signature_carryovers WHERE signature_id=?').get(signed.body.id);
assert.equal(stored.wrestler_name, 'Ari Kim'); assert.equal(stored.reason, 'Same child: Kai was renamed Ari and a cousin added as Kai'); assert.match(stored.carried_by, /owner-uuid$/);
// Logged in plain words.
const ev = sqlite.prepare("SELECT * FROM security_events WHERE action='waiver_carried_over'").get();
assert.equal(ev.target, `${version()}/kim-uuid/k1`);
const names = {people: {}, you: [], approvals: {}, waitlist: {}, orders: {}, waivers: {[version()]: 'Participation waiver'}, wrestlers: {'kim-uuid/k1': 'Ari Kim'}, requests: {}, curricula: {}, coaches: {}};
const entry = log.describeSecurityEvent(ev, names);
assert.equal(entry.title, 'Waiver signature carried over to a new name'); assert.equal(entry.detail, 'Participation waiver · Ari Kim');
// A carried-over signature can still be sent back to be signed again (issue #239), and then stops counting.
assert.equal((await post(ownerApi, '/api/waivers', {action: 'reissue', signatureId: signed.body.id, reason: 'Signed on the wrong form'}, 'owner')).status, 200);
assert.match(await book('k1'), /Ari Kim needs/);
console.log('Passed: a signature survives a typo fix for the same wrestler everywhere; a reused entry does not carry it; the owner carries it over with a logged reason; reminders, booking, the roster and the pages agree.');

// ---------- The owner page offers the carry-over (inline JavaScript is not typechecked) ----------
{
  const s = readFileSync('app/waivers/screen.html', 'utf8');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const ctx = {esc, when: d => d, location: {pathname: '/waivers'}, encodeURIComponent};
  vm.runInNewContext(s.slice(s.indexOf('const DOCS='), s.indexOf('let data=null;')) + ';this.DOC=DOC;this.statusCell=statusCell;this.exceptionControls=()=>""', ctx);
  const cell = ctx.statusCell(ctx.DOC, {signed: false, email: 'kim@example.test', wrestler: 'Ari Kim', userId: 'kim-uuid', wrestlerId: 'k1', carryable: {signatureId: 'sig-1', name: 'Kai Kim', signer: 'Robin Kim', signedAt: 'Nov 3'}});
  assert.match(cell, /Signed as Kai Kim Nov 3/); assert.match(cell, /renamed from Kai Kim to Ari Kim/); assert.match(cell, /data-carry-reason="sig-1"/); assert.match(cell, /data-carry="sig-1">Carry the signature over/);
  assert.doesNotMatch(ctx.statusCell(ctx.DOC, {signed: false, email: 'kim@example.test', wrestler: 'Kai Kim', carryable: null}), /Carry the signature over/);
  assert.match(ctx.statusCell(ctx.DOC, {signed: true, signedAt: 'Nov 3', signer: 'Robin Kim', signatureId: 's', carriedFrom: 'Kai Kim'}), /by Robin Kim, as Kai Kim/);
  assert.ok(s.includes("post({action:'carry',signatureId:id,reason})"), 'the button posts the carry-over');
}
console.log('Passed: the owner page offers to carry a signature over.');
