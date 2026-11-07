// Page scripts that load in the background must not let a late answer undo what the person did meanwhile (issue #220).
// These races made the browser walkthrough fail now and then; a fast owner or coach could hit them too. Each test holds
// the server's answers and releases them in a chosen order. Inline JavaScript in .html files is not typechecked.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const HOLD = Symbol('hold');
// A stand-in server. route(url, body) returns the answer, or HOLD to keep the request waiting until the test answers it.
function server(route) {
  const held = [], calls = [];
  const fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null; calls.push({url, body});
    const answer = (data, status = 200) => ({ok: status < 400, status, json: async () => data});
    const out = route(url, body);
    if (out !== HOLD) return answer(out);
    return new Promise(resolve => held.push({url, body, reply: (data, status) => resolve(answer(data, status))}));
  };
  return {fetch, held, calls};
}
// The page's script with a stub DOM. start: element properties the markup sets (checked against the markup by the caller).
function page(file, fetch, start = {}) {
  const nodes = new Map();
  const el = id => {
    if (!nodes.has(id)) {
      let html = '';
      nodes.set(id, {id, value: '', hidden: false, disabled: false, textContent: '', href: '', srcdoc: '', dataset: {}, style: {},
        // Like a <select>: new options select the first one.
        get innerHTML() { return html; }, set innerHTML(v) { html = String(v); const first = /^<option value="([^"]*)"/.exec(html); if (first) this.value = first[1]; },
        listeners: {}, addEventListener(type, f) { this.listeners[type] = f; }, scrollIntoView() {}, focus() {}, select() {}, ...start[id]});
    }
    return nodes.get(id);
  };
  const asked = [];
  const ctx = vm.createContext({console, setTimeout, clearTimeout, URLSearchParams, structuredClone, fetch,
    location: {search: '', pathname: '/', hash: '', origin: 'https://swa.test'}, confirm: msg => { asked.push(msg); return false; },
    document: {getElementById: el, querySelectorAll: () => [], querySelector: () => null}});
  vm.runInContext(readFileSync(file, 'utf8').match(/<script>([\s\S]*)<\/script>/)[1], ctx);
  return {el, ctx, asked, run: code => vm.runInContext(code, ctx)};
}
const submit = form => form.onsubmit({preventDefault() {}});

// ---------- Messages: the audience count shows the latest choice, whatever order the answers arrive in ----------
{
  const net = server((url, body) => body?.action === 'preview' ? HOLD : {programs: [{id: 'Elementary', name: 'SWA Development'}, {id: 'Intermediate', name: 'SWA Intermediate'}], events: [], families: [], sent: [], failedEmails: [], emailOn: false});
  const {el, asked} = page('app/messages/screen.html', net.fetch);
  await settle();
  assert.equal(net.held.length, 1, 'the page counts all families once it has loaded');
  // The owner picks "A program's members", then SWA Intermediate, before any count comes back.
  el('audType').value = 'program'; el('program').value = 'Elementary'; el('audType').onchange();
  el('program').value = 'Intermediate'; el('program').onchange();
  assert.equal(el('audCount').textContent, 'Counting families…');
  assert.deepEqual(net.held.map(h => h.body.audience), [{type: 'all'}, {type: 'program', program: 'Elementary'}, {type: 'program', program: 'Intermediate'}]);
  const [all, development, intermediate] = net.held;
  intermediate.reply({label: 'SWA Intermediate', count: 1}); await settle();
  assert.equal(el('audCount').textContent, 'SWA Intermediate: 1 family');
  // The older answers arrive last and are ignored, including an error.
  all.reply({label: 'All families', count: 2}); development.reply({error: 'Something went wrong.'}, 500); await settle();
  assert.equal(el('audCount').textContent, 'SWA Intermediate: 1 family', 'an older count must not replace the newer one');
  // An error for the latest choice is shown.
  el('program').value = 'Advanced'; el('program').onchange();
  net.held[3].reply({error: 'Choose a program.'}, 400); await settle();
  assert.equal(el('audCount').textContent, 'Choose a program.');
  // Sending right after a change waits for that choice's count, so the confirmation names the right families.
  el('program').value = 'Intermediate'; el('program').onchange();
  submit(el('announce')); await settle();
  assert.deepEqual(asked, [], 'no confirmation while the count is still coming');
  net.held[4].reply({label: 'SWA Intermediate', count: 1}); await settle();
  assert.deepEqual(asked, ['Send this announcement to SWA Intermediate: 1 family?']);
  assert.ok(!net.calls.some(c => c.body?.action === 'announce'), 'declining the confirmation sends nothing');
}

