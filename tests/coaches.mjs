// Issue #190: coach invitations and onboarding, coach profiles, the owner as a coach, removing a coach without losing
// history, and weekly repeating lesson openings. Runs the real routes against a database built from every migration,
// with the Supabase stand-in from tests/accounts.mjs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {load, request, sqlite, users, levels} from './accounts.mjs';

const staff = load('app/api/staff/route.ts'), invites = load('app/api/coach-invite/route.ts'), coach = load('app/api/coach/route.ts');
const profiles = load('app/api/coach-profile/route.ts'), lessons = load('app/api/lessons/route.ts'), auth = load('app/api/auth/route.ts');
const settings = load('app/api/lesson-settings/route.ts'), pages = load('lib/protected-page.ts'), pay = load('lib/coach-pay.ts');
const reply = async r => ({status: r.status, body: await r.json(), headers: r.headers});
const post = (route, path, body, who) => route.POST(request(path, 'POST', body, who)).then(reply);
const get = (route, path, who) => route.GET(request(path, 'GET', null, who)).then(reply);
const OWNER = 'savagewrestlingclub@gmail.com', ORIGIN = 'https://register.savagewrestling.example';
const ny = k => new Date(Date.now() + k * 864e5).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const confirmed = '2026-10-15', totp = id => [{id, status: 'verified', factor_type: 'totp'}];
const tokenOf = link => link.split('#invite=')[1];
const row = (sql, ...a) => sqlite.prepare(sql).get(...a);
const count = (sql, ...a) => Object.values(sqlite.prepare(sql).get(...a))[0];

users.lee = {id: 'lee-uuid', email: 'coach.lee@example.test', email_confirmed_at: confirmed, factors: []};
users.leeUnconfirmed = {id: 'lee-unconfirmed', email: 'coach.lee@example.test', factors: []};
users.mallory = {id: 'mallory-uuid', email: 'mallory@example.test', email_confirmed_at: confirmed, factors: []};
users.pat = {id: 'pat-uuid', email: 'pat.coach@example.test', email_confirmed_at: confirmed, factors: []};
users.sam = {id: 'sam-uuid', email: 'sam.coach@example.test', email_confirmed_at: confirmed, factors: []};
users.dana = {id: 'dana-uuid', email: 'dana.coach@example.test', email_confirmed_at: confirmed, factors: totp('dana-f')}; levels.dana = 'aal2';
users.ownerWeak = {...users.owner}; // signed in with a password but no authenticator code this session

