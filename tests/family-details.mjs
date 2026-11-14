// Issue #188: family contact and safety details. Home address (street, city, state, ZIP), an emergency contact, and
// per wrestler a birth date and allergies or medical notes. Justin decided all four are required and coaches see
// allergies and emergency contacts on the check-in roster (#197, question 14). The server refuses a profile without
// them and checks every field; stored profiles from before stay valid and the family home asks them to finish;
// the owner sees the details on Family accounts, with a program filter; staff see them on the roster.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {load, request, sqlite} from './accounts.mjs';

const records = load('lib/family-records.ts');
const today = '2026-11-06';
const base = {parentName: 'Pat', phone: '555-0100', wrestlers: [{id: 'w1', name: 'Sam', grade: '8'}]};
const details = {homeAddress: '20 Railroad St', homeCity: 'Huntington Station', homeState: 'NY', homeZip: '11746', emergencyContactName: 'Jordan', emergencyContactPhone: '631-555-0199'};
const full = {...base, ...details, wrestlers: [{...base.wrestlers[0], birthDate: '2012-04-18', allergies: 'None'}]};
const plain = v => JSON.parse(JSON.stringify(v)); // values from the vm realm
const ok = v => records.validFamily(v) && records.familyProblem(v, today) === null;

// Required on save: a profile without them lists exactly what is missing, in form order.
assert.deepEqual(plain(records.missingDetails(full)), []);
assert.deepEqual(plain(records.missingDetails(base)), ['the street address', 'the city', 'the state', 'the ZIP code', 'the emergency contact’s name', 'the emergency contact’s phone number', 'Sam’s birth date', 'Sam’s allergies or medical notes']);
assert.deepEqual(plain(records.missingDetails({...full, homeZip: '  ', wrestlers: [{...full.wrestlers[0], allergies: ''}]})), ['the ZIP code', 'Sam’s allergies or medical notes']);
assert.equal(records.missingMessage(['the ZIP code']), 'Add the ZIP code before saving.');
assert.equal(records.missingMessage(['the city', 'the ZIP code', 'Sam’s allergies or medical notes']), 'Add the city, the ZIP code and Sam’s allergies or medical notes before saving. If a wrestler has no allergies or medical needs, choose “No allergies or medical notes”.');
// "None" answers the allergies question without counting as a medical note.
for (const v of ['None', 'none', 'N/A', 'no']) assert.equal(records.hasMedicalNote(v), false, v);
for (const v of ['Peanuts', 'None known but asthma']) assert.equal(records.hasMedicalNote(v), true, v);
assert.equal(records.hasMedicalNote(''), false);
// Stored profiles from before stay valid (readable, restorable from a backup); only a save asks for the details.
assert.ok(ok(base), 'an older profile without the new fields is still valid');
// A Sites version 130 profile kept the whole address on one line; it stays valid and stays the street line.
const legacy = {...base, homeAddress: '12 Mill Street, Huntington Station, NY 11746'};
assert.ok(ok(legacy));
assert.equal(records.cleanFamily(legacy).homeAddress, legacy.homeAddress);
assert.deepEqual(plain(records.addressLines(legacy)), [legacy.homeAddress]);

