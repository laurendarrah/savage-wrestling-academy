// Issue #188: optional family contact and safety details. Home address (street, city, state, ZIP), an emergency
// contact, and per wrestler a birth date and allergies or medical notes. Nothing new is required, older profiles stay
// valid, the server checks every field, the family sees them on their profile, and only the owner sees them on
// Family accounts, with a program filter.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {load, request, sqlite} from './accounts.mjs';

const records = load('lib/family-records.ts');
const today = '2026-11-06';
const base = {parentName: 'Pat', phone: '555-0100', wrestlers: [{id: 'w1', name: 'Sam', grade: '8'}]};
const plain = v => JSON.parse(JSON.stringify(v)); // values from the vm realm
const ok = v => records.validFamily(v) && records.familyProblem(v, today) === null;

// Nothing new is required: a profile saved before #188 is still valid, and so are empty fields.
assert.ok(ok(base), 'an older profile without the new fields');
assert.ok(ok({...base, homeAddress: '', homeCity: '', homeState: '', homeZip: '', emergencyContactName: '', emergencyContactPhone: '', wrestlers: [{...base.wrestlers[0], birthDate: '', allergies: ''}]}), 'all empty');
// A Sites version 130 profile kept the whole address on one line; it stays valid and stays the street line.
const legacy = {...base, homeAddress: '12 Mill Street, Huntington Station, NY 11746'};
assert.ok(ok(legacy));
assert.equal(records.cleanFamily(legacy).homeAddress, legacy.homeAddress);
assert.deepEqual(plain(records.addressLines(legacy)), [legacy.homeAddress]);

// ZIP: 5 digits, or ZIP+4.
for (const zip of ['11746', '11746-1234']) assert.ok(ok({...base, homeZip: zip}), zip);
for (const zip of ['1174', '117460', 'ABCDE', '11746-12']) assert.match(records.familyProblem({...base, homeZip: zip}, today), /ZIP/, zip);
// State: letters; a two-letter code is saved in capitals.
assert.match(records.familyProblem({...base, homeState: 'N4'}, today), /state/);
assert.equal(records.cleanFamily({...base, homeState: ' ny '}).homeState, 'NY');
assert.equal(records.cleanFamily({...base, homeState: 'New York'}).homeState, 'New York');
// Emergency phone: 10 US digits (11 with a leading 1), or an international number written with +.
for (const phone of ['631-555-0100', '(631) 555-0100', '1 631 555 0100', '+44 20 7946 0958', '631.555.0100']) assert.ok(ok({...base, emergencyContactPhone: phone}), phone);
for (const phone of ['555-0100', '631-555-01000', 'call me', '2-631-555-0100']) assert.match(records.familyProblem({...base, emergencyContactPhone: phone}, today), /phone/, phone);
// Birth date: a real date, not in the future, not before 1900.
const born = d => ({...base, wrestlers: [{...base.wrestlers[0], birthDate: d}]});
assert.ok(ok(born('2012-04-18'))); assert.ok(ok(born(today)), 'today is allowed');
assert.match(records.familyProblem(born('2026-11-07'), today), /can’t be in the future/);
assert.match(records.familyProblem(born('2023-02-30'), today), /Check Sam’s birth date/);
assert.match(records.familyProblem(born('1899-12-31'), today), /birth date/);
assert.match(records.familyProblem(born('April 2012'), today), /birth date/);
// Lengths and types are checked on every save and on backup restore.
const tooLong = (k, n) => ({...base, [k]: 'x'.repeat(n)});
for (const [k, n] of Object.entries({homeAddress: 300, homeCity: 100, homeState: 40, homeZip: 10, emergencyContactName: 120, emergencyContactPhone: 40})) {
  assert.ok(records.validFamily(tooLong(k, n)), k + ' at its limit');
  assert.equal(records.validFamily(tooLong(k, n + 1)), false, k + ' over its limit');
}
assert.equal(records.validFamily({...base, homeZip: 11746}), false, 'numbers are not text');
assert.equal(records.validFamily({...base, wrestlers: [{...base.wrestlers[0], allergies: 'x'.repeat(501)}]}), false);
assert.equal(records.validFamily({...base, wrestlers: [{...base.wrestlers[0], birthDate: ['2012-04-18']}]}), false);
// Cleaning trims, drops empty fields and unknown ones, and never changes grades: Kindergarten stays "K".
const cleaned = records.cleanFamily({...base, homeCity: '  Huntington ', emergencyContactName: '   ', extra: 'x', wrestlers: [{id: 'k1', name: 'Kit', grade: 'K', birthDate: '2020-09-02', allergies: '  Bee stings  '}]});
assert.equal(cleaned.homeCity, 'Huntington'); assert.equal('emergencyContactName' in cleaned, false); assert.equal(cleaned.extra, undefined);
assert.deepEqual(plain(cleaned.wrestlers[0]), {id: 'k1', name: 'Kit', grade: 'K', usawNumber: '', usawExpires: '', birthDate: '2020-09-02', allergies: 'Bee stings'});
console.log('Passed: optional details, older profiles, ZIP, state, phone, birth date and length checks.');

