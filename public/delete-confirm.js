// Delete after typing DELETE (issue #388): the owner clicks Delete, reads what will happen, types DELETE, then confirms. Used on
// pages where test data is cleaned up for good. The server checks the typed word too (lib/delete-confirm.ts), so
// this box is the way to it, not the guard.
//
//   SwaDelete.open(box, {warning: 'What happens, in plain words.', label: 'Delete for good', run: async typed => {…}})
//
// `box` is an empty element on the page. `run` receives the typed word and throws an Error with a message to show.
(function () {
  var matches = function (v) { return String(v == null ? '' : v).trim().toLowerCase() === 'delete'; };
  function close(box) { box.hidden = true; box.innerHTML = ''; }
  function open(box, opts) {
    box.hidden = false;
    box.innerHTML = '<p class="del-warn"></p><label class="del-label">Type DELETE to confirm<input class="del-input" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20"></label>'
      + '<div class="del-row"><button type="button" class="danger del-go" disabled>Delete for good</button><button type="button" class="quiet del-cancel">Cancel</button></div><p class="del-note" role="status" aria-live="polite"></p>';
    var q = function (s) { return box.querySelector(s); }, input = q('.del-input'), go = q('.del-go'), note = q('.del-note');
    q('.del-warn').textContent = opts.warning;
    if (opts.label) go.textContent = opts.label;
    go.disabled = true;
    input.oninput = function () { go.disabled = !matches(input.value); };
    input.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); if (!go.disabled) go.onclick(); } else if (e.key === 'Escape') close(box); };
    q('.del-cancel').onclick = function () { close(box); };
    go.onclick = async function () {
      if (!matches(input.value)) return;
      go.disabled = true; input.disabled = true; note.textContent = 'Deleting…';
      try { await opts.run(input.value.trim()); }
      catch (e) { note.textContent = e && e.message ? e.message : 'That could not be deleted. Try again.'; go.disabled = false; input.disabled = false; }
    };
    if (input.focus) input.focus();
  }
  window.SwaDelete = {open: open, close: close, matches: matches};
})();