// ZIP: 5 digits, or ZIP+4.
for (const zip of ['11746', '11746-1234']) assert.ok(ok({...full, homeZip: zip}), zip);
for (const zip of ['1174', '117460', 'ABCDE', '11746-12']) assert.match(records.familyProblem({...full, homeZip: zip}, today), /ZIP/, zip);
// State: letters; a two-letter code is saved in capitals.
assert.match(records.familyProblem({...full, homeState: 'N4'}, today), /state/);
assert.equal(records.cleanFamily({...full, homeState: ' ny '}).homeState, 'NY');
assert.equal(records.cleanFamily({...full, homeState: 'New York'}).homeState, 'New York');
// Emergency phone: 10 US digits (11 with a leading 1), or an international number written with +.
for (const phone of ['631-555-0100', '(631) 555-0100', '1 631 555 0100', '+44 20 7946 0958', '631.555.0100']) assert.ok(ok({...full, emergencyContactPhone: phone}), phone);
for (const phone of ['555-0100', '631-555-01000', 'call me', '2-631-555-0100']) assert.match(records.familyProblem({...full, emergencyContactPhone: phone}, today), /phone/, phone);
// Birth date: a real date, not in the future, not before 1900.
const born = d => ({...full, wrestlers: [{...full.wrestlers[0], birthDate: d}]});
assert.ok(ok(born('2012-04-18'))); assert.ok(ok(born(today)), 'today is allowed');
assert.match(records.familyProblem(born('2026-11-07'), today), /can’t be in the future/);
assert.match(records.familyProblem(born('2023-02-30'), today), /Check Sam’s birth date/);
assert.match(records.familyProblem(born('1899-12-31'), today), /birth date/);
assert.match(records.familyProblem(born('April 2012'), today), /birth date/);
// Lengths and types are checked on every save and on backup restore.
const tooLong = (k, n) => ({...full, [k]: 'x'.repeat(n)});
for (const [k, n] of Object.entries({homeAddress: 300, homeCity: 100, homeState: 40, homeZip: 10, emergencyContactName: 120, emergencyContactPhone: 40})) {
  assert.ok(records.validFamily(tooLong(k, n)), k + ' at its limit');
  assert.equal(records.validFamily(tooLong(k, n + 1)), false, k + ' over its limit');
}
assert.equal(records.validFamily({...full, homeZip: 11746}), false, 'numbers are not text');
assert.equal(records.validFamily({...full, wrestlers: [{...full.wrestlers[0], allergies: 'x'.repeat(501)}]}), false);
assert.equal(records.validFamily({...full, wrestlers: [{...full.wrestlers[0], birthDate: ['2012-04-18']}]}), false);
// Cleaning trims, drops empty fields and unknown ones, and never changes grades: Kindergarten stays "K".
const cleaned = records.cleanFamily({...base, homeCity: '  Huntington ', emergencyContactName: '   ', extra: 'x', wrestlers: [{id: 'k1', name: 'Kit', grade: 'K', birthDate: '2020-09-02', allergies: '  Bee stings  '}]});
assert.equal(cleaned.homeCity, 'Huntington'); assert.equal('emergencyContactName' in cleaned, false); assert.equal(cleaned.extra, undefined);
assert.deepEqual(plain(cleaned.wrestlers[0]), {id: 'k1', name: 'Kit', grade: 'K', usawNumber: '', usawExpires: '', birthDate: '2020-09-02', allergies: 'Bee stings'});
console.log('Passed: required details listed in plain words, "None" for no allergies, older profiles still valid, ZIP, state, phone, birth date and length checks.');

// Through the API: a profile without the details is refused with what to add; a bad value with what to fix.
const family = load('app/api/family/route.ts');
const put = async (data, who = 'bob') => {
  const rev = (await (await family.GET(request('/api/family', 'GET', null, who))).json()).revision;
  return family.PUT(request('/api/family', 'PUT', {revision: rev, data}, who));
};
const bob = {parentName: 'Bob Parent', phone: '555-0144', homeAddress: '20 Railroad St', homeCity: 'Huntington Station', homeState: 'ny', homeZip: '11746',
  emergencyContactName: 'Jordan Grandparent', emergencyContactPhone: '(631) 555-0199',
  wrestlers: [{id: 'bob-w1', name: 'Riley Two', grade: '10', birthDate: '2010-12-01', allergies: 'Peanut allergy.\nEpiPen in the blue bag.'}, {id: 'bob-w2', name: 'Kit Two', grade: 'K', birthDate: '2020-09-02', allergies: 'None'}]};