// Through the API: the family saves the details; a bad value is refused with what to fix.
const family = load('app/api/family/route.ts');
const put = async (data, who = 'bob') => {
  const rev = (await (await family.GET(request('/api/family', 'GET', null, who))).json()).revision;
  return family.PUT(request('/api/family', 'PUT', {revision: rev, data}, who));
};
const bob = {parentName: 'Bob Parent', phone: '555-0144', homeAddress: '20 Railroad St', homeCity: 'Huntington Station', homeState: 'ny', homeZip: '11746',
  emergencyContactName: 'Jordan Grandparent', emergencyContactPhone: '(631) 555-0199',
  wrestlers: [{id: 'bob-w1', name: 'Riley Two', grade: '10', birthDate: '2010-12-01', allergies: 'Peanut allergy.\nEpiPen in the blue bag.'}, {id: 'bob-w2', name: 'Kit Two', grade: 'K'}]};
let r = await put({...bob, homeZip: '117'}); assert.equal(r.status, 400); assert.match((await r.json()).error, /ZIP code/);
r = await put({...bob, wrestlers: [{...bob.wrestlers[0], birthDate: '2999-01-01'}]}); assert.equal(r.status, 400); assert.match((await r.json()).error, /future/);
r = await put({...bob, emergencyContactPhone: '12'}); assert.equal(r.status, 400); assert.match((await r.json()).error, /emergency contact/);
assert.equal((await put(bob)).status, 200);
const saved = (await (await family.GET(request('/api/family', 'GET', null, 'bob'))).json()).data;
assert.equal(saved.homeState, 'NY'); assert.equal(saved.emergencyContactPhone, '(631) 555-0199'); assert.equal(saved.wrestlers[0].birthDate, '2010-12-01');
assert.equal(saved.wrestlers[0].allergies, 'Peanut allergy.\nEpiPen in the blue bag.'); assert.equal(saved.wrestlers[1].grade, 'K');
// Clearing a field removes it.
assert.equal((await put({...saved, homeZip: '', wrestlers: [saved.wrestlers[0], {...saved.wrestlers[1]}]})).status, 200);
assert.equal(JSON.parse(sqlite.prepare("SELECT payload FROM family_accounts WHERE user_id='bob-uuid'").get().payload).homeZip, undefined);
assert.equal((await put({...saved})).status, 200);
console.log('Passed: the family saves contact and safety details; bad values are refused with a plain reason.');

// Family accounts: only the owner, with the details folded away, programs per wrestler, and a medical-note marker.
const now = new Date().toISOString(), day = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York'}).format(new Date());
const plus = n => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
  VALUES ('ord-188','bob-uuid','bob@example.test','bob-w1','Riley Two','annual','Intermediate','Intermediate','Membership','[]',240000,0,240000,'usd','{}','{}','paid','k188',0,?,?,?,?,?,'offline')`).run(now, now, now, plus(-10), plus(300));
sqlite.prepare(`INSERT INTO scholarship_awards(id,token_hash,recipient_email,wrestler_name,program,reference_cents,terms_text,terms_ready,status,user_id,wrestler_id,expires_at,created_at,created_by)
  VALUES ('sch-188',?,'bob@example.test','Kit Two','Elementary',0,'Terms',1,'active','bob-uuid','bob-w2',?,?,'owner')`).run('e'.repeat(64), now, now);
// A membership that ended does not count.
sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end,source)
  VALUES ('ord-old','alice-uuid','alice@example.test','athlete-a','Wrestler A','annual','Advanced','Advanced','Membership','[]',240000,0,240000,'usd','{}','{}','paid','kold',0,?,?,?,'2024-01-01','2024-12-31','offline')`).run(now, now, now);
