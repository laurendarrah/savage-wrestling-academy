// Issue #388 (the owner's site change request of Nov 20): on SWA Advanced approvals and Scholarships the owner can
// delete a request or a scholarship for good, after clicking Delete and typing DELETE. The server checks the word too.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {makeDb, loader, call} from './fixtures/d1.mjs';

const {sqlite, DB} = makeDb(), env = {DB}, actor = {owner: true, id: 'owner-id'};
const load = loader(env, actor);
const approvals = load('app/api/owner-approvals/route.ts'), scholarships = load('app/api/scholarships/route.ts'), word = load('lib/delete-confirm.ts'), log = load('lib/security-log.ts');
const count = (sql, ...a) => sqlite.prepare(sql).get(...a).n, now = '2026-11-20T15:00:00.000Z';
const as = who => { actor.owner = who === 'owner'; actor.id = who === 'owner' ? 'owner-id' : who; };

// ---------- The typed word ----------
for (const ok of ['DELETE', 'delete', ' Delete ', 'DeLeTe']) assert.equal(word.confirmsDelete(ok), true, ok);
for (const no of ['', 'DELET', 'delete it', 'yes', null, undefined, 1, ['DELETE'], 'DELETE'.padEnd(25, ' ')]) assert.equal(word.confirmsDelete(no), false, JSON.stringify(no));

// ---------- SWA Advanced approvals ----------
const family = (uid, email, wid, name) => sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(uid, email, JSON.stringify({parentName: 'Pat', phone: '631-555-0100', wrestlers: [{id: wid, name, grade: '9'}]}), 1, now);
family('p1', 'pat@example.test', 'w1', 'Sam Example'); family('p2', 'riley@example.test', 'w2', 'Riley Two');
const request = (id, uid, wid, name, status) => sqlite.prepare("INSERT INTO program_approvals VALUES (?,?,?,'Advanced',?,'9',?,?,?,?)").run(id, uid, wid, name, status, now, now, status === 'pending' ? null : 'owner-id');
request('a-test', 'p1', 'w1', 'Sam Example', 'approved'); request('a-keep', 'p2', 'w2', 'Riley Two', 'pending');
const message = (id, approval) => sqlite.prepare("INSERT INTO approval_messages VALUES (?,?,'p1','parent','Hello',?)").run(id, approval, now);
message('m1', 'a-test'); message('m2', 'a-test'); message('m3', 'a-keep');
const notice = (id, key) => sqlite.prepare("INSERT INTO notifications(id,user_id,email,kind,subject,body,dedupe_key,created_at,read_at,email_status) VALUES (?,'p1','pat@example.test','approval_approved','S','B',?,?,NULL,'sent')").run(id, key, now);
notice('n1', `approval:a-test:approved:${now}`); notice('n2', 'approval-changed:a-test:Sam Example:10'); notice('n3', `approval:a-keep:declined:${now}`); notice('n4', 'approval:a-test-other:approved:x');
const del = (body, who = 'owner') => { as(who); return call(approvals, '/api/owner-approvals', {method: 'POST', body: {action: 'delete', ...body}}); };