// ---------- Invitations ----------
{
  assert.equal((await post(staff, '/api/staff', {action: 'invite', name: 'Coach Lee', email: 'coach.lee@example.test', programs: ['Elementary']}, 'alice')).status, 403, 'only the owner invites');
  assert.equal((await post(staff, '/api/staff', {action: 'invite', name: 'Coach Lee', email: 'coach.lee@example.test', programs: ['Elementary']}, 'ownerWeak')).status, 403, 'owner needs the authenticator');
  assert.equal((await post(staff, '/api/staff', {action: 'invite', name: 'Me', email: OWNER, programs: []}, 'owner')).status, 400, 'owner email cannot be invited');
  assert.equal((await post(staff, '/api/staff', {action: 'invite', name: 'Coach Lee', email: 'coach.lee@example.test', programs: ['Elite']}, 'owner')).status, 400, 'unknown program');
  assert.equal((await post(staff, '/api/staff', {action: 'invite', name: ' ', email: 'coach.lee@example.test', programs: []}, 'owner')).status, 400, 'name required');

  const made = await post(staff, '/api/staff', {action: 'invite', name: 'Coach Lee', email: 'Coach.Lee@Example.test', programs: ['Elementary', 'Elementary']}, 'owner');
  assert.equal(made.status, 200);
  assert.ok(made.body.link.startsWith(ORIGIN + '/coach-join#invite='), 'link uses appOrigin() and keeps the token after #: ' + made.body.link);
  const token = tokenOf(made.body.link);
  assert.match(token, /^[a-f0-9]{64}$/, '256-bit random token');
  assert.equal(made.body.emailStatus, 'off', 'email is off until it is configured; the owner copies the link');
  assert.deepEqual(made.body.invite.programs, ['Elementary']);
  const stored = row('SELECT * FROM coach_invites WHERE id=?', made.body.invite.id);
  assert.equal(stored.email, 'coach.lee@example.test');
  assert.equal(stored.token_hash, createHash('sha256').update(token).digest('hex'), 'only the hash is stored');
  assert.ok(!JSON.stringify(stored).includes(token), 'the token itself is never stored');
  const days = (Date.parse(stored.expires_at) - Date.parse(stored.created_at)) / 864e5;
  assert.equal(days, 7, 'invites expire after 7 days');
  assert.equal(count("SELECT count(*) FROM staff_access WHERE email='coach.lee@example.test'"), 0, 'no access until the invite is accepted');

  // Anyone with the link can see who it is for; nobody can guess a link.
  let r = await post(invites, '/api/coach-invite', {action: 'check', token}, '');
  assert.equal(r.status, 200); assert.equal(r.body.invite.name, 'Coach Lee'); assert.equal(r.body.invite.status, 'open'); assert.equal(r.body.signedIn, null);
  assert.equal(r.body.invite.token_hash, undefined, 'hash not exposed');
  assert.equal((await post(invites, '/api/coach-invite', {action: 'check', token: 'abc'}, '')).status, 404, 'malformed token');
  assert.equal((await post(invites, '/api/coach-invite', {action: 'check', token: 'f'.repeat(64)}, '')).status, 404, 'unknown token');
  assert.equal((await invites.POST(request('/api/coach-invite', 'POST', {action: 'check', token}, '', 'https://evil.test'))).status, 403, 'same origin only');

  // Wrong email: refused, and the invite stays open for the right person.
  r = await post(invites, '/api/coach-invite', {action: 'accept', token}, 'mallory');
  assert.equal(r.status, 403); assert.match(r.body.error, /This invite is for coach\.lee@example\.test/);
  assert.equal(row('SELECT used_at FROM coach_invites WHERE id=?', made.body.invite.id).used_at, null);
  assert.equal(count("SELECT count(*) FROM staff_access WHERE email='mallory@example.test'"), 0);
  r = await post(invites, '/api/coach-invite', {action: 'check', token}, 'mallory');
  assert.equal(r.body.signedIn.matches, false, 'the page tells them they are signed in as someone else');
  // Not signed in, or email not confirmed: refused.
  assert.equal((await post(invites, '/api/coach-invite', {action: 'accept', token}, '')).status, 401);
  assert.equal((await post(invites, '/api/coach-invite', {action: 'accept', token}, 'leeUnconfirmed')).status, 401);

  // The invited coach accepts: access granted with the invite's name and programs, then the authenticator step.
  r = await post(invites, '/api/coach-invite', {action: 'accept', token}, 'lee');
  assert.equal(r.status, 200); assert.equal(r.body.redirect, '/security', 'coaches set up an authenticator first');
  const granted = row("SELECT * FROM staff_access WHERE email='coach.lee@example.test'");
  assert.equal(granted.active, 1); assert.equal(granted.name, 'Coach Lee'); assert.equal(granted.programs, '["Elementary"]');
  const used = row('SELECT used_at,used_by FROM coach_invites WHERE id=?', made.body.invite.id);
  assert.ok(used.used_at); assert.equal(used.used_by, 'lee-uuid');
  assert.equal(count("SELECT count(*) FROM security_events WHERE action='coach_invite_accepted' AND target='coach.lee@example.test'"), 1);
  // Single use.
  r = await post(invites, '/api/coach-invite', {action: 'accept', token}, 'lee');
  assert.equal(r.status, 410); assert.match(r.body.error, /already used/);
  assert.equal((await post(invites, '/api/coach-invite', {action: 'check', token}, '')).body.invite.status, 'used');
  // Coach home still needs the authenticator; after it, Lee lands on coach home.
  assert.equal((await get(coach, '/api/coach', 'lee')).status, 403);
  users.lee.factors = totp('lee-f'); levels.lee = 'aal2';
  r = await get(coach, '/api/coach', 'lee');
  assert.equal(r.status, 200); assert.equal(r.body.name, 'Coach Lee'); assert.deepEqual(r.body.programs, ['Elementary']); assert.equal(r.body.owner, false); assert.equal(r.body.maxWeeks, 12);
  assert.equal((await post(invites, '/api/coach-invite', {action: 'accept', token}, 'lee')).body.redirect, undefined);
  assert.equal((await post(staff, '/api/staff', {action: 'invite', name: 'Coach Lee', email: 'coach.lee@example.test', programs: []}, 'owner')).status, 409, 'already a coach');
  assert.equal((await get(staff, '/api/staff', 'lee')).status, 403, 'coaches cannot manage coaches');

  // Expiry.
  const pat = await post(staff, '/api/staff', {action: 'invite', name: 'Coach Pat', email: 'pat.coach@example.test', programs: ['Advanced']}, 'owner');
  sqlite.prepare("UPDATE coach_invites SET expires_at='2026-01-01T00:00:00.000Z' WHERE id=?").run(pat.body.invite.id);
  r = await post(invites, '/api/coach-invite', {action: 'accept', token: tokenOf(pat.body.link)}, 'pat');
  assert.equal(r.status, 410); assert.match(r.body.error, /expired/);
  assert.equal(count("SELECT count(*) FROM staff_access WHERE email='pat.coach@example.test'"), 0, 'an expired invite grants nothing');
  // The owner sends a new link: the old one stops working, the new one works.
  const renewed = await post(staff, '/api/staff', {action: 'renew', id: pat.body.invite.id}, 'owner');
  assert.equal(renewed.status, 200); assert.notEqual(tokenOf(renewed.body.link), tokenOf(pat.body.link));
  assert.equal((await post(invites, '/api/coach-invite', {action: 'check', token: tokenOf(pat.body.link)}, '')).status, 404);
  assert.equal((await get(staff, '/api/staff', 'owner')).body.invites.find(i => i.id === pat.body.invite.id).status, 'open');
  // Canceling ends it.
  assert.equal((await post(staff, '/api/staff', {action: 'cancel-invite', id: pat.body.invite.id}, 'owner')).status, 200);
  r = await post(invites, '/api/coach-invite', {action: 'accept', token: tokenOf(renewed.body.link)}, 'pat');
  assert.equal(r.status, 410); assert.match(r.body.error, /canceled/);
  // Only the newest invite for an email works.
  const first = await post(staff, '/api/staff', {action: 'invite', name: 'Coach Pat', email: 'pat.coach@example.test', programs: []}, 'owner');
  const second = await post(staff, '/api/staff', {action: 'invite', name: 'Coach Pat', email: 'pat.coach@example.test', programs: ['Intermediate']}, 'owner');
  assert.equal((await post(invites, '/api/coach-invite', {action: 'check', token: tokenOf(first.body.link)}, '')).body.invite.status, 'canceled');
  assert.equal((await post(invites, '/api/coach-invite', {action: 'accept', token: tokenOf(second.body.link)}, 'pat')).status, 200);
  assert.equal(row("SELECT programs FROM staff_access WHERE email='pat.coach@example.test'").programs, '["Intermediate"]');

  // A coach who confirmed their email (or signed in) elsewhere comes back to /coach-join and accepts without the link.
  await post(staff, '/api/staff', {action: 'invite', name: 'Coach Sam', email: 'sam.coach@example.test', programs: ['Intermediate']}, 'owner');
  r = await post(auth, '/api/auth', {action: 'login', email: 'sam.coach@example.test', password: 'valid-password'}, '');
  assert.equal(r.body.redirect, '/coach-join', 'sign-in sends an invited coach back to accept');
  assert.equal((await post(auth, '/api/auth', {action: 'login', email: 'alice@example.test', password: 'valid-password'}, '')).body.redirect, '/family', 'other families unaffected');
  r = await post(invites, '/api/coach-invite', {action: 'check'}, 'sam');
  assert.equal(r.body.invite.name, 'Coach Sam'); assert.equal(r.body.signedIn.matches, true);
  assert.equal((await post(invites, '/api/coach-invite', {action: 'accept'}, 'mallory')).status, 404, 'no invite for this email');
  assert.equal((await post(invites, '/api/coach-invite', {action: 'accept'}, 'sam')).status, 200);
  assert.equal(row("SELECT active FROM staff_access WHERE email='sam.coach@example.test'").active, 1);
  assert.equal((await post(auth, '/api/auth', {action: 'login', email: 'sam.coach@example.test', password: 'valid-password'}, '')).body.redirect, '/security', 'once accepted, the coach sign-in rules apply');
}

