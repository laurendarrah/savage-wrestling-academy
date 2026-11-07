// Issue #196: the public website. The owner edits the welcome page's headline, introduction and mission, chooses
// which coaches the team page shows, and lists wrestler achievements and alumni (names only, no photos: #197, Q22).
// Runs the real routes against a database built from every migration, with the Supabase stand-in from accounts.mjs,
// and the editor page's inline script with a fake DOM (inline JavaScript is not typechecked).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {load, request, sqlite, users} from './accounts.mjs';

// Routes import their page with "?raw"; read the file, and load everything else through accounts.mjs.
function route(file) {
  const module = {exports: {}};
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true}}).outputText;
  vm.runInNewContext(out, {module, exports: module.exports, Response, Request, Headers, URL, console, require(name) {
    const path = resolve(dirname(file), name.replace(/\?raw$/, ''));
    if (name.endsWith('?raw')) return {__esModule: true, default: readFileSync(path, 'utf8')};
    return load(path + '.ts');
  }});
  return module.exports;
}
const api = route('app/api/website/route.ts'), welcome = route('app/welcome/route.ts'), team = route('app/team/route.ts'), editorPage = route('app/website/route.ts');
const W = load('lib/website.ts');
const reply = async r => ({status: r.status, body: await r.json()});
const post = (body, who = 'owner', origin) => api.POST(request('/api/website', 'POST', body, who, origin)).then(reply);
const get = (who = 'owner') => api.GET(request('/api/website', 'GET', null, who)).then(reply);
const page = async r => { const res = await r.GET(request('/x')); return {status: res.status, html: await res.text(), headers: res.headers}; };
const ORIGIN = 'https://register.savagewrestling.example';
users.ownerWeak = {...users.owner}; // signed in with a password but no authenticator code this session

const base = {headline: 'Built on the mat', intro: 'Wrestling for K to 12 in Huntington Station.', mission: '', coaches: [], achievements: [], alumni: [], address: '', email: ''};
// JSON round trip: the module runs in its own context, so its objects have other prototypes.
const ok = input => { const r = W.cleanWebsite(input); assert.ok(r.site, 'expected valid: ' + r.error); return JSON.parse(JSON.stringify(r.site)); };
const bad = (input, re, known) => { const r = W.cleanWebsite(input, known); assert.ok(r.error, 'expected an error'); assert.match(r.error, re); };