for (const who of ['p1', 'coach-1']) assert.equal((await del({id: 'a-test', confirm: 'DELETE'}, who)).status, 403, 'owner only: ' + who);
let r = await del({id: 'a-test'}); assert.deepEqual([r.status, r.body.error], [400, 'Type DELETE to confirm, then try again.'], 'no word, no delete');
r = await del({id: 'a-test', confirm: 'yes'}); assert.equal(r.status, 400);
r = await del({id: 'nope', confirm: 'DELETE'}); assert.deepEqual([r.status, r.body.error], [404, 'This request is already gone. Refresh the requests.']);
assert.equal((await del({id: {x: 1}, confirm: 'DELETE'})).status, 400);
assert.equal(count("SELECT count(*) n FROM program_approvals"), 2, 'nothing deleted yet');
r = await del({id: 'a-test', confirm: 'delete'});
assert.deepEqual([r.status, r.body.ok, r.body.messages, r.body.notices], [200, true, 2, 2]);
assert.equal(count("SELECT count(*) n FROM program_approvals WHERE id='a-test'"), 0, 'the request is gone');
assert.equal(count("SELECT count(*) n FROM approval_messages WHERE approval_id='a-test'"), 0, 'and its private conversation');
assert.deepEqual(sqlite.prepare('SELECT id FROM notifications ORDER BY id').all().map(x => x.id), ['n3', 'n4'], 'and the notices about it, only those');
assert.equal(count("SELECT count(*) n FROM program_approvals WHERE id='a-keep'"), 1, 'other requests stay'); assert.equal(count("SELECT count(*) n FROM approval_messages WHERE approval_id='a-keep'"), 1);
assert.equal((await del({id: 'a-test', confirm: 'DELETE'})).status, 404, 'a second delete finds nothing');
// The approval went with it: the family's wrestler is no longer approved and can ask again.
assert.equal(count("SELECT count(*) n FROM program_approvals WHERE user_id='p1' AND wrestler_id='w1'"), 0);
as('owner'); assert.deepEqual((await call(approvals, '/api/owner-approvals')).body.requests.map(x => x.id), ['a-keep'], 'the owner’s list no longer shows it');
// Deciding still works as before.
assert.equal((await call(approvals, '/api/owner-approvals', {method: 'POST', body: {id: 'a-keep', status: 'approved', updatedAt: now}})).status, 200);
const line = sqlite.prepare("SELECT actor,target FROM security_events WHERE action='program_approval_deleted'").get();
assert.deepEqual({...line}, {actor: 'owner-id', target: 'Sam Example · approved'}, 'the security log keeps a line saying what it was');

// ---------- Scholarships ----------
const award = (id, status, extra = {}) => sqlite.prepare(`INSERT INTO scholarship_awards(id,token_hash,recipient_email,wrestler_name,program,reference_cents,terms_text,terms_ready,revision,status,user_id,wrestler_id,signer,accepted_at,signature_record,ended_at,expires_at,created_at,created_by)
  VALUES (?,?,'pat@example.test',?,'Intermediate',20000,'Terms',1,?,?,?,?,?,?,?,?,'2026-12-20T00:00:00.000Z',?,'owner-id')`)
  .run(id, 'hash-' + id, extra.name ?? 'Sam Example', extra.revision ?? 1, status, extra.user ?? null, extra.wrestler ?? null, extra.signer ?? null, extra.accepted ?? null, extra.signature ?? null, extra.ended ?? null, now);
award('s-offered', 'offered'); award('s-revoked', 'revoked', {ended: now});
award('s-active', 'active', {user: 'p1', wrestler: 'w1', signer: 'Pat', accepted: now, signature: '{"method":"typed"}'});
award('s-ended', 'ended', {name: 'Riley Two', user: 'p2', wrestler: 'w2', signer: 'Riley', accepted: now, signature: '{"method":"typed"}', ended: now, revision: 3});
const sdel = (id, extra = {}, who = 'owner') => { as(who); return call(scholarships, '/api/scholarships', {method: 'POST', body: {action: 'delete', id, revision: sqlite.prepare('SELECT revision FROM scholarship_awards WHERE id=?').get(id)?.revision ?? 1, ...extra}}); };
assert.equal((await sdel('s-offered', {confirm: 'DELETE'}, 'p1')).status, 403, 'owner only');
r = await sdel('s-offered'); assert.deepEqual([r.status, r.body.error], [400, 'Type DELETE to confirm, then try again.']);
r = await sdel('s-active', {confirm: 'DELETE'}); assert.deepEqual([r.status, r.body.error], [409, 'End this scholarship first (End future scholarship assistance), then delete it.'], 'an active scholarship is ended first');
assert.equal(count("SELECT count(*) n FROM scholarship_awards WHERE id='s-active'"), 1);
r = await sdel('s-ended', {confirm: 'DELETE', revision: 2}); assert.equal(r.status, 409, 'a stale page deletes nothing');
for (const id of ['s-offered', 's-revoked', 's-ended']) { r = await sdel(id, {confirm: 'delete'}); assert.deepEqual([r.status, r.body.ok, r.body.deleted], [200, true, id], id); }
assert.deepEqual(sqlite.prepare('SELECT id FROM scholarship_awards').all().map(x => x.id), ['s-active'], 'only the active scholarship is left');
r = await sdel('s-offered', {confirm: 'DELETE'}); assert.equal(r.status, 404, 'a second delete finds nothing');
assert.deepEqual(sqlite.prepare("SELECT target FROM security_events WHERE action='scholarship_deleted' ORDER BY rowid").all().map(x => x.target),
  ['Sam Example · Intermediate · offered', 'Sam Example · Intermediate · revoked', 'Riley Two · Intermediate · ended · signed']);

