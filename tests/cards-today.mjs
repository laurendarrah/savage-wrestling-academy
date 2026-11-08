// Issue #271 (audit UX 10 and 11): the cards page and the dashboard count the cards that stop a check-in today, an
// entered-but-unverified card included; the default list holds the cards waiting for the owner; the exception control
// shows for them too; the roster links the owner to the right list; and marking a card verified against what USA
// Wrestling showed asks for confirmation and a note.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {makeDb, loader, call} from './fixtures/d1.mjs';

const {sqlite, DB} = makeDb();
const load = loader({DB}, {owner: true, id: 'owner-id'});
const cardsApi = load('app/api/usaw-cards/route.ts'), exceptionsApi = load('app/api/exceptions/route.ts'), usaw = load('lib/usaw.ts');
const ny = k => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', {timeZone: 'America/New_York'}), today = ny(0);
const all = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => ({day, start: '18:00', end: '19:30'}));
sqlite.prepare("INSERT INTO academy_state VALUES ('academy',?,1,'o','x')").run(JSON.stringify({programNamingVersion: 2,
  programs: [{id: 'Intermediate', name: 'SWA Intermediate', priceCents: 20000, walkInPriceCents: 4000}],
  seasons: [{program: 'Intermediate', start: ny(-30), end: ny(60), weekly: all, excludedDates: []}]}));
const SEASON = usaw.cardSeason(today).end;
// Four wrestlers in one family: a verified card, an unverified card with a session today, an unverified card with no
// session, and no card with a session today.
const kids = [
  {id: 'ok', name: 'Vera Verified', grade: '8', usawNumber: 'AB1001', usawExpires: SEASON},
  {id: 'new', name: 'Ned Unverified', grade: '8', usawNumber: 'AB1006', usawExpires: SEASON},
  {id: 'idle', name: 'Ida Idle', grade: '8', usawNumber: 'AB1007', usawExpires: SEASON},
  {id: 'none', name: 'Nico Nocard', grade: '8'}
];
sqlite.prepare('INSERT INTO family_accounts VALUES (?,?,?,?,?)').run('p1', 'p1@example.test', JSON.stringify({parentName: 'Pat', phone: '555', wrestlers: kids}), 1, today);
sqlite.prepare("INSERT INTO usaw_reviews VALUES ('p1','ok','AB1001',?,'valid','','owner-id','x')").run(SEASON);
let n = 0;
for (const w of kids.filter(w => w.id !== 'idle'))
  sqlite.prepare(`INSERT INTO orders(id,user_id,email,wrestler_id,wrestler_name,kind,program,item_id,item_label,dates,base_cents,discount_cents,amount_cents,currency,pricing,terms_accepted,status,dedupe_key,livemode,created_at,updated_at,paid_at,term_start,term_end)
    VALUES (?,'p1','x',?,?,'monthly','Intermediate','Intermediate','label','[]',20000,0,20000,'usd','{}','{}','paid',?,0,?,?,?,?,?)`).run('m' + ++n, w.id, w.name, 'k' + n, today, today, today, ny(-10), ny(20));

// --- The count of cards that stop a check-in today, and the lists ---
let r = await call(cardsApi, '/api/usaw-cards');
assert.equal(r.status, 200);
assert.deepEqual(r.body.totals, {all: 4, blocked: 1, waiting: 2, blockedToday: 2, soon: 0, verified: 1});
const byId = id => r.body.cards.find(c => c.wrestlerId === id);
assert.equal(byId('new').blocksToday, true, 'entered but not verified, with a session today');
assert.equal(byId('none').blocksToday, true); assert.equal(byId('ok').blocksToday, false); assert.equal(byId('idle').blocksToday, false, 'no session today');
assert.deepEqual(r.body.cards.map(c => c.wrestlerId), ['none', 'new', 'idle', 'ok'], 'today’s problems first, then blocked, then by expiry and name');
r = await call(cardsApi, '/api/usaw-cards?show=problems');
assert.deepEqual(r.body.cards.map(c => c.wrestlerId), ['none', 'new', 'idle'], 'the default list holds the cards waiting for the owner');
r = await call(cardsApi, '/api/usaw-cards?show=waiting');
assert.deepEqual(r.body.cards.map(c => c.wrestlerId), ['new', 'idle']);
r = await call(cardsApi, '/api/usaw-cards?show=unreviewed');
assert.deepEqual(r.body.cards.map(c => c.wrestlerId), ['new', 'idle'], 'the older name of the list still works');
// An exception lets Ned in today, and the count follows.
assert.equal((await call(exceptionsApi, '/api/exceptions', {method: 'POST', body: {action: 'grant', userId: 'p1', wrestlerId: 'new', rule: 'usaw', endsOn: ny(3), reason: 'Card checked at the door'}})).status, 200);
r = await call(cardsApi, '/api/usaw-cards');
assert.equal(r.body.totals.blockedToday, 1); assert.equal(byId('new').blocksToday, false);
// Verifying Nico's card is impossible (none on file); verifying Ned's would remove him from the count too.
sqlite.prepare('DELETE FROM booking_exceptions').run();
assert.equal((await call(cardsApi, '/api/usaw-cards', {method: 'POST', body: {userId: 'p1', wrestlerId: 'new', status: 'valid', number: 'AB1006', expires: SEASON}})).status, 200);
r = await call(cardsApi, '/api/usaw-cards');
assert.equal(r.body.totals.blockedToday, 1); assert.equal(r.body.totals.waiting, 1);