// ---------- Validation and cleaning ----------
{
  assert.deepEqual(ok(W.DEFAULT_WEBSITE), JSON.parse(JSON.stringify(W.DEFAULT_WEBSITE)), 'the defaults are valid');
  const s = ok({...base, headline: '  Built   on\nthe mat ', mission: 'First line.\r\n\r\n\r\n\r\nSecond   paragraph.', achievements: [{name: ' Sam  Example ', achievement: 'NYS champion', season: '2025–26', photo: 'https://evil.test/x.jpg'}],
    alumni: [{name: 'Alex', next: 'Wrestles at Hofstra', image: 'https://evil.test/logo.png'}], extra: 'ignored', theme: {background: '#fff'}});
  assert.equal(s.headline, 'Built on the mat', 'one-line fields collapse spaces');
  assert.equal(s.mission, 'First line.\n\nSecond paragraph.', 'paragraphs keep one blank line');
  assert.deepEqual(s.achievements, [{name: 'Sam Example', achievement: 'NYS champion', season: '2025–26'}], 'no photo field is kept');
  assert.deepEqual(s.alumni, [{name: 'Alex', years: '', next: 'Wrestles at Hofstra'}], 'no image field; years optional');
  assert.equal(s.extra, undefined); assert.equal(s.theme, undefined, 'no theme or colour settings (triage entry 13)');
  assert.deepEqual(Object.keys(s).sort(), ['achievements', 'address', 'alumni', 'coaches', 'email', 'headline', 'intro', 'mission']);
  bad({...base, headline: '  '}, /Enter the headline/);
  bad({...base, intro: ''}, /Enter the introduction/);
  bad({...base, headline: 'x'.repeat(81)}, /Keep the headline to 80 characters/);
  bad({...base, mission: 'x'.repeat(1501)}, /Keep the mission to 1500/);
  bad({...base, headline: 'Bad\u0007bell'}, /can’t be saved/);
  bad({...base, mission: 'tab sep'}, /can’t be saved/);
  bad({...base, email: 'not-an-email'}, /contact email like/);
  assert.equal(ok({...base, email: ' coach@example.test '}).email, 'coach@example.test');
  bad({...base, achievements: [{name: 'A', achievement: 'B', season: 'C'}, {name: '', achievement: 'Champion', season: '2025'}]}, /^Achievement 2: enter the wrestler’s name\.$/);
  bad({...base, achievements: [{name: 'A', achievement: '', season: '2025'}]}, /Achievement 1: enter what they achieved/);
  bad({...base, achievements: [{name: 'A', achievement: 'B', season: ''}]}, /Achievement 1: enter the season or year/);
  bad({...base, alumni: [{name: 'A', next: ''}]}, /^Alumni entry 1: enter where they went or what they did\.$/);
  bad({...base, achievements: 'nope'}, /Check the achievements list/);
  bad({...base, achievements: Array.from({length: 201}, () => ({name: 'A', achievement: 'B', season: 'C'}))}, /List up to 200 achievements/);
  bad({...base, achievements: [{name: 'x'.repeat(81), achievement: 'B', season: 'C'}]}, /Achievement 1: keep the wrestler’s name to 80/);
  bad({...base, coaches: ['not an email']}, /Check the coaches/);
  bad({...base, coaches: ['ghost@example.test']}, /no longer on Coaches/, new Set(['lee@example.test']));
  assert.deepEqual(ok({...base, coaches: ['Lee@Example.test', 'lee@example.test']}).coaches, ['lee@example.test'], 'emails lower-cased, no repeats');
  bad(null, /Check the website content/); bad([], /Check the website content/);
}