// ---------- Coach profile: the form is disabled until the saved profile is in, and while it saves ----------
{
  const html = readFileSync('app/coach-profile/screen.html', 'utf8');
  const fieldset = html.match(/<fieldset id="profileFields" disabled>([\s\S]*?)<\/fieldset>/);
  assert.ok(fieldset, 'the profile fields start disabled');
  for (const id of ['displayName', 'bio', 'specialties', 'phone', 'saveProfile']) assert.match(fieldset[1], new RegExp(`id="${id}"`), id + ' is inside the disabled fieldset');
  const net = server(() => HOLD);
  const {el} = page('app/coach-profile/screen.html', net.fetch, {profileFields: {disabled: true}});
  await settle();
  assert.equal(el('profileFields').disabled, true, 'nothing can be typed before the profile loads');
  net.held[0].reply({email: 'coach.lee@example.test', profile: {displayName: 'Coach Lee', bio: '', specialties: [], phone: '', updatedAt: null}}); await settle();
  assert.equal(el('profileFields').disabled, false); assert.equal(el('displayName').value, 'Coach Lee'); assert.equal(el('saved').textContent, 'Not saved yet');
  // Saving: the fields are disabled until the server answers, then show what was saved.
  el('displayName').value = 'Lee Tran'; el('bio').value = 'Ten years coaching.'; el('specialties').value = 'Takedowns, Mat returns';
  submit(el('profileForm')); await settle();
  assert.equal(el('profileFields').disabled, true, 'disabled while saving');
  assert.deepEqual(net.held[1].body, {displayName: 'Lee Tran', bio: 'Ten years coaching.', specialties: ['Takedowns', 'Mat returns'], phone: ''});
  net.held[1].reply({profile: {displayName: 'Lee Tran', bio: 'Ten years coaching.', specialties: ['Takedowns', 'Mat returns'], phone: '', updatedAt: '2026-11-07T15:00:00Z'}}); await settle();
  assert.equal(el('profileFields').disabled, false); assert.equal(el('status').textContent, 'Profile saved.'); assert.equal(el('displayName').value, 'Lee Tran');
  assert.match(el('saved').textContent, /^Last saved Nov 7, 2026$/);
  // A failed save gives the fields back.
  submit(el('profileForm')); await settle();
  net.held[2].reply({error: 'Name families see is required.'}, 400); await settle();
  assert.equal(el('profileFields').disabled, false); assert.equal(el('status').textContent, 'Name families see is required.');
  // If the profile cannot load, the form stays disabled and says why.
  const failed = server(() => HOLD), p = page('app/coach-profile/screen.html', failed.fetch, {profileFields: {disabled: true}});
  failed.held[0].reply({error: 'Coaches only.'}, 403); await settle();
  assert.equal(p.el('profileFields').disabled, true); assert.equal(p.el('status').textContent, 'Coaches only.');
}

// ---------- Public website editor: disabled until the published site is in, and while it saves ----------
{
  const html = readFileSync('app/website/screen.html', 'utf8');
  const fieldset = html.match(/<fieldset id="editor" disabled>([\s\S]*?)<\/fieldset>/);
  assert.ok(fieldset, 'the editor starts disabled');
  for (const id of ['headline', 'intro', 'mission', 'coachList', 'achList', 'alumList', 'address', 'email', 'saveButton']) assert.match(fieldset[1], new RegExp(`id="${id}"`), id + ' is inside the disabled editor');
  assert.match(fieldset[1], /onclick="addRow\('achievements'\)"[\s\S]*onclick="addRow\('alumni'\)"[\s\S]*onclick="showPreview\('team'\)"/, 'the add and preview buttons wait too');
  const site = {headline: 'Built on the mat', intro: 'Wrestling.', mission: '', coaches: [], achievements: [], alumni: [], address: '', email: ''};
  const net = server(() => HOLD);
  const {el, run} = page('app/website/screen.html', net.fetch, {editor: {disabled: true}});
  await settle();
  assert.equal(el('editor').disabled, true); assert.equal(el('headline').value, '');
  net.held[0].reply({site, updatedAt: '2026-11-07T15:00:00Z', coaches: []}); await settle();
  assert.equal(el('editor').disabled, false); assert.equal(el('headline').value, 'Built on the mat'); assert.equal(el('status').textContent, '');
  el('headline').value = 'Tough and coachable';
  const saving = run('saveSite()'); await settle();
  assert.equal(el('editor').disabled, true, 'disabled while saving');
  assert.equal(net.held[1].body.site.headline, 'Tough and coachable'); assert.equal(net.held[1].body.updatedAt, '2026-11-07T15:00:00Z');
  net.held[1].reply({site: {...site, headline: 'Tough and coachable'}, updatedAt: '2026-11-07T16:00:00Z'}); await saving;
  assert.equal(el('editor').disabled, false); assert.match(el('status').textContent, /Saved and published/);
  // A refused save gives the editor back with the reason.
  const again = run('saveSite()'); await settle();
  net.held[2].reply({error: 'The website was saved on another device.'}, 409); await again;
  assert.equal(el('editor').disabled, false); assert.equal(el('status').textContent, 'The website was saved on another device.');
  // If it cannot load, nothing can be edited or published.
  const failed = server(() => HOLD), p = page('app/website/screen.html', failed.fetch, {editor: {disabled: true}});
  failed.held[0].reply({error: 'Owner access required.'}, 403); await settle();
  assert.equal(p.el('editor').disabled, true); assert.equal(p.el('status').textContent, 'Owner access required.');
}