// --- Verified by hand against the USA Wrestling check: a note is required and kept ---
sqlite.prepare("INSERT INTO usaw_lookups VALUES ('p1','idle','AB1007',?,?,'active','mismatch','Someone Else','PA',?)").run(SEASON, SEASON, new Date().toISOString());
r = await call(cardsApi, '/api/usaw-cards', {method: 'POST', body: {userId: 'p1', wrestlerId: 'idle', status: 'valid', number: 'AB1007', expires: SEASON}});
assert.equal(r.status, 400); assert.match(r.body.error, /USA Wrestling showed that the name on the card is Someone Else, PA\. To mark this card verified anyway, add a note/); assert.equal(r.body.lookupOutcome, 'mismatch');
r = await call(cardsApi, '/api/usaw-cards', {method: 'POST', body: {userId: 'p1', wrestlerId: 'idle', status: 'valid', number: 'AB1007', expires: SEASON, note: 'Card is in her maiden name; checked in person'}});
assert.equal(r.status, 200);
r = await call(cardsApi, '/api/usaw-cards?show=all');
assert.equal(byId('idle').state, 'verified'); assert.equal(byId('idle').note, 'Card is in her maiden name; checked in person'); assert.equal(byId('idle').verifiedBy, 'owner');
assert.equal(await usaw.lookupDisagreement('p1', 'idle', 'AB1008', SEASON), null, 'a lookup for another number is not a disagreement');
assert.equal(await usaw.lookupDisagreement('p1', 'ok', 'AB1001', SEASON), null, 'no lookup, no disagreement');
console.log('Passed: cards that stop a check-in today are counted and listed first; the waiting list; verifying against the lookup needs a note.');