// ---------- Rendering: owner text is escaped; empty sections are left out ----------
{
  const tpl = readFileSync('app/welcome/screen.html', 'utf8'), teamTpl = readFileSync('app/team/screen.html', 'utf8');
  let html = W.renderWelcome(tpl, W.DEFAULT_WEBSITE, [], ORIGIN);
  assert.match(html, /<h1>Savage Wrestling Academy<\/h1>/, 'unsaved: the standard heading');
  assert.match(html, /<title>Savage Wrestling Academy \| Wrestling in Huntington Station, NY<\/title>/);
  assert.match(html, /<meta name="description" content="Wrestling for kindergarten through 12th grade/);
  assert.match(html, new RegExp(`<link rel="canonical" href="${ORIGIN}/welcome"><meta property="og:type" content="website">`));
  assert.match(html, new RegExp(`<meta property="og:url" content="${ORIGIN}/welcome">`));
  assert.doesNotMatch(html, /class="mission"|class="teaser"|id="visit"|class="herolink"|<!--slot:/, 'empty sections hidden, every slot filled');
  assert.doesNotMatch(html, /og:image/, 'text tags only');

  const evil = '<script>alert(1)</script> "quoted" & $& $1';
  const site = {...base, headline: evil, intro: evil, mission: evil + '\n\nSecond <b>para</b>', address: evil, email: 'x@example.test',
    achievements: [{name: '"><img src=x onerror=alert(1)>', achievement: evil, season: '2025–26'}], alumni: [{name: evil, years: evil, next: evil}]};
  const coaches = [{name: '<i>Coach</i> Lee', bio: evil, specialties: ['<b>Takedowns</b>']}];
  for (const out of [W.renderWelcome(tpl, site, coaches, ORIGIN), W.renderTeam(teamTpl, site, coaches, ORIGIN)]) {
    assert.doesNotMatch(out, /<script>alert|<img src=x|<i>Coach|<b>Takedowns|<b>para/, 'no owner or coach markup reaches the page');
    assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;quoted&quot; &amp; \$&amp; \$1/, '"$&" and "$1" stay literal');
    assert.doesNotMatch(out, /<!--slot:/);
  }
  html = W.renderWelcome(tpl, site, coaches, ORIGIN);
  assert.match(html, /<title>&lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;quoted&quot; &amp; \$&amp; \$1 \| Savage Wrestling Academy<\/title>/);
  assert.match(html, /<meta property="og:description" content="&lt;script&gt;/, 'attributes escaped too');
  assert.match(html, /<section class="mission"[^]*Our mission[^]*<p>&lt;script&gt;[^]*<\/p><p>Second &lt;b&gt;para/, 'mission paragraphs');
  assert.match(html, /<section class="teaser"[^]*Meet the coaches[^]*1 coach, 1 wrestler achievement and 1 alum[^]*href="\/team"/);
  assert.match(html, /<a class="herolink" href="\/team">/);
  assert.match(html, /<a href="mailto:x@example\.test">x@example\.test<\/a>/);

  // The team page: each section only when it has something; achievements grouped by season in the owner's order.
  const t = W.renderTeam(teamTpl, {...base, achievements: [{name: 'Sam', achievement: 'State champion', season: '2025–26'}, {name: 'Jo', achievement: 'County champion', season: '2024–25'}, {name: 'Max', achievement: 'State 3rd', season: '2025–26'}]}, [], ORIGIN);
  assert.doesNotMatch(t, /id="coaches"|id="alumni"|class="jump"|id="visit"/, 'empty coaches, alumni and visit hidden; no jump links for one section');
  assert.match(t, /id="achievements"[^]*2025–26<\/h3><ul class="results"><li><b>Sam<\/b><span>State champion<\/span><\/li><li><b>Max<\/b>[^]*2024–25<\/h3>[^]*Jo/);
  assert.match(t, /<title>Achievements \| Savage Wrestling Academy<\/title>/);
  assert.match(t, new RegExp(`<link rel="canonical" href="${ORIGIN}/team">`));
  const empty = W.renderTeam(teamTpl, base, [], null);
  assert.match(empty, /<title>Our team \| Savage Wrestling Academy<\/title>/);
  assert.match(empty, /will be listed here soon/);
  assert.doesNotMatch(empty, /id="coaches"|id="achievements"|id="alumni"|rel="canonical"|og:url/, 'nothing invented; no absolute address without APP_ORIGIN');
  const all = W.renderTeam(teamTpl, {...base, alumni: [{name: 'Alex', years: '2014–2020', next: 'Wrestled at Hofstra'}], achievements: [{name: 'Sam', achievement: 'Champion', season: '2025'}]}, [{name: 'Lee Tran', bio: 'Line one.\n\nLine two.', specialties: ['Takedowns']}], ORIGIN);
  assert.match(all, /<nav class="jump" aria-label="On this page"><a href="#coaches">Coaches<\/a><a href="#achievements">Achievements<\/a><a href="#alumni">Alumni<\/a><\/nav>/);
  assert.match(all, /<title>Coaches, achievements and alumni \| Savage Wrestling Academy<\/title>/);
  assert.match(all, /content="Savage Wrestling Academy in Huntington Station, NY: coaches Lee Tran, 1 wrestler achievement and 1 alum\."/);
  assert.match(all, /<span class="mono mono--lg" aria-hidden="true">LT<\/span><h3>Lee Tran<\/h3>[^]*<li>Takedowns<\/li>[^]*<p>Line one\.<\/p><p>Line two\.<\/p>/);
  assert.match(all, /<h3>Alex<\/h3><p class="alum__years">2014–2020<\/p><p class="alum__next">Wrestled at Hofstra<\/p>/);
  // Nothing loads from another site, and wrestlers have no pictures at all.
  for (const out of [all, html]) for (const m of out.matchAll(/<img\b[^>]*src="([^"]*)"/g)) assert.match(m[1], /^\/brand\//, 'only the academy logo');
  assert.doesNotMatch(readFileSync('lib/website.ts', 'utf8') + teamTpl, /photo_?url|image_?url|https?:\/\/[a-z]/i, 'no image links or hard-coded addresses');
  assert.equal(W.clip('word '.repeat(60)).length <= 160, true); assert.match(W.clip('word '.repeat(60)), /word…$/);
}

// ---------- Owner only ----------
{
  assert.equal((await get('')).status, 403); assert.equal((await get('alice')).status, 403, 'families cannot read the editor');
  assert.equal((await get('ownerWeak')).status, 403, 'owner needs the authenticator');
  assert.equal((await post({action: 'save', site: base, updatedAt: null}, 'alice')).status, 403);
  assert.equal((await post({action: 'save', site: base, updatedAt: null}, 'ownerWeak')).status, 403);
  assert.equal((await post({action: 'save', site: base, updatedAt: null}, 'owner', 'https://evil.test')).status, 403, 'same origin only');
  const plain = await api.POST(new Request('https://academy.test/api/website', {method: 'POST', headers: {'content-type': 'text/plain', origin: 'https://academy.test', cookie: 'test-session=owner'}, body: '{}'}));
  assert.equal(plain.status, 415);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM academy_settings WHERE id='website'").get().n, 0, 'nothing saved by a refused request');
  const anon = await editorPage.GET(request('/website'));
  assert.equal(anon.status, 303); assert.equal(anon.headers.get('Location'), '/login', 'the editor page is owner only');
  assert.equal((await editorPage.GET(request('/website', 'GET', null, 'alice'))).headers.get('Location'), '/login');
  assert.equal((await editorPage.GET(request('/website', 'GET', null, 'owner'))).status, 200);
}

// ---------- Saving, coaches and the public pages ----------
{
  const now = '2026-11-07T12:00:00Z';
  const coach = (email, name, active, profile) => {
    sqlite.prepare('INSERT INTO staff_access(email,name,programs,active,updated_at) VALUES (?,?,?,?,?)').run(email, name, '["Elementary"]', active, now);
    if (profile) sqlite.prepare('INSERT INTO coach_profiles(email,display_name,bio,specialties,phone,photo_key,updated_at,updated_by) VALUES (?,?,?,?,?,NULL,?,?)').run(email, profile.name, profile.bio, JSON.stringify(profile.specialties), '(631) 555-0199', now, 'x');
  };
  coach('lee.tran@example.test', 'Coach Lee', 1, {name: 'Lee Tran', bio: 'Ten years coaching folkstyle.', specialties: ['Takedowns', 'Mat returns']});
  coach('dana@example.test', 'Dana Ruiz', 1, null);
  coach('gone@example.test', 'Gone Coach', 0, {name: 'Gone Coach', bio: 'Left.', specialties: []});

  let r = await get();
  assert.equal(r.status, 200); assert.equal(r.body.updatedAt, null); assert.deepEqual(r.body.site, JSON.parse(JSON.stringify(W.DEFAULT_WEBSITE)), 'unsaved: the standard wording');
  assert.deepEqual(r.body.coaches.map(c => [c.name, c.active, c.profileSaved, c.hasBio]), [['Dana Ruiz', true, false, false], ['Gone Coach', false, true, true], ['Lee Tran', true, true, true]]);
  assert.ok(!JSON.stringify(r.body).includes('555-0199'), 'the editor never reads the phone');

  // Before anything is saved, the public pages read as before and no coach is listed.
  let w = await page(welcome);
  assert.equal(w.status, 200); assert.match(w.html, /<h1>Savage Wrestling Academy<\/h1>/);
  assert.match(w.headers.get('Content-Security-Policy'), /img-src 'self'/, 'no images from other sites');
  assert.match(w.headers.get('Content-Security-Policy'), /frame-ancestors 'self'/);
  let tp = await page(team);
  assert.equal(tp.status, 200); assert.match(tp.html, /listed here soon/); assert.doesNotMatch(tp.html, /Lee Tran|Dana/, 'a coach appears only when the owner chooses them');
  assert.match(tp.headers.get('Content-Security-Policy'), /img-src 'self'/); assert.equal(tp.headers.get('X-Content-Type-Options'), 'nosniff');

  const site = {...base, mission: 'Build tough, coachable wrestlers.', coaches: ['dana@example.test', 'lee.tran@example.test', 'gone@example.test'],
    achievements: [{name: 'Sam Example', achievement: 'NYS champion', season: '2025–26'}], alumni: [{name: 'Alex Moore', years: '2014–2020', next: 'Wrestled at Hofstra'}]};
  assert.match((await post({action: 'save', site: {...site, coaches: ['ghost@example.test']}, updatedAt: null})).body.error, /no longer on Coaches/);
  assert.match((await post({action: 'save', site: {...site, achievements: [{name: '', achievement: 'x', season: 'y'}]}, updatedAt: null})).body.error, /Achievement 1/);
  assert.equal((await post({action: 'publish', site, updatedAt: null})).status, 400);

  // Preview renders the unsaved content as the page, with the shared top bar, and saves nothing.
  r = await post({action: 'preview', page: 'team', site});
  assert.equal(r.status, 200); assert.match(r.body.html, /class="swa-bar"/); assert.match(r.body.html, /Lee Tran[^]*Sam Example[^]*Alex Moore/);
  r = await post({action: 'preview', page: 'home', site});
  assert.match(r.body.html, /Build tough, coachable wrestlers/);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM academy_settings WHERE id='website'").get().n, 0, 'preview does not publish');

  r = await post({action: 'save', site, updatedAt: null});
  assert.equal(r.status, 200); const first = r.body.updatedAt; assert.ok(first);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM security_events WHERE action='website_saved'").get().n, 1, 'saving is in the security log');
  assert.equal((await post({action: 'save', site, updatedAt: null})).status, 409, 'a second first-save loses');
  assert.equal((await post({action: 'save', site, updatedAt: '2020-01-01T00:00:00Z'})).status, 409, 'saved on another device since');
  assert.equal((await get()).body.updatedAt, first);

  tp = await page(team);
  assert.match(tp.html, /<h3>Dana Ruiz<\/h3>[^]*<h3>Lee Tran<\/h3>/, 'the owner’s order; staff name until a profile is saved');
  assert.match(tp.html, /Ten years coaching folkstyle\.[^]*/); assert.match(tp.html, /<li>Takedowns<\/li><li>Mat returns<\/li>/);
  assert.doesNotMatch(tp.html, /Gone Coach/, 'removed coaches are not shown');
  for (const secret of ['555-0199', '631', '@example.test', 'mailto:']) assert.ok(!tp.html.includes(secret), 'the team page never shows a coach’s phone or email: ' + secret);
  assert.match(tp.html, /<b>Sam Example<\/b><span>NYS champion<\/span>/); assert.match(tp.html, /<h3>Alex Moore<\/h3>/);
  assert.match(tp.html, new RegExp(`<link rel="canonical" href="${ORIGIN}/team">`), 'absolute addresses from appOrigin()');
  w = await page(welcome);
  assert.match(w.html, /Build tough, coachable wrestlers/); assert.match(w.html, /2 coaches, 1 wrestler achievement and 1 alum/);
  assert.ok(!w.html.includes('@example.test') && !w.html.includes('555-0199'), 'no coach email or phone on the welcome page');

  // Emptying a list hides its section again.
  r = await post({action: 'save', site: {...site, achievements: [], alumni: [], coaches: []}, updatedAt: first});
  assert.equal(r.status, 200);
  tp = await page(team); assert.match(tp.html, /listed here soon/); assert.doesNotMatch(tp.html, /id="achievements"|id="alumni"|id="coaches"/);
  w = await page(welcome); assert.doesNotMatch(w.html, /class="teaser"|class="herolink"/);

  // A damaged saved record (for example from an old backup) falls back to the standard wording instead of breaking.
  sqlite.prepare("UPDATE academy_settings SET payload='{\"headline\":\"\"}' WHERE id='website'").run();
  w = await page(welcome); assert.equal(w.status, 200); assert.match(w.html, /<h1>Savage Wrestling Academy<\/h1>/);
}

// ---------- The editor page's script ----------
{
  const nodes = new Map();
  const el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', hidden: true, disabled: false, innerHTML: '', textContent: '', srcdoc: '', scrollIntoView() {}}); return nodes.get(id); };
  const calls = []; let next = null;
  const coaches = [{email: 'dana@example.test', name: 'Dana Ruiz', active: true, profileSaved: false, hasBio: false}, {email: 'gone@example.test', name: 'Gone Coach', active: false, profileSaved: true, hasBio: true}, {email: 'lee@example.test', name: 'Lee "The Hammer" Tran', active: true, profileSaved: true, hasBio: true}];
  const ctx = vm.createContext({JSON, Date, Intl, Object, Promise, console, document: {getElementById: el},
    fetch: async (url, o) => { const body = o?.body ? JSON.parse(o.body) : null; calls.push({url, body}); const res = next ? next(body) : {status: 200, body: {site: {...base, coaches: ['lee@example.test']}, updatedAt: '2026-11-07T15:00:00Z', coaches}}; return {ok: res.status === 200, status: res.status, json: async () => res.body}; }});
  const src = readFileSync('app/website/screen.html', 'utf8');
  vm.runInContext(src.match(/<script>([\s\S]*)<\/script>/)[1], ctx);
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
  const run = code => vm.runInContext(code, ctx);
  await settle();
  assert.equal(calls[0].url, '/api/website'); assert.equal(el('headline').value, 'Built on the mat');
  assert.match(el('savedAt').textContent, /Last published Nov 7/);
  // Empty lists say what to add.
  assert.match(el('achList').innerHTML, /No achievements yet, so the team page leaves this section out\. Add one with the wrestler’s name, what they achieved and the season or year\./);
  assert.match(el('alumList').innerHTML, /No alumni yet, so the team page leaves this section out/);
  // Coaches: chosen first with their number, then the rest; removed coaches only if chosen; names escaped.
  let list = el('coachList').innerHTML;
  assert.match(list, /class="coach on"><span class="order" aria-hidden="true">1<\/span><label><input type="checkbox" checked onchange="toggleCoach\(2,this\.checked\)"><span>Lee &quot;The Hammer&quot; Tran/);
  assert.match(list, /Dana Ruiz <span class="note">· No profile yet: only the name is shown/);
  assert.doesNotMatch(list, /Gone Coach/, 'removed coaches are not offered');
  assert.match(list, /aria-label="Move Lee &quot;The Hammer&quot; Tran up" disabled/);
  run('toggleCoach(0,true)'); assert.deepEqual(run('site.coaches'), ['lee@example.test', 'dana@example.test']);
  run('moveCoach(1,-1)'); assert.deepEqual(run('site.coaches'), ['dana@example.test', 'lee@example.test']);
  run('toggleCoach(2,false)'); assert.deepEqual(run('site.coaches'), ['dana@example.test']);
  run('site.coaches.push("gone@example.test");render()');
  assert.match(el('coachList').innerHTML, /Gone Coach <span class="note">· Removed from Coaches: not shown/);
  run('toggleCoach(1,false)');
  run('site.coaches=[];render()'); assert.match(el('coachList').innerHTML, /No coaches chosen, so the team page leaves this section out/);
  // Rows: add, edit, move, remove; owner text is escaped in the fields.
  run("addRow('achievements');addRow('achievements');addRow('alumni')");
  run(`setField('achievements',0,'name','Sam "Slam" <b>');setField('achievements',0,'achievement','NYS champion');setField('achievements',0,'season','2025–26')`);
  run(`setField('achievements',1,'name','Jo');setField('achievements',1,'achievement','County 1st');setField('achievements',1,'season','2024–25')`);
  assert.equal(run('site.achievements[0].name'), 'Sam "Slam" <b>', 'typing updates the list without redrawing the fields');
  run('render()'); assert.match(el('achList').innerHTML, /value="Sam &quot;Slam&quot; &lt;b&gt;"/);
  assert.match(el('achList').innerHTML, /aria-label="Move achievement 1 up" disabled/);
  assert.match(el('achList').innerHTML, /onclick="dropRow\('achievements',1\)"/);
  run("moveRow('achievements',0,1)"); assert.equal(run('site.achievements[0].name'), 'Jo');
  run("moveRow('achievements',1,1)"); assert.equal(run('site.achievements[1].name'), 'Sam "Slam" <b>', 'moving past the end does nothing');
  assert.deepEqual(JSON.parse(JSON.stringify(run('payload()').alumni)), [], 'blank rows are not sent');
  run("dropRow('alumni',0)"); assert.match(el('alumList').innerHTML, /No alumni yet/);
  // Saving sends the form and the lists with the version it loaded; a conflict shows the message.
  el('mission').value = 'Tough and coachable.'; el('email').value = 'swa@example.test';
  next = body => ({status: 200, body: {ok: true, site: body.site, updatedAt: '2026-11-07T16:00:00Z'}});
  await run('saveSite()');
  const sent = calls.at(-1).body;
  assert.equal(sent.action, 'save'); assert.equal(sent.updatedAt, '2026-11-07T15:00:00Z');
  assert.equal(sent.site.mission, 'Tough and coachable.'); assert.equal(sent.site.email, 'swa@example.test');
  assert.deepEqual(sent.site.achievements.map(a => a.name), ['Jo', 'Sam "Slam" <b>']);
  assert.match(el('status').textContent, /Saved and published/); assert.equal(run('updatedAt'), '2026-11-07T16:00:00Z');
  next = () => ({status: 409, body: {error: 'The website was saved on another device. Reload the page to see the latest, then make your changes again.'}});
  await run('saveSite()'); assert.match(el('status').textContent, /saved on another device/); assert.equal(el('saveButton').disabled, false);
  // Preview puts the page into the sandboxed frame.
  next = () => ({status: 200, body: {html: '<p>preview</p>'}});
  await run("showPreview('team')");
  assert.equal(calls.at(-1).body.action, 'preview'); assert.equal(calls.at(-1).body.page, 'team');
  assert.equal(el('previewFrame').srcdoc, '<p>preview</p>'); assert.equal(el('previewBox').hidden, false);
  assert.match(src, /<iframe id="previewFrame"[^>]*sandbox="allow-scripts"/, 'the preview runs without the site’s origin');
  assert.doesNotMatch(src, /type="color"|type="file"|type="url"|<img|\['(?:photo|image)'/i,'no colour editor, uploads or image links');
}

// The owner navigation (the shell's sidebar and the dashboard's tools, issue #261) links to the editor.
assert.match(readFileSync('lib/owner-nav.ts', 'utf8'), /\{href: '\/website', label: 'Public website'\}/);
console.log('Website tests passed: validation, escaping, empty sections hidden, coaches without phone or email, owner-only editing, publish and conflicts, SEO from appOrigin(), editor script');
