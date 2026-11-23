// One pay-period picker for the coach hours pages (issue #399): /coach-time and /timesheets. Coaches are paid twice a
// month (decided on #369): the 1st to the 15th ('YYYY-MM-1') and the 16th to the month's end ('YYYY-MM-2'). It looks and
// works like the month picker (public/month-picker.js), with the same markup and its own ids:
//   <div class="month-picker"><button type="button" class="month-step" id="prev" aria-label="Previous pay period">←</button>
//   <label class="month-pick"><span>Pay period</span><select id="period"></select></label>
//   <button type="button" class="month-step" id="next" aria-label="Next pay period">→</button></div>
// PeriodPicker.set(picker, period, {min, max}) fills the list with named periods around the one shown and turns the
// arrows off at the ends; PeriodPicker.wire(picker, go) calls go('YYYY-MM-1') for the arrows and the list.
// Period keys compare as text, like months, because months are always two digits.
(function (root) {
  const KEY = /^\d{4}-(0[1-9]|1[0-2])-[12]$/;
  const valid = key => KEY.test(String(key || ''));
  function shift(key, delta) {
    const index = (Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1) * 2 + (key.endsWith('-2') ? 1 : 0) + delta;
    const month = Math.floor(index / 2), y = Math.floor(month / 12), m = month % 12 + 1;
    return y + '-' + String(m).padStart(2, '0') + '-' + (index % 2 + 1);
  }
  const lastDay = key => new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7), 0)).getUTCDate();
  // "Nov 1–15, 2026", "Nov 16–30, 2026".
  function label(key) {
    const month = new Intl.DateTimeFormat('en-US', {month: 'short', timeZone: 'UTC'}).format(new Date(key.slice(0, 7) + '-15T12:00:00Z'));
    return month + ' ' + (key.endsWith('-1') ? '1–15' : '16–' + lastDay(key)) + ', ' + key.slice(0, 4);
  }
  // The period a date ('YYYY-MM-DD') falls in.
  const of = date => date.slice(0, 7) + (Number(date.slice(8, 10)) <= 15 ? '-1' : '-2');
  // Six months either side of the period shown, inside min and max.
  function options(key, min = '2020-01-1', max = '2100-12-2') {
    if (!valid(key)) return '';
    return Array.from({length: 25}, (_, i) => shift(key, i - 12)).filter(v => v >= min && v <= max)
      .map(v => '<option value="' + v + '"' + (v === key ? ' selected' : '') + '>' + label(v) + '</option>').join('');
  }
  function set(picker, key, {min = '2020-01-1', max = '2100-12-2'} = {}) {
    if (!valid(key)) return;
    picker.select.innerHTML = options(key, min, max);
    picker.select.value = key;
    picker.prev.disabled = shift(key, -1) < min;
    picker.next.disabled = shift(key, 1) > max;
  }
  function wire(picker, go) {
    picker.select.onchange = () => { if (valid(picker.select.value)) go(picker.select.value); };
    picker.prev.onclick = () => { if (valid(picker.select.value)) go(shift(picker.select.value, -1)); };
    picker.next.onclick = () => { if (valid(picker.select.value)) go(shift(picker.select.value, 1)); };
  }
  root.PeriodPicker = {shift, label, of, options, set, wire, valid};
  // The same look as the month picker, once per page.
  if (typeof document !== 'undefined' && document.head && document.createElement && !document.getElementById('month-picker-style')) {
    const style = document.createElement('style');
    style.id = 'month-picker-style';
    style.textContent = '.month-picker{display:flex;align-items:center;gap:8px;min-width:0;max-width:100%}'
      + 'html body .month-picker .month-step{flex:none;min-width:48px;min-height:46px;margin:0;padding:0 12px;font-family:var(--swa-body);font-size:20px;line-height:1}'
      + '.month-pick{display:block;flex:1 1 auto;min-width:0;margin:0}'
      + '.month-pick>span{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'
      + 'html body .month-pick select{display:block;width:100%;min-width:13ch;margin:0;font-weight:700}';
    document.head.appendChild(style);
  }
})(globalThis);
