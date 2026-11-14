// Issue #286 (redesign Phase 3): the mat screen's page script, in a fake DOM (inline JavaScript is not typechecked).
// The session switcher opens on the session running or next and marks it; one panel is on screen and the others
// are in the page but hidden; a tab, the arrow keys and a search that only matches elsewhere change the panel; each
// row shows its state (Check in, checked in with Undo, Hold with Why?, cash due with Cash received); the detail is
// open only for a flagged wrestler; the dock's Scan shares the bar's handler; actions speak through swaToast when it
// is there and through #status when it is not; the row that just changed gets its .enter frame.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('app/roster/screen.html', 'utf8'), script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
const ny = new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
// The page reads New York's clock through Intl.DateTimeFormat(...).formatToParts; the harness holds it at 6:30 PM.
const nowMin = 18 * 60 + 30;
const FrozenIntl = {NumberFormat: Intl.NumberFormat, DateTimeFormat: class { constructor(l, o) { this.real = new Intl.DateTimeFormat(l, o); } formatToParts() { return [{type: 'hour', value: '18'}, {type: 'minute', value: '30'}]; } format(d) { return this.real.format(d); } }};
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const entry = (name, o = {}) => ({userId: 'u-' + name.split(' ')[0], wrestlerId: 'w-' + name.split(' ')[0], name, grade: '8', parentName: 'Pat', phone: '555-0100', email: null, sources: ['Member'], checkedInAt: null, checkedInBy: null,
  card: 'verified', cardExpires: '2099-08-31', cardNote: '', waiverSigned: true, exceptions: [], checkInBlocked: null, cash: null, allergies: 'None', emergencyName: 'Jo', emergencyPhone: '631-555-0199', ...o});
const sessions = () => [
  {key: 'live:fnl:' + ny, type: 'live', title: 'Friday Night Live', program: null, date: ny, start: hhmm(nowMin - 120), end: hhmm(nowMin - 60), checkedIn: 0, entries: [entry('Early Bird')]},
  {key: 'practice:Intermediate:' + ny + ':' + hhmm(nowMin - 10), type: 'practice', title: 'SWA Intermediate', program: 'Intermediate', date: ny, start: hhmm(nowMin - 10), end: hhmm(nowMin + 50), checkedIn: 1, entries: [
    entry('Sam Example', {allergies: 'Peanut allergy', cash: {bookingId: 'cb1', status: 'due', cents: 4000, orderId: null, collectedAt: null, collectedBy: null}, sources: ['Member', 'Pay at the academy']}),
    entry('Riley Two', {checkedInAt: new Date().toISOString(), sources: ['Scholarship']}),
    entry('Casey Morgan', {card: 'missing', checkInBlocked: 'Casey Morgan can\'t be checked in: there is no USA Wrestling card on file. Ask the family to update the card, or the owner to allow an exception.'}),
    entry('Jordan Avery')]},
  {key: 'practice:Advanced:' + ny + ':' + hhmm(nowMin + 60), type: 'practice', title: 'SWA Advance', program: 'Advanced', date: ny, start: hhmm(nowMin + 60), end: hhmm(nowMin + 150), checkedIn: 0, entries: []},
];