const accounts = load('app/accounts/route.ts');
assert.equal((await accounts.GET(request('/accounts', 'GET', null, 'bob'))).status, 403, 'a family cannot open Family accounts');
assert.equal((await accounts.GET(request('/accounts', 'GET', null, 'alice'))).status, 403);
const html = await (await accounts.GET(request('/accounts', 'GET', null, 'owner'))).text();
const card = html.match(/<article data-search="bob parent[\s\S]*?<\/article>/)[0];
assert.match(card, /data-programs="Intermediate Elementary"/);
assert.match(card, /Riley Two · Grade 10<\/span><span class="pill">SWA Intermediate<\/span><span class="pill alert">Medical note<\/span>/);
assert.match(card, /Kit Two · Kindergarten<\/span><span class="pill">SWA Development<\/span><\/li>/);
assert.match(card, /<details class="family-details"><summary>Contact and safety details<\/summary>/);
assert.doesNotMatch(card, /<details[^>]* open/, 'medical notes are folded away by default');
assert.match(card, /20 Railroad St<br>Huntington Station, NY 11746/);
assert.match(card, /Jordan Grandparent · \(631\) 555-0199/);
assert.match(card, /December 1, 2010 · age \d+/);
assert.match(card, /Peanut allergy.\nEpiPen in the blue bag./);
const alice = html.match(/<article data-search="alice[\s\S]*?<\/article>/)[0];
assert.match(alice, /data-programs="none"/, 'an ended membership is not a current program');
assert.match(alice, /Home address<\/dt><dd><span class="none">Not provided/);
assert.match(html, /<select id="program"><option value="">All programs<\/option><option value="Elementary">SWA Development<\/option><option value="Intermediate">SWA Intermediate<\/option><option value="Advanced">SWA Advance<\/option><option value="none">No current program<\/option><\/select>/);
// Text a family typed is escaped.
assert.equal((await put({...bob, emergencyContactName: '<img src=x onerror=alert(1)>'})).status, 200);
const escaped = await (await accounts.GET(request('/accounts', 'GET', null, 'owner'))).text();
assert.doesNotMatch(escaped, /<img src=x/); assert.match(escaped, /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.equal((await put(bob)).status, 200);
console.log('Passed: owner-only Family accounts shows the details folded away, programs per wrestler and a medical-note marker.');

// The family page: the form says the details are optional and why, saves them, and shows them on the saved profile.
const page = readFileSync('app/family/screen.html', 'utf8');
assert.match(page, /Contact and safety details are optional\.<\/strong> The academy asks for them so we can reach someone quickly/);
assert.match(page, /Only the academy owner sees them/);
assert.match(page, /<legend>Home address <span class="opt">Optional<\/span><\/legend>/);
assert.match(page, /<legend>Emergency contact <span class="opt">Optional<\/span><\/legend>/);
assert.doesNotMatch(page.match(/<fieldset[\s\S]*?<h3>Your wrestlers<\/h3>/)[0], /required/, 'no new field is required');
const script = page.match(/<script>([\s\S]*)<\/script>/)[1];
const nodes = new Map();
const element = id => { if (!nodes.has(id)) nodes.set(id, {hidden: id === 'summary', value: '', textContent: '', innerHTML: '', focus() {}, scrollIntoView() {}, elements: {parentName: {value: '', focus() {}}, phone: {value: ''}}}); return nodes.get(id); };
let stored = {parentName: 'Pat', phone: '555-0100', wrestlers: [{id: 'w1', name: 'Sam', grade: '8'}]}, revision = 1;
const ctx = vm.createContext({document: {getElementById: element}, location: {}, URLSearchParams, crypto: {randomUUID: () => 'new-id'},
  fetch: async (path, o) => { if (o?.method === 'PUT') { stored = JSON.parse(o.body).data; revision++; } return {ok: true, status: 200, json: async () => ({email: 'pat@example.test', data: structuredClone(stored), revision, updatedAt: '2026-11-06T12:00:00Z'})}; }});
vm.runInContext(script, ctx);
await new Promise(r => setImmediate(r));
assert.match(element('savedDetails').innerHTML, /Home address<\/dt><dd><span class="muted">Not added \(optional\)/);
assert.doesNotMatch(element('savedDetails').innerHTML, /kid-safety/, 'nothing extra when there are no safety notes');
vm.runInContext('editProfile()', ctx);
assert.match(element('wrestlers').innerHTML, /Birth date <span class="opt">Optional<\/span><input id="birth0" type="date" min="1900-01-01" max="\d{4}-\d{2}-\d{2}"/);
assert.match(element('wrestlers').innerHTML, /Allergies or medical notes <span class="opt">Optional<\/span><textarea id="allergies0" maxlength="500"/);
element('homeAddress').value = '12 Mill Street'; element('homeCity').value = 'Huntington'; element('homeState').value = 'NY'; element('homeZip').value = '11746';
element('emergencyContactName').value = 'Jordan'; element('emergencyContactPhone').value = '631-555-0199';
element('birth0').value = '2012-04-18'; element('allergies0').value = ' Asthma <inhaler> ';
await element('familyForm').onsubmit({preventDefault() {}});
assert.deepEqual(plain({...stored, wrestlers: undefined}), {parentName: 'Pat', phone: '555-0100', homeAddress: '12 Mill Street', homeCity: 'Huntington', homeState: 'NY', homeZip: '11746', emergencyContactName: 'Jordan', emergencyContactPhone: '631-555-0199'});
assert.equal(stored.wrestlers[0].birthDate, '2012-04-18'); assert.equal(stored.wrestlers[0].allergies, 'Asthma <inhaler>');
assert.equal((await put({...bob, homeState: ' ny '}).then(r => r.json())).data.homeState, 'NY', 'the reply carries the profile as saved');
const summary = element('savedDetails').innerHTML;
assert.match(summary, /12 Mill Street<br>Huntington, NY 11746/);
assert.match(summary, /Jordan · 631-555-0199/);
assert.match(summary, /Born Apr 18, 2012<br><strong>Allergies or medical notes:<\/strong> Asthma &lt;inhaler&gt;/);
// Editing again shows the saved values in the form.
vm.runInContext('editProfile()', ctx);
assert.equal(element('homeZip').value, '11746'); assert.match(element('wrestlers').innerHTML, /value="2012-04-18"/); assert.match(element('wrestlers').innerHTML, />Asthma &lt;inhaler&gt;<\/textarea>/);
console.log('Passed: the family form says the details are optional and why, saves them, and shows them on the saved profile.');
