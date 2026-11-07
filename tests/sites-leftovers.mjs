// Issue #239, the last pieces of Justin's Sites versions (docs/SITES_V131_TRIAGE.md entries 05 and 27):
// 1. The owner manages any coach's lesson openings with the same rules as coach home (lib/lessons.ts).
// 2. Families get a month view of open lesson times on /lesson.
// 3. The owner asks one family (or one coach) to sign a document again; the old signature is kept, marked replaced.
// Runs the real routes against a database built from every migration, with the Supabase stand-in from tests/accounts.mjs.
// The page scripts run in a small fake DOM (inline JavaScript is not typechecked). All names and text are test data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {load, request, sqlite, users, levels} from './accounts.mjs';

const openingsApi = load('app/api/coach-openings/route.ts'), coachApi = load('app/api/coach/route.ts'), lessonsApi = load('app/api/lessons/route.ts');
const familyDocs = load('app/api/waiver/route.ts'), ownerDocs = load('app/api/waivers/route.ts'), contractApi = load('app/api/contract/route.ts');
const quotes = load('lib/quotes.ts'), docs = load('lib/documents.ts'), waivers = load('lib/waivers.ts'), log = load('lib/security-log.ts'), holidays = load('lib/holidays.ts');
const reply = async r => ({status: r.status, body: await r.json()});
const post = (route, path, body, who) => route.POST(request(path, 'POST', body, who)).then(reply);
const get = (route, path, who) => route.GET(request(path, 'GET', null, who)).then(reply);
const plain = v => JSON.parse(JSON.stringify(v));
const OWNER = 'savagewrestlingclub@gmail.com', CORA = 'cora.coach@example.test', DREW = 'drew.coach@example.test', now = new Date().toISOString();
const ny = k => new Date(Date.now() + k * 864e5).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const totp = id => [{id, status: 'verified', factor_type: 'totp'}];
const strokes = [[[0.1, 0.5], [0.3, 0.4], [0.5, 0.6]]];
const TEXT = 'Test text for the automated check only. It is not a real document and is never shown to families. '.repeat(3);

// Two coaches (Cora has never signed in; Drew has), a removed coach, and a family with one carded wrestler.
users.cora = {id: 'cora-uuid', email: CORA, email_confirmed_at: '2026-10-15', factors: totp('cora-f')}; levels.cora = 'aal2';
users.drew = {id: 'drew-uuid', email: DREW, email_confirmed_at: '2026-10-15', factors: totp('drew-f')}; levels.drew = 'aal2';
users.kim = {id: 'kim-uuid', email: 'kim@example.test', email_confirmed_at: '2026-10-15', factors: []};
for (const [email, name, active] of [[CORA, 'Cora Coach', 1], [DREW, 'Drew Coach', 1], ['gone@example.test', 'Gone Coach', 0]])
  sqlite.prepare('INSERT INTO staff_access(email,name,programs,active,updated_at) VALUES (?,?,?,?,?)').run(email, name, '["Intermediate"]', active, now);
sqlite.prepare('INSERT INTO family_accounts(user_id,email,payload,revision,updated_at) VALUES (?,?,?,1,?)').run('kim-uuid', 'kim@example.test',
  JSON.stringify({parentName: 'Robin Kim', phone: '555-0101', wrestlers: [{id: 'k1', name: 'Kai Kim', grade: '8', usawNumber: 'AB1234', usawExpires: '2099-12-31'}]}), now);
