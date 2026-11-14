// Issues #155 and #320: the Supabase email templates use Supabase's own variables, never hard-code an address, and
// wear the same Savage layout as the emails the site sends itself. They are written by
// scripts/build-email-templates.mjs from lib/email-brand.ts; this fails if the files are out of date.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {TEMPLATES, buildTemplates} from '../scripts/build-email-templates.mjs';

const brandModule = {exports: {}};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/email-brand.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {module: brandModule, exports: brandModule.exports});
const brand = brandModule.exports;
const count = (html, piece) => html.split(piece).length - 1;

// Every standard Supabase template has a file, and the folder holds nothing else.
assert.deepEqual(TEMPLATES.map(t => t.supabase).sort(), ['Change email address', 'Confirm sign up', 'Invite user', 'Magic link', 'Reauthentication', 'Reset password']);
assert.deepEqual(readdirSync('docs/email-templates').filter(f => f.endsWith('.html')).sort(), TEMPLATES.map(t => t.file).sort());

const built = buildTemplates();
const readme = readFileSync('docs/email-templates/README.md', 'utf8');
// What a site email's header and footer look like, with Supabase's variable where the site address goes.
const siteEmail = brand.brandedEmail({subject: 's', text: 'Hello.', origin: 'https://swa.example'}).html.replaceAll('https://swa.example', '{{ .SiteURL }}');
const header = brand.brandHeader('{{ .SiteURL }}' + brand.LOGO_PATH);
assert.ok(siteEmail.includes(header), 'the site’s own emails use this header');

for (const t of TEMPLATES) {
  const f = t.file, html = readFileSync(`docs/email-templates/${f}`, 'utf8');
  assert.equal(html, built[f], `${f} is out of date: run node scripts/build-email-templates.mjs, then paste it into Supabase`);

  // The required variable, exactly as Supabase spells it, and no variable Supabase doesn't have.
  const variables = [...new Set([...html.matchAll(/\{\{[^}]*\}\}/g)].map(m => m[0]))].sort();
  if (t.code) {
    assert.deepEqual(variables, ['{{ .SiteURL }}', '{{ .Token }}'], f);
    assert.match(html, /<p class="swa-code"[^>]*>\{\{ \.Token \}\}<\/p>/, f + ' shows the code');
    assert.equal(count(html, 'bgcolor="#C4222C"'), 0, f + ' has no button: Supabase sends no link with it');
  } else {
    assert.deepEqual(variables, ['{{ .ConfirmationURL }}', '{{ .SiteURL }}'], f);
    assert.match(html, new RegExp(`bgcolor="#C4222C"[^>]*><a href="\\{\\{ \\.ConfirmationURL \\}\\}" style="[^"]*">${t.button}</a>`), f + ' has the button, linked with {{ .ConfirmationURL }}');
    assert.match(html, /If the button doesn’t work, paste this link into your browser:<br><a href="\{\{ \.ConfirmationURL \}\}"[^>]*>\{\{ \.ConfirmationURL \}\}<\/a>/, f + ' has the paste-this-link line');
    assert.equal(count(html, 'bgcolor="#C4222C"'), 1, f + ' has one button');
  }
  assert.equal(count(html, '{{'), count(html, '}}'), f);

  // The brand header and footer, the same as the site's own emails.
  assert.ok(html.includes(header), f + ' has the brand header');
  assert.match(html, /<img src="\{\{ \.SiteURL \}\}\/brand\/savage-logo-128\.png" width="64" height="64" alt="Savage Wrestling Academy"/, f + ' loads the logo from the site');
  assert.match(html, />Savage<\/div>/); assert.match(html, />Wrestling Academy<\/div>/); assert.match(html, /border-bottom:3px solid #C4222C/);
  assert.ok(html.includes(brand.brandFooter(t.why)), f + ' has the brand footer');
  assert.match(html, /Savage Wrestling Academy &middot; 20 Railroad St, Huntington Station, NY 11746<br>You’re getting this because /, f);
  // Everything around the card is the site email's own shell.
  const shell = h => h.slice(0, h.indexOf('<h1')).replace(/<title>[^<]*<\/title>/, '').replace(/(<div style="display:none;[^"]*">)[^<]*/, '$1');
  assert.equal(shell(html), shell(siteEmail), f + ' uses the same layout as the site’s emails');

  // A clear headline, one sentence, and a note for someone who didn't ask.
  assert.match(html, new RegExp(`<title>${t.headline}</title>`)); assert.match(html, new RegExp(`<h1 class="swa-h"[^>]*>${t.headline}</h1>`), f + ' has its headline');
  assert.equal(count(html, '<p class="swa-text"'), 1, f + ' says it in one short paragraph');
  assert.match(html, /<p class="swa-muted" style="margin:0 0 16px;[^"]*">(Didn’t|Not expecting)/, f);
  assert.match(html, /^<!doctype html>\n<html lang="en">/); assert.match(html, /<div style="display:none;[^"]*">[^<]{20,}<\/div>/, f + ' has the inbox preview line');

  assert.doesNotMatch(html, /https?:\/\//, f + ' has no hard-coded address');
  assert.doesNotMatch(html, /<script|<link|@import|@font-face|url\(|\son\w+=/i, f);
  assert.equal(count(html, '<img'), 1, f);

  // The README tells Lauren where each one goes and what its subject is.
  assert.ok(readme.includes(`| ${t.supabase} | ${t.subject} | \`${f}\` |`), `README lists ${f} with its Supabase name and subject`);
}
assert.match(readme, /\*\*Authentication\*\*, then \*\*Emails\*\*, then the \*\*Templates\*\* tab/);
assert.match(readme, /choose \*\*Source\*\* \(not Preview\)/); assert.match(readme, /Click \*\*Save\*\*/);
assert.match(readme, /Nothing here reaches families until someone pastes each file in by hand/);
console.log('email-templates ok');
