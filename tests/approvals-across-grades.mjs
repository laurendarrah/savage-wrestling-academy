// Issue #271 (audit E1, UX 3): an SWA Advance request or decision belongs to the wrestler, not to the grade they asked
// in. It survives a grade change within 7–12 (the owner sees "Requested as Grade 9, now Grade 10" and can still decide;
// the family's registration page says the request is still waiting), the owner is told when a waiting request's
// profile changes, and only a name change or leaving grades 7–12 ends it.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {makeDb, loader, call} from './fixtures/d1.mjs';

const {sqlite, DB} = makeDb();
const env = {DB};
const actor = {owner: false, id: 'p1'};
const load = loader(env, actor);
const requests = load('app/api/program-approvals/route.ts'), decisions = load('app/api/owner-approvals/route.ts'), familyApi = load('app/api/family/route.ts');
const rules = load('lib/program-approval.ts');
const today = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o',?)").run(JSON.stringify({programNamingVersion: 2, programs: [{id: 'Advanced', name: 'SWA Advance', priceCents: 20000, walkInPriceCents: 4000}], seasons: []}), today);
const details = {homeAddress: '20 Railroad St', homeCity: 'Huntington Station', homeState: 'NY', homeZip: '11746', emergencyContactName: 'Jordan', emergencyContactPhone: '631-555-0188'};
const kid = (name, grade) => ({id: 'w1', name, grade, usawNumber: 'AB1234', usawExpires: '2099-08-31', birthDate: '2012-04-18', allergies: 'None'});
const profile = (...wrestlers) => ({parentName: 'Pat', phone: '631-555-0100', ...details, wrestlers});
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('p1', 'pat@example.test', JSON.stringify(profile(kid('Sam Example', '9'))), 1, today);
const as = who => { actor.owner = who === 'owner'; actor.id = who === 'owner' ? 'owner-id' : who; };
const save = async (...wrestlers) => { as('p1'); const rev = sqlite.prepare("SELECT revision FROM family_accounts WHERE user_id='p1'").get().revision; const r = await call(familyApi, '/api/family', {method: 'PUT', body: {revision: rev, data: profile(...wrestlers)}}); assert.equal(r.status, 200, JSON.stringify(r.body)); };
const mine = async () => { as('p1'); return (await call(requests, '/api/program-approvals')).body.approvals; };
const owners = async () => { as('owner'); return (await call(decisions, '/api/owner-approvals')).body.requests; };
const decide = async (status) => { as('owner'); const row = sqlite.prepare("SELECT id,updated_at FROM program_approvals WHERE wrestler_id='w1'").get(); return call(decisions, '/api/owner-approvals', {method: 'POST', body: {id: row.id, status, updatedAt: row.updated_at}}); };
const access = async w => rules.checkCompetitionAccess('p1', 'Advanced', w);
const notices = kind => sqlite.prepare('SELECT * FROM notifications WHERE kind=? ORDER BY created_at').all(kind);

// --- The pure rule ---
assert.equal(rules.approvalApplies({wrestler_name: 'Sam Example', grade: '9', status: 'approved'}, {name: 'Sam Example', grade: '10'}), true, 'a grade change within 7–12 keeps it');
assert.equal(rules.approvalApplies({wrestler_name: 'Sam Example', grade: '9', status: 'approved'}, {name: ' sam example ', grade: '12'}), true, 'names compare without case or spaces');
assert.equal(rules.approvalApplies({wrestler_name: 'Sam Example', grade: '9', status: 'approved'}, {name: 'Sam Example', grade: '6'}), false, 'leaving 7–12 ends it');
assert.equal(rules.approvalApplies({wrestler_name: 'Sam Example', grade: '9', status: 'approved'}, {name: 'Alex Example', grade: '9'}), false, 'a renamed entry ends it');
assert.equal(rules.approvalApplies(null, {name: 'Sam Example', grade: '9'}), false);

// --- A waiting request follows the wrestler into the next grade ---
as('p1'); assert.equal((await call(requests, '/api/program-approvals', {method: 'POST', body: {action: 'request', wrestlerId: 'w1'}})).status, 200);
let list = await mine(); assert.equal(list.length, 1); assert.equal(list[0].status, 'pending'); assert.equal(list[0].gradeChanged, false);
await save(kid('Sam Example', '10'));
list = await mine(); assert.equal(list.length, 1, 'still waiting after the grade change'); assert.equal(list[0].status, 'pending');
assert.equal(list[0].grade, '9'); assert.equal(list[0].currentGrade, '10'); assert.equal(list[0].gradeChanged, true);
let own = await owners(); assert.equal(own.length, 1); assert.equal(own[0].applies, 1); assert.equal(own[0].grade, '9'); assert.equal(own[0].current_grade, '10');
// The owner is told, once, with the new grade.
assert.equal(notices('approval_profile_changed').length, 1);
assert.equal(notices('approval_profile_changed')[0].email, 'owner@example.test'); assert.equal(notices('approval_profile_changed')[0].user_id, null);
assert.match(notices('approval_profile_changed')[0].subject, /Sam Example is now Grade 10/); assert.match(notices('approval_profile_changed')[0].body, /Requested as Grade 9, now Grade 10/);
await save(kid('Sam Example', '10'));
assert.equal(notices('approval_profile_changed').length, 1, 'saving again with nothing changed tells nobody');
// Asking again changes nothing while the request still applies.
as('p1'); assert.equal((await call(requests, '/api/program-approvals', {method: 'POST', body: {action: 'request', wrestlerId: 'w1'}})).status, 200);
assert.equal(sqlite.prepare("SELECT grade,status FROM program_approvals WHERE wrestler_id='w1'").get().grade, '9', 'the request keeps the grade it was made in');
// The owner decides it as it stands.
assert.equal((await decide('approved')).status, 200);
assert.equal(await access(kid('Sam Example', '10')), null, 'approved at grade 10');
await save(kid('Sam Example', '11'));
assert.equal(await access(kid('Sam Example', '11')), null, 'the approval follows the wrestler into grade 11');
assert.equal((await mine())[0].status, 'approved');
assert.equal(notices('approval_profile_changed').length, 1, 'an approved request has nothing waiting; no notice');