let r = await put({parentName: 'Bob Parent', phone: '555-0144', wrestlers: [{id: 'bob-w1', name: 'Riley Two', grade: '10'}]});
assert.equal(r.status, 400, 'a profile without the required details is refused');
let body = await r.json();
assert.match(body.error, /^Add the street address, the city, the state, the ZIP code, the emergency contact’s name, the emergency contact’s phone number, Riley Two’s birth date and Riley Two’s allergies or medical notes before saving\./);
assert.equal(body.missing.length, 8);
r = await put({...bob, wrestlers: [bob.wrestlers[0], {...bob.wrestlers[1], allergies: '  '}]}); assert.equal(r.status, 400); assert.match((await r.json()).error, /Add Kit Two’s allergies or medical notes/);
r = await put({...bob, homeZip: '117'}); assert.equal(r.status, 400); assert.match((await r.json()).error, /ZIP code/);
r = await put({...bob, wrestlers: [{...bob.wrestlers[0], birthDate: '2999-01-01'}, bob.wrestlers[1]]}); assert.equal(r.status, 400); assert.match((await r.json()).error, /future/);
r = await put({...bob, emergencyContactPhone: '12'}); assert.equal(r.status, 400); assert.match((await r.json()).error, /emergency contact/);
assert.equal(sqlite.prepare("SELECT count(*) n FROM family_accounts WHERE user_id='bob-uuid'").get().n, 0, 'nothing was saved');
r = await put(bob); assert.equal(r.status, 200);
assert.equal((await r.json()).data.homeState, 'NY', 'the reply carries the profile as saved');
const saved = (await (await family.GET(request('/api/family', 'GET', null, 'bob'))).json()).data;
assert.equal(saved.homeState, 'NY'); assert.equal(saved.emergencyContactPhone, '(631) 555-0199'); assert.equal(saved.wrestlers[0].birthDate, '2010-12-01');
assert.equal(saved.wrestlers[0].allergies, 'Peanut allergy.\nEpiPen in the blue bag.'); assert.equal(saved.wrestlers[1].grade, 'K'); assert.equal(saved.wrestlers[1].allergies, 'None');
// A required field cannot be cleared.
assert.equal((await put({...saved, homeZip: ''})).status, 400);
console.log('Passed: the server requires the details, refuses bad values with a plain reason, and saves complete profiles.');

// Family accounts: only the owner, with the details folded away, programs per wrestler, a medical-note marker and a
// marker for families who saved before the details were required.
const now = new Date().toISOString(), day = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York'}).format(new Date());
const plus = n => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
  VALUES ('ord-188','bob-uuid','bob@example.test','bob-w1','Riley Two','annual','Intermediate','Intermediate','Membership','[]',240000,0,240000,'usd','{}','{}','paid','k188',0,?,?,?,?,?,'offline')`).run(now, now, now, plus(-10), plus(300));
sqlite.prepare(`INSERT INTO scholarship_awards(id,token_hash,recipient_email,wrestler_name,program,reference_cents,terms_text,terms_ready,status,user_id,wrestler_id,expires_at,created_at,created_by)
  VALUES ('sch-188',?,'bob@example.test','Kit Two','Elementary',0,'Terms',1,'active','bob-uuid','bob-w2',?,?,'owner')`).run('e'.repeat(64), now, now);
// A family that saved before #188, and a membership that ended (it does not count as a current program).
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('legacy-uuid', 'legacy@example.test', JSON.stringify({parentName: 'Lee Legacy', phone: '555-0177', wrestlers: [{id: 'lw1', name: 'Lou Legacy', grade: '3'}]}), 1, '2026-10-01T00:00:00Z');
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
  VALUES ('ord-old','legacy-uuid','legacy@example.test','lw1','Lou Legacy','annual','Elementary','Elementary','Membership','[]',240000,0,240000,'usd','{}','{}','paid','kold',0,?,?,?,'2024-01-01','2024-12-31','offline')`).run(now, now, now);
