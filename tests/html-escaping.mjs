// Issue #274: every value written into a page with innerHTML goes through esc(). The pages are server-rendered HTML
// with inline scripts (not typechecked), so this scans each page's script: for every statement that writes innerHTML,
// each value interpolated into the HTML (`${value}` or '…'+value+'…') must be escaped, either right there with esc(…),
// or inside a function on the page (or a shared public script) that escapes what it renders, or be a value that
// cannot carry markup: a number or count, a date or money formatter, a URL-encoded id, a fixed word chosen with ?:,
// a lookup in a table of fixed labels, or an id the page made itself. Anything else fails here with the file, line
// and expression, so a new renderer either escapes its data or is listed below with the reason it is safe.
//
// This is a static check on the source, not a browser: it reads the statement an innerHTML write belongs to and the
// definitions of the page functions it calls, one level at a time.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync, existsSync} from 'node:fs';
import {join} from 'node:path';

const files = [];
const walk = dir => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.html')) files.push(p); } };
walk('app');

// Formatters that return text with no HTML meaning: numbers, dates, times, money, counts, URL-encoded ids, option lists
// built from fixed labels, and the QR drawing (which strips markup characters from its label).
const SAFE_CALLS = new Set(['esc', 'encodeURIComponent', 'Number', 'String', 'Math.round', 'Math.max', 'Math.min', 'Math.abs', 'Math.floor', 'Math.ceil', 'parseInt', 'parseFloat',
  'money', 'cents', 'dollars', 'minus', 'usd', 'clock', 'clockTime', 'clockRange', 'range', 'dayDate', 'dayName', 'fullDate', 'longDate', 'shortDate', 'dayTime', 'when', 'whenDate', 'time', 'timeOf',
  'dateLabel', 'monthName', 'monthLabel', 'hours', 'hoursText', 'minutesText', 'duration', 'eventWhen', 'spotsText', 'namedMonthOptions', 'monthOptions', 'gradeLabel', 'gradeName', 'plural',
  'seasonLabel', 'window.qrSvg', 'qrSvg']);
