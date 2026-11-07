// Issue #195: the Parent Consent Form and coach contracts, built on the waiver's signing system (issue #69).
// Decisions on #197: families sign the waiver and the Parent Consent Form (Q15), which blocks booking only once the owner
// publishes it; a parent or guardian always signs, also for wrestlers 18 and older (Q16); coaches sign their contract on
// the site and see a to-do until they do, with nothing blocked (Q17). Runs the real routes against a database built from
// every migration, with the Supabase stand-in from tests/accounts.mjs. All text below is test text, not a real document.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {load, request, sqlite, users, levels} from './accounts.mjs';

const familyApi = load('app/api/waiver/route.ts'), ownerApi = load('app/api/waivers/route.ts'), contractApi = load('app/api/contract/route.ts');
const exceptionsApi = load('app/api/exceptions/route.ts'), coachApi = load('app/api/coach/route.ts'), payments = load('app/api/payments/route.ts');
const quotes = load('lib/quotes.ts'), docs = load('lib/documents.ts'), waivers = load('lib/waivers.ts'), log = load('lib/security-log.ts');
const reply = async r => ({status: r.status, body: await r.json()});
const post = (route, path, body, who) => route.POST(request(path, 'POST', body, who)).then(reply);
const get = (route, path, who) => route.GET(request(path, 'GET', null, who)).then(reply);
const OWNER = 'savagewrestlingclub@gmail.com', now = new Date().toISOString();
const ny = k => new Date(Date.now() + k * 864e5).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const totp = id => [{id, status: 'verified', factor_type: 'totp'}];
const strokes = [[[0.1, 0.5], [0.3, 0.4], [0.5, 0.6]]];
const TEXT = 'Test text for the automated check only. It is not a real document and is never shown to families. '.repeat(3);

// A family with a grade 8 wrestler and an adult wrestler, two coaches, and the owner also set up as a coach (issue #190).
users.kim = {id: 'kim-uuid', email: 'kim@example.test', email_confirmed_at: '2026-10-15', factors: []};
users.cora = {id: 'cora-uuid', email: 'cora.coach@example.test', email_confirmed_at: '2026-10-15', factors: totp('cora-f')}; levels.cora = 'aal2';
users.drew = {id: 'drew-uuid', email: 'drew.coach@example.test', email_confirmed_at: '2026-10-15', factors: totp('drew-f')}; levels.drew = 'aal2';
const card = {usawNumber: 'AB1234', usawExpires: '2099-12-31'};
sqlite.prepare('INSERT INTO family_accounts(user_id,email,payload,revision,updated_at) VALUES (?,?,?,1,?)').run('kim-uuid', 'kim@example.test',
  JSON.stringify({parentName: 'Robin Kim', phone: '555-0101', wrestlers: [{id: 'k1', name: 'Kai Kim', grade: '8', ...card}, {id: 'k2', name: 'Ari Kim', grade: 'Adult', ...card}]}), now);
for (const [email, name, programs] of [['cora.coach@example.test', 'Cora Coach', '["Intermediate"]'], ['drew.coach@example.test', 'Drew Coach', '["Intermediate"]'], [OWNER, 'Justin', '["Intermediate"]']])
  sqlite.prepare('INSERT INTO staff_access(email,name,programs,active,updated_at) VALUES (?,?,?,1,?)').run(email, name, programs, now);
const all = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
sqlite.prepare("INSERT OR REPLACE INTO academy_state(id,payload,revision,updated_by,updated_at) VALUES ('academy',?,1,'owner',?)").run(JSON.stringify({programNamingVersion: 2,
  programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}],
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(60), weekly: all, excludedDates: []}],
  events: [{id: 'camp', name: 'Camp', type: 'Camp', dates: [ny(10)], price: 160}],
  extraPractices: [{id: 'fnl', name: 'Friday Night Live', dates: [ny(3)], enabled: true, start: '17:00', end: '18:00', memberCents: 1000, nonMemberCents: 2000}]}), now);

