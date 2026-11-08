// Issue #280: the toast helper (public/toast.js). It is inline-free browser JavaScript the typecheck skips, so it runs
// here against a small fake document: the region is made once with role=status, each call adds a toast that shows
// after a frame, hides after its time (or a tap) and is removed, at most three are on screen, and the Worker loads
// the script on every decorated page.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fakeDocument() {
  const timers = [];
  const el = tag => {
    const e = {tag, id: '', className: '', textContent: '', attrs: {}, children: [], parentNode: null, listeners: {}, offsetWidth: 10,
      setAttribute(n, v) { e.attrs[n] = String(v); }, getAttribute: n => e.attrs[n] ?? null,
      appendChild(c) { c.parentNode = e; e.children.push(c); return c; },
      removeChild(c) { e.children = e.children.filter(x => x !== c); c.parentNode = null; },
      addEventListener(type, fn) { (e.listeners[type] ||= []).push(fn); },
      fire(type) { for (const fn of e.listeners[type] || []) fn({type}); },
      classList: {add: c => { if (!e.has(c)) e.className = (e.className + ' ' + c).trim(); }, remove: c => { e.className = e.className.split(' ').filter(x => x !== c).join(' '); }, contains: c => e.has(c)},
      has: c => e.className.split(' ').includes(c)};
    return e;
  };
  const body = el('body');
  const document = {body, documentElement: el('html'), createElement: el, getElementById: id => body.children.find(c => c.id === id) || null};
  // A clock: a timer fires at the time it was set plus its delay, in order, including timers set while running.
  let now = 0;
  const window = {setTimeout: (fn, ms) => { timers.push({fn, at: now + ms}); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; }};
  const run = until => { for (;;) { const due = timers.filter(t => t.fn && t.at <= until).sort((a, b) => a.at - b.at)[0]; if (!due) break; now = due.at; const f = due.fn; due.fn = null; f(); } now = until; };
  return {document, window, body, run, timers};
}
const script = readFileSync('public/toast.js', 'utf8');
assert.doesNotMatch(script, /\son[a-z]+=|innerHTML|eval\(/, 'no inline handlers or markup from text: it fits the nonce script policy');

const {document, window, body, run, timers} = fakeDocument();
const ctx = vm.createContext({document, window, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, String});
vm.runInContext(script, ctx);
assert.equal(typeof ctx.window.swaToast, 'function');
assert.equal(body.children.length, 0, 'nothing is added to the page until the first toast');

const t1 = ctx.window.swaToast('Saved');
const region = document.getElementById('swa-toast');
assert.ok(region, 'the region is made on first use');
assert.equal(region.getAttribute('role'), 'status'); assert.equal(region.getAttribute('aria-live'), 'polite');
assert.equal(t1.tag, 'p'); assert.equal(t1.textContent, 'Saved'); assert.equal(t1.className, 'swa-toast show', 'shown right after it is on the page');
assert.equal(region.children[0], t1);
const t2 = ctx.window.swaToast('<b>Checked in</b>', {kind: 'ok', duration: 1000});
assert.equal(t2.textContent, '<b>Checked in</b>', 'text, never markup'); assert.ok(t2.has('ok'));
assert.equal(document.getElementById('swa-toast'), region, 'one region');
assert.equal(ctx.window.swaToast(null).textContent, '', 'nothing becomes an empty toast, not "null"');
assert.equal(region.children.length, 3);
ctx.window.swaToast('Four');
assert.equal(region.children.length, 3, 'at most three on screen; the oldest goes');
assert.ok(!region.children.includes(t1));

// Hiding: after its time a toast fades (.hide) and is removed when the transition ends, or after 400ms without one.
run(1000);
assert.ok(t2.has('hide') && !t2.has('show'), 'the short toast hides after its time');
assert.ok(region.children.includes(t2), 'still on the page while it fades');
t2.fire('transitionend');
assert.ok(!region.children.includes(t2), 'gone when the fade ends');
const t5 = region.children[region.children.length - 1];
t5.fire('click');
assert.ok(t5.has('hide'), 'a tap hides a toast early');
run(4000);
assert.ok(region.children.every(t => t.has('hide')), 'the default toasts hide after 4 seconds');
run(99999);
assert.equal(region.children.length, 0, 'removed by the fallback timer when no transition ends');
const dup = region; t5.hide(); assert.equal(dup.children.length, 0, 'hiding twice is harmless');

// The Worker loads it on every decorated page, before the stylesheet (lib/page-chrome.ts is checked in tests/page-chrome.mjs);
// the stylesheet places the region and animates the toasts, honouring reduced motion.
const css = readFileSync('public/savage.css', 'utf8');
assert.match(css, /html body #swa-toast\{position:fixed;[^}]*bottom:max\(var\(--swa-s-16\),env\(safe-area-inset-bottom,0px\)\)/, 'bottom of the screen on a phone');
assert.match(css, /@media \(min-width:900px\)\{html body #swa-toast\{left:auto;bottom:auto;top:calc\(64px \+ var\(--swa-s-16\)\);right:var\(--swa-s-24\)/, 'top right on a desktop');
assert.match(css, /html body \.swa-toast\{[^}]*opacity:0;transform:translateY\(8px\);transition:opacity \.18s ease-out,transform \.18s ease-out\}/, 'slides 8px and fades in');
assert.match(css, /html body \.swa-toast\.show\{opacity:1;transform:none\}/);
assert.match(css, /prefers-reduced-motion:reduce\)\{[^}]*\}html body \.swa-toast\{opacity:1;transform:none\}/, 'no slide for less motion');
console.log('Toast: one status region, text only, three at most, hides on time or tap, removed after the fade; placed and animated by the stylesheet');