// ---------- The security log says what each was ----------
{
  const names = {people: {}, you: [], approvals: {}, waitlist: {}, orders: {}, waivers: {}, wrestlers: {}, requests: {}, curricula: {}, coaches: {}, scholarships: {}};
  const said = (action, target) => { const e = log.describeSecurityEvent({actor: 'owner-id', action, target, created_at: now}, names, new Date(now)); return [e.title, e.detail]; };
  assert.deepEqual(said('program_approval_deleted', 'Sam Example · approved'), ['SWA Advanced request deleted', 'Sam Example · approved']);
  assert.deepEqual(said('scholarship_deleted', 'Riley Two · Intermediate · ended · signed'), ['Scholarship deleted', 'Riley Two · SWA Intermediate · ended · signed']);
}

// ---------- The box that asks for DELETE (public/delete-confirm.js) ----------
{
  // A box whose parts are found by their class, as the script queries them after writing its markup.
  const part = () => ({textContent: '', value: '', disabled: false, focused: 0, focus() { this.focused++; }});
  const box = {hidden: true, innerHTML: '', parts: {}, querySelector(sel) { return this.parts[sel] ??= part(); }};
  const win = {}; vm.runInNewContext(readFileSync('public/delete-confirm.js', 'utf8'), {window: win, String});
  const D = win.SwaDelete; let ran = [], fail = null;
  D.open(box, {warning: 'This deletes <b>Sam</b>’s request for good.', label: 'Delete request for good', run: async typed => { ran.push(typed); if (fail) throw Error(fail); }});
  const p = s => box.parts[s];
  assert.equal(box.hidden, false); assert.match(box.innerHTML, /Type DELETE to confirm<input class="del-input"/); assert.match(box.innerHTML, /class="danger del-go" disabled>Delete for good<\/button>/);
  assert.equal(p('.del-warn').textContent, 'This deletes <b>Sam</b>’s request for good.', 'the warning is set as text, never as markup');
  assert.equal(p('.del-go').textContent, 'Delete request for good'); assert.equal(p('.del-input').focused, 1, 'the cursor goes to the box');
  assert.equal(p('.del-go').disabled, true, 'the button waits for the word');
  for (const [typed, off] of [['DEL', true], ['delete', false], ['DELETE ', false], ['deleted', true]]) { p('.del-input').value = typed; p('.del-input').oninput(); assert.equal(p('.del-go').disabled, off, typed); }
  p('.del-input').value = 'nope'; await p('.del-go').onclick(); assert.deepEqual(ran, [], 'a click without the word does nothing');
  p('.del-input').value = 'Delete'; p('.del-input').oninput();
  fail = 'This request is already gone. Refresh the requests.'; await p('.del-go').onclick();
  assert.deepEqual(ran, ['Delete']); assert.equal(p('.del-note').textContent, fail, 'the server’s refusal is shown'); assert.deepEqual([p('.del-go').disabled, p('.del-input').disabled], [false, false], 'and the owner can try again');
  fail = null; await p('.del-go').onclick(); assert.deepEqual(ran, ['Delete', 'Delete']);
  let prevented = 0; p('.del-input').onkeydown({key: 'Enter', preventDefault() { prevented++; }}); assert.equal(prevented, 1);
  p('.del-cancel').onclick(); assert.deepEqual([box.hidden, box.innerHTML], [true, ''], 'Cancel closes it');
  D.open(box, {warning: 'x', run: async () => {}}); p('.del-input').onkeydown({key: 'Escape'}); assert.equal(box.hidden, true, 'Escape closes it');
}