// Every booking path asks lib/waivers.ts waiverProblem(), so these cover walk-ins, extra practices, events and lessons.
// The adult wrestler is not in a grade program, so only Kai books a walk-in.
const bookings = w => [...(w === 'k1' ? [quotes.quoteMembership('kim-uuid', {wrestlerId: w, program: 'Intermediate', plan: 'walkin', date: ny(1), practiceId: `Intermediate:${ny(1)}:18:00`})] : []),
  quotes.quoteBooking('kim-uuid', {type: 'live', wrestlerId: w, id: 'fnl', date: ny(3)}), quotes.quoteBooking('kim-uuid', {type: 'event', wrestlerId: w, id: 'camp'}),
  quotes.quoteBooking('kim-uuid', {type: 'lesson', wrestlerId: w, format: 'one-on-one'})];
const canBook = async w => (await Promise.all(bookings(w))).every(q => q.ok);
const consentVersion = () => sqlite.prepare("SELECT id FROM waiver_versions WHERE kind='parent_consent' AND retired_at IS NULL").get()?.id;
const signConsent = (extra = {}) => post(familyApi, '/api/waiver', {kind: 'parent_consent', versionId: consentVersion(), wrestlerId: 'k1', signer: 'Robin Kim', accepted: true, electronicConsent: true, signature: {method: 'drawn', strokes}, ...extra}, 'kim');

// ---------- Nothing published: nothing changes for families ----------
{
  assert.equal(await canBook('k1'), true, 'no form, no block');
  let r = await get(familyApi, '/api/waiver?kind=parent_consent', 'kim');
  assert.equal(r.status, 200); assert.equal(r.body.document, null); assert.deepEqual(r.body.signatures, []);
  assert.equal((await signConsent({versionId: 'x'})).status, 409, 'nothing to sign');
  assert.equal((await get(familyApi, '/api/waiver?kind=coach_contract', 'kim')).status, 400, 'families cannot open the coach contract');
  assert.equal((await get(familyApi, '/api/waiver?kind=nonsense', 'kim')).status, 400);
}

// ---------- The owner publishes the form (only after the attorney's review, which the page says) ----------
{
  const publish = (who, extra = {}) => post(ownerApi, '/api/waivers', {action: 'publish', kind: 'parent_consent', title: 'Parent Consent Form', body: TEXT, ...extra}, who);
  assert.equal((await publish('kim')).status, 403, 'families cannot publish');
  assert.equal((await publish('cora')).status, 403, 'coaches cannot publish');
  assert.equal((await publish('owner', {kind: 'bogus'})).status, 400, 'unknown document');
  assert.equal((await publish('owner', {body: 'too short'})).status, 400);
  assert.equal((await publish('owner')).status, 200);
  assert.equal((await publish('owner')).status, 409, 'same text twice');
  assert.equal(await waivers.currentWaiver(), null, 'publishing the consent form publishes no waiver');
  assert.equal((await get(ownerApi, '/api/waivers', 'owner')).body.versions.length, 0, 'the waiver page lists only waivers');
  const page = await get(ownerApi, '/api/waivers?kind=parent_consent', 'owner');
  assert.equal(page.body.current.title, 'Parent Consent Form'); assert.equal(page.body.versions.length, 1);
  assert.deepEqual(page.body.wrestlers.filter(w => w.userId === 'kim-uuid').map(w => [w.wrestler, w.signed]), [['Kai Kim', false], ['Ari Kim', false]]);
}

// ---------- Now booking needs it, for every purchase type and offline payments too ----------
{
  for (const q of await Promise.all(bookings('k1'))) {
    assert.equal(q.ok, false); assert.equal(q.status, 403);
    assert.match(q.error, /^Kai Kim needs a signed Parent Consent Form before booking\./, 'the fixed name the booking pages link from');
  }
  const r = await post(payments, '/api/payments', {action: 'record', userId: 'kim-uuid', wrestlerId: 'k1', kind: 'event', eventId: 'camp', id: 'camp', method: 'cash'}, 'owner');
  assert.equal(r.status, 403); assert.match(r.body.error, /Parent Consent Form/);
  // Families are told (the daily reminder runs on publish). The wrestler view is checked in tests/wrestler-view.mjs.
  const notes = sqlite.prepare("SELECT * FROM notifications WHERE user_id='kim-uuid' AND kind='consent_needed' ORDER BY dedupe_key").all();
  assert.equal(notes.length, 2); assert.match(notes[0].subject, /Please sign the Parent Consent Form for (Kai|Ari) Kim/); assert.match(notes[0].body, /parent or guardian/);
}