sqlite.prepare("INSERT INTO academy_settings VALUES ('lessons',?,?,'owner')").run(JSON.stringify({prices: {'one-on-one': 6000, partner: 4500, 'small-group': 3500}, splits: {}, defaultSplit: 65}), now);
const openingsOf = email => sqlite.prepare('SELECT * FROM coach_openings WHERE coach_email=? ORDER BY date,start').all(email).map(r => ({...r}));
const events = action => sqlite.prepare('SELECT actor,target FROM security_events WHERE action=? ORDER BY created_at').all(action).map(r => ({...r}));
const notices = kind => sqlite.prepare('SELECT user_id,email,subject,body FROM notifications WHERE kind=? ORDER BY created_at').all(kind).map(r => ({...r}));
const pay = (openingId, wrestler = 'k1') => sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at)
  VALUES (?,'kim-uuid','kim@example.test',?,'Kai Kim','lesson',?,'Lesson','[]',6000,0,6000,'usd',?,'{}','paid',?,0,?,?)`).run('ord-' + openingId + wrestler, wrestler, openingId, JSON.stringify({coachEmail: CORA}), 'k|' + openingId + wrestler, now, now);
const add = (body, who = 'owner') => post(openingsApi, '/api/coach-openings', {action: 'add', email: CORA, start: '15:00', end: '16:00', ...body}, who);

// ---------- 1. The owner manages a coach's openings ----------
{
  // Owner only: coaches and families are refused, and only active coaches have openings.
  for (const who of ['cora', 'kim', '']) {
    assert.equal((await get(openingsApi, '/api/coach-openings?email=' + CORA, who)).status, 403, who + ' cannot read');
    assert.equal((await add({date: ny(5)}, who)).status, 403, who + ' cannot add');
  }
  assert.equal((await get(openingsApi, '/api/coach-openings?email=nobody@example.test', 'owner')).status, 404);
  assert.equal((await get(openingsApi, '/api/coach-openings?email=gone@example.test', 'owner')).status, 404, 'a removed coach has no openings to manage');
  assert.equal((await add({email: 'gone@example.test', date: ny(5)})).status, 404);
  const evil = await openingsApi.POST(request('/api/coach-openings', 'POST', {action: 'add', email: CORA, date: ny(5), start: '15:00', end: '16:00'}, 'owner', 'https://evil.test'));
  assert.equal(evil.status, 403, 'same-origin only');

  // The same validation as coach home.
  assert.match((await add({date: ny(5), end: '16:30'})).body.error, /exactly one hour/);
  assert.match((await add({date: '2026-02-31'})).body.error, /valid date/);
  assert.match((await add({date: ny(5), format: 'small-group', spots: 7})).body.error, /3 to 6 spots/);
  assert.match((await add({date: ny(5), format: 'tag-team'})).body.error, /Choose a lesson type/);
  assert.match((await add({date: ny(5), weeks: 13})).body.error, /Repeat for 1 to 12 weeks/);
  assert.deepEqual(openingsOf(CORA), [], 'nothing saved from a refused request');

  // A one-off, then a weekly small group for 3 weeks: each week its own opening, with the same type and spots.
  let r = await add({date: ny(5)});
  assert.equal(r.status, 200); assert.deepEqual(plain(r.body.created), [ny(5)]);
  let rows = openingsOf(CORA);
  assert.equal(rows.length, 1); assert.equal(rows[0].user_id, 'staff:' + CORA, 'filed under a placeholder until Cora signs in');
  r = await add({date: ny(5), start: '17:00', end: '18:00', format: 'small-group', spots: 5, weeks: 3});
  assert.deepEqual(plain(r.body.created), [ny(5), ny(12), ny(19)]);
  assert.deepEqual(openingsOf(CORA).filter(o => o.start === '17:00').map(o => [o.format, o.capacity]), [['small-group', 5], ['small-group', 5], ['small-group', 5]]);
  // Overlaps are skipped, never doubled; one that only overlaps is refused, naming the coach.
  r = await add({date: ny(12), start: '17:30', end: '18:30'});
  assert.equal(r.status, 409); assert.match(r.body.error, /overlaps one of Cora Coach’s existing openings/);
  r = await add({date: ny(5), start: '17:30', end: '18:30', weeks: 4});
  assert.deepEqual(plain(r.body.skipped), [ny(5), ny(12), ny(19)]); assert.deepEqual(plain(r.body.created), [ny(26)]);
  // Another coach's openings never block Cora's.
  assert.equal((await add({email: DREW, date: ny(5)})).status, 200);

  // Logged, and the coach is told by email.
  assert.deepEqual(events('owner_opening_added').map(e => [e.actor, e.target]), [['supabase:owner-uuid', CORA + ' 1'], ['supabase:owner-uuid', CORA + ' 3'], ['supabase:owner-uuid', CORA + ' 1'], ['supabase:owner-uuid', DREW + ' 1']]);
  const told = notices('coach_openings_changed');
  assert.equal(told.length, 4); assert.equal(told[0].user_id, null); assert.equal(told[0].email, CORA);
  assert.match(told[1].subject, /added 3 lesson openings for you/); assert.match(told[1].body, /at 5:00 PM/);
  const names = {people: {}, you: ['supabase:owner-uuid'], approvals: {}, waitlist: {}, orders: {}, waivers: {}, wrestlers: {}, requests: {}, curricula: {}, coaches: {[CORA]: 'Cora Coach'}};
  const described = log.describeSecurityEvent({actor: 'supabase:owner-uuid', action: 'owner_opening_added', target: CORA + ' 3', created_at: now}, names);
  assert.equal(described.title, 'Lesson openings added for a coach'); assert.equal(described.detail, 'Cora Coach · 3 openings'); assert.equal(described.who, 'You');
  assert.equal(log.describeSecurityEvent({actor: 'x', action: 'owner_opening_removed', target: CORA + ' 2026-12-01 15:00', created_at: now}, names).detail, 'Cora Coach · Tue, Dec 1 · 3:00 PM');

  // Families see and book them with Cora; the lesson's pay goes to Cora (the coach on the opening).
  const one = openingsOf(CORA).find(o => o.start === '15:00').id;
  const listed = (await get(lessonsApi, '/api/lessons', 'kim')).body.openings.find(o => o.id === one);
  assert.equal(listed.coach, 'Cora Coach'); assert.equal(listed.spotsLeft, 1);
  const q = await quotes.quoteBooking('kim-uuid', {type: 'lesson', wrestlerId: 'k1', openingId: one, format: 'one-on-one'});
  assert.equal(q.ok, true); assert.equal(q.charge.pricing.coachEmail, CORA); assert.equal(q.charge.pricing.coachName, 'Cora Coach'); assert.equal(q.charge.amountCents, 6000, 'price from lib/quotes.ts');

  // Cora signs in: coach home shows the owner's openings and claims them for her account.
  r = await get(coachApi, '/api/coach', 'cora');
  assert.equal(r.status, 200); assert.equal(r.body.openings.length, 5);
  assert.ok(openingsOf(CORA).every(o => o.user_id === 'cora-uuid'), 'claimed by Cora’s account');
  // From then on, owner-added openings use her account, and both see the same list.
  await add({date: ny(6)});
  assert.equal(openingsOf(CORA).find(o => o.date === ny(6)).user_id, 'cora-uuid');
  r = await get(openingsApi, '/api/coach-openings?email=' + CORA, 'owner');
  assert.equal(r.body.coach.name, 'Cora Coach'); assert.equal(r.body.maxWeeks, 12); assert.equal(r.body.openings.length, 6);
  assert.equal((await get(coachApi, '/api/coach', 'cora')).body.openings.length, 6);
  // An opening Cora adds herself is in the owner's view too, and overlaps are checked across both.
  assert.equal((await post(coachApi, '/api/coach', {action: 'add', date: ny(6), start: '15:30', end: '16:30'}, 'cora')).status, 409, 'Cora’s own add sees the owner’s opening');

  // Editing: same rules as coach home. Nothing booked: any type.
  const edit = (id, body, email = CORA) => post(openingsApi, '/api/coach-openings', {action: 'update', email, id, ...body}, 'owner');
  assert.equal((await edit(one, {format: 'partner'})).status, 200);
  assert.deepEqual([openingsOf(CORA).find(o => o.id === one).format, openingsOf(CORA).find(o => o.id === one).capacity], ['partner', 2]);
  assert.equal((await edit(one, {format: 'small-group', spots: 9})).status, 400);
  assert.equal((await edit(one, {format: null})).status, 200);
  assert.equal((await edit(one, {format: null}, DREW)).status, 404, 'an opening is changed only as its own coach’s');
  assert.equal(events('owner_opening_changed').length, 2);
  // Booked: the type stays, the spots cover the wrestlers booked, and it cannot be removed.
  const group = openingsOf(CORA).find(o => o.start === '17:00' && o.date === ny(5)).id;
  pay(group); pay(group, 'k2');
  assert.match((await edit(group, {format: 'partner'})).body.error, /type can’t change/);
  assert.match((await edit(group, {format: 'small-group', spots: 1})).body.error, /3 to 6 spots/);
  assert.equal((await edit(group, {format: 'small-group', spots: 3})).status, 200, 'spots can drop to cover the two booked');
  const remove = (id, email = CORA) => post(openingsApi, '/api/coach-openings', {action: 'remove', email, id}, 'owner');
  r = await remove(group);
  assert.equal(r.status, 409); assert.match(r.body.error, /has booked this lesson .*Move or refund it before removing/);
  assert.ok(openingsOf(CORA).some(o => o.id === group), 'a booked lesson stays');
  // A checkout in progress holds it the same way.
  const held = openingsOf(CORA).find(o => o.date === ny(26)).id;
  sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at)
    VALUES ('hold','kim-uuid','kim@example.test','k1','Kai Kim','lesson',?,'Lesson','[]',6000,0,6000,'usd','{}','{}','pending','hold',0,?,?)`).run(held, now, now);
  assert.equal((await remove(held)).status, 409);
  sqlite.prepare("DELETE FROM orders WHERE id='hold'").run();
  // Nobody booked: removed, logged, and the coach is told.
  assert.equal((await remove(held, DREW)).status, 404, 'not Drew’s');
  assert.equal((await remove(held)).status, 200);
  assert.ok(!openingsOf(CORA).some(o => o.id === held));
  assert.deepEqual(events('owner_opening_removed').map(e => e.target), [`${CORA} ${ny(26)} 17:30`]);
  assert.match(notices('coach_openings_changed').at(-1).subject, /removed your lesson opening/);
  assert.equal((await remove(held)).status, 404, 'already gone');

  // A family's private group on an open time: its type is theirs; removing it calls it off and tells the family.
  const open = openingsOf(CORA).find(o => o.date === ny(6)).id;
  // (As lib/lessons.ts requestGroup leaves it; tests/group-lessons.mjs covers asking for one.)
  sqlite.prepare(`UPDATE coach_openings SET format='partner',capacity=2,closed=1,invite_code=?,organizer_id='kim-uuid',organizer_wrestlers='["k1"]' WHERE id=?`).run('C'.repeat(32), open);
  assert.match((await edit(open, {format: 'small-group', spots: 4})).body.error, /lesson type is theirs\. Message the family/);
  assert.equal((await remove(open)).status, 200);
  const off = notices('lesson_group_canceled');
  assert.equal(off.length, 1); assert.equal(off[0].user_id, 'kim-uuid'); assert.match(off[0].body, /Cora Coach can no longer teach/);

  // The owner as a coach files their own openings under their own account, as coach home does, and is not emailed.
  sqlite.prepare('INSERT INTO staff_access(email,name,programs,active,updated_at) VALUES (?,?,?,1,?)').run(OWNER, 'Justin', '["Intermediate"]', now);
  const before = notices('coach_openings_changed').length;
  assert.equal((await add({email: OWNER, date: ny(7)})).status, 200);
  assert.equal(openingsOf(OWNER)[0].user_id, 'owner-uuid'); assert.equal(notices('coach_openings_changed').length, before);
  assert.equal((await get(openingsApi, '/api/coach-openings?email=' + OWNER, 'owner')).body.coach.you, true);

  // Coach home's own flow is unchanged: a coach removes only their own unbooked openings.
  assert.equal((await post(coachApi, '/api/coach', {action: 'remove', id: group}, 'cora')).status, 409);
  const drewOpening = openingsOf(DREW)[0].id;
  assert.equal((await post(coachApi, '/api/coach', {action: 'remove', id: drewOpening}, 'cora')).status, 200);
  assert.ok(openingsOf(DREW).length === 1, 'Cora cannot remove Drew’s opening');
}