// The confirmation link brings an invited coach to /coach-join; everyone else to sign-in as before.
{
  const file = 'app/auth/confirm/route.ts', module = {exports: {}};
  let open = false;
  const ts = (await import('typescript')).default;
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText, {module, exports: module.exports, URL, Response, Headers,
    require: n => n.endsWith('/account-auth') ? {accountClient: () => ({headers: new Headers(), client: {auth: {verifyOtp: async () => ({data: {user: {email: 'sam@x.test'}}, error: null}), exchangeCodeForSession: async () => ({data: {user: {email: 'sam@x.test'}}, error: null})}}})}
      : n.endsWith('/coach-invites') ? {hasOpenInvite: async () => open} : null});
  const go = async q => new URL((await module.exports.GET(new Request('https://academy.test/auth/confirm' + q))).headers.get('location')).pathname + new URL((await module.exports.GET(new Request('https://academy.test/auth/confirm' + q))).headers.get('location')).search;
  assert.equal(await go('?token_hash=x&type=signup'), '/login?confirmed=1');
  open = true;
  assert.equal(await go('?token_hash=x&type=signup'), '/coach-join');
  assert.equal(await go('?code=abc'), '/coach-join');
  assert.equal(await go('?token_hash=x&type=recovery'), '/login?mode=change', 'a password reset still goes to the reset form');
}

