// One month picker for the monthly pages (issue #232): /financials, /timesheets and /coach-time.
// Each page has the same markup, with its own ids, and loads this file before its own script:
//   <div class="month-picker"><button type="button" class="month-step" id="prev" aria-label="Previous month">←</button>
//   <label class="month-pick"><span>Month</span><select id="month"></select></label>
//   <button type="button" class="month-step" id="next" aria-label="Next month">→</button></div>
// MonthPicker.set(picker, month, {min, max}) fills the list with named months around the month shown and turns the
// arrows off at the ends; MonthPicker.wire(picker, go) calls go('YYYY-MM') for the arrows and the list.
// picker is {select, prev, next}: the three elements. Months are 'YYYY-MM' strings, so they compare as text.
(function (root) {
  const KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
  const valid = key => KEY.test(String(key || ''));
  function shift(key, delta) {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
  }
  function label(key) {
    return new Intl.DateTimeFormat('en-US', {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(new Date(key + '-01T12:00:00Z'));
  }
  // A year either side of the month shown, inside min and max.
  function options(key, min = '2020-01', max = '2100-12') {
    if (!valid(key)) return '';
    return Array.from({length: 25}, (_, i) => shift(key, i - 12)).filter(v => v >= min && v <= max)
      .map(v => '<option value="' + v + '"' + (v === key ? ' selected' : '') + '>' + label(v) + '</option>').join('');
  }
  function set(picker, key, {min = '2020-01', max = '2100-12'} = {}) {
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
  root.MonthPicker = {shift, label, options, set, wire};
  // The look, once per page: the two arrows either side of the list, on one line at any width.
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