const accounts = load('app/accounts/route.ts');
assert.equal((await accounts.GET(request('/accounts', 'GET', null, 'bob'))).status, 403, 'a family cannot open Family accounts');
assert.equal((await accounts.GET(request('/accounts', 'GET', null, 'alice'))).status, 403);
const html = await (await accounts.GET(request('/accounts', 'GET', null, 'owner'))).text();
// A family's card on the page, found by its email.
const cardOf = (page, email) => '<article ' + page.split('<article ').find(s => s.includes(email)).split('</article>')[0] + '</article>';
const card = cardOf(html, 'bob@example.test');
assert.match(card, /data-programs="Intermediate Elementary"/);
assert.match(card, /Riley Two · Grade 10<\/span><span class="pill">SWA Intermediate<\/span><span class="pill bad">Medical note<\/span>/);
// Each wrestler row ends with its links to approvals and transfers (issue #283).
assert.match(card, /Kit Two · Kindergarten<\/span><span class="pill">SWA Development<\/span><span class="kid-links"><a href="\/approvals">Approvals<\/a><a href="\/transfers">Transfer<\/a><\/span><\/li>/, '"None" is not a medical note');
assert.doesNotMatch(card, /Details missing/);
assert.match(card, /<details class="family-details"><summary>Contact and safety details<\/summary>/);
assert.doesNotMatch(card, /<details[^>]* open/, 'medical notes are folded away by default');
assert.match(card, /20 Railroad St<br>Huntington Station, NY 11746/);
assert.match(card, /Jordan Grandparent · \(631\) 555-0199/);
assert.match(card, /December 1, 2010 · age \d+/);
assert.match(card, /Peanut allergy.\nEpiPen in the blue bag./);
const legacyCard = cardOf(html, 'legacy@example.test');
assert.match(legacyCard, /data-programs="none"/, 'an ended membership is not a current program');
assert.match(legacyCard, /<span class="pill warn">Details missing<\/span>/);
assert.match(legacyCard, /Home address<\/dt><dd><span class="none">Not provided/);
assert.match(html, /Coaches see allergies and emergency contacts on the check-in roster for their own programs/);
assert.match(html, /<select id="program" name="program"><option value="" selected>All programs<\/option><option value="Elementary">SWA Development<\/option><option value="Intermediate">SWA Intermediate<\/option><option value="Advanced">SWA Advance<\/option><option value="none">No current program<\/option><\/select>/);
// Text a family typed is escaped.
assert.equal((await put({...bob, emergencyContactName: '<img src=x onerror=alert(1)>'})).status, 200);
const escaped = await (await accounts.GET(request('/accounts', 'GET', null, 'owner'))).text();
assert.doesNotMatch(escaped, /<img src=x/); assert.match(escaped, /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.equal((await put(bob)).status, 200);
console.log('Passed: owner-only Family accounts shows the details folded away, programs per wrestler, a medical-note marker and families still missing details.');

// The check-in roster shows staff the allergies or medical notes and the emergency contact (#197, question 14).
const roster = readFileSync('app/roster/screen.html', 'utf8');
const rosterSafety = new Function(roster.match(/const noNotes=[^\n]*\n/)[0] + roster.match(/function safety\(e\)\{[\s\S]*?\n\}/)[0] + "const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));return safety;")();
assert.match(rosterSafety({allergies: 'Peanuts <severe>', emergencyName: 'Jordan', emergencyPhone: '631-555-0199'}), /<span class="medical"><strong>Allergies or medical notes:<\/strong> Peanuts &lt;severe&gt;<\/span><br><strong>Emergency contact:<\/strong> Jordan · <a href="tel:631-555-0199">631-555-0199<\/a>/);
assert.match(rosterSafety({allergies: 'None', emergencyName: 'Jordan', emergencyPhone: null}), /No allergies or medical notes[\s\S]*Emergency contact:<\/strong> Jordan/);
assert.match(rosterSafety({allergies: null, emergencyName: null, emergencyPhone: null}), /Allergies or medical notes not given yet[\s\S]*Emergency contact not given yet/);
assert.match(roster, /\$\{safety\(e\)\}/, 'every roster row shows them');
console.log('Passed: the roster shows allergies or medical notes and the emergency contact to staff.');

// The family page: the form says the details are required and why, saves them, and asks families who saved before
// to finish them.
const page = readFileSync('app/family/screen.html', 'utf8');
assert.match(page, /The academy needs these details for every family\.<\/strong> They let us reach someone quickly/);
assert.match(page, /The academy and your wrestler’s coaches see them at check-in/);
assert.doesNotMatch(page, /Optional<\/span>/);
const contactForm = page.match(/<fieldset[\s\S]*?<h3>Your wrestlers<\/h3>/)[0];
for (const id of ['homeAddress', 'homeCity', 'homeState', 'homeZip', 'emergencyContactName', 'emergencyContactPhone']) assert.match(contactForm, new RegExp(`<input id="${id}"[^>]* required`), id + ' is required in the form');
const script = page.match(/<script>([\s\S]*)<\/script>/)[1];
const nodes = new Map();
const element = id => { if (!nodes.has(id)) nodes.set(id, {hidden: id === 'summary', value: '', textContent: '', innerHTML: '', checked: false, focus() { this.focused = true; }, scrollIntoView() {}, elements: {parentName: {value: '', focus() {}}, phone: {value: ''}}}); return nodes.get(id); };
let stored = {parentName: 'Pat', phone: '555-0100', wrestlers: [{id: 'w1', name: 'Sam', grade: '8'}]}, revision = 1;
const ctx = vm.createContext({document: {getElementById: element}, location: {}, URLSearchParams, crypto: {randomUUID: () => 'new-id'},
  fetch: async (path, o) => { if (o?.method === 'PUT') { stored = JSON.parse(o.body).data; revision++; } return {ok: true, status: 200, json: async () => ({email: 'pat@example.test', data: structuredClone(stored), revision, updatedAt: '2026-11-06T12:00:00Z'})}; }});
vm.runInContext(script, ctx);
await new Promise(r => setImmediate(r));
// A family that saved before the details were required is asked to finish them; nothing else is blocked.
assert.equal(element('finishDetails').hidden, false, 'the home page asks to finish the details');
assert.match(element('finishText').textContent, /Still to add: the street address, the city, the state, the ZIP code, the emergency contact’s name, the emergency contact’s phone number, Sam’s birth date, Sam’s allergies or medical notes\.$/);
assert.equal(element('editor').hidden, true, 'the saved profile still shows');
assert.match(element('contactRows').innerHTML, /Address<\/dt><dd class="t"><span class="muted">Not added yet/);
// The family page's list matches the server's.
assert.deepEqual(plain(vm.runInContext('missingDetails', ctx)(stored)), plain(records.missingDetails(stored)));
vm.runInContext('startSafety()', ctx);
assert.equal(element('editor').hidden, false); assert.equal(element('homeAddress').focused, true, 'the first missing field gets focus');
assert.match(element('wrestlers').innerHTML, /<label class="birth">Birth date<input id="birth0" type="date" required min="1900-01-01" max="\d{4}-\d{2}-\d{2}"/);
assert.match(element('wrestlers').innerHTML, /Allergies or medical notes<textarea id="allergies0" maxlength="500" rows="2" required/);
assert.match(element('wrestlers').innerHTML, /<input type="checkbox" id="none0" data-notes="0">No allergies or medical notes/);
element('homeAddress').value = '12 Mill Street'; element('homeCity').value = 'Huntington'; element('homeState').value = 'NY'; element('homeZip').value = '11746';
element('emergencyContactName').value = 'Jordan'; element('emergencyContactPhone').value = '631-555-0199';
element('birth0').value = '2012-04-18'; element('allergies0').value = 'typed then ticked'; element('none0').checked = true;
vm.runInContext('notesNone(0)', ctx);
assert.equal(element('allergies0').disabled, true); assert.equal(element('allergies0').value, '', '"No allergies" clears and disables the box');
await element('familyForm').onsubmit({preventDefault() {}});
assert.deepEqual(plain({...stored, wrestlers: undefined}), {parentName: 'Pat', phone: '555-0100', homeAddress: '12 Mill Street', homeCity: 'Huntington', homeState: 'NY', homeZip: '11746', emergencyContactName: 'Jordan', emergencyContactPhone: '631-555-0199'});
assert.equal(stored.wrestlers[0].birthDate, '2012-04-18'); assert.equal(stored.wrestlers[0].allergies, 'None', '"No allergies" is saved as None');
assert.equal(element('finishDetails').hidden, true, 'the prompt goes away once the details are saved');
// The Family card holds the contacts as rows (#282); the wrestler card carries the birth date and the notes.
let summary = element('contactRows').innerHTML;
assert.match(summary, /Address<\/dt><dd class="t">12 Mill Street, Huntington, NY 11746/);
assert.match(summary, /Emergency<\/dt><dd class="t">Jordan · 631-555-0199/);
assert.match(element('savedDetails').innerHTML, /<p class="kid-safety quiet">Born Apr 18, 2012 · No allergies or medical notes<\/p>/);
// Editing again: "None" shows as the ticked box; a real note shows in the box.
nodes.delete('none0'); nodes.delete('allergies0');
vm.runInContext('editProfile()', ctx);
assert.match(element('wrestlers').innerHTML, /id="none0" data-notes="0" checked>/); assert.match(element('wrestlers').innerHTML, /required aria-describedby="allergyHint0" disabled><\/textarea>/);
element('none0').checked = false; element('allergies0').value = ' Asthma <inhaler> ';
await element('familyForm').onsubmit({preventDefault() {}});
assert.equal(stored.wrestlers[0].allergies, 'Asthma <inhaler>');
summary = element('savedDetails').innerHTML;
assert.match(summary, /<p class="kid-safety"><b>Allergies or medical notes:<\/b> Asthma &lt;inhaler&gt;<br>Born Apr 18, 2012<\/p>/, 'a real allergy leads, in the note box');
vm.runInContext('editProfile()', ctx);
assert.equal(element('homeZip').value, '11746'); assert.match(element('wrestlers').innerHTML, /value="2012-04-18"/); assert.match(element('wrestlers').innerHTML, />Asthma &lt;inhaler&gt;<\/textarea>/);
console.log('Passed: the family form requires the details and says why, offers "No allergies or medical notes", saves them, and asks earlier families to finish them.');
