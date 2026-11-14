// Writes the sign-in email templates in docs/email-templates/ (issue #320) from the same layout the site's own
// emails use (lib/email-brand.ts), so the two always look alike. Supabase keeps its templates in its dashboard, so
// after running this, paste the changed files in by hand (docs/email-templates/README.md).
//
//   node scripts/build-email-templates.mjs
//
// tests/email-templates.mjs fails if the files are out of date. Only Supabase's own variables are used:
// {{ .ConfirmationURL }} (the link), {{ .Token }} (the one-time code) and {{ .SiteURL }} (the site address, for the
// logo). No address is written into the files.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = ts.transpileModule(readFileSync(path.join(root, 'lib/email-brand.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const brand = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const {emailShell, headlineHtml, paragraphHtml, noteHtml, buttonHtml, codeHtml, fallbackHtml, escapeHtml, WHY, LOGO_PATH} = brand;

const LINK = '{{ .ConfirmationURL }}', CODE = '{{ .Token }}', LOGO = '{{ .SiteURL }}' + LOGO_PATH;

// One entry per template in Supabase → Authentication → Emails → Templates. `subject` goes in the Subject box there.
export const TEMPLATES = [
  {file: 'confirm-signup.html', supabase: 'Confirm sign up', subject: 'Confirm your email · Savage Wrestling Academy',
    headline: 'Confirm your email', preheader: 'One tap to confirm your email and finish setting up your family account.',
    body: 'Thanks for signing up. Confirm this is your email address, then sign in to add your wrestler and choose training.',
    button: 'Confirm my email', note: 'Didn’t sign up? You can ignore this email and no account will be created.',
    why: 'You’re getting this because this email address was used to sign up at Savage Wrestling Academy.'},
  {file: 'invite.html', supabase: 'Invite user', subject: 'You’re invited to Savage Wrestling Academy',
    headline: 'You’re invited', preheader: 'Savage Wrestling Academy invited you to create an account.',
    body: 'Savage Wrestling Academy invited you to create an account. Accept with the button below, then choose a password.',
    button: 'Accept the invite', note: 'Not expecting this? You can ignore this email.',
    why: 'You’re getting this because Savage Wrestling Academy invited this email address.'},
  {file: 'magic-link.html', supabase: 'Magic link', subject: 'Your sign-in link · Savage Wrestling Academy',
    headline: 'Your sign-in link', preheader: 'Sign in to your Savage Wrestling Academy account.',
    body: 'Sign in to your Savage Wrestling Academy account with the button below. The link works once and expires soon.',
    button: 'Sign in', note: 'Didn’t ask for this? Ignore this email and nothing changes.', why: WHY.account},
  {file: 'change-email.html', supabase: 'Change email address', subject: 'Confirm your new email · Savage Wrestling Academy',
    headline: 'Confirm your new email', preheader: 'Confirm the new email address for your Savage Wrestling Academy account.',
    body: 'Confirm that this is the new email address for your Savage Wrestling Academy account. You’ll use it to sign in from now on.',
    button: 'Confirm new email', note: 'Didn’t ask for this? Ignore this email and nothing changes.', why: WHY.account},
  {file: 'reset-password.html', supabase: 'Reset password', subject: 'Reset your password · Savage Wrestling Academy',
    headline: 'Reset your password', preheader: 'Choose a new password for your Savage Wrestling Academy account.',
    body: 'Someone asked to reset the password for this email address. Choose a new one with the button below. The link works once and expires soon.',
    button: 'Choose a new password', note: 'Didn’t ask for this? Ignore this email and your password stays the same.', why: WHY.account},
  // Supabase sends this one with a code and no link, so it has no button.
  {file: 'reauthentication.html', supabase: 'Reauthentication', subject: 'Your confirmation code · Savage Wrestling Academy',
    headline: 'Your confirmation code', preheader: 'The code to confirm it’s you.',
    body: 'Enter this code on the Savage Wrestling Academy site to confirm it’s you. It expires soon.',
    code: true, note: 'Didn’t ask for this? Ignore this email and change your password.', why: WHY.account}
];

export function buildTemplates() {
  return Object.fromEntries(TEMPLATES.map(t => [t.file, emailShell({title: t.headline, preheader: t.preheader, why: t.why, logoUrl: LOGO,
    inner: [headlineHtml(escapeHtml(t.headline)), paragraphHtml(escapeHtml(t.body)),
      t.code ? codeHtml(CODE) : buttonHtml(LINK, escapeHtml(t.button)), noteHtml(escapeHtml(t.note)), ...(t.code ? [] : [fallbackHtml(LINK)])].join('\n')}) + '\n']));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [file, html] of Object.entries(buildTemplates())) writeFileSync(path.join(root, 'docs/email-templates', file), html);
  console.log(`Wrote ${TEMPLATES.length} templates to docs/email-templates/. Paste the changed ones into Supabase (see its README).`);
}