// ---------- The two pages ----------
{
  const page = readFileSync('app/approvals/screen.html', 'utf8'), sch = readFileSync('app/scholarships/screen.html', 'utf8');
  for (const html of [page, sch]) assert.ok(html.indexOf('<script src="/delete-confirm.js"></script>') > -1 && html.indexOf('<script src="/delete-confirm.js"></script>') < html.lastIndexOf('<script>'), 'loads the box before the page script');
  // Approvals: every request card has Delete and its own box; the warning says what deleting an approval does.
  const script = page.slice(page.lastIndexOf('<script>') + 8, page.lastIndexOf('</script>'));
  const ctx = vm.createContext({document: {getElementById: () => ({}), querySelectorAll: () => []}, fetch: async () => ({ok: true, json: async () => ({requests: []})}), confirm: () => true, Date, String, Number, JSON, Promise, Error});
  vm.runInContext(script, ctx);
  const card = vm.runInContext(`requestCard(${JSON.stringify({id: 'a1', wrestler_name: 'Sam <Example>', grade: '9', current_grade: '9', current_name: 'Sam <Example>', applies: 1, status: 'approved', parent_name: 'Pat', email: 'pat@example.test', phone: '', created_at: now})},4)`, ctx);
  assert.match(card, /<button class="quiet" data-del="4">Delete<\/button><\/div><div class="del-box" id="del-4" hidden><\/div><\/article>$/);
  assert.equal(vm.runInContext(`deleteWarning({wrestler_name:'Sam Example',status:'approved'})`, ctx), 'Sam Example is approved for SWA Advanced. Deleting the request takes that approval away, so the family can’t register Sam Example for SWA Advanced unless they ask again. This deletes Sam Example’s request and its private conversation for good. The family is not told.');
  assert.equal(vm.runInContext(`deleteWarning({wrestler_name:'Riley Two',status:'pending'})`, ctx), 'This deletes Riley Two’s request and its private conversation for good. The family is not told.');
  // Scholarships: Delete on anything but an active scholarship; the signed agreement is mentioned.
  assert.match(sch, /\$\{a\.status==='active'\?'':`<div class="row actions"><button class="quiet" data-del="\$\{esc\(a\.id\)\}">Delete<\/button><\/div><div class="del-box" id="del-\$\{esc\(a\.id\)\}" hidden><\/div>`\}/);
  const s = sch.slice(sch.lastIndexOf('<script>') + 8, sch.lastIndexOf('</script>'));
  const sctx = vm.createContext({document: {getElementById: () => ({}), querySelectorAll: () => []}, fetch: async () => new Promise(() => {}), Date, String, Number, JSON, Promise, Error, Intl, FormData: class {}});
  vm.runInContext(s, sctx);
  assert.equal(vm.runInContext(`deleteWarning({wrestler_name:'Sam',status:'offered'})`, sctx), 'This deletes the scholarship offer for Sam for good. Its invitation link stops working.');
  assert.equal(vm.runInContext(`deleteWarning({wrestler_name:'Sam',status:'revoked'})`, sctx), 'This deletes the withdrawn offer for Sam for good.');
  assert.equal(vm.runInContext(`deleteWarning({wrestler_name:'Riley',status:'ended',accepted_at:'x'})`, sctx), 'This deletes Riley’s scholarship and the agreement the family signed, for good. Download the signed agreement first if you need to keep it.');
  assert.equal(vm.runInContext(`deleteWarning({wrestler_name:'Riley',status:'ended'})`, sctx), 'This deletes the scholarship for Riley for good.');
}
console.log('Passed: on SWA Advanced approvals and Scholarships the owner deletes a request or scholarship for good only after typing DELETE, checked on the server; a request goes with its conversation and notices, an active scholarship must be ended first, and the security log keeps a line saying what each was.');