// ---------- Profiles ----------
{
  let r = await get(profiles, '/api/coach-profile', 'lee');
  assert.equal(r.status, 200); assert.equal(r.body.profile.displayName, 'Coach Lee'); assert.equal(r.body.profile.saved, false); assert.equal(r.body.profile.photo, null, 'photos come with #192');
  const save = (body, who = 'lee') => post(profiles, '/api/coach-profile', body, who);
  const good = {displayName: 'Lee Tran', bio: 'Ten years coaching folkstyle.\nState qualifier.', specialties: 'Takedowns, mat returns, takedowns', phone: '(631) 555-0199'};
  for (const [bad, why] of [[{...good, displayName: '  '}, 'name required'], [{...good, displayName: 'x'.repeat(61)}, 'name too long'], [{...good, displayName: 'Lee\u0007'}, 'control character'],
    [{...good, bio: 'x'.repeat(501)}, 'bio too long'], [{...good, specialties: 'a,b,c,d,e,f,g'}, 'too many specialties'], [{...good, specialties: ['x'.repeat(41)]}, 'specialty too long'],
    [{...good, specialties: 5}, 'specialties type'], [{...good, phone: 'call me'}, 'phone letters'], [{...good, phone: '12'}, 'phone too short'], [{...good, bio: 7}, 'bio type']])
    assert.equal((await save(bad)).status, 400, why);
  r = await save(good);
  assert.equal(r.status, 200); assert.equal(r.body.profile.displayName, 'Lee Tran'); assert.deepEqual(r.body.profile.specialties, ['Takedowns', 'mat returns'], 'trimmed and de-duplicated');
  assert.equal(r.body.profile.phone, '(631) 555-0199');
  assert.equal((await save({...good, email: 'pat.coach@example.test'})).status, 403, 'a coach edits only their own profile');
  assert.equal((await save(good, 'alice')).status, 403, 'families cannot edit profiles');
  assert.equal((await get(profiles, '/api/coach-profile', 'alice')).status, 403);
  // The owner sees and edits any coach's profile, phone included.
  r = await get(profiles, '/api/coach-profile?email=coach.lee@example.test', 'owner');
  assert.equal(r.status, 200); assert.equal(r.body.byOwner, true); assert.equal(r.body.profile.phone, '(631) 555-0199');
  r = await save({...good, email: 'coach.lee@example.test', bio: 'Ten years coaching folkstyle. Edited by the academy.'}, 'owner');
  assert.equal(r.status, 200);
  assert.equal(row("SELECT bio,updated_by FROM coach_profiles WHERE email='coach.lee@example.test'").updated_by, 'owner-uuid');
  assert.equal((await get(profiles, '/api/coach-profile?email=nobody@example.test', 'owner')).status, 404);
  assert.equal((await save(good, 'ownerWeak')).status, 403, 'owner edits need the authenticator');
  // The owner's list shows profiles.
  const list = (await get(staff, '/api/staff', 'owner')).body.staff;
  const lee = list.find(s => s.email === 'coach.lee@example.test');
  assert.equal(lee.displayName, 'Lee Tran'); assert.equal(lee.phone, '(631) 555-0199'); assert.deepEqual(lee.specialties, ['Takedowns', 'mat returns']);
  // Families see the name, bio and specialties beside the coach's times, never the phone or email.
  assert.equal((await post(coach, '/api/coach', {action: 'add', date: ny(5), start: '16:00', end: '17:00'}, 'lee')).status, 200);
  r = await get(lessons, '/api/lessons', 'alice');
  const o = r.body.openings.find(x => x.date === ny(5));
  assert.equal(o.coach, 'Lee Tran', 'families see the profile name');
  assert.deepEqual(r.body.coaches[o.coachKey], {name: 'Lee Tran', bio: 'Ten years coaching folkstyle. Edited by the academy.', specialties: ['Takedowns', 'mat returns']});
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes('555-0199') && !text.includes('coach.lee@example.test'), 'no coach phone or email for families');
}