// ---------- A parent or guardian signs, also for the adult wrestler ----------
{
  assert.equal((await signConsent({versionId: 'old'})).status, 409, 'must sign the version in force');
  assert.equal((await signConsent({kind: 'waiver'})).status, 409, 'a consent form signature is not a waiver signature');
  assert.equal((await signConsent({wrestlerId: 'athlete-a'})).status, 404, "cannot sign for another family's wrestler");
  assert.equal((await signConsent({accepted: false})).status, 400);
  assert.equal((await signConsent({electronicConsent: false})).status, 400);
  assert.equal((await signConsent({signature: {method: 'typed'}})).status, 400, 'drawn signature required');
  let r = await signConsent({wrestlerId: 'k2', signer: 'Ari Kim'});
  assert.equal(r.status, 400, 'an adult wrestler cannot sign for themselves'); assert.match(r.body.error, /including wrestlers 18 and older/);
  assert.equal((await signConsent({wrestlerId: 'k2', signer: '  ari KIM '})).status, 400, 'whatever the spacing or case');
  assert.equal((await signConsent({signer: 'Kai Kim'})).status, 400, 'nor can a younger wrestler');
  r = await signConsent(); assert.equal(r.status, 200); const sigId = r.body.id;
  assert.equal((await signConsent()).status, 409, 'once per wrestler per version');
  assert.equal(await canBook('k1'), true, 'signed: booking opens');
  assert.equal(await canBook('k2'), false, 'the other wrestler still needs it');
  const record = JSON.parse(sqlite.prepare('SELECT signature_record FROM waiver_signatures WHERE id=?').get(sigId).signature_record);
  assert.equal(record.kind, 'parent_consent'); assert.equal(record.signerRole, 'parent'); assert.equal(record.consent, docs.DOCUMENTS.parent_consent.consent);
  assert.equal(record.waiverId, consentVersion()); assert.equal(record.signer, 'Robin Kim'); assert.deepEqual(record.strokes, strokes);
  // Each document lists only its own signatures.
  r = await get(familyApi, '/api/waiver?kind=parent_consent', 'kim'); assert.equal(r.body.signatures.length, 1); assert.equal(r.body.signatures[0].current, true);
  assert.equal(r.body.consent, docs.DOCUMENTS.parent_consent.consent);
  assert.deepEqual((await get(familyApi, '/api/waiver', 'kim')).body.signatures, [], 'the waiver list is unchanged');
  // The signed copy: the family and the owner only; it names the parent role and the form.
  const copy = await docs.signedCopy(sigId, {userId: 'kim-uuid', owner: false});
  assert.equal(copy.version.kind, 'parent_consent'); assert.equal(await docs.signedCopy(sigId, {userId: 'alice-uuid', owner: false}), null);
  const html = docs.signedCopyHtml(copy, 'n1');
  assert.match(html, /<title>Signed Parent Consent Form/); assert.match(html, /Kai Kim/); assert.match(html, /Signed by<\/strong> Robin Kim, parent or guardian/); assert.match(html, /<polyline/);
  // Signed copies cannot be changed: altering the published text is detected.
  sqlite.prepare("UPDATE waiver_versions SET body=body||' edited' WHERE id=?").run(consentVersion());
  assert.match((await docs.signedCopy(sigId, {userId: 'kim-uuid', owner: false})).error, /Parent Consent Form record needs review/);
  sqlite.prepare('UPDATE waiver_versions SET body=substr(body,1,length(body)-7) WHERE id=?').run(consentVersion());
  assert.ok((await docs.signedCopy(sigId, {userId: 'kim-uuid', owner: false})).signature);
  assert.equal((await get(ownerApi, '/api/waivers?kind=parent_consent', 'owner')).body.wrestlers.find(w => w.wrestlerId === 'k1').signed, true);
}

