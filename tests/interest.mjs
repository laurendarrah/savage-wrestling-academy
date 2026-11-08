// #273: "Tell the academy I want this". While a purchase type is closed online, a family's one action on the review is a
// message to the owner, written on the server from the saved wrestler and the catalog (never free text), sent once per
// family, item and day, readable by the owner and by that family only, with the academy's contact line beside it.
import assert from 'node:assert/strict';
import {makeDb, loader, call} from './fixtures/d1.mjs';

const {sqlite, DB} = makeDb();
const env = {DB};
const actor = {owner: false, id: 'p1'};
const load = loader(env, actor);
const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
const today = ny(0);
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('p1', 'p1@example.test', JSON.stringify({parentName: 'Pat One', phone: '555-0100', wrestlers: [{id: 'w1', name: 'Jo One', grade: '8'}, {id: 'w2', name: 'Kay One', grade: 'K'}]}), 1, 'x');
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('p2', 'p2@example.test', JSON.stringify({parentName: 'Pat Two', phone: '555-0200', wrestlers: [{id: 'w3', name: 'Lee Two', grade: '9'}]}), 1, 'x');
sqlite.prepare("INSERT INTO staff_access VALUES ('dana@example.test','Coach Dana','[\"Intermediate\"]',1,'x')").run();
sqlite.prepare("INSERT INTO coach_openings(id,user_id,date,start,end,coach_email,format,capacity,closed) VALUES ('open1','staff:dana@example.test',?,'15:00','16:00','dana@example.test',NULL,1,0)").run(ny(3));
sqlite.prepare("INSERT INTO coach_openings(id,user_id,date,start,end,coach_email,format,capacity,closed) VALUES ('grp1','staff:dana@example.test',?,'10:00','11:00','dana@example.test','small-group',4,0)").run(ny(4));
sqlite.prepare("INSERT INTO coach_openings(id,user_id,date,start,end,coach_email,format,capacity,closed) VALUES ('past1','staff:dana@example.test',?,'15:00','16:00','dana@example.test',NULL,1,0)").run(ny(-2));

const route = load('app/api/interest/route.ts'), messages = load('lib/messages.ts'), interest = load('lib/interest.ts');
const post = body => call(route, '/api/interest', {method: 'POST', body});
const rows = () => sqlite.prepare("SELECT user_id,sender_role,body FROM family_messages ORDER BY created_at,body").all();

// ---------- Validation: a saved wrestler of this family, a real program or lesson ----------
assert.equal((await post({})).status, 400);
assert.equal((await post({kind: 'membership', wrestlerId: 'w3', program: 'Intermediate'})).status, 404, 'another family’s wrestler');
assert.equal((await post({kind: 'membership', wrestlerId: 'w1', program: 'Varsity'})).status, 400, 'unknown program');
assert.equal((await post({kind: 'membership', wrestlerId: 'w1'})).status, 400);
assert.equal((await post({kind: 'camp', wrestlerId: 'w1'})).status, 400, 'only memberships and lessons');
assert.equal((await post({kind: 'lesson', wrestlerId: 'w1', format: 'pair'})).status, 400, 'unknown lesson type');
assert.equal((await post({kind: 'lesson', wrestlerId: 'w1', openingId: 'nope'})).status, 409, 'a time that does not exist');
assert.equal((await post({kind: 'lesson', wrestlerId: 'w1', openingId: 'past1'})).status, 409, 'a time that has passed');
assert.equal(rows().length, 0, 'nothing was sent');

// ---------- A membership: the message names the wrestler, grade, program and plan; the family's own words are not used ----------
let r = await post({kind: 'membership', wrestlerId: 'w1', program: 'Intermediate', note: '<b>free text</b>', body: 'ignored'});
assert.equal(r.status, 200, JSON.stringify(r.body));
const longToday = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'});
assert.equal(r.body.message, `Request from the website: a 12-month SWA Intermediate membership, paid monthly, for Jo One (grade 8), asked for on ${longToday}. Please let us know how to pay and when Jo One can start.`);
assert.equal(interest.ACADEMY_ADDRESS, '20 Railroad St, Huntington Station, NY 11746', 'the address on the membership terms page');
assert.deepEqual(r.body.contact, {address: '20 Railroad St, Huntington Station, NY 11746', email: 'savagewrestlingclub@gmail.com'}, 'the fixed address until the owner saves one');
assert.doesNotMatch(JSON.stringify(rows()), /free text|ignored/, 'nothing the browser wrote is in the message');
assert.equal(rows().length, 1); assert.equal(rows()[0].sender_role, 'family'); assert.equal(rows()[0].user_id, 'p1');

