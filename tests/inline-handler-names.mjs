// Inline handlers (onclick="save()") look names up on the element, its form and the document before the page's own
// functions. A button or field whose id or name matches the function, or a function named like an element method
// (remove, submit, open...), makes the click hit the wrong thing. That broke "Cancel changes" on /family (#121):
// the button id="cancelEdit" hid function cancelEdit(). This scans every page for the same trap.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

const files = [];
const walk = dir => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.html')) files.push(p); } };
walk('app'); walk('public');

// Names an inline handler resolves on the element, its form or the document before reaching window.
const shadowing = new Set(['remove', 'click', 'focus', 'blur', 'select', 'submit', 'reset', 'append', 'prepend', 'before', 'after', 'replaceWith',
  'animate', 'closest', 'matches', 'scroll', 'scrollTo', 'scrollBy', 'checkValidity', 'reportValidity', 'setCustomValidity', 'showPicker',
  'open', 'close', 'write', 'writeln', 'clear', 'evaluate', 'append', 'requestSubmit', 'stepUp', 'stepDown', 'setRangeText', 'toggle',
  'name', 'value', 'title', 'type', 'form', 'hidden', 'dataset', 'style', 'id', 'labels', 'children', 'location', 'domain', 'cookie']);

const problems = [];
let handlers = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // A form exposes its fields by id and name, so only names inside a form (including forms built in scripts) shadow.
  const inForms = [...src.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(m => m[0]).join('\n');
  const ids = new Set([...inForms.matchAll(/\b(?:id|name)=\\?["']([A-Za-z_$][\w$]*)\\?["']/g)].map(m => m[1]));
  const fns = new Set([...src.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));
  for (const m of src.matchAll(/\son[a-z]+=\\?"([^"]*)"/g)) {
    handlers++;
    for (const c of m[1].matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = c[2];
      if (!fns.has(name)) continue;
      if (ids.has(name)) problems.push(`${file}: an element has id or name "${name}", which hides function ${name}() in ${JSON.stringify(m[0].trim())}`);
      if (shadowing.has(name)) problems.push(`${file}: function ${name}() in an inline handler resolves to the element or document's own ${name}`);
    }
  }
}
assert.ok(handlers > 20, 'expected to find inline handlers to check');
assert.deepEqual(problems, []);
console.log(`Inline handler names: ${handlers} handlers in ${files.length} pages, none hidden by an element or built-in name`);