// ---------- The owner as a coach ----------
{
  assert.equal((await get(coach, '/api/coach', 'owner')).status, 403, 'not a coach until they add themselves');
  const page = async who => { const r = await pages.coachPage(request('/coach', 'GET', null, who), '<p>coach</p>'); return [r.status, r.headers.get('location')]; };
  assert.deepEqual(await page('owner'), [303, '/staff#self'], 'Coach view asks the owner to add themselves first');
  assert.equal((await post(staff, '/api/staff', {action: 'self', name: 'Justin', programs: ['Advanced']}, 'ownerWeak')).status, 403);
  assert.equal((await post(staff, '/api/staff', {action: 'self', name: 'Justin', programs: ['Elite']}, 'owner')).status, 400);
  assert.equal((await post(staff, '/api/staff', {action: 'self', name: 'Justin', programs: ['Advanced', 'Intermediate']}, 'owner')).status, 200);
  assert.deepEqual(await page('owner'), [200, null]);
  assert.deepEqual(await page('ownerWeak'), [303, '/security'], 'the owner still needs the authenticator for Coach view');
  assert.deepEqual(await page('alice'), [403, null]);
  assert.equal((await get(coach, '/api/coach', 'ownerWeak')).status, 403, 'owner MFA rules unchanged');
  let r = await get(coach, '/api/coach', 'owner');
  assert.equal(r.status, 200); assert.equal(r.body.owner, true); assert.equal(r.body.name, 'Justin'); assert.deepEqual(r.body.programs, ['Advanced', 'Intermediate']);
  // The owner keeps the owner role everywhere else.
  assert.equal((await reply(await auth.GET(request('/api/auth', 'GET', null, 'owner')))).body.user.role, 'owner');
  assert.equal((await get(staff, '/api/staff', 'owner')).status, 200);
  // Post an opening; families can book it; the owner shows in lesson settings for coach pay.
  r = await post(coach, '/api/coach', {action: 'add', date: ny(6), start: '09:00', end: '10:00', format: 'partner'}, 'owner');
  assert.equal(r.status, 200);
  assert.equal(row('SELECT coach_email,user_id,capacity FROM coach_openings WHERE date=? AND start=?', ny(6), '09:00').coach_email, OWNER);
  r = await get(lessons, '/api/lessons', 'alice');
  assert.equal(r.body.openings.find(x => x.date === ny(6)).coach, 'Justin');
  assert.ok((await get(settings, '/api/lesson-settings', 'owner')).body.coaches.some(c => c.email === OWNER), 'the owner can set their own pay share');
  // A coach profile for the owner.
  assert.equal((await post(profiles, '/api/coach-profile', {displayName: 'Coach Justin', bio: 'Founder and head coach.', specialties: [], phone: ''}, 'owner')).status, 200);
  assert.equal((await get(lessons, '/api/lessons', 'alice')).body.openings.find(x => x.date === ny(6)).coach, 'Coach Justin');
  const list = await get(staff, '/api/staff', 'owner');
  assert.equal(list.body.self.active, true); assert.ok(!list.body.staff.some(s => s.email === OWNER), 'the owner is not in the coach list');
  // Owner access cannot be revoked, deleted, invited or overwritten through the coach actions.
  for (const action of ['revoke', 'delete', 'restore', 'grant']) assert.equal((await post(staff, '/api/staff', {action, email: OWNER, name: 'X', programs: [], confirmed: true}, 'owner')).status, 400, action);
  // Stop coaching: Coach view closes and the open time is no longer listed; the owner is still the owner.
  assert.equal((await post(staff, '/api/staff', {action: 'self-stop'}, 'owner')).status, 200);
  assert.equal((await get(coach, '/api/coach', 'owner')).status, 403);
  assert.ok(!(await get(lessons, '/api/lessons', 'alice')).body.openings.some(x => x.date === ny(6)));
  assert.equal((await get(staff, '/api/staff', 'owner')).status, 200);
  assert.equal((await post(staff, '/api/staff', {action: 'self', programs: ['Advanced']}, 'owner')).status, 200);
  assert.equal(row('SELECT name FROM staff_access WHERE email=?', OWNER).name, 'Justin', 'changing programs keeps the name');
}