function page({role = 'coach', date = ny, today = ny, toast = null} = {}) {
  const nodes = new Map(), handlers = new Map(), calls = [];
  const el = id => { if (!nodes.has(id)) nodes.set(id, {id, value: '', textContent: '', innerHTML: '', hidden: false, href: '', style: {}, focus() {}, classList: {add() {}, remove() {}}}); return nodes.get(id); };
  // Elements with a data attribute in any rendered HTML, so the page's click handlers can be run.
  const all = sel => {
    const m = /^\[data-([a-z-]+)\]$/.exec(sel); if (!m) return [];
    const out = [];
    for (const node of nodes.values()) for (const x of String(node.innerHTML).matchAll(new RegExp(`<\\w+[^>]*data-${m[1]}="([^"]*)"[^>]*>`, 'g'))) {
      const key = m[1] + ':' + x[1], camel = m[1].replace(/-(\w)/g, (_, c) => c.toUpperCase());
      if (!handlers.has(key)) handlers.set(key, {dataset: {[camel]: x[1]}});
      out.push(handlers.get(key));
    }
    return out;
  };
  let data = {date, today, role, sessions: sessions()};
  const ctx = vm.createContext({document: {getElementById: el, querySelectorAll: all, querySelector: () => null, createElement: () => ({getContext: () => null})}, window: {addEventListener() {}}, navigator: {},
    location: {search: ''}, URLSearchParams, Date, Intl: FrozenIntl, JSON, Promise, Number, String, Math, confirm: () => true, prompt: () => 'x', console, ...(toast ? {swaToast: toast} : {}),
    fetch: async (url, o) => { const body = o?.body ? JSON.parse(o.body) : null; calls.push({url, body});
      if (body?.action === 'checkin') { const s = data.sessions.find(s => s.key === body.sessionKey), e = s.entries.find(e => e.userId === body.userId); e.checkedInAt = new Date().toISOString(); s.checkedIn++; }
      if (body?.action === 'cash') { for (const s of data.sessions) for (const e of s.entries) if (e.cash?.bookingId === body.bookingId) { e.cash = {...e.cash, status: 'paid', orderId: 'o1', collectedAt: new Date().toISOString(), collectedBy: 'Coach Dana'}; e.sources = ['Member', 'Walk-in paid']; } }
      return {ok: true, json: async () => structuredClone(data)}; }});
  vm.runInContext(script, ctx);
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
  const click = (attr, value) => { const h = all(`[data-${attr}]`).find(x => Object.values(x.dataset)[0] === value); assert.ok(h && h.onclick, `a [data-${attr}="${value}"] with a handler`); return h.onclick(); };
  return {el, ctx, calls, settle, click, run: s => vm.runInContext(s, ctx), data: () => data};
}
const panels = p => [...p.el('sessions').innerHTML.matchAll(/<section class="session" id="(s\d)" role="tabpanel" aria-labelledby="(tab\d)"( hidden)?>/g)].map(m => [m[1], m[2], !m[3]]);
const tabs = p => [...p.el('switcher').innerHTML.matchAll(/<button type="button" role="tab" class="seg" id="(tab\d)" aria-selected="(true|false)" aria-controls="(s\d)" tabindex="(0|-1)" data-session="(\d)"><b>([^<]+)<\/b><small>([\s\S]*?)<\/small><\/button>/g)].map(m => ({id: m[1], selected: m[2] === 'true', panel: m[3], tabindex: m[4], title: m[6], small: m[7]}));
const row = (p, name) => { const out = p.el('sessions').innerHTML, at = out.indexOf(name), next = [out.indexOf('<div class="row', at), out.indexOf('</section>', at)].filter(i => i > 0); return out.slice(out.lastIndexOf('<div class="row', at), Math.min(...next)); };