// ---------- Payments: Check price waits for the latest choices; an older load cannot hide a checked price ----------
{
  const formats = [{id: 'one-on-one', name: 'One-on-one lesson', cents: 6000}, {id: 'partner', name: 'Partner lesson', cents: 4500}];
  const time = (id, extra) => ({id, date: '2026-11-13', start: '16:00', end: '17:00', coach: 'Coach Dana', format: null, capacity: 1, spotsLeft: 1, ...extra});
  const older = {formats, openings: [time('one')]};
  const newer = {formats, openings: [time('one'), time('pg', {format: 'partner', capacity: 2, spotsLeft: 1, kept: 1, closed: true, organizer: 'Pat Example'})]};
  const net = server((url, body) => {
    if (url === '/api/lessons') return HOLD;
    if (url.startsWith('/api/public-schedule')) return {programs: [{id: 'Intermediate', name: 'SWA Intermediate'}], practices: [], events: [], liveClasses: []};
    if (url.startsWith('/api/payments?families')) return {families: [{userId: 'u1', parentName: 'Riley Parent', email: 'family.b@example.test', wrestlers: [{id: 'w1', name: 'Riley Two', grade: 8}]}]};
    if (body?.action === 'preview') return {item: 'Partner lesson', wrestler: 'Riley Two', dates: ['2026-11-13'], listCents: 4500, suggestedCents: 4500};
    if (body?.action === 'record') return {ok: true};
    return {payments: [], next: null, matched: 0, totals: {collectedCents: 0, onlineCents: 0, offlineCents: 0, refundedCents: 0, count: 0}};
  });
  const {el} = page('app/payments/screen.html', net.fetch);
  el('kind').value = 'annual';
  await settle();
  assert.equal(el('preview').disabled, false, 'Check price is ready once the page has loaded');
  // The owner chooses a private lesson, then the partner lesson, before the first lesson list comes back.
  el('kind').value = 'lesson'; el('kind').onchange();
  assert.equal(el('preview').disabled, true, 'Check price waits while the lesson times load');
  await settle();
  el('opening').value = 'pg'; el('opening').onchange(); await settle();
  assert.equal(net.held.length, 2, 'two lesson loads are on their way');
  const [first, second] = net.held;
  second.reply(newer); await settle();
  assert.equal(el('preview').disabled, false);
  assert.match(el('format').innerHTML, /^<option value="partner">Partner lesson · \$45\.00 per wrestler<\/option>$/);
  await el('preview').onclick(); await settle();
  assert.equal(el('previewBox').hidden, false);
  // The first load, from before the partner lesson was listed, finishes last: it changes nothing.
  first.reply(older); await settle();
  assert.equal(el('previewBox').hidden, false, 'an older load must not hide the checked price');
  assert.match(el('format').innerHTML, /value="partner"/, 'an older load must not bring back the one-on-one');
  assert.equal(el('preview').disabled, false);
  el('amount').value = '45.00'; el('method').value = 'cash';
  await el('record').onclick(); await settle();
  const recorded = net.calls.find(c => c.body?.action === 'record').body;
  assert.equal(recorded.format, 'partner'); assert.equal(recorded.openingId, 'pg'); assert.equal(recorded.amountCents, 4500);
  assert.match(el('status').textContent, /Payment recorded/);
  // Changing a choice hides the old price at once.
  el('opening').value = 'one'; el('opening').onchange();
  assert.equal(el('previewBox').hidden, true); assert.equal(el('preview').disabled, true);
  await settle(); assert.equal(el('preview').disabled, true, 'still waiting for the lesson times');
  net.held[2].reply(newer); await settle();
  assert.equal(el('preview').disabled, false); assert.match(el('format').innerHTML, /value="one-on-one"/);
}

console.log('Page race tests passed: the messages audience count, the coach profile, the public website editor and the payments form ignore late answers and wait for the latest.');
