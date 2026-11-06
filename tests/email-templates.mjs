// Issue #155: the Supabase email templates link with Supabase's own variables and never hard-code an address.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
for (const f of ['confirm-signup', 'reset-password', 'change-email']) {
  const html = readFileSync(`docs/email-templates/${f}.html`, 'utf8');
  assert.match(html, /href="\{\{ \.ConfirmationURL \}\}"/, f + ' links with {{ .ConfirmationURL }}');
  assert.match(html, /src="\{\{ \.SiteURL \}\}\/brand\/savage-logo-256\.png"/, f + ' loads the logo from the site');
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/, f + ' has no hard-coded address');
  assert.doesNotMatch(html, /<script/i);
}
console.log('email-templates ok');