// ---------- The switcher: one tab per session, the running one open, the others' panels in the page but hidden ----------
{
  const p = page(); await p.settle();
  const t = tabs(p);
  assert.deepEqual(t.map(x => x.title), ['Friday Night Live', 'SWA Intermediate', 'SWA Advance']);
  assert.match(p.el('switcher').innerHTML, /^<div class="sessions__in" role="tablist" aria-label="Sessions">/);
  assert.deepEqual(t.map(x => [x.id, x.panel]), [['tab0', 's0'], ['tab1', 's1'], ['tab2', 's2']], 'each tab controls its panel');
  assert.deepEqual(t.map(x => x.selected), [false, true, false], 'opens on the session running now');
  assert.match(t[1].small, /^6:20 PM <span class="now">now<\/span> · 1 of 4 in$/); assert.doesNotMatch(t[0].small, /class="now"/); assert.doesNotMatch(t[2].small, /class="now"/, 'only one Now; the next session is marked only when nothing is running');
  assert.deepEqual(panels(p).map(x => x[2]), [false, true, false], 'one panel on screen');
  // With nothing running, the next session to start is marked and opened.
  {
    const n = page(); n.data().sessions[1].start = hhmm(nowMin - 60); n.data().sessions[1].end = hhmm(nowMin - 5); await n.settle();
    assert.deepEqual(tabs(n).map(x => [x.selected, /class="now">next</.test(x.small)]), [[false, false], [false, false], [true, true]]);
  }
  assert.equal(t.filter(x => x.tabindex === '0').length, 1, 'one tab in the tab order');
  assert.equal(p.el('status').textContent, '', 'no summary line: the count is on the tab and the title');
  // The session's header is the academy's practice box: the name, the time under it, the count beside them.
  assert.match(p.el('sessions').innerHTML, /<div class="session-head"><h2>SWA Intermediate<\/h2><p class="when">6:20 PM–7:20 PM<\/p><span class="count">1<small>\/ 4 in<\/small><\/span><\/div>/, 'the name, its time and the count in one box');
  assert.match(p.el('sessions').innerHTML, /<h2>Friday Night Live<\/h2><p class="when">4:30 PM–5:30 PM<\/p>[\s\S]*?<p class="muted meta">Separate purchase<\/p>/, 'what kind of session it is, under the box');
  assert.match(p.el('sessions').innerHTML, /<h2>SWA Advance<\/h2><p class="when">7:30 PM–9:00 PM<\/p>[\s\S]*?<p class="muted meta"><\/p>/, 'a plain practice has nothing to add (the empty line is hidden by the stylesheet)');
  assert.equal(p.el('sessionBar').hidden, false); assert.equal(p.el('scanStart').hidden, false); assert.equal(p.el('scanDock').hidden, false); assert.equal(p.el('searchBox').hidden, false);
  assert.match(p.el('sessions').innerHTML, /Friday Night Live[\s\S]*Early Bird/, 'the other sessions are still in the page (the walkthrough reads them)');
  // A tab click opens its panel and moves the tab order; the arrow keys walk the tabs.
  await p.click('session', '2');
  assert.deepEqual(tabs(p).map(x => x.selected), [false, false, true]); assert.deepEqual(panels(p).map(x => x[2]), [false, false, true]);
  assert.match(p.el('sessions').innerHTML, /<section class="session" id="s2"[^>]*><div class="session-head"><h2>SWA Advance<\/h2>[\s\S]*<div class="empty">[\s\S]*Nobody is registered for this session yet\./);
  let prevented = 0; p.el('switcher').onkeydown({key: 'ArrowRight', preventDefault() { prevented++; }});
  assert.deepEqual(tabs(p).map(x => x.selected), [true, false, false], 'ArrowRight wraps to the first tab'); assert.equal(prevented, 1);
  p.el('switcher').onkeydown({key: 'End', preventDefault() {}}); assert.equal(tabs(p)[2].selected, true);
  p.el('switcher').onkeydown({key: 'Tab', preventDefault() { prevented++; }}); assert.equal(prevented, 1, 'other keys are left alone');
  // A search that finds nobody in the open session opens the one where it finds someone.
  p.el('search').value = 'early'; p.el('search').oninput();
  assert.equal(tabs(p)[0].selected, true, 'the search jumped to Friday Night Live'); assert.match(panels(p).length ? p.el('sessions').innerHTML : '', /Early Bird/);
  p.el('search').value = 'nobody'; p.el('search').oninput();
  assert.match(p.el('sessions').innerHTML, /No wrestler matches that name\./);
  p.el('search').value = '';
  // Another date for the owner: no Now, the first session opens, and the date and home controls follow the role.
  const o = page({role: 'owner', date: '2026-12-01', today: ny}); await o.settle();
  assert.doesNotMatch(o.el('switcher').innerHTML, /class="now"/, 'another day has no now'); assert.equal(tabs(o)[0].selected, true);
  assert.equal(o.el('dateLabel').hidden, false); assert.equal(o.el('home').hidden, true);
  assert.equal(p.el('dateLabel').hidden, true); assert.equal(p.el('home').hidden, false); assert.equal(p.el('home').textContent, '← Coach home');
}