// ---------- Owner exceptions work for the form as they do for the waiver, and each covers only its own document ----------
{
  const grant = rule => post(exceptionsApi, '/api/exceptions', {action: 'grant', userId: 'kim-uuid', wrestlerId: 'k2', rule, endsOn: ny(30), reason: 'Paper form on file'}, 'owner');
  assert.equal((await grant('waiver')).status, 200);
  assert.equal(await canBook('k2'), false, 'a waiver exception does not cover the consent form');
  assert.equal((await grant('parent_consent')).status, 200);
  assert.equal(await canBook('k2'), true, 'the consent form exception lets the wrestler book');
  assert.equal((await get(familyApi, '/api/waiver?kind=parent_consent', 'kim')).body.exceptions.k2, ny(30));
  // A waiver published now blocks on its own, until its exception (granted above) covers it.
  assert.equal((await post(ownerApi, '/api/waivers', {action: 'publish', title: 'Participation waiver', body: TEXT}, 'owner')).status, 200);
  assert.match((await quotes.quoteBooking('kim-uuid', {type: 'event', wrestlerId: 'k1', id: 'camp'})).error, /Kai Kim needs a signed Participation waiver/, 'waiver first, by its title');
  assert.equal(await canBook('k2'), true, 'both exceptions in place');
  assert.equal((await post(ownerApi, '/api/waivers', {action: 'retire'}, 'owner')).status, 200);
  for (const x of (await get(exceptionsApi, '/api/exceptions', 'owner')).body.exceptions) assert.equal((await post(exceptionsApi, '/api/exceptions', {action: 'remove', id: x.id}, 'owner')).status, 200);
  assert.equal(await canBook('k2'), false);
}

// ---------- Retiring the form stops the requirement ----------
{
  assert.equal((await post(ownerApi, '/api/waivers', {action: 'retire', kind: 'parent_consent'}, 'owner')).status, 200);
  assert.equal((await post(ownerApi, '/api/waivers', {action: 'retire', kind: 'parent_consent'}, 'owner')).status, 409);
  assert.equal(await canBook('k2'), true, 'nothing required after retiring');
  assert.equal((await get(familyApi, '/api/waiver?kind=parent_consent', 'kim')).body.signatures[0].current, false, 'kept as an earlier copy');
}

