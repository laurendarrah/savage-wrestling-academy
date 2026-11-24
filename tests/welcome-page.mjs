// Issue #412 (Justin, Nov 24, #197 Q22 changed): the site does not host the academy's marketing website. The team page
// and the owner's Public website editor are gone; the welcome page, the front door families sign up from, keeps a short
// fixed welcome and the academy's address and email around the programs and calendar. No wrestler or coach is named.
// Runs the real welcome route against a database built from every migration (tests/accounts.mjs).
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {load, request, sqlite} from './accounts.mjs';

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
const welcome = route('app/welcome/route.ts'), W = load('lib/website.ts');
const page = async () => { const res = await welcome.GET(request('/welcome')); return {status: res.status, html: await res.text(), headers: res.headers}; };

// The removed pages and their API are gone from the app, and nothing links to them.
for (const gone of ['app/team', 'app/website', 'app/api/website']) assert.ok(!existsSync(gone), gone + ' is removed');
for (const f of ['lib/owner-nav.ts', 'lib/owner-shell.ts', 'lib/launch-checklist.ts', 'lib/page-chrome.ts', 'app/help/owner/screen.html', 'app/welcome/screen.html', 'app/portal.html'])
  assert.doesNotMatch(readFileSync(f, 'utf8'), /href="\/team|['"]\/team['"]|href="\/website|['"]\/website['"]|\/api\/website/, f + ' does not link to the team page or the editor');

// The welcome page: the fixed welcome, the academy's fixed address and email, no team section, no team link.
let w = await page();
assert.equal(w.status, 200);
assert.match(w.html, /<h1[^>]*>Savage Wrestling Academy<\/h1>/);
assert.match(w.html, /Wrestling for kindergarten through 12th grade, from first-time wrestlers to experienced competitors\./);
assert.match(w.html, /<title>Savage Wrestling Academy \| Wrestling in Huntington Station, NY<\/title>/);
assert.match(w.html, /<h2 id="visitTitle">Visit the academy<\/h2>[\s\S]*20 Railroad St, Huntington Station, NY 11746[\s\S]*mailto:savagewrestlingclub@gmail\.com/);
assert.doesNotMatch(w.html, /class="teaser"|class="herolink"|Meet the team|Our mission|<!--slot:/, 'no team teaser, team link, mission or unfilled slot');
assert.match(w.headers.get('Content-Security-Policy'), /img-src 'self'/, 'no images from other sites');
assert.match(w.headers.get('Content-Security-Policy'), /frame-ancestors 'self' https:\/\/savagewrestlingacademy\.com/, 'still embeddable on the academy’s own site');

// An address and email an earlier editor saved still reach families (the emails and this page read them).
sqlite.prepare("INSERT INTO academy_settings(id,payload,updated_at,updated_by) VALUES ('website',?,?,?)").run(JSON.stringify({headline: 'Old headline', address: '1 Example Ave, Huntington, NY', email: 'front.desk@example.test', achievements: [{name: 'Sam Example', achievement: 'Champion', season: '2025'}]}), 'x', 'owner-uuid');
w = await page();
assert.match(w.html, /1 Example Ave, Huntington, NY[\s\S]*mailto:front\.desk@example\.test/);
assert.doesNotMatch(w.html, /Old headline|Sam Example/, 'saved website text and names are no longer shown');
assert.deepEqual(JSON.parse(JSON.stringify(await W.academyContact())), {address: '1 Example Ave, Huntington, NY', email: 'front.desk@example.test'});
// A damaged or odd saved row falls back to the fixed contact instead of breaking anything.
sqlite.prepare("UPDATE academy_settings SET payload=? WHERE id='website'").run(JSON.stringify({address: 'x'.repeat(500), email: 'not an email'}));
assert.deepEqual(JSON.parse(JSON.stringify(await W.academyContact())), {address: W.ACADEMY_ADDRESS, email: W.ACADEMY_EMAIL});
sqlite.prepare("UPDATE academy_settings SET payload='{not json' WHERE id='website'").run();
assert.deepEqual(JSON.parse(JSON.stringify(await W.academyContact())), {address: W.ACADEMY_ADDRESS, email: W.ACADEMY_EMAIL});
w = await page(); assert.equal(w.status, 200); assert.match(w.html, /20 Railroad St/);
// Escaping: a saved address with markup is shown as text.
sqlite.prepare("UPDATE academy_settings SET payload=? WHERE id='website'").run(JSON.stringify({address: '<b>1 Main</b>', email: 'a@example.test'}));
assert.match((await page()).html, /&lt;b&gt;1 Main&lt;\/b&gt;/);

// The coach card stays for the coach's own profile page ("What families see").
assert.match(W.coachCard({name: 'Lee <Tran>', bio: 'One.\n\nTwo.', specialties: ['Takedowns']}), /<h3>Lee &lt;Tran&gt;<\/h3>[\s\S]*<li>Takedowns<\/li>[\s\S]*<p>One\.<\/p><p>Two\.<\/p>/);
assert.match(readFileSync('app/coach-profile/route.ts', 'utf8'), /COACH_CARD_CSS/);

console.log('Welcome page (#412): the team page, editor and API are gone and nothing links to them; the welcome page has the fixed welcome and the academy’s address and email (a saved one still wins, a damaged one falls back), no team section or names, escaped text, and the coach card stays for coach profiles.');