// ---------- Removing a coach keeps their history ----------
{
  const email = 'coach.lee@example.test', past = ny(-10), soon = ny(4);
  // A past lesson Lee taught and was paid for, an upcoming booked lesson, and an open time nobody booked.
  const opening = (id, date) => sqlite.prepare('INSERT INTO coach_openings(id,user_id,date,start,end,coach_email) VALUES (?,?,?,?,?,?)').run(id, 'lee-uuid', date, '15:00', '16:00', email);
  const order = (id, item, date, status) => sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,source)
    VALUES (?,'alice-uuid','alice@example.test','w-a','Wrestler A','lesson',?,'Lesson',?,6000,0,6000,'usd',?,'{}',?,?,0,?,?,?,'offline')`)
    .run(id, item, JSON.stringify([date]), JSON.stringify({coachEmail: email, coachName: 'Lee Tran', start: '15:00', format: 'one-on-one', formatName: 'One-on-one lesson'}), status, 'k-' + id, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
  opening('lee-past', past); order('ord-past', 'lee-past', past, 'paid');
  opening('lee-booked', soon); order('ord-soon', 'lee-booked', soon, 'paid');
  opening('lee-open', ny(8));
  assert.equal((await post(staff, '/api/staff', {action: 'delete', email, confirmed: true}, 'owner')).status, 409, 'remove access first');
  let r = await get(staff, '/api/staff', 'owner');
  assert.equal(r.body.staff.find(s => s.email === email).upcomingLessons, 1, 'the owner sees the booked lesson still to come');
  // Remove access: no coach tools, no listed times, history untouched.
  assert.equal((await post(staff, '/api/staff', {action: 'revoke', email}, 'owner')).status, 200);
  assert.equal((await get(coach, '/api/coach', 'lee')).status, 403);
  assert.ok(!(await get(lessons, '/api/lessons', 'alice')).body.openings.some(o => o.coach === 'Lee Tran'), 'a removed coach’s times are not offered');
  assert.equal(count("SELECT count(*) FROM coach_openings WHERE user_id='lee-uuid'"), 4);
  assert.equal(row("SELECT active FROM staff_access WHERE email=?", email).active, 0);
  // Permanent removal waits while a booked lesson is still to come, and needs confirmation.
  r = await post(staff, '/api/staff', {action: 'delete', email, confirmed: true}, 'owner');
  assert.equal(r.status, 409); assert.match(r.body.error, /1 booked lesson still to come/);
  sqlite.prepare("UPDATE orders SET status='refunded' WHERE id='ord-soon'").run();
  assert.equal((await post(staff, '/api/staff', {action: 'delete', email}, 'owner')).status, 400, 'confirmation required');
  assert.equal((await post(staff, '/api/staff', {action: 'delete', email, confirmed: true}, 'alice')).status, 403);
  assert.equal((await post(staff, '/api/staff', {action: 'delete', email, confirmed: true}, 'owner')).status, 200);
  assert.equal(count('SELECT count(*) FROM staff_access WHERE email=?', email), 0, 'they leave the coach list');
  assert.equal(count('SELECT count(*) FROM coach_profiles WHERE email=?', email), 0, 'their profile and phone are deleted');
  assert.equal(count("SELECT count(*) FROM coach_openings WHERE id='lee-open'"), 0, 'their unbooked future time is deleted');
  assert.equal(count("SELECT count(*) FROM coach_openings WHERE id IN ('lee-past','lee-booked')"), 2, 'lessons with payments are kept');
  assert.equal(count("SELECT count(*) FROM orders WHERE id IN ('ord-past','ord-soon')"), 2, 'payments are kept');
  assert.equal(count("SELECT count(*) FROM security_events WHERE target=? AND action IN ('coach_invite_accepted','coach_access_revoked','coach_permanently_removed')", email), 3, 'audit history is kept');
  const report = await pay.coachPayReport(ny(-30), ny(0));
  const line = report.coaches.find(c => c.coachEmail === email);
  assert.equal(line.coach, 'Lee Tran', 'the pay report still names the coach'); assert.equal(line.lessons, 1); assert.equal(line.grossCents, 6000);
  assert.equal((await post(staff, '/api/staff', {action: 'delete', email, confirmed: true}, 'owner')).status, 404);
  // Restore brings a removed coach back.
  assert.equal((await post(staff, '/api/staff', {action: 'revoke', email: 'pat.coach@example.test'}, 'owner')).status, 200);
  assert.equal((await post(staff, '/api/staff', {action: 'restore', email: 'pat.coach@example.test'}, 'owner')).status, 200);
  assert.equal(row("SELECT active FROM staff_access WHERE email='pat.coach@example.test'").active, 1);
  assert.equal((await post(staff, '/api/staff', {action: 'restore', email: 'pat.coach@example.test'}, 'owner')).status, 404, 'only removed coaches are restored');
}

// ---------- Weekly repeating openings ----------
{
  await post(staff, '/api/staff', {action: 'grant', email: 'dana.coach@example.test', name: 'Coach Dana', programs: ['Intermediate']}, 'owner');
  const add = body => post(coach, '/api/coach', {action: 'add', start: '18:00', end: '19:00', ...body}, 'dana');
  const start = ny(3), mine = () => sqlite.prepare("SELECT date,format,capacity FROM coach_openings WHERE user_id='dana-uuid' ORDER BY date,start").all();
  for (const weeks of [0, 13, 2.5, 'x', -1]) assert.equal((await add({date: start, weeks})).status, 400, 'weeks ' + weeks);
  let r = await add({date: start, weeks: 4, format: 'small-group', spots: 5});
  assert.equal(r.status, 200); assert.deepEqual(r.body.created, [0, 7, 14, 21].map(n => addDays(start, n))); assert.deepEqual(r.body.skipped, []);
  assert.deepEqual(mine().map(o => [o.format, o.capacity]), Array(4).fill(['small-group', 5]), 'every week has the same format and spots');
  // A week that clashes is skipped, never doubled; every week clashing is an error.
  const later = addDays(start, 35);
  assert.equal((await add({date: addDays(later, 14), start: '18:30', end: '19:30'})).status, 200);
  r = await add({date: later, weeks: 4, format: 'partner'});
  assert.equal(r.status, 200); assert.deepEqual(r.body.skipped, [addDays(later, 14)]); assert.equal(r.body.created.length, 3);
  assert.deepEqual(mine().filter(o => o.date >= later && o.format === 'partner').map(o => o.capacity), [2, 2, 2]);
  r = await add({date: start, weeks: 2, format: 'small-group', spots: 5});
  assert.equal(r.status, 409); assert.match(r.body.error, /Every one of those weeks overlaps/);
  assert.equal((await add({date: start})).status, 409, 'single opening overlap still refused');
  r = await add({date: addDays(start, 70), weeks: '12'});
  assert.equal(r.status, 200); assert.equal(r.body.created.length, 12, 'up to 12 weeks');
  assert.equal(count("SELECT count(*) FROM coach_openings WHERE user_id='dana-uuid'"), 4 + 1 + 3 + 12);
  // Each generated week is bookable on its own by families.
  const listed = (await get(lessons, '/api/lessons', 'alice')).body.openings.filter(o => o.coach === 'Coach Dana');
  assert.equal(listed.length, 20); assert.equal(new Set(listed.map(o => o.id)).size, 20);
  assert.equal(count("SELECT count(*) FROM security_events WHERE action='coach_opening_added' AND target='weekly:12'"), 1);
}

// ---------- Page scripts (inline JavaScript is not typechecked) ----------
function page(file, fetch, hash = '') {
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, innerHTML: '', textContent: '', className: '', dataset: {}, style: {}, focus() {}, select() {}, scrollIntoView() {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => []}); return nodes.get(id); };
  const ctx = vm.createContext({document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null}, location: {hash, search: '', assign() {}, reload() {}}, fetch, confirm: () => true, URLSearchParams, Date, JSON, Promise, Error, Object, Array, Number, String, Set, Map, setTimeout, console, FormData: class { constructor(f) { this.f = f; } }});
  for (const [, code] of readFileSync(file, 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(code, ctx);
  return {el, ctx};
}
const settle = () => new Promise(r => setImmediate(r));
const ok = body => ({ok: true, status: 200, json: async () => body});
{
  // Coach home: the repeat choice goes up to the server's limit; one week sends nothing extra.
  const {el, ctx} = page('app/coach/screen.html', async u => ok(u === '/api/roster' ? {sessions: []} : {name: 'Justin', programs: ['Advanced'], owner: true, profileSaved: false, maxWeeks: 12, openings: []}));
  await settle(); await settle();
  assert.equal(el('heading').textContent, 'Justin'); assert.equal(el('ownerNote').hidden, false, 'the owner sees they are in Coach view'); assert.equal(el('profileNudge').hidden, false);
  assert.equal((el('weeks').innerHTML.match(/<option/g) || []).length, 12); assert.match(el('weeks').innerHTML, /Every week for 12 weeks/);
  ctx.FormData = class { constructor() { this.v = [['date', '2026-12-01'], ['start', '10:00'], ['end', '11:00'], ['format', 'partner'], ['weeks', '6']]; } [Symbol.iterator]() { return this.v[Symbol.iterator](); } };
  vm.runInContext('globalThis.out=openingInput({})', ctx);
  assert.equal(ctx.out.weeks, 6); assert.equal(ctx.out.format, 'partner');
  vm.runInContext("globalThis.msg=savedText({created:['2026-12-01','2026-12-08'],skipped:['2026-12-15']})", ctx);
  assert.match(ctx.msg, /^2 openings saved\. Skipped Tue, Dec 15: it overlaps one of your openings\.$/);
  vm.runInContext("globalThis.msg=savedText({created:['2026-12-01'],skipped:[]})", ctx);
  assert.equal(ctx.msg, 'Opening saved.');
}
{
  // Coach join: a signed-in coach with the matching email sees Accept; someone else sees whose invite it is.
  const tokenHash = '#invite=' + 'a'.repeat(64);
  let signedIn = {email: 'coach.lee@example.test', matches: true}, sent = null;
  const fetch = async (u, o) => { sent = JSON.parse(o.body); return ok({invite: {name: 'Coach Lee', email: 'coach.lee@example.test', programs: ['Elementary'], expiresAt: '2026-12-01T00:00:00Z', status: 'open'}, signedIn}); };
  let p = page('app/coach-join/screen.html', fetch, tokenHash); await settle(); await settle();
  assert.equal(sent.token, 'a'.repeat(64), 'the token from after # is sent in the body');
  assert.equal(p.el('acceptBox').hidden, false); assert.equal(p.el('signupForm').hidden, true); assert.match(p.el('details').innerHTML, /SWA Development/);
  signedIn = {email: 'mallory@example.test', matches: false};
  p = page('app/coach-join/screen.html', fetch, tokenHash); await settle(); await settle();
  assert.equal(p.el('otherBox').hidden, false); assert.equal(p.el('otherFor').textContent, 'coach.lee@example.test');
  signedIn = null;
  p = page('app/coach-join/screen.html', fetch, tokenHash); await settle(); await settle();
  assert.equal(p.el('signupForm').hidden, false); assert.equal(p.el('signupEmail').value, 'coach.lee@example.test');
}
{
  // The owner navigation (the shell's sidebar, issue #261; folded in #283): Coaches & lessons opens /staff, and its
  // switch carries Coach view; Coach view also sits in the folded Settings & records group, leaving the shell.
  const navSource = readFileSync('lib/owner-nav.ts', 'utf8');
  assert.match(navSource, /\{href: '\/staff', label: 'Coaches & lessons', also: \['\/coach-openings', '\/coach-profile', '\/lesson-settings', '\/timesheets'\], tabs: COACH_TABS\}/);
  assert.match(navSource, /const COACH_TABS[^\n]*\{href: '\/staff', label: 'Coaches'\}[^\n]*\{href: '\/coach', label: 'Coach view'\}/);
  assert.match(navSource, /\{href: '\/coach', label: 'Coach view', leaves: true\}/);
}
console.log('Passed: coach invites (owner only, 256-bit single-use tokens stored hashed, 7-day expiry, wrong email refused, renew and cancel, access granted on accept, authenticator before coach home, sign-in and confirmation return to the invite), profiles (validation, own only, owner edits, families see name and bio but no phone or email), the owner as a coach (Coach view, openings, pay settings, owner checks unchanged), removal keeps lessons, payments, pay report and audit history, and weekly repeating openings (same format and spots, clashes skipped, 12-week cap).');