// ---------- Rows: each state, the flag and the detail ----------
{
  const p = page(); await p.settle();
  const jordan = row(p, 'Jordan Avery'), sam = row(p, 'Sam Example'), riley = row(p, 'Riley Two'), casey = row(p, 'Casey Morgan');
  assert.match(jordan, /^<div class="row" data-row="u-Jordan\|w-Jordan"><div class="who"><div class="name"><strong>Jordan Avery<\/strong><small>Grade 8<\/small><\/div>/);
  assert.match(jordan, /<div class="state"><span class="badge ok">Member<\/span><span class="badge verified">Card <span aria-hidden="true">✓<\/span><span class="vh">verified<\/span><\/span><\/div>/, 'the state line in words');
  assert.match(jordan, /<div class="actions"><button class="primary big" type="button" data-checkin="1:3">Check in<\/button><\/div>/, 'one 56px Check in');
  assert.match(jordan, /<details class="detail"><summary>Contact and notes<\/summary><div class="detail__body"><div><span class="lbl">Parent<\/span>Pat · <a href="tel:555-0100">555-0100<\/a><\/div><div class="safety">/, 'the detail is folded with no flag');
  assert.doesNotMatch(jordan, /class="flag"|@/);
  // Sam: the allergy flag opens the detail; cash due is amber on the state line with Cash received under Check in.
  assert.match(sam, /<span class="flag"><svg[^>]*>[\s\S]*?<\/svg>Allergy<\/span>/); assert.match(sam, /<details class="detail" open>/);
  assert.match(sam, /<span class="badge ok">Member<\/span><span class="badge due">\$40\.00 cash due<\/span><span class="badge verified">/);
  assert.match(sam, /<button class="primary big" type="button" data-checkin="1:0">Check in<\/button><button class="cash" type="button" data-cash="1:0">Cash received<\/button>/);
  assert.match(sam, /<span class="medical"><strong>Allergies or medical notes:<\/strong> Peanut allergy<\/span>/);
  // Riley: checked in, the lighter surface, a quiet Undo.
  assert.match(riley, /^<div class="row done"/); assert.match(riley, /<span class="in"><svg[^>]*>[\s\S]*?<\/svg>Checked in \d{1,2}:\d{2} [AP]M<\/span><button type="button" class="quiet" data-undo="1:1">Undo<\/button>/);
  // Casey: held, the reason behind Why?, a disabled Hold that points at it.
  assert.match(casey, /^<div class="row card-problem hold"/); assert.match(casey, /<span class="badge warn">No USA Wrestling card<\/span>/);
  assert.match(casey, /<details class="why"><summary>Why\?<\/summary><p class="block-reason" id="why1-2">Casey Morgan can&#39;t be checked in: there is no USA Wrestling card on file\. Ask the family to update the card, or the owner to allow an exception\.<\/p><\/details>/);
  assert.match(casey, /<button class="blocked" type="button" disabled aria-describedby="why1-2">Hold<\/button>/); assert.doesNotMatch(casey, /data-checkin/);
  assert.match(p.el('sessions').innerHTML, /<p class="muted meta">1 can’t be checked in until their USA Wrestling card is sorted out · 1 to pay at the academy \(\$40\.00 due\)<\/p>/);
  p.ctx.s = {type: 'event', entries: []}; assert.equal(p.run('metaLine(s)'), 'Camp, clinic or event');
}

// ---------- Nothing scheduled: one sentence, and nothing that has no use (the tab bar, Scan, the search) ----------
{
  for (const [role, text] of [['coach', 'Nothing is on the mat for your programs today.'], ['owner', 'No practices, camps or sessions are scheduled for this date.']]) {
    const p = page({role}); p.data().sessions = []; await p.settle();
    assert.match(p.el('sessions').innerHTML, new RegExp('^<div class="empty"><svg[^>]*>[\\s\\S]*?</svg><p>' + text.replace(/\./g, '\\.') + '</p></div>$'), role);
    assert.equal(p.el('status').textContent, '', 'said once, in the empty state, not also on the status line');
    assert.equal(p.el('switcher').innerHTML, ''); assert.equal(p.el('sessionBar').hidden, true, 'no empty tab bar');
    assert.equal(p.el('scanStart').hidden, true); assert.equal(p.el('scanDock').hidden, true); assert.equal(p.el('searchBox').hidden, true);
  }
}

// ---------- Actions: the toast when it is there, the status line when it is not; the changed row's .enter frame ----------
{
  const toasts = [];
  const p = page({toast: (text, opts) => { toasts.push([text, opts.kind]); }}); await p.settle();
  let entered = [];
  p.ctx.document.querySelector = sel => ({classList: {add: c => entered.push([sel, c]), remove: c => entered.push([sel, '-' + c])}, offsetWidth: 1});
  await p.click('checkin', '1:3'); await p.settle();
  assert.deepEqual(p.calls.at(-1).body, {action: 'checkin', date: ny, sessionKey: p.data().sessions[1].key, userId: 'u-Jordan', wrestlerId: 'w-Jordan'}, 'the same check-in write');
  assert.deepEqual(toasts, [['Jordan Avery checked in.', 'ok']]);
  assert.equal(p.el('status').textContent, '', 'the toast speaks, not the status line');
  assert.match(row(p, 'Jordan Avery'), /^<div class="row done"/);
  assert.deepEqual(entered, [['[data-row="u-Jordan|w-Jordan"]', 'enter'], ['[data-row="u-Jordan|w-Jordan"]', '-enter']], 'the row that changed starts from the plain surface and settles (120ms in the stylesheet)');
  await p.click('cash', '1:0'); await p.settle();
  assert.deepEqual(p.calls.at(-1).body, {action: 'cash', date: ny, bookingId: 'cb1'}, 'the same cash write');
  assert.equal(toasts.at(-1)[0], 'Cash received: $40.00 for Sam Example. It now counts as paid.');
  assert.match(row(p, 'Sam Example'), /<span class="badge ok">Cash \$40\.00<\/span><span class="received">Received by Coach Dana · \d{1,2}:\d{2} [AP]M<\/span>[\s\S]*<span class="muted small">Only the owner can undo cash<\/span>/);
  // Without the helper, the status line says it.
  const q = page(); await q.settle(); await q.click('checkin', '1:3'); await q.settle();
  assert.equal(q.el('status').textContent, 'Jordan Avery checked in.');
}

// ---------- The markup around the script: the bar, the dock, the skeleton, the folded explanation ----------
{
  assert.match(html, /<div class="mat-bar"><div class="mat-bar__in"><a id="home" class="swa-back" href="\/">← Back<\/a><h1>Check-in<\/h1><button type="button" id="scanStart" class="scan">/);
  assert.match(html, /<div class="dock"><div class="dock__in"><button type="button" id="scanDock" class="primary big">Scan a pass<\/button><\/div><\/div>/, 'Scan a pass at the thumb');
  assert.match(script, /\$\('scanStart'\)\.onclick=startScan;\$\('scanDock'\)\.onclick=startScan;/, 'both Scan buttons open the same camera flow');
  assert.match(html, /<div class="sessions" id="sessionBar"><div id="switcher"><div class="sessions__in" aria-hidden="true"><span class="skeleton"><\/span>/, 'skeleton tabs while loading');
  // The header box and the phone row (design pass): a thin outline with the red bar on the left; on a phone the name
  // and the button share the first line and the state runs the full width under them, without dots.
  assert.match(html, /body\[data-swa-page="\/roster"\] \.session-head\{[^}]*border:1px solid var\(--m-line-2\);border-left:4px solid var\(--swa-red\);/);
  assert.match(html, /body\[data-swa-page="\/roster"\] \.row\{grid-template-areas:"name actions" "state state" "why why" "detail detail";/);
  assert.match(html, /body\[data-swa-page="\/roster"\] \.row \.who\{display:contents\}/); assert.match(html, /body\[data-swa-page="\/roster"\] \.row \.state>\*:not\(:last-child\)::after\{content:none\}/);
  assert.match(html, /\.row details\.detail>summary\{[^}]*font-size:var\(--swa-t-15\);[^}]*min-height:44px\}/, 'Contact and notes is readable and a full tap target');
  assert.match(html, /<div id="sessions"><div class="list" aria-hidden="true"><span class="skeleton row"><\/span>/, 'skeleton rows while loading');
  assert.match(html, /<details class="more"><summary aria-label="More actions">⋯<\/summary><div class="menu"><button id="refresh" type="button" class="quiet">Refresh<\/button><button type="button" id="printRoster" class="quiet">Print<\/button><\/div><\/details>/, 'Refresh and Print are quiet actions in a menu');
  assert.match(html, /<details class="how"><summary>How this works<\/summary><p>Wrestlers listed here have a paid membership/, 'the explanation is folded, not gone');
  // The dark set for a coach, the light set inside the owner shell, and the motion in the stylesheet.
  assert.match(html, /body\[data-swa-page="\/roster"\]:not\(\[data-swa-shell\]\)\{background:var\(--swa-dark-0\);color:var\(--swa-dark-text\);/);
  assert.match(html, /body\[data-swa-page="\/roster"\]:not\(\[data-swa-shell\]\) \.swa-bar\{display:none\}/, 'the compact bar replaces the site bar at the mat');
  assert.match(html, /body\[data-swa-page="\/roster"\] \.row\{[^}]*transition:background-color \.12s ease-out,border-color \.12s ease-out\}/);
  assert.match(html, /body\[data-swa-page="\/roster"\] \.row\.done\.enter\{background:var\(--m-surface\);border-color:var\(--m-line\)\}/);
  assert.doesNotMatch(html, /data-swa-shell=|class="swa-bar"/, 'nothing that would make the Worker skip decorating the page');
  assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/, 'no inline handlers: the nonce policy stays');
}
console.log('Mat screen: the session switcher opens on the running session and moves by tab, key and search; every row state renders; actions toast (or write #status) and the changed row gets its .enter frame; the dock shares the scan flow.');
