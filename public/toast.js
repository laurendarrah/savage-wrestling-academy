// One toast region for every page (issue #280). swaToast(text, {kind, duration}) adds a short message that slides in
// 8px and fades (bottom of the screen on a phone, top-right on a desktop; public/savage.css), waits, then fades out.
// It is read by screen readers through the region's role=status. Pages that write to a #status line can call this
// too; the region is created on first use, so a page needs nothing in its markup. Loaded by the Worker on every
// decorated page (lib/page-chrome.ts) with the response's script nonce where the page has one (issue #274).
(function () {
  var d = document, MAX = 3;
  function region() {
    var r = d.getElementById('swa-toast');
    if (!r) {
      r = d.createElement('div'); r.id = 'swa-toast'; r.setAttribute('role', 'status'); r.setAttribute('aria-live', 'polite');
      (d.body || d.documentElement).appendChild(r);
    }
    return r;
  }
  function remove(t) { if (t.parentNode) t.parentNode.removeChild(t); }
  function swaToast(text, opts) {
    opts = opts || {};
    var r = region(), t = d.createElement('p');
    t.className = 'swa-toast' + (opts.kind ? ' ' + opts.kind : '');
    t.textContent = text == null ? '' : String(text);
    while (r.children.length >= MAX) remove(r.children[0]);
    r.appendChild(t);
    // One frame on the page before .show, so the slide and fade run instead of jumping (reduced motion skips them).
    void t.offsetWidth;
    t.classList.add('show');
    var gone = false, timer;
    function hide() {
      if (gone) return; gone = true; clearTimeout(timer);
      t.classList.remove('show'); t.classList.add('hide');
      var done = function () { remove(t); };
      t.addEventListener('transitionend', done, {once: true});
      setTimeout(done, 400);
    }
    timer = setTimeout(hide, opts.duration || 4000);
    t.addEventListener('click', hide);
    t.hide = hide;
    return t;
  }
  window.swaToast = swaToast;
})();
