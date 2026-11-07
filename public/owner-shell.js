// The owner shell's behaviour (issue #261): the phone menu drawer, the Account menu, sign-out, the current item on the
// dashboard's sections, and focus after moving between owner pages. The sidebar and header themselves are drawn by the
// Worker (lib/owner-shell.ts), so a page looks right before this runs; tests/owner-shell.mjs runs this file.
(function () {
  var d = document, w = window;
  var byId = function (id) { return d.getElementById(id); };
  var side = byId('swa-os-side'), menu = byId('swa-os-menu'), scrim = byId('swa-os-scrim'), close = byId('swa-os-close'), account = byId('swa-os-account');
  if (!side || !menu) return;
  var work = d.querySelector('.os-work'), store = function (fn) { try { return fn(w.sessionStorage); } catch (e) { return null; } };
  var FOCUSABLE = 'a[href],button:not([disabled]),summary,input,select,textarea,[tabindex]:not([tabindex="-1"])';

  // ---------- The drawer (phones and small tablets) ----------
  function isOpen() { return d.body.classList.contains('os-open'); }
  function openDrawer() {
    d.body.classList.add('os-open');
    if (scrim) scrim.hidden = false;
    menu.setAttribute('aria-expanded', 'true');
    side.setAttribute('role', 'dialog'); side.setAttribute('aria-modal', 'true'); side.setAttribute('aria-label', 'Owner menu');
    if (work) work.inert = true;
    // Focus goes to Close menu without scrolling the list, which opens at the current page.
    (close || side).focus({preventScroll: true});
  }
  function closeDrawer(returnFocus) {
    if (!isOpen()) return false;
    d.body.classList.remove('os-open');
    if (scrim) scrim.hidden = true;
    menu.setAttribute('aria-expanded', 'false');
    side.removeAttribute('role'); side.removeAttribute('aria-modal'); side.removeAttribute('aria-label');
    if (work) work.inert = false;
    if (returnFocus) menu.focus();
    return true;
  }
  // Tab and Shift+Tab stay inside the open drawer.
  function trap(e) {
    var items = Array.prototype.filter.call(side.querySelectorAll(FOCUSABLE), function (el) { return el.getClientRects().length > 0; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (d.activeElement === first || !side.contains(d.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (d.activeElement === last || !side.contains(d.activeElement))) { e.preventDefault(); first.focus(); }
  }
  menu.addEventListener('click', function () { if (isOpen()) closeDrawer(true); else openDrawer(); });
  if (close) close.addEventListener('click', function () { closeDrawer(true); });
  if (scrim) scrim.addEventListener('click', function () { closeDrawer(true); });
  // A wider window shows the sidebar again, so the drawer has nothing left to cover.
  var wide = w.matchMedia ? w.matchMedia('(min-width: 901px)') : null;
  if (wide && wide.addEventListener) wide.addEventListener('change', function (e) { if (e.matches) closeDrawer(false); });

  // ---------- The Account menu ----------
  function closeAccount(returnFocus) {
    if (!account || !account.open) return false;
    account.open = false;
    if (returnFocus) { var s = account.querySelector('summary'); if (s) s.focus(); }
    return true;
  }

  d.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (!closeAccount(true)) closeDrawer(true); }
    else if (e.key === 'Tab' && isOpen()) trap(e);
  });

  // ---------- Where the owner is ----------
  // The dashboard's sections share one page, so the current item follows the #section in the address.
  function mark() {
    var nav = byId('swa-os-nav');
    if (!nav || w.location.pathname !== '/') return;
    var hash = String(w.location.hash || '').split('?')[0].replace(/[^\w#-]/g, '');
    var target = (hash.length > 1 && nav.querySelector('a[href="/' + hash + '"]')) || nav.querySelector('a[href="/"]');
    if (!target) return;
    Array.prototype.forEach.call(nav.querySelectorAll('[aria-current="page"]'), function (a) { if (a !== target) a.removeAttribute('aria-current'); });
    target.setAttribute('aria-current', 'page');
    var fold = target.closest('details'); if (fold) fold.open = true;
    var crumb = byId('swa-os-crumb'), list = target.closest('ul'), group = list && list.getAttribute('aria-labelledby');
    if (crumb) crumb.textContent = (group && byId(group) ? byId(group).textContent + ' / ' : '') + target.textContent;
  }
  // The first visible heading of the page's main content takes focus, so a screen reader starts at the new content.
  // The dashboard draws its heading after its data loads, so this waits for it a little while.
  function focusMain() {
    var find = function () {
      return Array.prototype.find.call(d.querySelectorAll('main h1'), function (h) { return h.getClientRects().length > 0; });
    };
    var go = function (h) { if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1'); h.focus({preventScroll: true}); };
    var h = find();
    if (h) { go(h); return; }
    var main = d.querySelector('main');
    if (!main || !w.MutationObserver) return;
    var seen = new w.MutationObserver(function () { var h = find(); if (h) { seen.disconnect(); go(h); } });
    seen.observe(main, {childList: true, subtree: true});
    setTimeout(function () { seen.disconnect(); }, 5000);
  }

  // A shell link that opens another page asks that page to put focus on its heading.
  function opensAnotherPage(a) {
    if (a.origin !== w.location.origin) return false;
    return a.pathname + a.search !== w.location.pathname + w.location.search || (!a.hash && !!w.location.hash);
  }
  d.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    if (account && account.open && !account.contains(t)) account.open = false;
    var a = t.closest('a[href]');
    if (t.closest('[data-os-signout]')) { signOut(t.closest('[data-os-signout]')); return; }
    if (!a || !t.closest('.os-side, .os-top')) return;
    if (a.classList.contains('os-skip')) return;
    if (side.contains(a)) closeDrawer(false);
    if (account && account.contains(a)) account.open = false;
    if (!e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && opensAnotherPage(a)) store(function (s) { s.setItem('swa-os-focus', '1'); });
  });
  var skip = d.querySelector('.os-skip');
  if (skip) skip.addEventListener('click', function (e) { if (d.querySelector('main')) { e.preventDefault(); focusMain(); } });

  // ---------- Sign out ----------
  function signOut(button) {
    button.disabled = true;
    w.fetch('/api/auth', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'logout'})})
      .then(function (r) { if (!r.ok) throw new Error(); w.location.href = '/login'; })
      .catch(function () { button.disabled = false; button.textContent = 'Sign-out did not finish. Try again.'; });
  }

  // The sidebar opens where it was left on the last owner page (lib/owner-shell.ts puts it back before it is drawn).
  w.addEventListener('pagehide', function () { store(function (s) { s.setItem('swa-os-scroll', String(side.scrollTop)); }); });
  w.addEventListener('hashchange', mark);
  w.addEventListener('popstate', mark);
  if (store(function (s) { var on = s.getItem('swa-os-focus'); s.removeItem('swa-os-focus'); return on; })) focusMain();

  w.SwaOwnerShell = {mark: mark, focusMain: focusMain, openDrawer: openDrawer, closeDrawer: closeDrawer, closeAccount: closeAccount};
})();