// Property names whose values are numbers or counts from the server, or short ids and fixed words the server validates
// (ids are letters, digits and dashes; dates are YYYY-MM-DD; statuses, kinds and roles come from fixed lists).
const NUMERIC = /^[\w.]+\.(length|upcomingLessons|openings|shifts|cents|count|total|ready|n|made|paid|minutes|hours|spots|spotsLeft|seatsLeft|capacity|lessons|wrestlers|unread|opened|recipients|emailed|failed|checkedIn|amount|pct|percent|revision|year|month|day|grade|discount_cents|discountCents|amount_cents|amountCents|base_cents|payments_made|payments_total|refundedCents|feeCents|netCents|splitPct|weeks)$/;
const ENUMERATED = /^[\w.]+\.(id|date|key|kind|type|status|state|role|from|program|sessionKey|wrestlerId|userId|orderId|bookingId|code|href|season)$/;
const SAFE_EXPR = [
  /^\d+(\.\d+)?$/, /^(true|false|null|''|""|``)$/,
  /^[\w.]+\.length(\s*[-+*/]\s*\d+)?$/, /^[\w.]+\s*[-+*/]\s*\d+$/, /^\d+\s*[-+*/]\s*[\w.]+$/,
  /^(i|j|k|n|index|idx|si|ei|i0|at|count|total|page|step|pct|w|offset|col|row)(\s*[-+]\s*\d+)?$/,
  /^(id|date|day|key|kind|f|g|t|v|program|status|state|month|year|hour|minute|label|d|m)$/,   // loop variables over fixed lists, dates and keys
  /^[^?:]+(===|!==|==|!=|>=|<=)[^?:]+$/,   // a comparison renders as true or false
  /^new Intl\.DateTimeFormat\(/, /^new Date\(/,
  NUMERIC, ENUMERATED,
];
const literalOnly = s => /^\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`$]*`|\d+)\s*$/.test(s);

// From `from`, the text up to the end of the statement: a ; or , or newline outside brackets and strings, or the
// bracket that closes an enclosing one. Brackets opened inside are followed to their close, over lines.
function statementFrom(text, from, stopAtComma = true) {
  let depth = 0, s = null, k = from;
  for (; k < text.length; k++) {
    const c = text[k];
    if (s) { if (c === '\\') k++; else if (c === s) s = null; continue; }
    if (c === "'" || c === '"' || c === '`') s = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    else if (depth === 0 && (c === ';' || (stopAtComma && c === ','))) break;
    else if (depth === 0 && c === '\n') {
      // A statement continues on the next line when that line starts with an operator (a ternary's : or ?, +, .).
      const next = text.slice(k + 1).match(/^\s*(\S)/)?.[1];
      if (!next || !':?+.|&'.includes(next)) break;
    }
  }
  return text.slice(from, k);
}
// Every function and variable defined in a script, with the text of its definition (balanced over lines).
function definitions(script) {
  const out = new Map();
  for (const m of script.matchAll(/(?:function\s+([A-Za-z_$][\w$]*)\s*\(|\b([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|\b([A-Za-z_$][\w$]*)\s*=\s*(?!=))/g)) {
    const name = m[1] || m[2] || m[3];
    const body = statementFrom(script, m.index, !m[1]);
    if (!out.has(name)) out.set(name, []);
    out.get(name).push({body, fn: !!(m[1] || m[2])});
  }
  return out;
}
const asFunction = (defs, name) => defs.get(name)?.filter(d => d.fn).sort((a, b) => b.body.length - a.body.length)[0]?.body;
const asVariable = (defs, name) => defs.get(name)?.filter(d => !d.fn).sort((a, b) => b.body.length - a.body.length)[0]?.body;

// The interpolated expressions in a piece of script that builds HTML: ${…} in template literals, and the pieces
// between string literals joined with +.
function interpolations(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '$' && text[i + 1] === '{') {
      let depth = 1, j = i + 2, s = null;
      for (; j < text.length && depth; j++) {
        const c = text[j];
        if (s) { if (c === '\\') j++; else if (c === s) s = null; continue; }
        if (c === "'" || c === '"' || c === '`') s = c;
        else if (c === '{') depth++;
        else if (c === '}') depth--;
      }
      out.push(text.slice(i + 2, j - 1));
      i = j - 1;
    }
  }
  return out.map(e => e.trim()).filter(Boolean);
}

// Splits an expression on an operator that appears outside brackets and strings.
function splitTop(text, op) {
  const out = []; let depth = 0, s = null, start = 0;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (s) { if (c === '\\') k++; else if (c === s) s = null; continue; }
    if (c === "'" || c === '"' || c === '`') s = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && text.startsWith(op, k)) { out.push(text.slice(start, k)); start = k + op.length; k += op.length - 1; }
  }
  out.push(text.slice(start));
  return out;
}
// cond ? a : b at the top level: [cond, a, b], or null.
function ternary(text) {
  let depth = 0, s = null, q = -1, nest = 0;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (s) { if (c === '\\') k++; else if (c === s) s = null; continue; }
    if (c === "'" || c === '"' || c === '`') s = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && c === '?' && text[k + 1] !== '?' && text[k + 1] !== '.' && text[k - 1] !== '?') { if (q < 0) q = k; else nest++; }
    else if (depth === 0 && c === ':' && q >= 0) { if (nest) nest--; else return [text.slice(0, q), text.slice(q + 1, k), text.slice(k + 1)]; }
  }
  return null;
}
const ESCAPES = /\b(esc|escapeHtml|escapeHTML|escapeText)\(/;

function makeChecker(script, fns) {
  const lookupTables = new Set([...script.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{\s*['"]?\w+['"]?\s*:\s*['"`]/g)].map(m => m[1]));
  // Arrays a page fills with push(): what is pushed is what gets rendered.
  const pushed = name => [...script.matchAll(new RegExp('(?<![\\w$.])' + name + '\\.push\\(', 'g'))].flatMap(m => splitTop(statementFrom(script, m.index + m[0].length, false), ','));
  const leaves = [], verdicts = new Map();
  // A page function's verdict is worked out once; while it is being worked out, a recursive use counts as safe.
  const judge = (name, body, seen) => {
    if (verdicts.has(name)) return verdicts.get(name);
    if (seen.has(name)) return true;
    seen.add(name);
    const ok = bodySafe(body, seen);
    seen.delete(name);
    verdicts.set(name, ok);
    return ok;
  };
  const isSafe = (expr, seen = new Set()) => {
    let e = expr.trim();
    if (e.startsWith('(') && statementFrom(e, 1, false).length === e.length - 2) e = e.slice(1, -1).trim();
    if (!e || SAFE_EXPR.some(r => r.test(e))) return true;
    if (seen.has('expr:' + e)) return true;   // already being judged higher up the same expression
    seen.add('expr:' + e);
    if (ESCAPES.test(e) && !/[+]\s*[A-Za-z_$][\w$.]*\s*[+]/.test(e.replace(/\b(esc|escapeHtml|escapeHTML|escapeText)\([^()]*(\([^()]*\))*[^()]*\)/g, 'esc()'))) return true;
    // A fixed label chosen by key from a table of fixed words.
    const table = e.match(/^([A-Za-z_$][\w$]*)\[[^\]]+\](?:\s*(?:\|\||\?\?)\s*(?:'[^']*'|"[^"]*"))?$/);
    if (table && lookupTables.has(table[1])) return true;
    // list.map(fn).join(…) with a page function, or an inline arrow, possibly over a fallback list: (x||[]).map(…).
    const mapped = e.match(/^[\s\S]*?\.map\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\.join\([^)]*\)$/);
    if (mapped && asFunction(fns, mapped[1])) return judge(mapped[1], asFunction(fns, mapped[1]), seen);
    const arrow = e.match(/^(?:\(?([A-Za-z_$][\w$.]*)(?:\|\|\[\])?\)?|[\s\S]*?)\.(?:filter\([^)]*\)\.)?map\(\s*(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>\s*([\s\S]*)\)\s*\.join\([^)]*\)$/);
    if (arrow) {
      const param = (arrow[2] || arrow[3] || '').split(',')[0].trim(), source = arrow[1];
      // The items of an array the page made itself (a literal list, or one filled with push()) are safe to write.
      const literalList = /^\s*\[(?:\s*(?:'[^']*'|"[^"]*"|\d+)\s*,?)+\]\s*\./.test(e) || /^Array\.from\(/.test(e);
      const made = source && !source.includes('.') && pushed(source).length && pushed(source).every(p => isSafe(p, seen));
      const body = arrow[4];
      if ((literalList || made) && param) return bodySafe(body.replace(new RegExp('(^|[^\\w.$])' + param.replace(/\$/g, '\\$') + '(?![\\w$.])', 'g'), '$1""'), seen);
      return bodySafe(body, seen);
    }
    // Array.from({length: n}, (_, i) => …): the index is a number.
    const from = e.match(/^Array\.from\(\{length:[^}]*\},\s*(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>\s*([\s\S]*)\)\s*\.join\([^)]*\)$/);
    if (from) { const ps = (from[1] || from[2] || '').split(',').map(p => p.trim()).filter(Boolean); let body = from[3]; for (const p of ps) body = body.replace(new RegExp('(^|[^\\w.$])' + p.replace(/\$/g, '\\$') + '(?![\\w$.])', 'g'), '$10'); return bodySafe(body, seen); }
    // An array the page filled with push(), joined.
    const joinedList = e.match(/^([A-Za-z_$][\w$]*)\.join\([^)]*\)$/);
    if (joinedList && pushed(joinedList[1]).length) return pushed(joinedList[1]).every(p => isSafe(p, seen));
    // Alternatives and fallbacks: every branch must be safe.
    const parts = splitTop(e, '||').flatMap(p => splitTop(p, '??'));
    if (parts.length > 1) return parts.every(p => isSafe(p, seen));
    const tern = ternary(e);
    if (tern) return isSafe(tern[1], seen) && isSafe(tern[2], seen);
    // Pieces joined with +: a plain string is fine, every other piece must be safe.
    const joined = splitTop(e, '+');
    if (joined.length > 1) return joined.every(p => literalOnly(p) || isSafe(p, seen));
    // One template literal: only what it interpolates reaches the page.
    if (/^`[\s\S]*`$/.test(e)) return interpolations(e).every(x => isSafe(x, seen));
    if (literalOnly(e)) return true;
    // A call to a formatter, or to a function that escapes what it renders (or renders nothing from data).
    const call = e.match(/^(?:window\.)?([A-Za-z_$][\w$.]*)\s*\(([\s\S]*)\)$/);
    if (call) {
      const name = call[1].replace(/^window\./, '');
      if (SAFE_CALLS.has(call[1]) || SAFE_CALLS.has(name)) return true;
      const body = asFunction(fns, name);
      if (body) return judge(name, body, seen);
    }
    // Arithmetic between numbers.
    if (/^[\w.()]+\s*[-+*/]\s*[\w.()]+$/.test(e) && e.split(/\s*[-+*/]\s*/).every(p => isSafe(p, seen))) return true;
    // A variable set earlier in the script from a safe expression.
    const def = /^[A-Za-z_$][\w$]*$/.test(e) && asVariable(fns, e);
    if (def && !seen.has('var:' + e)) { seen.add('var:' + e); const rhs = statementFrom(def.replace(/^[A-Za-z_$][\w$]*\s*=\s*/, ''), 0); return isSafe(rhs, seen); }
    leaves.push(e.replace(/\s+/g, ' ').slice(0, 100));
    return false;
  };
  // A function body (or template) renders safely when it escapes, or when nothing it interpolates needs escaping.
  const bodySafe = (body, seen) => {
    if (ESCAPES.test(body) && !/[^$]\{?[+]\s*[a-z]\w*\.(name|title|body|note|notes|email|parentName|wrestler|label|text|reason|description|subject|message)\b/.test(body)) return true;
    return interpolations(body).every(x => isSafe(x, seen));
  };
  return {isSafe, leaves};
}

// Writes the scanner cannot follow, read by hand (issue #274): each renders through functions that escape their data.
const REVIEWED = {
  'app/portal.html': [
    // The dashboard draws the open section with the renderer named by `page`: dashboard, calendar, schedules, events and
    // programs, each in lib/workspace or this page, each escaping the academy's own settings with esc().
    "(f[page]||dashboard)()+'<footer>Times are New York time.</footer>'",
    // The extra-practice planner's month grid (lib/workspace): day numbers and the dates chosen on the form's checkboxes.
    'extraPracticeCalendar()',
  ],
  // The books' chart: an SVG of numbers (money and positions), with the month labels escaped.
  'app/financials/screen.html': ['chartSvg(report.months,report.month,box.clientWidth||720)'],
};
const problems = [];
let checked = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const inline = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  // Shared scripts the page loads (public/*.js) define renderers too, as does the owner workspace bundle for the dashboard.
  let shared = '';
  for (const m of src.matchAll(/<script[^>]*\bsrc="\/([^"]+\.js)"/g)) if (existsSync('public/' + m[1])) shared += '\n' + readFileSync('public/' + m[1], 'utf8');
  if (file.endsWith('portal.html')) for (const f of readdirSync('lib/workspace')) shared += '\n' + readFileSync('lib/workspace/' + f, 'utf8');
  const script = inline.join('\n');
  const {isSafe, leaves} = makeChecker(script + '\n' + shared, definitions(script + '\n' + shared));
  const lines = script.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/\.innerHTML\s*\+?=/.test(lines[i])) continue;
    const lineStart = lines.slice(0, i).join('\n').length + (i ? 1 : 0);
    const stmt = lines[i];
    for (const m of stmt.matchAll(/\.innerHTML\s*\+?=/g)) {
      // The written expression: up to the end of the statement, following brackets over lines.
      const expr = statementFrom(script, lineStart + m.index + m[0].length).trim();
      checked++;
      leaves.length = 0;
      if ((REVIEWED[file] ?? []).includes(expr) || isSafe(expr)) continue;
      const why = ` <- ${[...new Set(leaves)].slice(0, 4).join(' | ')}`;
      // A function that writes a parameter (showModal(html), showScan(cls, html)): each caller's argument must be safe.
      const defs = [...stmt.slice(0, m.index).matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)|\b([A-Za-z_$][\w$]*)\s*=\s*\(([^)]*)\)\s*=>|\b([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*=>/g)];
      const last = defs.at(-1), fn = last ? [last[0], last[1] || last[3] || last[5], last[2] ?? last[4] ?? last[6]] : null;
      const params = fn ? fn[2].split(',').map(p => p.trim().split('=')[0].trim()) : [];
      const unsafeParams = [...new Set(leaves)].filter(l => params.includes(l));
      if (fn && unsafeParams.length && [...new Set(leaves)].every(l => params.includes(l))) {
        const calls = [...script.matchAll(new RegExp('(?<![\\w$.])' + fn[1] + '\\(', 'g'))].filter(c => !/function\s*$/.test(script.slice(Math.max(0, c.index - 12), c.index)));
        const bad = [];
        for (const p of unsafeParams) for (const c of calls) {
          const rest = script.slice(c.index + c[0].length);
          let depth = 0, k = 0, s = null;
          for (; k < rest.length; k++) { const ch = rest[k]; if (s) { if (ch === '\\') k++; else if (ch === s) s = null; continue; } if (ch === "'" || ch === '"' || ch === '`') s = ch; else if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) { if (!depth) break; depth--; } }
          const arg = splitTop(rest.slice(0, k), ',')[params.indexOf(p)] ?? '';
          if (arg.trim() && !isSafe(arg)) bad.push(`${p} = ${arg.replace(/\s+/g, ' ').slice(0, 80)}`);
        }
        if (!bad.length) continue;
        problems.push(`${file}:${i + 1}: ${fn[1]}() is called with ${bad.join(' | ')}`);
        continue;
      }
      problems.push(`${file}:${i + 1}: ${expr.replace(/\s+/g, ' ').slice(0, 120)}${why}`);
    }
  }
}
assert.ok(checked > 100, 'expected to check many innerHTML writes: ' + checked);
if (problems.length) console.log(problems.join('\n'));
assert.deepEqual(problems, [], 'every value written with innerHTML goes through esc() or is a value that cannot carry markup');
console.log(`HTML escaping: ${checked} innerHTML writes across ${files.length} pages escape their values or write only numbers, dates, ids and fixed words`);
