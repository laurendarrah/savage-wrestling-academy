// Issue #392: an invited coach who signed up but landed on the family side becomes a coach without anyone being told
// anything. Signing in, the confirmation link, the family home and the invite page add coach access for the confirmed,
// invited email; the owner can also give it on Coaches; a one-time step at deploy does it for coaches already waiting.
// Their empty family account goes, so they show under Coaches and not under Families.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeDb, loader, call} from './fixtures/d1.mjs';

const {sqlite, DB} = makeDb(), env = {DB}, actor = {owner: true, id: 'owner-id'};
const load = loader(env, actor);
const inv = load('lib/coach-invites.ts'), staff = load('app/api/staff/route.ts');
const row = (sql, ...a) => sqlite.prepare(sql).get(...a), count = (sql, ...a) => row(sql, ...a).n;
const future = new Date(Date.now() + 5 * 864e5).toISOString(), past = new Date(Date.now() - 864e5).toISOString(), now = new Date().toISOString();
const invite = (id, email, extra = {}) => sqlite.prepare('INSERT INTO coach_invites VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, 'hash-' + id, email, extra.name ?? 'Coach Ryan', '["Intermediate"]', 'owner-id', extra.created ?? now, extra.expires ?? future, extra.used ?? null, null, extra.revoked ?? null);
const family = (uid, email, wrestlers = []) => sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run(uid, email, JSON.stringify({parentName: 'Ryan Example', phone: '631-555-0142', wrestlers}), 1, now);
const user = (id, email) => ({id, email, email_confirmed_at: '2026-11-20T12:00:00Z'});

// ---------- At sign-in, the confirmation link, the family home: acceptOpenInvite ----------
invite('i1', 'ryan.coach@example.test'); family('u-ryan', 'ryan.coach@example.test');
assert.equal(await inv.acceptOpenInvite(null), false);
assert.equal(await inv.acceptOpenInvite({...user('u-ryan', 'ryan.coach@example.test'), email_confirmed_at: null}), false, 'never for an email that is not confirmed');
assert.equal(await inv.acceptOpenInvite(user('u-x', 'someone.else@example.test')), false, 'never for another email');
assert.equal(await inv.acceptOpenInvite(user('u-ryan', 'Ryan.Coach@example.test')), true, 'the invited email, any case');
assert.deepEqual({...row("SELECT name,active FROM staff_access WHERE email='ryan.coach@example.test'")}, {name: 'Coach Ryan', active: 1}, 'he is a coach');
assert.equal(row("SELECT used_by FROM coach_invites WHERE id='i1'").used_by, 'u-ryan');
assert.equal(count("SELECT count(*) n FROM family_accounts WHERE user_id='u-ryan'"), 0, 'his empty family account is gone, so he is not under Families');
assert.equal(await inv.acceptOpenInvite(user('u-ryan', 'ryan.coach@example.test')), false, 'nothing more to do the second time');
assert.equal(await inv.coachWithoutFamily(user('u-ryan', 'ryan.coach@example.test')), true, 'opening the family home sends him to coach home');
// A coach who is also a parent keeps their family account.
invite('i2', 'parent.coach@example.test'); family('u-pc', 'parent.coach@example.test', [{id: 'w1', name: 'Sam Example', grade: '8'}]);
assert.equal(await inv.acceptOpenInvite(user('u-pc', 'parent.coach@example.test')), true);
assert.equal(count("SELECT count(*) n FROM family_accounts WHERE user_id='u-pc'"), 1, 'a family account with a wrestler stays');
assert.equal(await inv.coachWithoutFamily(user('u-pc', 'parent.coach@example.test')), false, 'and the family home still opens for them');
// The owner's email never takes a coach invite.
invite('i3', 'owner@example.test'); assert.equal(await inv.acceptOpenInvite(user('owner-id', 'owner@example.test')), false);   // the owner email in this test's stand-in
// An expired or canceled invite is not accepted.
invite('i4', 'late.coach@example.test', {expires: past}); assert.equal(await inv.acceptOpenInvite(user('u-late', 'late.coach@example.test')), false);
invite('i5', 'gone.coach@example.test', {revoked: now}); assert.equal(await inv.acceptOpenInvite(user('u-gone', 'gone.coach@example.test')), false);

// ---------- The owner gives access now, on Coaches ----------
invite('i6', 'lee.coach@example.test', {name: 'Coach Lee'}); family('u-lee', 'lee.coach@example.test');
as('owner');
function as(who) { actor.owner = who === 'owner'; actor.id = who === 'owner' ? 'owner-id' : who; }
let list = (await call(staff, '/api/staff')).body.invites;
assert.equal(list.find(i => i.id === 'i6').signedUp, true, 'Coaches shows that he already signed up');
as('u-lee'); assert.equal((await call(staff, '/api/staff', {method: 'POST', body: {action: 'grant-invite', id: 'i6'}})).status, 403, 'owner only'); as('owner');
let r = await call(staff, '/api/staff', {method: 'POST', body: {action: 'grant-invite', id: 'i6'}});
assert.deepEqual([r.status, r.body.ok, r.body.name], [200, true, 'Coach Lee']);
assert.equal(row("SELECT active FROM staff_access WHERE email='lee.coach@example.test'").active, 1);
assert.equal(row("SELECT used_by FROM coach_invites WHERE id='i6'").used_by, 'owner:owner-id');
assert.equal(count("SELECT count(*) n FROM family_accounts WHERE user_id='u-lee'"), 0, 'his empty family account is gone too');
assert.equal(count("SELECT count(*) n FROM security_events WHERE action='coach_access_granted' AND target='lee.coach@example.test'"), 1);
assert.equal((await call(staff, '/api/staff', {method: 'POST', body: {action: 'grant-invite', id: 'i6'}})).status, 410, 'once');
assert.equal((await call(staff, '/api/staff', {method: 'POST', body: {action: 'grant-invite', id: 'i5'}})).status, 410, 'not a canceled invite');
assert.equal((await call(staff, '/api/staff', {method: 'POST', body: {action: 'grant-invite', id: 'nope'}})).status, 404);
// The Coaches page offers it on every waiting invite, and says when the person already signed up.
{
  const page = readFileSync('app/staff/screen.html', 'utf8');
  assert.match(page, /<button type="button" data-grant>Give coach access now<\/button><button type="button" data-renew>New link<\/button>/);
  assert.match(page, /\$\{i\.signedUp\?`<p class="warn">\$\{esc\(i\.name\)\} has already signed up with \$\{esc\(i\.email\)\}, so they show under Families\. Give coach access now and they open coach home the next time they visit\.<\/p>`:''\}/);
}

// ---------- The one-time step at deploy, for coaches already waiting ----------
{
  const db = makeDb().sqlite, step = readFileSync('drizzle/0051_accept_waiting_coach_invites.sql', 'utf8');
  const put = (sql, ...a) => db.prepare(sql).run(...a);
  const inviteIn = (id, email, extra = {}) => put('INSERT INTO coach_invites VALUES (?,?,?,?,?,?,?,?,?,?,?)', id, 'h-' + id, email, extra.name ?? 'Coach ' + id, '["Intermediate"]', 'owner-id', extra.created ?? now, extra.expires ?? future, null, null, extra.revoked ?? null);
  const famIn = (uid, email, wrestlers = []) => put('INSERT INTO family_accounts VALUES (?,?,?,?,?)', uid, email, JSON.stringify({parentName: 'P', wrestlers}), 1, now);
  inviteIn('old', 'ryan.coach@example.test', {created: '2026-11-19T10:00:00.000Z', name: 'Old name'}); inviteIn('new', 'ryan.coach@example.test', {created: '2026-11-20T10:00:00.000Z', name: 'Coach Ryan'});
  famIn('u-ryan', 'Ryan.Coach@example.test');                                  // signed up, landed on the family side
  inviteIn('w', 'waiting.coach@example.test');                                  // invited, never signed up: left alone
  inviteIn('x', 'expired.coach@example.test', {expires: past}); famIn('u-x', 'expired.coach@example.test');
  inviteIn('c', 'canceled.coach@example.test', {revoked: now}); famIn('u-c', 'canceled.coach@example.test');
  inviteIn('p', 'parent.coach@example.test'); famIn('u-p', 'parent.coach@example.test', [{id: 'w1', name: 'Kid'}]);
  inviteIn('o', 'savagewrestlingclub@gmail.com'); famIn('u-o', 'savagewrestlingclub@gmail.com');
  famIn('u-fam', 'plain.family@example.test');
  for (const s of step.split('--> statement-breakpoint')) db.exec(s);
  const coaches = db.prepare('SELECT email,name,active FROM staff_access ORDER BY email').all().map(x => ({...x}));
  assert.deepEqual(coaches, [{email: 'parent.coach@example.test', name: 'Coach p', active: 1}, {email: 'ryan.coach@example.test', name: 'Coach Ryan', active: 1}], 'only confirmed, invited, open, not the owner; the newest invite’s name');
  assert.deepEqual(db.prepare('SELECT user_id FROM family_accounts ORDER BY user_id').all().map(x => x.user_id), ['u-c', 'u-fam', 'u-o', 'u-p', 'u-x'], 'Ryan’s empty family account is gone; a parent-coach, others and plain families stay');
  assert.deepEqual(db.prepare("SELECT id FROM coach_invites WHERE used_by='migration:0051' ORDER BY id").all().map(x => x.id), ['new', 'old', 'p'], 'their open invites are used');
  assert.equal(db.prepare("SELECT used_at FROM coach_invites WHERE id='w'").get().used_at, null, 'a coach who never signed up still has their link');
  assert.deepEqual(db.prepare("SELECT target FROM security_events WHERE actor='migration:0051' ORDER BY target").all().map(x => x.target), ['parent.coach@example.test', 'ryan.coach@example.test'], 'one line each');
  for (const s of step.split('--> statement-breakpoint')) db.exec(s);
  assert.equal(db.prepare("SELECT count(*) n FROM security_events WHERE actor='migration:0051'").get().n, 2, 'running it again changes nothing');
}

// ---------- Where it is wired in ----------
assert.match(readFileSync('app/api/auth/route.ts', 'utf8'), /return reply\(\{redirect:await acceptOpenInvite\(data\.user\)\.catch\(\(\)=>false\)\?'\/coach':'\/coach-join'\}\)/, 'sign-in');
assert.match(readFileSync('app/auth/confirm/route.ts', 'utf8'), /const accepted=coach&&await acceptOpenInvite\(user\)\.catch\(\(\)=>false\);/, 'the confirmation link');
assert.match(readFileSync('app/family/route.ts', 'utf8'), /if\(await acceptOpenInvite\(auth\.user\)\.catch\(\(\)=>false\)\|\|await coachWithoutFamily\(auth\.user\)\.catch\(\(\)=>false\)\)\{auth\.headers\.set\('Location','\/coach'\)/, 'the family home');
console.log('Passed: an invited coach with a confirmed email gets coach access at sign-in, the confirmation link, the family home or the invite page, or from the owner on Coaches, and a one-time step does it for those already waiting; their empty family account goes, a parent-coach keeps theirs; expired, canceled and the owner’s email never count.');