// ---------- Coach contracts ----------
{
  const signContract = (who, extra = {}) => post(contractApi, '/api/contract', {versionId: sqlite.prepare("SELECT id FROM waiver_versions WHERE kind='coach_contract' AND retired_at IS NULL").get()?.id,
    signer: 'Cora Coach', accepted: true, electronicConsent: true, signature: {method: 'drawn', strokes}, ...extra}, who);
  assert.equal((await get(contractApi, '/api/contract', 'kim')).status, 403, 'families have no contract');
  let r = await get(contractApi, '/api/contract', 'cora'); assert.equal(r.status, 200); assert.equal(r.body.document, null, 'nothing until the owner publishes');
  assert.equal((await post(ownerApi, '/api/waivers', {action: 'publish', kind: 'coach_contract', title: 'Coach contract 2026', body: TEXT}, 'cora')).status, 403);
  assert.equal((await post(ownerApi, '/api/waivers', {action: 'publish', kind: 'coach_contract', title: 'Coach contract 2026', body: TEXT}, 'owner')).status, 200);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM notifications WHERE kind NOT IN ('consent_needed','waiver_needed')").get().n, 0, 'no family notices for a coach contract');
  r = await get(contractApi, '/api/contract', 'cora'); assert.equal(r.body.document.title, 'Coach contract 2026'); assert.deepEqual(r.body.signatures, []);
  assert.equal(r.body.consent, docs.DOCUMENTS.coach_contract.consent);
  assert.equal(await canBook('k2'), true, 'a coach contract never blocks a family');
  // Coaching is not blocked by an unsigned contract (not decided): coach home still loads.
  assert.equal((await get(coachApi, '/api/coach', 'drew')).status, 200);
  // Owner view: every coach except the owner, with who has signed.
  let page = (await get(ownerApi, '/api/waivers?kind=coach_contract', 'owner')).body;
  assert.deepEqual(page.coaches.map(c => [c.email, c.signed]), [['cora.coach@example.test', false], ['drew.coach@example.test', false]], 'the owner does not sign a contract');
  assert.equal(page.wrestlers, undefined);
  // The coach signs for themselves.
  assert.equal((await signContract('cora', {signature: {method: 'drawn', strokes: [[[0.5, 0.5], [0.5, 0.5]]]}})).status, 400, 'a dot is not a signature');
  assert.equal((await signContract('cora', {electronicConsent: false})).status, 400);
  assert.equal((await signContract('cora', {versionId: 'old'})).status, 409);
  r = await signContract('cora', {wrestlerId: 'k1'}); assert.equal(r.status, 200, 'a stray wrestler id is ignored'); const cid = r.body.id;
  assert.equal((await signContract('cora')).status, 409, 'once per version'); assert.match((await signContract('cora')).body.error, /Your contract is already signed/);
  const row = sqlite.prepare('SELECT * FROM waiver_signatures WHERE id=?').get(cid);
  assert.equal(row.wrestler_id, ''); assert.equal(row.wrestler_name, ''); assert.equal(row.user_id, 'cora-uuid'); assert.equal(row.email, 'cora.coach@example.test');
  assert.equal(JSON.parse(row.signature_record).signerRole, 'coach');
  r = await get(contractApi, '/api/contract', 'cora'); assert.equal(r.body.signatures.length, 1); assert.equal(r.body.signatures[0].current, true);
  page = (await get(ownerApi, '/api/waivers?kind=coach_contract', 'owner')).body;
  assert.deepEqual(page.coaches.map(c => [c.name, c.signed]), [['Cora Coach', true], ['Drew Coach', false]]); assert.equal(page.versions[0].signed, 1);
  const copy = await docs.signedCopy(cid, {userId: 'cora-uuid', owner: false});
  assert.equal(await docs.signedCopy(cid, {userId: 'drew-uuid', owner: false}), null, 'another coach cannot open it');
  assert.ok((await docs.signedCopy(cid, {userId: 'owner-uuid', owner: true})).signature, 'the owner can');
  const html = docs.signedCopyHtml(copy, 'n2'); assert.match(html, /<strong>Coach<\/strong> Cora Coach/); assert.doesNotMatch(html, /Wrestler/); assert.match(html, /Coach contract version/);
  // The owner, also set up as a coach, is not asked to sign.
  assert.equal((await get(contractApi, '/api/contract', 'owner')).body.owner, true);
  assert.equal((await get(contractApi, '/api/contract', 'owner')).body.document, null);
  assert.equal((await signContract('owner')).status, 403);
  // A contract signature is not a family document.
  assert.deepEqual((await get(familyApi, '/api/waiver', 'cora')).body.signatures, []);
  // A new version asks again.
  assert.equal((await post(ownerApi, '/api/waivers', {action: 'publish', kind: 'coach_contract', title: 'Coach contract 2027', body: TEXT + ' Updated.'}, 'owner')).status, 200);
  assert.equal((await get(contractApi, '/api/contract', 'cora')).body.signatures[0].current, false);
}

// ---------- The audit trail names each document ----------
{
  const actions = sqlite.prepare("SELECT action FROM security_events WHERE action LIKE 'parent_consent%' OR action LIKE 'coach_contract%' ORDER BY rowid").all().map(x => x.action);
  assert.deepEqual(actions, ['parent_consent_published', 'parent_consent_signed', 'parent_consent_retired', 'coach_contract_published', 'coach_contract_signed', 'coach_contract_published']);
  const names = {people: {}, you: [], approvals: {}, waitlist: {}, orders: {}, waivers: {v1: 'Parent Consent Form'}, wrestlers: {'kim-uuid/k1': 'Kai Kim'}, requests: {}, curricula: {}, coaches: {}};
  const e = log.describeSecurityEvent({id: 'e', actor: 'kim-uuid', action: 'parent_consent_signed', target: 'v1/k1', created_at: now}, names);
  assert.match(JSON.stringify(e), /Parent Consent Form signed/); assert.match(JSON.stringify(e), /Kai Kim/);
  const x = log.describeSecurityEvent({id: 'e', actor: 'owner-uuid', action: 'booking_exception_granted', target: `parent_consent kim-uuid/k1 until ${ny(5)}`, created_at: now}, names);
  assert.match(JSON.stringify(x), /without a signed Parent Consent Form/);
}

