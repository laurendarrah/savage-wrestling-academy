// Clock in and out (issue #193), shared by coach home and the coach's hours page (/coach-time). Big buttons for a phone.
// Needs /hours-text.js on the page first.
// Any element with data-coach-clock becomes the clock card. After a change it fires a "coachclock" event on document so
// the page around it can refresh. Pay covers the scheduled practice time only (#197 Q4); the card says so.
window.CoachClock = (() => {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const clock = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? (+m[1] % 12 || 12) + ':' + m[2] + ' ' + (+m[1] < 12 ? 'AM' : 'PM') : ''; };
  // Durations come from the shared formatter (public/hours-text.js, loaded first): "1 h 2 min", never "62 min".
  const span = m => hoursText(m);
  const ROLES = [['head', 'Head coach'], ['assistant', 'Assistant coach']];
  const CSS = `[data-coach-clock] .cc-role{display:grid;grid-template-columns:1fr 1fr;gap:8px;border:0;padding:0;margin:14px 0 6px;min-width:0}
[data-coach-clock] .cc-role legend{font-weight:700;margin:0 0 8px;padding:0}
[data-coach-clock] .cc-role button{min-height:56px;width:100%}
[data-coach-clock] .cc-role button[aria-pressed=true]{background:var(--swa-ink,#111113);color:#fff;border-color:var(--swa-ink,#111113)}
[data-coach-clock] .cc-big{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;width:100%;min-height:76px;padding:12px 20px;margin:10px 0 0;font-size:24px;text-align:left}
[data-coach-clock] .cc-big small{font-family:var(--swa-body,Arial,sans-serif);font-size:16px;font-weight:600;letter-spacing:0;text-transform:none;opacity:.92}
[data-coach-clock] .cc-other{width:100%;margin:10px 0 0;min-height:56px}
[data-coach-clock] .cc-on{border-left:4px solid var(--swa-red,#C4222C);padding:4px 0 4px 16px;margin:8px 0 0}
[data-coach-clock] .cc-eyebrow{margin:0;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--swa-red,#C4222C)}
[data-coach-clock] .cc-since{margin:4px 0;font-family:var(--swa-display,Arial,sans-serif);font-weight:800;font-size:clamp(36px,9vw,52px);line-height:1;text-transform:uppercase}
[data-coach-clock] .cc-what{margin:0;font-weight:600}
[data-coach-clock] .cc-note,[data-coach-clock] .cc-foot{margin:12px 0 0;font-size:15px;color:var(--swa-muted,#55585F)}
[data-coach-clock] .cc-status{margin:10px 0 0;font-weight:700}[data-coach-clock] .cc-status:empty{display:none}`;
  let duty = null;
  const roots = [];

  // The card for one state of the clock. Pure: it only builds HTML from the /api/coach-time reply.
  function html(d, role, opts = {}) {
    const title = `<h2 id="${esc(opts.titleId || 'clockTitle')}">${d && d.open ? 'On the clock' : 'Clock in'}</h2>`;
    const foot = (opts.link === false ? '' : '<a href="/coach-time">Your hours and time off →</a>') + (d && d.totals ? `${opts.link === false ? '' : ' · '}${esc(d.monthLabel)}: ${d.totals.shifts} shift${d.totals.shifts === 1 ? '' : 's'}, ${span(d.totals.minutes)} paid so far` : '');
    if (!d) return title + '<p class="muted">Loading your clock…</p>';
    if (d.open) {
      const o = d.open, since = Date.parse(o.clockIn), now = opts.now ?? Date.now();
      return title + `<div class="cc-on"><p class="cc-eyebrow">Clocked in</p><p class="cc-since">Since ${esc(clock(o.inTime))}</p>`
        + `<p class="cc-what">${o.session ? esc(o.session.title) + ' · ' + esc(clock(o.session.start)) + '–' + esc(clock(o.session.end)) : 'No scheduled practice'} · ${esc(o.dutyLabel)} · ${esc(span((now - since) / 60000))} so far</p></div>`
        + `<button type="button" class="primary cc-big" data-cc="out" data-id="${esc(o.id)}">Clock out<small>Tap when you leave the mat</small></button>`
        + `<p class="cc-note">Pay covers the scheduled practice time${o.session ? ' (' + esc(clock(o.session.start)) + '–' + esc(clock(o.session.end)) + ')' : ''}, not time before or after it.</p>`
        + '<p class="cc-status" role="status" aria-live="polite"></p>' + (foot ? `<p class="cc-foot">${foot}</p>` : '');
    }
    const choices = d.choices || [], first = d.suggested || (choices[0] && choices[0].key);
    const roles = `<fieldset class="cc-role"><legend>You are coaching as</legend>${ROLES.map(([k, n]) => `<button type="button" data-duty="${k}" aria-pressed="${role === k}">${n}</button>`).join('')}</fieldset>`;
    const list = [...choices].sort((a, b) => (b.key === first) - (a.key === first)).map(c =>
      `<button type="button" class="cc-big${c.key === first ? ' primary' : ''}" data-cc="in" data-session="${esc(c.key)}">Clock in<small>${esc(c.title)} · ${esc(clock(c.start))}–${esc(clock(c.end))}</small></button>`).join('');
    return title + (choices.length ? '<p class="muted">Tap your practice when you start. You can fix a time later if you forget.</p>' : '<p class="muted">Nothing is on the schedule for your programs today.</p>')
      + roles + list
      + `<button type="button" class="cc-other" data-cc="in" data-session="">Clock in without a practice</button>`
      + '<p class="cc-note">Time without a scheduled practice is paid only if the academy sets it.</p>'
      + '<p class="cc-status" role="status" aria-live="polite"></p>' + (foot ? `<p class="cc-foot">${foot}</p>` : '');
  }
  // What to send for a tap, or the reason it cannot be sent yet.
  function action(kind, el, role) {
    if (kind === 'out') return {body: {action: 'clock-out', id: el.dataset.id}, done: 'Clocked out.'};
    if (!role) return {error: 'Choose Head coach or Assistant coach first.'};
    return {body: {action: 'clock-in', duty: role, session: el.dataset.session || null}, done: 'Clocked in.'};
  }
  async function call(body) {
    const r = await fetch('/api/coach-time', body ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {cache: 'no-store'});
    const d = await r.json();
    if (!r.ok) throw Error(d.error || 'Something went wrong. Please try again.');
    return d;
  }
  function render(root) {
    root.innerHTML = html(root._data, duty, {titleId: root.id ? root.id + 'Title' : 'clockTitle', link: root.dataset.link !== 'off'});
    const status = root.querySelector('.cc-status'), say = t => { if (status) status.textContent = t; };
    root.querySelectorAll('[data-duty]').forEach(b => b.onclick = () => { duty = b.dataset.duty; roots.forEach(render); });
    root.querySelectorAll('[data-cc]').forEach(b => b.onclick = async () => {
      const a = action(b.dataset.cc, b, duty);
      if (a.error) return say(a.error);
      b.disabled = true;
      try { await call(a.body); await refresh(); document.dispatchEvent(new Event('coachclock')); roots.forEach(r => { const s = r.querySelector('.cc-status'); if (s) s.textContent = a.done; }); }
      catch (e) { b.disabled = false; say(e.message); }
    });
  }
  async function refresh() {
    try { const d = await call(); if (duty === null && d.lastDuty) duty = d.lastDuty; roots.forEach(r => { r._data = d; render(r); }); }
    catch (e) { roots.forEach(r => { r.innerHTML = html(null) ; const p = r.querySelector('p'); if (p) p.textContent = 'Your clock could not be loaded. Refresh the page to try again.'; }); }
  }
  function start() {
    document.querySelectorAll('[data-coach-clock]').forEach(r => roots.push(r));
    if (!roots.length) return;
    if (!document.getElementById('coach-clock-css')) { const s = document.createElement('style'); s.id = 'coach-clock-css'; s.textContent = CSS; document.head.appendChild(s); }
    roots.forEach(render); refresh();
    if (typeof setInterval === 'function') setInterval(() => roots.forEach(r => { if (r._data && r._data.open) render(r); }), 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  return {html, action, refresh, span};
})();