// ---------- The owner's page for a coach's openings ----------
const settle = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(res => setImmediate(res)); };
const json = (body, ok = true) => ({ok, status: ok ? 200 : 400, json: async () => body});
// A small fake DOM: elements by id, and querySelectorAll finding [data-x] buttons in the rendered HTML so clicks run the
// page's own handlers.
function page(file, {fetch, search = '', before = ''}) {
  const nodes = new Map(), clicks = new Map(), calls = [];
  const el = id => {
    if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: false, checked: false, disabled: false, innerHTML: '', textContent: '', className: '', href: '', style: {}, dataset: {}, attrs: {},
      replaceChildren() {}, focus() {}, select() {}, scrollIntoView() {}, setAttribute(k, v) { this.attrs[k] = v; }, querySelector() { return null; }, addEventListener() {}, classList: {add() {}, remove() {}, toggle() {}}});
    return nodes.get(id);
  };
  const all = sel => {
    const m = /^\[data-([a-z-]+)(?:="([^"]*)")?\]$/.exec(sel); if (!m) return [];
    const out = [];
    for (const node of nodes.values()) for (const x of String(node.innerHTML).matchAll(new RegExp(`<(\\w+)[^>]*data-${m[1]}="([^"]*)"[^>]*>`, 'g'))) {
      if (m[2] !== undefined && x[2] !== m[2]) continue;
      const key = m[1] + ':' + x[2], camel = m[1].replace(/-(\w)/g, (_, c) => c.toUpperCase()), extra = {};
      for (const a of x[0].matchAll(/data-([a-z-]+)="([^"]*)"/g)) extra[a[1].replace(/-(\w)/g, (_, c) => c.toUpperCase())] = a[2];
      if (!clicks.has(key)) clicks.set(key, {dataset: {[camel]: x[2], ...extra}, value: values[key] ?? ''});
      out.push(clicks.get(key));
    }
    return out;
  };
  const values = {};
  const ctx = vm.createContext({Intl, Date, JSON, URLSearchParams, Promise, setTimeout: f => setImmediate(f), console, encodeURIComponent, Number, String, Array, Object, Math, Set, Map,
    location: {search, href: '', origin: 'https://swa.test', pathname: '/' + file.split('/')[1], assign() {}}, confirm: () => true, history: {replaceState() {}},
    document: {getElementById: el, querySelectorAll: all, querySelector: sel => all(sel)[0] ?? null, createElement: () => ({})},
    fetch: async (url, options) => { calls.push({url, body: options?.body ? JSON.parse(options.body) : null}); return fetch(url, options); }});
  if (before) vm.runInContext(before, ctx);
  const html = readFileSync(file, 'utf8');
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], ctx);
  return {el, ctx, html, calls, values, button: (attr, v) => all(`[data-${attr}="${v}"]`)[0], run: s => vm.runInContext(s, ctx)};
}
{
  const roster = [{wrestler: 'Kai Kim', parent: 'Robin Kim', phone: '555-0101', email: 'kim@example.test', status: 'paid'}];
  const list = [{id: 'o1', date: '2026-12-01', start: '15:00', end: '16:00', format: null, formatName: '', capacity: 1, spotsLeft: 1, hosted: null, organizer: null, roster: []},
    {id: 'b1', date: '2026-12-02', start: '16:00', end: '17:00', format: 'one-on-one', formatName: 'One-on-one lesson', capacity: 1, spotsLeft: 0, hosted: null, organizer: null, roster},
    {id: 'f1', date: '2026-12-03', start: '10:00', end: '11:00', format: 'partner', formatName: 'Partner lesson', capacity: 2, spotsLeft: 1, hosted: 'family', organizer: 'Robin Kim', roster: [{...roster[0], status: 'kept', email: ''}]}];
  const staff = {staff: [{email: CORA, name: 'Cora', displayName: 'Cora Coach', active: true}, {email: 'gone@example.test', name: 'Gone', displayName: 'Gone', active: false}], self: null};
  const p = page('app/coach-openings/screen.html', {search: '?email=' + encodeURIComponent(CORA), fetch: async (url, o) => json(url === '/api/staff' ? staff
    : url.startsWith('/api/coach-openings?') ? {coach: {email: CORA, name: 'Cora Coach', programs: ['Intermediate'], you: false}, today: '2026-11-30', maxWeeks: 12, openings: list}
    : {ok: true, created: ['2026-12-08', '2026-12-15'], skipped: ['2026-12-01']})});
  await settle();
  assert.equal(p.el('heading').textContent, 'Lesson openings: Cora Coach');
  assert.match(p.el('coach').innerHTML, /<option value="cora\.coach@example\.test" selected>Cora Coach<\/option>/); assert.doesNotMatch(p.el('coach').innerHTML, /Gone/, 'only coaches with access');
  assert.match(p.el('coachNote').textContent, /Lesson pay for them goes to Cora Coach/);
  assert.equal((p.el('weeks').innerHTML.match(/<option/g) || []).length, 12, 'repeat for up to 12 weeks');
  const cards = p.el('slots').innerHTML.split('<article').slice(1);
  assert.match(cards[0], /class="booked"[\s\S]*Booked: One-on-one lesson[\s\S]*Kai Kim[\s\S]*tel:555-0101/, 'booked lessons first');
  assert.doesNotMatch(cards[0], /data-slot/, 'a booked lesson cannot be removed'); assert.match(cards[0], /data-edit="b1"/);
  assert.match(cards[1], /Family-requested private group, organised by Robin Kim/); assert.doesNotMatch(cards[1], /data-edit/, 'a family’s group is theirs'); assert.match(cards[1], /data-slot="f1" data-family="1"/);
  assert.match(cards[2], /Open for families to book[\s\S]*data-slot="o1"/);
  // Adding sends the coach, the time, the type, the spots and the weeks; the result says what was skipped.
  Object.assign(p.el('date'), {value: '2026-12-01'}); Object.assign(p.el('start'), {value: '18:00'}); p.el('start').onchange(); assert.equal(p.el('end').value, '19:00', 'the end follows the start');
  p.el('format').value = 'small-group'; p.el('format').onchange(); assert.equal(p.el('spotsLabel').hidden, false); p.el('spots').value = '5'; p.el('weeks').value = '3'; p.el('weeks').onchange();
  assert.match(p.el('repeatHelp').textContent, /Adds 3 openings, one each week from Tue, Dec 1 to Tue, Dec 15/);
  assert.deepEqual(plain(p.run('openingInput()')), {action: 'add', email: CORA, date: '2026-12-01', start: '18:00', end: '19:00', format: 'small-group', spots: 5, weeks: 3});
  await p.el('openingForm').onsubmit({preventDefault() {}}); await settle();
  assert.deepEqual(p.calls.find(c => c.body?.action === 'add').body.weeks, 3);
  assert.equal(p.el('status').textContent, '2 openings saved. Skipped Tue, Dec 1: it overlaps one of Cora Coach’s openings.');
  // Removing and changing the type go to the owner's API, for this coach.
  await p.button('slot', 'o1').onclick(); await settle();
  assert.deepEqual(p.calls.find(c => c.body?.action === 'remove').body, {action: 'remove', email: CORA, id: 'o1'});
  // The staff page links each coach (and the owner as a coach) to this page.
  const staffPage = readFileSync('app/staff/screen.html', 'utf8');
  assert.match(staffPage, /href="\/coach-openings\?email=\$\{encodeURIComponent\(s\.email\)\}">Lesson openings →/);
  assert.match(staffPage, /href="\/coach-openings\?email=\$\{encodeURIComponent\(me\.email\)\}">Your lesson openings →/);
  assert.match(readFileSync('app/coach-openings/route.ts', 'utf8'), /ownerPage\(request,html\)/, 'the page is owner only');
}