// --- The cards page (inline JavaScript is not typechecked) ---
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
{
  const html = readFileSync('app/cards/screen.html', 'utf8'), script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const nodes = new Map(), el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', textContent: '', innerHTML: '', hidden: false, className: '', options: [{value: 'problems'}, {value: 'waiting'}, {value: 'all'}], previousElementSibling: {textContent: ''}, setAttribute() {}, removeAttribute() {}}); return nodes.get(id); };
  const posted = [], dialogs = [];
  const cards = [{userId: 'p1', wrestlerId: 'idle', wrestler: 'Ida Idle', grade: '8', email: 'p1@example.test', parentName: 'Pat', number: 'AB1007', expires: SEASON, state: 'current', note: '', blocksToday: false, lookup: {outcome: 'mismatch', name: 'Someone Else', state: 'PA', checkedAt: new Date().toISOString()}},
    {userId: 'p1', wrestlerId: 'new', wrestler: 'Ned Unverified', grade: '8', email: 'p1@example.test', parentName: 'Pat', number: 'AB1006', expires: SEASON, state: 'current', note: '', blocksToday: true, lookup: null},
    {userId: 'p1', wrestlerId: 'ok', wrestler: 'Vera Verified', grade: '8', email: 'p1@example.test', parentName: 'Pat', number: 'AB1001', expires: SEASON, state: 'verified', note: 'Checked in person', verifiedBy: 'owner', verifiedAt: new Date().toISOString(), blocksToday: false, lookup: null}];
  const data = {today, date: today, cards, totals: {all: 3, blocked: 0, waiting: 2, blockedToday: 1, soon: 0, verified: 1}, matched: 3, next: null, renewal: null, renewalDays: 30};
  let confirmAnswer = true, promptAnswer = 'Checked in person';
  const ctx = vm.createContext({document: {getElementById: el, querySelectorAll: () => []}, window: {}, navigator: {}, location: {search: '?show=waiting&q=Ned'}, Date, Intl, JSON, Promise, Number, String, URLSearchParams, encodeURIComponent, setTimeout, clearTimeout,
    confirm: m => { dialogs.push(['confirm', m]); return confirmAnswer; }, prompt: m => { dialogs.push(['prompt', m]); return promptAnswer; },
    fetch: async (url, o) => { if (o?.body) posted.push(JSON.parse(o.body)); return {ok: true, json: async () => url === '/api/exceptions' ? {exceptions: []} : o?.body ? {ok: true} : data}; }});
  vm.runInContext(script, ctx); await new Promise(r => setTimeout(r, 20));
  // The link from the roster opens the right list and wrestler.
  assert.equal(el('show').value, 'waiting'); assert.equal(el('q').value, 'Ned');
  assert.equal(el('tToday').textContent, 1); assert.equal(el('todayTile').className, 'tile urgent'); assert.equal(el('tWaiting').textContent, 2);
  const rows = el('rows').innerHTML;
  const rowOf = name => rows.slice(rows.indexOf(name), rows.indexOf('</tr>', rows.indexOf(name)));
  assert.match(rowOf('Ned Unverified'), /<span class="badge current">On file, not verified<\/span><br><span class="badge today">Can’t check in today<\/span>/);
  assert.match(rowOf('Ned Unverified'), /Allow booking and check-in anyway/, 'the exception control shows for an unverified card');
  assert.doesNotMatch(rowOf('Vera Verified'), /Allow booking and check-in anyway/);
  assert.match(rowOf('Vera Verified'), /Owner · [A-Z][a-z]{2} \d{1,2} · Checked in person/, 'the note why it was verified');
  assert.match(rowOf('Ned Unverified'), /<label class="note-label">Note the family sees \(required for Not valid\)<input id="note1"/, 'the reason field has a label');
  // Verified against the lookup: confirm, then a note.
  await vm.runInContext('review(0,"valid")', ctx); await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(dialogs.map(d => d[0]), ['confirm', 'prompt']);
  assert.match(dialogs[0][1], /USA Wrestling showed that the name on the card is Someone Else, PA\. Mark Ida Idle’s card verified anyway\?/);
  assert.deepEqual(posted.at(-1), {userId: 'p1', wrestlerId: 'idle', number: 'AB1007', expires: SEASON, status: 'valid', note: 'Checked in person'});
  dialogs.length = 0; posted.length = 0; promptAnswer = '';
  await vm.runInContext('review(0,"valid")', ctx);
  assert.equal(posted.length, 0, 'no note, no review'); assert.match(el('status').textContent, /Not changed\. Add why the card is verified/);
  dialogs.length = 0; confirmAnswer = false;
  await vm.runInContext('review(0,"valid")', ctx);
  assert.deepEqual(dialogs.map(d => d[0]), ['confirm']); assert.equal(posted.length, 0, 'declined');
  // A card the lookup agreed with, or never checked, is verified without a dialog.
  dialogs.length = 0;
  await vm.runInContext('review(1,"valid")', ctx); await new Promise(r => setTimeout(r, 20));
  assert.equal(dialogs.length, 0); assert.equal(posted.at(-1).status, 'valid');
  assert.match(html, /<option value="problems">Needs you: blocked, waiting to be verified, or expiring soon<\/option><option value="waiting">Waiting for you: on file, not yet verified<\/option>/);
}
// The roster's hint links the owner to the cards page, on the list that fits; coaches get the reason only.
{
  const html = readFileSync('app/roster/screen.html', 'utf8'), script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const line = script.slice(script.indexOf('const cardsLink='), script.indexOf('\n', script.indexOf('const cardsLink=')));
  const ctx = {encodeURIComponent, data: {role: 'owner'}}; vm.runInNewContext('var data=this.data;' + line + ';this.cardsLink=cardsLink', ctx);
  assert.equal(ctx.cardsLink({card: 'current', name: 'Riley Two'}), ' <a class="fix-link" href="/cards?show=waiting&q=Riley%20Two">Open USA Wrestling cards →</a>');
  assert.equal(ctx.cardsLink({card: 'missing', name: 'Nico'}), ' <a class="fix-link" href="/cards?show=problems&q=Nico">Open USA Wrestling cards →</a>');
  ctx.data.role = 'coach'; vm.runInNewContext('data.role="coach"', ctx);
  assert.equal(ctx.cardsLink({card: 'current', name: 'Riley Two'}), '');
  assert.ok(script.includes('${esc(e.checkInBlocked)}${cardsLink(e)}'), 'shown with the reason');
}
// The dashboard tile is checked in tests/live-dashboard.mjs.
console.log('Passed: cards page counts and lists, the labeled note, the confirmation against the lookup, and the roster link.');