// --- Leaving grades 7–12 ends it; a decision then waits for the profile ---
await save(kid('Sam Example', '6'));
assert.equal((await mine()).length, 0); assert.match(await access(kid('Sam Example', '6')), /grades 7–12/);
own = await owners(); assert.equal(own[0].applies, 0);
assert.equal((await decide('declined')).status, 409, 'nothing to decide for a wrestler outside 7–12');
await save(kid('Sam Example', '9'));
assert.equal((await mine())[0].status, 'approved', 'back in 7–12, the decision stands');

// --- A renamed entry starts over ---
as('owner'); assert.equal((await decide('declined')).status, 200);
await save(kid('Alex Example', '9'));
assert.equal((await mine()).length, 0, 'another name, no request');
assert.match(await access(kid('Alex Example', '9')), /Contact Justin/);
own = await owners(); assert.equal(own[0].applies, 0); assert.equal(own[0].current_name, 'Alex Example');
assert.equal(notices('approval_profile_changed').length, 1, 'a declined request is not waiting, so no notice');
as('p1'); assert.equal((await call(requests, '/api/program-approvals', {method: 'POST', body: {action: 'request', wrestlerId: 'w1'}})).status, 200);
const fresh = sqlite.prepare("SELECT wrestler_name,grade,status,decided_by FROM program_approvals WHERE wrestler_id='w1'").get();
assert.deepEqual([fresh.wrestler_name, fresh.grade, fresh.status, fresh.decided_by], ['Alex Example', '9', 'pending', null], 'a new pending request under the new name');
await save(kid('Alexander Example', '9'));
assert.equal(notices('approval_profile_changed').length, 2); assert.match(notices('approval_profile_changed')[1].subject, /Alex Example was renamed Alexander Example/);
assert.match(notices('approval_profile_changed')[1].body, /no longer applies/);
console.log('Passed: SWA Advance requests and decisions follow the wrestler through grade changes within 7–12, end on a rename or on leaving 7–12, stay decidable, and the owner hears about profile changes once.');

// --- Pages (inline JavaScript is not typechecked) ---
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
{ // /approvals: a changed grade stays decidable and says both grades; a renamed entry or a wrestler outside 7–12 does not.
  const html = readFileSync('app/approvals/screen.html', 'utf8'), script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const ctx = {esc, nyWhen: () => 'Sat, Nov 7 · 7:03 PM', Number, String};
  vm.runInNewContext(script.slice(script.indexOf('const gradeOf='), script.indexOf('async function load()')) + ';this.requestCard=requestCard', ctx);
  const base = {id: 'a1', status: 'pending', wrestler_name: 'Sam Example', grade: '9', current_name: 'Sam Example', current_grade: '9', parent_name: 'Pat', email: 'pat@example.test', phone: '', created_at: 'x', applies: 1};
  let card = ctx.requestCard(base, 0);
  assert.match(card, /PENDING<\/span><h2>Sam Example · Grade 9<\/h2>/); assert.match(card, /data-status="approved">Approve registration/); assert.doesNotMatch(card, /Requested as/);
  card = ctx.requestCard({...base, current_grade: '10'}, 0);
  assert.match(card, /PENDING · Grade changed<\/span><h2>Sam Example · Grade 10<\/h2><p class="grade-note">Requested as Grade 9, now Grade 10\./);
  assert.match(card, /data-status="approved">Approve registration/); assert.match(card, /data-status="declined">Decline request/);
  card = ctx.requestCard({...base, current_name: 'Alex Example', applies: 0}, 0);
  assert.match(card, /PENDING · Profile changed/); assert.match(card, /name was changed to Alex Example/); assert.doesNotMatch(card, /data-status=/);
  card = ctx.requestCard({...base, current_grade: '6', applies: 0}, 0);
  assert.match(card, /now in Grade 6, outside grades 7–12/); assert.doesNotMatch(card, /data-status=/);
}
{ // /register: the approval box says the request is still waiting after a grade change, and that Justin sees the new grade.
  const html = readFileSync('app/register/screen.html', 'utf8'), script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const ctx = {};
  vm.runInNewContext(script.slice(script.indexOf('function approvalWords('), script.indexOf('function closeChat()')) + ';this.approvalWords=approvalWords', ctx);
  const w = {grade: '10'};
  assert.match(ctx.approvalWords('pending', {gradeChanged: true}, w), /^Approval pending\. Your request is still waiting; Justin sees the new grade \(now Grade 10\) with it, so there is nothing to send again\./);
  assert.match(ctx.approvalWords('pending', {gradeChanged: false}, w), /^Approval pending\. Please message Justin below/);
  assert.match(ctx.approvalWords('approved', {gradeChanged: true}, w), /Approved![\s\S]*stays with the wrestler after the grade change \(now Grade 10\)/);
  assert.match(ctx.approvalWords('not_requested', undefined, w), /need coach approval for SWA Advance/);
  assert.ok(script.includes("$('approvalText').textContent=approvalWords(status,approval,w)"), 'the gate uses it');
}
console.log('Passed: approvals and registration pages explain a request that outlived a grade change.');