// ---------- 2. The month view of open lesson times ----------
{
  // The API gives the academy's date and the holidays in every month with an open time.
  const r = (await get(lessonsApi, '/api/lessons', 'kim')).body;
  assert.match(r.today, /^\d{4}-\d{2}-\d{2}$/);
  const months = [...new Set(r.openings.map(o => o.date.slice(0, 7)))];
  assert.ok(months.length >= 1);
  assert.deepEqual(plain(r.holidays), plain(months.flatMap(m => holidays.holidaysInMonth(m))));

  // The page: November 2026 starts on a Sunday (weeks start on Monday), Thanksgiving is a label, today is ringed.
  const formats = [{id: 'one-on-one', name: 'One-on-one lesson', cents: 6000}, {id: 'partner', name: 'Partner lesson', cents: 4500}, {id: 'small-group', name: 'Small-group lesson', cents: 3500}];
  const at = (id, date, extra) => ({id, date, start: '15:00', end: '16:00', coach: 'Cora Coach', coachKey: 'c', format: null, capacity: 1, spotsLeft: 1, ...extra});
  const openings = [at('n1', '2026-11-24'), at('n2', '2026-11-24', {start: '09:00', end: '10:00', coach: 'Drew Coach', coachKey: 'd'}), at('g1', '2026-11-25', {format: 'small-group', capacity: 4, spotsLeft: 2}), at('d1', '2026-12-03')];
  const lessons = {formats, openings, mine: [], coaches: {}, paymentsOpen: false, today: '2026-11-20', holidays: [{date: '2026-11-26', name: 'Thanksgiving Day'}]};
  const p = page('app/lesson/screen.html', {before: readFileSync('public/month-picker.js', 'utf8'), fetch: async url => json(url.startsWith('/api/lessons') ? lessons : url === '/api/family' ? {data: {wrestlers: [{id: 'k1', name: 'Kai Kim'}]}} : {review: {title: 'One-on-one lesson', coach: 'Cora Coach', dates: ['2026-11-24'], start: '15:00', end: '16:00', wrestler: 'Kai Kim', cents: 6000, capacity: 1, spotsLeft: 1}, paymentsEnabled: false})});
  await settle();
  // The pure month: the same shape as the coach month calendar (lib/practice-calendar.ts).
  const cal = plain(p.run(`lessonMonth(data.openings,'2026-11','2026-11-20',data.holidays)`));
  assert.equal(cal.lead, 6); assert.equal(cal.days.length, 30);
  assert.deepEqual(cal.days.find(d => d.date === '2026-11-24').items.map(o => o.id), ['n2', 'n1'], 'sorted by time');
  assert.deepEqual(cal.days.find(d => d.date === '2026-11-26').holidays, ['Thanksgiving Day']); assert.equal(cal.days.find(d => d.date === '2026-11-20').today, true);
  // One-on-one is the only path with open times priced... plus groups and starting a group: pick the one-on-one path.
  await p.button('path', 'one').onclick(); await settle();
  assert.equal(p.el('viewBar').hidden, false, 'the toggle sits next to the list');
  assert.match(p.el('times').innerHTML, /class="choice" data-opening="n2"/, 'the list is the default');
  assert.equal(p.el('monthPicker').hidden, true);
  // Month view: the grid, the key, real seats and prices, holidays and today.
  await p.el('viewMonth').onclick(); await settle();
  let grid = p.el('times').innerHTML;
  assert.equal(p.el('viewMonth').attrs['aria-pressed'], 'true'); assert.equal(p.el('viewList').attrs['aria-pressed'], 'false');
  assert.equal(p.el('monthPicker').hidden, false); assert.match(p.el('monthSel').innerHTML, /value="2026-11" selected>November 2026/);
  assert.equal(p.el('monthPrev').disabled, true, 'no earlier month with open times'); assert.equal(p.el('monthNext').disabled, false);
  assert.equal((grid.match(/class="cal-dow"/g) || []).length, 7); assert.equal((grid.match(/class="cal-blank"/g) || []).length, 6);
  assert.match(grid, /<div class="cal-day is-today" aria-current="date"><h3><span class="d-num">20<\/span><span class="d-long">Friday, November 20<\/span><span class="today-tag">Today<\/span><\/h3>/);
  assert.match(grid, /<span class="d-num">26<\/span>[\s\S]*?<span class="holiday-tag">Thanksgiving Day<\/span>/);
  assert.match(grid, /<button type="button" class="cal-item" data-opening="n2" aria-pressed="false"><span class="vh">Tue, Nov 24: <\/span><b>9:00 AM–10:00 AM<\/b><span>Drew Coach<\/span><small>1 spot · \$60\.00<\/small><\/button>/);
  assert.doesNotMatch(grid, /data-opening="g1"/, 'only the times this way of booking offers');
  assert.match(grid, /<div class="cal-day empty"><h3><span class="d-num">2<\/span>/, 'quiet days fold away on a phone');
  assert.match(grid, /cal-key[\s\S]*One-on-one or open time[\s\S]*Your choice/);
  // Choosing a time in the month works like the list: it is marked and checked.
  await p.button('opening', 'n1').onclick(); await settle();
  assert.match(p.el('times').innerHTML, /data-opening="n1" aria-pressed="true"/);
  assert.ok(p.calls.some(c => c.url === '/api/booking-review' && c.body.openingId === 'n1'), 'the same review as the list');
  // The next month, then back to the list.
  p.el('monthNext').onclick(); await settle();
  grid = p.el('times').innerHTML;
  assert.match(p.el('monthSel').innerHTML, /value="2026-12" selected/); assert.match(grid, /data-opening="d1"/); assert.doesNotMatch(grid, /data-opening="n1"/);
  assert.equal(p.el('monthNext').disabled, true);
  await p.el('viewList').onclick(); await settle();
  assert.match(p.el('times').innerHTML, /class="choice" data-opening="n1" aria-pressed="true"/, 'the choice carries over');
  // Joining a coach's group: the month shows spots left and the price per wrestler.
  await p.button('path', 'group').onclick(); await p.el('viewMonth').onclick(); await settle();
  assert.match(p.el('times').innerHTML, /class="cal-item f-group" data-opening="g1"[\s\S]*?Cora Coach · Small-group lesson<\/span><small>2 of 4 spots left · \$35\.00 per wrestler<\/small>/);
  // Phone width and the shared look: the grid folds to a list of days; colors are the program tokens; the shared month picker.
  const html = readFileSync('app/lesson/screen.html', 'utf8');
  assert.match(html, /@media\(max-width:760px\)\{\.cal\{grid-template-columns:1fr\}\.cal-dow,\.cal-blank,\.cal-day\.empty\{display:none\}/);
  for (const token of ['--swa-prog-development', '--swa-prog-development-line', '--swa-prog-intermediate', '--swa-prog-event']) assert.ok(html.includes('var(' + token + ')'), token);
  assert.match(html, /<script src="\/month-picker\.js"><\/script>/);
  const css = readFileSync('public/savage.css', 'utf8');
  for (const token of ['--swa-prog-development:', '--swa-prog-intermediate:', '--swa-prog-event:']) assert.ok(css.includes(token), 'savage.css defines ' + token);
}

// ---------- 3. Asking one family (or coach) to sign again ----------
{
  const publish = (kind, title) => post(ownerDocs, '/api/waivers', {action: 'publish', kind, title, body: TEXT}, 'owner');
  assert.equal((await publish('waiver', 'Participation waiver')).status, 200);
  const version = sqlite.prepare("SELECT id FROM waiver_versions WHERE kind='waiver'").get().id;
  const sign = () => post(familyDocs, '/api/waiver', {versionId: version, wrestlerId: 'k1', signer: 'Robin Kim', accepted: true, electronicConsent: true, signature: {method: 'drawn', strokes}}, 'kim');
  const opening = sqlite.prepare("SELECT id FROM coach_openings WHERE coach_email=? AND format IS NULL AND closed=0 AND id NOT IN (SELECT item_id FROM orders) ORDER BY date LIMIT 1").get(CORA).id;
  const book = () => quotes.quoteBooking('kim-uuid', {type: 'lesson', wrestlerId: 'k1', openingId: opening, format: 'one-on-one'});
  assert.match((await book()).error, /needs a signed Participation waiver/);
  assert.equal((await sign()).status, 200);
  assert.equal((await book()).ok, true, 'signed: booking works');
  const first = sqlite.prepare('SELECT * FROM waiver_signatures WHERE user_id=?').get('kim-uuid');
  assert.equal(first.round, 0);

  // Owner only, with a reason, and only a signature that counts now.
  const reissue = (body, who = 'owner') => post(ownerDocs, '/api/waivers', {action: 'reissue', kind: 'waiver', ...body}, who);
  for (const who of ['kim', 'cora']) assert.equal((await reissue({signatureId: first.id, reason: 'Wrong wrestler'}, who)).status, 403);
  assert.match((await reissue({signatureId: first.id, reason: ' x '})).body.error, /Say why it needs signing again/);
  assert.equal((await reissue({signatureId: first.id, reason: 'y'.repeat(301)})).status, 400);
  assert.equal((await reissue({signatureId: 'nope', reason: 'Wrong wrestler'})).status, 404);
  assert.equal((await post(ownerDocs, '/api/waivers', {action: 'reissue', kind: 'parent_consent', signatureId: first.id, reason: 'Wrong wrestler'}, 'owner')).status, 404, 'a waiver signature is not a consent form');
  let r = await reissue({signatureId: first.id, reason: 'The form named the wrong wrestler.'});
  assert.equal(r.status, 200);
  assert.equal((await reissue({signatureId: first.id, reason: 'Again please'})).status, 404, 'already replaced');

  // The signature itself is unchanged; it is marked replaced with the reason.
  assert.deepEqual({...sqlite.prepare('SELECT * FROM waiver_signatures WHERE id=?').get(first.id)}, {...first});
  assert.deepEqual({...sqlite.prepare('SELECT signature_id,user_id,reason,reissued_by FROM signature_reissues').get()}, {signature_id: first.id, user_id: 'kim-uuid', reason: 'The form named the wrong wrestler.', reissued_by: 'supabase:owner-uuid'});
  assert.deepEqual(events('waiver_reissued').map(e => e.target), [`${version}/kim-uuid/k1`]);
  const names = {people: {}, you: [], approvals: {}, waitlist: {}, orders: {}, waivers: {[version]: 'Participation waiver'}, wrestlers: {'kim-uuid/k1': 'Kai Kim'}, requests: {}, curricula: {}, coaches: {[CORA]: 'Cora Coach'}};
  const entry = log.describeSecurityEvent({actor: 'x', action: 'waiver_reissued', target: `${version}/kim-uuid/k1`, created_at: now}, names);
  assert.equal(entry.title, 'Family asked to sign the waiver again'); assert.equal(entry.detail, 'Participation waiver · Kai Kim');
  const told = notices('waiver_reissued');
  assert.equal(told.length, 1); assert.equal(told[0].user_id, 'kim-uuid');
  assert.match(told[0].subject, /Please sign the Participation waiver again for Kai Kim/); assert.match(told[0].body, /Reason: The form named the wrong wrestler\. Kai Kim cannot book until it is signed again/);

  // Booking treats Kai as unsigned until a parent signs again, everywhere that asks.
  assert.match((await book()).error, /needs a signed Participation waiver/);
  assert.match(await waivers.waiverProblem('kim-uuid', {id: 'k1', name: 'Kai Kim'}), /needs a signed Participation waiver/);
  assert.equal(await docs.signatureFor(version, 'kim-uuid', 'k1', 'Kai Kim'), null);
  // The family sees it replaced, with the reason; the owner sees who was asked and why.
  const fam = (await get(familyDocs, '/api/waiver', 'kim')).body;
  assert.equal(fam.signatures.length, 1); assert.equal(fam.signatures[0].current, false); assert.equal(fam.signatures[0].replaced.reason, 'The form named the wrong wrestler.');
  let own = (await get(ownerDocs, '/api/waivers?show=all', 'owner')).body;
  const kai = own.wrestlers.find(w => w.wrestlerId === 'k1');
  assert.equal(kai.signed, false); assert.equal(kai.reissued.signatureId, first.id); assert.equal(kai.reissued.reason, 'The form named the wrong wrestler.');
  assert.equal(own.versions[0].signed, 0, 'a replaced signature is not counted');
  // The old copy still opens for the owner and the family, marked replaced.
  const copy = await docs.signedCopy(first.id, {userId: 'kim-uuid', owner: false});
  assert.equal(copy.replaced.reason, 'The form named the wrong wrestler.');
  assert.match(docs.signedCopyHtml(copy, 'n'), /<p class="replaced"><strong>Replaced\.<\/strong> On .* the academy asked for this waiver to be signed again\. Reason: The form named the wrong wrestler\. This copy is kept as a record and no longer counts\.<\/p>/);

  // Signing again: a new signature (the next round), and booking works again.
  r = await sign();
  assert.equal(r.status, 200);
  assert.equal(sqlite.prepare('SELECT round FROM waiver_signatures WHERE id=?').get(r.body.id).round, 1);
  assert.equal((await sign()).status, 409, 'still once per round');
  assert.equal((await book()).ok, true);
  own = (await get(ownerDocs, '/api/waivers?show=all', 'owner')).body;
  assert.equal(own.wrestlers.find(w => w.wrestlerId === 'k1').signed, true); assert.equal(own.wrestlers.find(w => w.wrestlerId === 'k1').reissued, null); assert.equal(own.versions[0].signed, 1);
  assert.deepEqual((await get(familyDocs, '/api/waiver', 'kim')).body.signatures.map(s => [s.current, !!s.replaced]).sort(), [[false, true], [true, false]]);
  // The family's data download says it was asked again, and why.
  const exported = (await load('lib/data-requests.ts').familyExport('kim-uuid')).waiverSignatures;
  assert.ok(exported.some(s => s.sign_again_reason === 'The form named the wrong wrestler.'));

  // A coach contract: the coach is asked again and sees the to-do; the log names the coach first.
  assert.equal((await publish('coach_contract', 'Coach contract')).status, 200);
  const contract = sqlite.prepare("SELECT id FROM waiver_versions WHERE kind='coach_contract'").get().id;
  assert.equal((await post(contractApi, '/api/contract', {versionId: contract, signer: 'Cora Coach', accepted: true, electronicConsent: true, signature: {method: 'drawn', strokes}}, 'cora')).status, 200);
  const coachSig = (await get(ownerDocs, '/api/waivers?kind=coach_contract&show=all', 'owner')).body.coaches.find(c => c.email === CORA);
  assert.equal(coachSig.signed, true);
  assert.equal((await post(ownerDocs, '/api/waivers', {action: 'reissue', kind: 'coach_contract', signatureId: coachSig.signatureId, reason: 'The start date was wrong'}, 'owner')).status, 200);
  assert.equal((await get(contractApi, '/api/contract', 'cora')).body.signatures[0].current, false, 'coach home shows the to-do again');
  assert.equal((await get(ownerDocs, '/api/waivers?kind=coach_contract&show=all', 'owner')).body.coaches.find(c => c.email === CORA).reissued.reason, 'The start date was wrong');
  assert.deepEqual(events('coach_contract_reissued').map(e => e.target), [`${CORA} ${contract}`]);
  assert.equal(log.describeSecurityEvent({actor: 'x', action: 'coach_contract_reissued', target: `${CORA} ${contract}`, created_at: now}, {...names, waivers: {[contract]: 'Coach contract'}}).detail, 'Cora Coach · Coach contract');
  const coachTold = notices('contract_reissued');
  assert.equal(coachTold.length, 1); assert.equal(coachTold[0].email, CORA); assert.match(coachTold[0].body, /Reason: The start date was wrong\./);
}

// ---------- The pages: owner documents, family home, the signing page ----------
{
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const owner = readFileSync('app/waivers/screen.html', 'utf8'), s = owner.match(/<script>([\s\S]*)<\/script>/)[1];
  const ctx = {esc, when: d => 'WHEN ' + d, location: {pathname: '/waivers'}, exceptionControls: () => ''};
  vm.runInNewContext(s.slice(s.indexOf('const DOCS='), s.indexOf('let data=null;')) + ';this.DOC=DOC;this.statusCell=statusCell', ctx);
  const signed = ctx.statusCell(ctx.DOC, {signed: true, signatureId: 'sig1', signer: 'Robin Kim', signedAt: 'x', userId: 'u', wrestlerId: 'k1', email: 'kim@example.test', wrestler: 'Kai Kim'});
  assert.match(signed, /<summary>Ask to sign again<\/summary><label>Reason the family will see<input maxlength="300" data-reissue-reason="sig1"[^>]*><\/label><button type="button" data-reissue="sig1">Ask to sign again<\/button>/);
  const asked = ctx.statusCell(ctx.DOC, {signed: false, userId: 'u', wrestlerId: 'k1', email: 'kim@example.test', wrestler: 'Kai Kim', reissued: {signatureId: 'sig1', reason: 'Wrong <name>', at: 'T'}});
  assert.match(asked, /Not signed<\/span><div class="exc"><span class="badge">Asked to sign again WHEN T<\/span><br><span class="muted">Wrong &lt;name&gt;<\/span> · <a href="\/waiver-copy\?id=sig1"[^>]*>Earlier copy<\/a><\/div>/);
  assert.match(owner, /function reissue\(id\)[\s\S]*action:'reissue',signatureId:id,reason/);
  const coachCtx = {...ctx, location: {pathname: '/contracts'}};
  vm.runInNewContext(s.slice(s.indexOf('const DOCS='), s.indexOf('let data=null;')) + ';this.DOC=DOC;this.statusCell=statusCell', coachCtx);
  assert.match(coachCtx.statusCell(coachCtx.DOC, {signed: true, signatureId: 'c1', signer: 'Cora', signedAt: 'x', email: CORA, name: 'Cora'}), /Reason the coach will see[\s\S]*data-reissue="c1"/);

  const family = readFileSync('app/family/screen.html', 'utf8');
  const fn = family.slice(family.indexOf('let waiverInfo=null,consentInfo=null;'), family.indexOf('async function refreshCards'));
  const f = {esc, longDate: d => 'LONG ' + d, fetch: async () => ({})};
  vm.runInNewContext(fn + ';this.waiverLine=waiverLine;this.set=(w,c)=>{waiverInfo=w;consentInfo=c}', f);
  f.set({waiver: {id: 'v1'}, signatures: [{id: 'old', versionId: 'v1', wrestlerId: 'k1', current: false, replaced: {reason: 'Wrong wrestler named.'}}], exceptions: {}}, null);
  assert.match(f.waiverLine({id: 'k1'}), /Sign the waiver again<\/span> The academy asked you to sign it again: Wrong wrestler named\. <a href="\/waiver-copy\?id=old"[^>]*>Earlier copy<\/a> <strong>Booking is blocked until it is signed\.<\/strong> <a href="\/waiver\?wrestler=k1">Sign the waiver →/);
  f.set({waiver: {id: 'v2'}, signatures: [{id: 'old', versionId: 'v1', wrestlerId: 'k1', current: false, replaced: {reason: 'x'}}], exceptions: {}}, null);
  assert.match(f.waiverLine({id: 'k1'}), /Waiver not signed/, 'a replaced copy of an older version does not say "again"');

  const signing = readFileSync('app/waiver/screen.html', 'utf8'), row = signing.slice(signing.indexOf('function historyRow'), signing.indexOf('\n', signing.indexOf('function historyRow')));
  const w = {esc, when: d => d}; vm.runInNewContext(row + ';this.historyRow=historyRow', w);
  assert.match(w.historyRow({}, {id: 'old', wrestler: 'Kai Kim', title: 'Waiver', signer: 'Robin', signedAt: 'x', current: false, replaced: {reason: 'Wrong wrestler'}}), /replaced: the academy asked for it to be signed again[\s\S]*Reason: Wrong wrestler/);
  assert.match(w.historyRow({}, {id: 'v', wrestler: 'Kai Kim', title: 'Waiver', signer: 'Robin', signedAt: 'x', current: false, replaced: null}), /earlier version/);
}

console.log('Passed (#239): the owner adds, changes and removes any coach’s openings with coach home’s rules (one hour, types and spots, 12-week repeat, overlaps, booked lessons kept, family groups), owner only, logged, coach told, pay stays with the coach; the family month view (data, grid, seats and prices, today, holidays, phone fold, tokens); asking one family or coach to sign again (signature kept and marked, booking blocked until signed again, owner and family pages, notices, log, export).');