// ---------- Page functions (inline JavaScript is not typechecked) ----------
const scriptOf = file => { const p = readFileSync(file, 'utf8'); return p.slice(p.lastIndexOf('<script>') + 8, p.lastIndexOf('</script>')); };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
// The signing page (/waiver, /consent, /contract).
{
  const s = scriptOf('app/waiver/screen.html'), ctx = {esc, when: d => d};
  vm.runInNewContext(s.slice(s.indexOf('const DOCS='), s.indexOf('const DOC=DOCS[')), ctx);
  const {DOCS, kindFor, signersFor, whoRow, statusLine, alsoLine, historyRow} = vm.runInNewContext('({DOCS,kindFor,signersFor,whoRow,statusLine,alsoLine,historyRow})', ctx);
  assert.equal(kindFor('/waiver'), 'waiver'); assert.equal(kindFor('/consent'), 'parent_consent'); assert.equal(kindFor('/contract'), 'coach_contract');
  for (const d of Object.values(DOCS)) assert.equal(kindFor(d.other?.href ?? '/contract'), d.other ? (d.kind === 'waiver' ? 'parent_consent' : 'waiver') : 'coach_contract');
  assert.match(DOCS.parent_consent.api, /kind=parent_consent/); assert.equal(DOCS.coach_contract.api, '/api/contract');
  const family = {parentName: 'Robin Kim', wrestlers: [{id: 'a', name: 'Kai'}, {id: 'b', name: 'Ari'}]};
  assert.deepEqual(signersFor(DOCS.parent_consent, family).map(x => x.id), ['a', 'b']);
  assert.deepEqual(JSON.parse(JSON.stringify(signersFor(DOCS.coach_contract, {}))), [{id: '', name: 'You'}], 'a coach signs for themselves');
  assert.match(whoRow(DOCS.parent_consent, {name: 'Kai'}, null), /Not signed · booking blocked/);
  assert.match(whoRow(DOCS.coach_contract, {name: 'You'}, null), /Not signed yet/); assert.doesNotMatch(whoRow(DOCS.coach_contract, {name: 'You'}, null), /booking/);
  assert.match(whoRow(DOCS.coach_contract, {name: 'You'}, {id: 's1', signedAt: 'x'}), /waiver-copy\?id=s1/);
  const info = {document: {id: 'v'}, signatures: [{id: 's', wrestlerId: 'a', current: true}, {id: 'old', wrestlerId: 'b', current: false}]};
  assert.equal(statusLine(DOCS.parent_consent, info, family.wrestlers), DOCS.parent_consent.ask, 'an old version does not count');
  assert.equal(statusLine(DOCS.parent_consent, {...info, signatures: [...info.signatures, {wrestlerId: 'b', current: true}]}, family.wrestlers), DOCS.parent_consent.all);
  assert.equal(statusLine(DOCS.waiver, {document: null, signatures: []}, family.wrestlers), '');
  // On the waiver page, the consent form is pointed out when it also still needs signing, and only then.
  assert.match(alsoLine(DOCS.waiver, info, family.wrestlers), /Also needed:.*Parent Consent Form.*for Ari.*href="\/consent"/);
  assert.equal(alsoLine(DOCS.waiver, {document: null, signatures: []}, family.wrestlers), '');
  assert.equal(alsoLine(DOCS.waiver, {document: {}, signatures: [{wrestlerId: 'a', current: true}, {wrestlerId: 'b', current: true}]}, family.wrestlers), '');
  assert.match(alsoLine(DOCS.parent_consent, info, family.wrestlers), /the waiver for Ari.*href="\/waiver"/);
  assert.equal(alsoLine(DOCS.coach_contract, info, []), '');
  assert.match(historyRow(DOCS.coach_contract, {id: 's', title: 'Coach contract 2026', signer: 'Cora', signedAt: 'x', current: false}), /Coach contract 2026.*earlier version/);
  // The page wording follows decision Q16: no "adult wrestler" signer.
  assert.doesNotMatch(readFileSync('app/waiver/screen.html', 'utf8'), /or the adult wrestler/);
}
// The owner page (/waivers, /consent-forms, /contracts).
{
  const s = scriptOf('app/waivers/screen.html');
  for (const [path, kind] of [['/waivers', 'waiver'], ['/consent-forms', 'parent_consent'], ['/contracts', 'coach_contract']]) {
    const ctx = {esc, when: d => d, location: {pathname: path}};
    vm.runInNewContext(s.slice(s.indexOf('const DOCS='), s.indexOf('let data=null;')) + ';this.DOC=DOC;this.peopleOf=peopleOf;this.statusCell=statusCell;this.personCells=personCells;this.matches=matches', ctx);
    assert.equal(ctx.DOC.kind, kind);
    if (kind === 'parent_consent') { assert.match(ctx.DOC.notice, /attorney has not reviewed/); assert.equal(ctx.DOC.rule, 'parent_consent'); assert.equal(ctx.DOC.defaultTitle, 'Parent Consent Form'); }
    if (kind === 'waiver') { assert.equal(ctx.DOC.rule, 'waiver'); assert.equal(ctx.DOC.defaultTitle, 'Participation waiver and release'); }
    if (kind === 'coach_contract') {
      assert.equal(ctx.DOC.rule, undefined, 'no booking exceptions for contracts');
      const people = ctx.peopleOf(ctx.DOC, {coaches: [{email: 'c@x.test', name: 'Cora', signed: false}]});
      assert.equal(people[0].wrestler, 'Cora'); assert.ok(ctx.matches(people[0], 'cora')); assert.ok(ctx.matches(people[0], 'c@x'));
      const cell = ctx.statusCell(ctx.DOC, people[0]);
      assert.match(cell, /Not signed/); assert.match(cell, /Email coach/); assert.doesNotMatch(cell, /Allow booking anyway/);
      assert.match(ctx.personCells(ctx.DOC, people[0]), /<td><strong>Cora<\/strong><\/td><td>c@x\.test<\/td>/);
    }
  }
}
// The family page: a line per wrestler for the consent form once it is published.
{
  const page = readFileSync('app/family/screen.html', 'utf8');
  const fn = page.slice(page.indexOf('let waiverInfo=null,consentInfo=null;'), page.indexOf('async function refreshCards'));
  const ctx = {esc, longDate: d => 'LONG ' + d, fetch: async () => ({})}; vm.runInNewContext(fn + ';this.consentLine=consentLine;this.waiverLine=waiverLine;this.set=(w,c)=>{waiverInfo=w;consentInfo=c}', ctx);
  assert.equal(ctx.consentLine({id: 'a'}), '', 'nothing shown until the form is published');
  ctx.set(null, {document: {id: 'v'}, signatures: [], exceptions: {}});
  assert.match(ctx.consentLine({id: 'a'}), /Parent Consent Form not signed.*Booking is blocked.*href="\/consent\?wrestler=a">Sign the form/);
  assert.equal(ctx.waiverLine({id: 'a'}), '', 'the waiver line still depends only on the waiver');
  ctx.set(null, {document: {id: 'v'}, signatures: [], exceptions: {a: '2026-12-01'}});
  assert.match(ctx.consentLine({id: 'a'}), /allowing bookings until LONG 2026-12-01/);
  ctx.set(null, {document: {id: 'v'}, signatures: [{id: 's9', wrestlerId: 'a', current: true}]});
  assert.match(ctx.consentLine({id: 'a'}), /Parent Consent Form signed.*waiver-copy\?id=s9/);
  assert.match(page, /\['','One step','Two steps','Three steps','Four steps','Five steps'\]/, 'five steps once both documents are published');
}
// Coach home: a clear to-do until the coach signs the contract in force.
{
  const s = readFileSync('app/coach/screen.html', 'utf8'), line = s.slice(s.indexOf('function contractTodo'), s.indexOf('async function loadContract'));
  const ctx = {esc}; vm.runInNewContext(line + ';this.todo=contractTodo', ctx);
  assert.equal(ctx.todo({document: null, signatures: []}), '');
  assert.equal(ctx.todo({owner: true, document: null, signatures: []}), '');
  assert.match(ctx.todo({document: {title: 'Coach contract 2026'}, signatures: [{current: false}]}), /To do:.*Coach contract 2026.*href="\/contract"/);
  assert.equal(ctx.todo({document: {title: 'C'}, signatures: [{current: true}]}), '');
  assert.match(s, /<p id="contractTodo" class="owner-note" hidden><\/p>/);
}
// Booking, registration and lesson pages send a family to the document named in the refusal.
for (const file of ['app/booking/screen.html', 'app/register/screen.html', 'app/lesson/screen.html']) {
  const s = readFileSync(file, 'utf8'), fn = s.slice(s.indexOf('function signHelp'), s.indexOf('\n', s.indexOf('function signHelp')));
  const ctx = {}; vm.runInNewContext(fn + ';this.signHelp=signHelp', ctx);
  const a = {href: '/waiver', textContent: ''}, p = {querySelector: () => a};
  ctx.signHelp(p, 'Kai Kim needs a signed Parent Consent Form before booking. Sign it in your family account; it takes about a minute.');
  assert.equal(a.href, '/consent', file); assert.match(a.textContent, /Parent Consent Form/);
  ctx.signHelp(p, 'Kai Kim needs a signed Participation waiver before booking.');
  assert.equal(a.href, '/waiver', file); assert.equal(a.textContent, 'Sign the waiver →');
  assert.match(s, /signHelp\((?:document\.getElementById\('waiverHelp'\)|\$\('waiverHelp'\)),t\)/, file + ' calls it');
}
// Routes: each new page reuses its shared screen with its own title, behind the right sign-in.
{
  for (const [file, screen, guard, title] of [['app/consent/route.ts', '../waiver/screen.html', 'familyPage', 'Parent Consent Form'], ['app/contract/route.ts', '../waiver/screen.html', 'coachPage', 'Coach contract'],
    ['app/consent-forms/route.ts', '../waivers/screen.html', 'ownerPage', 'Parent Consent Form'], ['app/contracts/route.ts', '../waivers/screen.html', 'ownerPage', 'Coach contracts']]) {
    const src = readFileSync(file, 'utf8');
    assert.ok(src.includes(screen + '?raw'), file); assert.match(src, new RegExp(guard + '\\(request')); assert.ok(src.includes(`'${title}'`), file);
  }
  const pages = load('lib/protected-page.ts');
  const html = pages.retitle(readFileSync('app/waiver/screen.html', 'utf8'), 'Waiver', 'Parent Consent Form');
  assert.match(html, /<title>Parent Consent Form \|/); assert.match(html, /<h1 id="title">Parent Consent Form<\/h1>/);
  const owner = pages.retitle(readFileSync('app/waivers/screen.html', 'utf8'), 'Waivers', 'Coach contracts');
  assert.match(owner, /<title>Coach contracts \|/); assert.match(owner, /<h1>Coach contracts<\/h1>/);
  // /waiver behaves as before: signed-out visitors go to sign in.
  const r = await pages.familyPage(request('/waiver', 'GET', null, ''), '<p>x</p>');
  assert.equal(r.status, 303); assert.equal(r.headers.get('Location'), '/login');
  assert.equal((await pages.familyPage(request('/consent', 'GET', null, 'kim'), '<p>x</p>')).status, 200);
}
// The attorney's draft is in the repository, clearly marked, and nothing publishes it.
{
  const draft = readFileSync('docs/policies/parent-consent-form-draft.md', 'utf8');
  assert.match(draft, /^# Parent Consent Form \(DRAFT/); assert.match(draft, /not been reviewed by an attorney/i);
  for (const f of ['lib/documents.ts', 'lib/waivers.ts', 'app/waivers/screen.html', 'app/waiver/screen.html'])
    assert.doesNotMatch(readFileSync(f, 'utf8'), /PARENT \/ LEGAL GUARDIAN CONSENT|parent-consent-form-draft/, f + ' must not carry the draft text');
}
console.log('Document tests passed: Parent Consent Form publish, sign, booking block only after publish, parent-only signing, exceptions; coach contract publish, sign, to-do and owner view; page functions');