// ---------- One per family, per item, per day; a different item or wrestler is fine ----------
r = await post({kind: 'membership', wrestlerId: 'w1', program: 'Intermediate'});
assert.equal(r.status, 409); assert.match(r.body.error, /already told the academy about this today/);
assert.equal((await post({kind: 'membership', wrestlerId: 'w1', program: 'Advanced'})).status, 200, 'another program is another item');
assert.equal((await post({kind: 'membership', wrestlerId: 'w2', program: 'Elementary'})).status, 200, 'another wrestler is another item');
assert.equal(rows().length, 3);
// Yesterday's same request does not block today's.
sqlite.prepare("UPDATE family_messages SET created_at=? WHERE body LIKE '%SWA Advance%'").run(ny(-1) + 'T12:00:00Z');
assert.equal((await post({kind: 'membership', wrestlerId: 'w1', program: 'Advanced'})).status, 200, 'a new day, a new request');

// ---------- Lessons: a chosen open time names the coach and time; the type is the time's own ----------
r = await post({kind: 'lesson', wrestlerId: 'w2', openingId: 'open1', format: 'small-group'});
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.match(r.body.message, new RegExp(`^Request from the website: a one-on-one lesson with Coach Dana, \\w{3}, \\w{3} \\d{1,2} · 3:00 PM, for Kay One \\(kindergarten\\)\\. Please hold the spot and let us know how to pay\\.$`), r.body.message);
r = await post({kind: 'lesson', wrestlerId: 'w1', openingId: 'grp1'});
assert.equal(r.status, 200); assert.match(r.body.message, /a small-group lesson with Coach Dana, .* · 10:00 AM, for Jo One \(grade 8\)/);
r = await post({kind: 'lesson', wrestlerId: 'w1', format: 'partner'});
assert.equal(r.status, 200); assert.match(r.body.message, /^Request from the website: a partner lesson for Jo One \(grade 8\), asked for on .*\. Please let us know the coach, the time and how to pay\.$/);
assert.equal((await post({kind: 'lesson', wrestlerId: 'w1', openingId: 'grp1'})).status, 409, 'the same lesson twice in a day');

// ---------- Who reads it: the owner, and the family in their own conversation; never another family ----------
const owner = await messages.ownerThread('p1');
assert.ok(owner.thread.some(m => m.from === 'family' && /12-month SWA Intermediate membership/.test(m.body)), 'the owner reads it in the family’s thread');
const mine = await messages.familyInbox('p1');
assert.ok(mine.thread.some(m => m.from === 'you' && /12-month SWA Intermediate membership/.test(m.body)), 'the family sees what they sent');
const other = await messages.familyInbox('p2');
assert.equal(other.thread.length, 0, 'another family sees nothing');
const list = await messages.familiesPage();
assert.equal(list.families.find(f => f.userId === 'p1').unread, 0, 'opening the thread marked the owner’s copy read');
actor.id = 'p2';
assert.equal((await call(route, '/api/interest')).body.contact.email, 'savagewrestlingclub@gmail.com');
assert.equal((await post({kind: 'membership', wrestlerId: 'w1', program: 'Intermediate'})).status, 404, 'a family cannot ask on another family’s behalf');

// ---------- The contact line follows the public website settings once saved ----------
sqlite.prepare("INSERT INTO academy_settings VALUES ('website',?,'x','owner-id')").run(JSON.stringify({headline: 'Savage Wrestling Academy', intro: 'Wrestling for K to 12.', mission: '', coaches: [], achievements: [], alumni: [], address: '1 Mat Way, Melville, NY 11747', email: 'hello@swa.test'}));
r = await call(route, '/api/interest');
assert.deepEqual(r.body.contact, {address: '1 Mat Way, Melville, NY 11747', email: 'hello@swa.test'});

console.log('Passed: "Tell the academy I want this" validates the wrestler, program and lesson time, writes the message on the server, sends it once per family, item and day, shows it to the owner and that family only, and gives the academy’s contact line.');
