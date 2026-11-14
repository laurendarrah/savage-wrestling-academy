# Sign-in emails

Savage-branded versions of the emails Supabase sends (issues #155 and #320): confirming a new account, resetting a password and the rest. They use the same layout as the emails the site sends itself (`lib/email-brand.ts`): the black SAVAGE header with the logo, the red rule, a white card, one red button and the academy's address in the footer.

**Supabase keeps these templates in its dashboard, not in this repository. Nothing here reaches families until someone pastes each file in by hand.** Paste them again whenever a file here changes. If a sign-up email still arrives as a bare heading and a link, the template was never saved in that Supabase project.

## Paste them into Supabase

1. Open [supabase.com/dashboard](https://supabase.com/dashboard) and choose the academy's project (the one the live site uses, not a development project).
2. In the left menu choose **Authentication**, then **Emails**, then the **Templates** tab.
3. For each row in the table below:
   1. Choose the template by its name in Supabase.
   2. Replace the **Subject** with the subject from the table.
   3. Open the file from this folder, select all of it and copy it.
   4. In the message body, choose **Source** (not Preview), delete everything there and paste.
   5. Choose **Preview** to check it shows the black SAVAGE header and the red button.
   6. Click **Save**.
4. Check one for real: sign up on the site with an address you haven't used, and look at the email that arrives.

| Template in Supabase | Subject | File to paste (the whole file) | Does the site send it today? |
|---|---|---|---|
| Confirm sign up | Confirm your email · Savage Wrestling Academy | `confirm-signup.html` | Yes, when a family or coach creates an account |
| Reset password | Reset your password · Savage Wrestling Academy | `reset-password.html` | Yes, from "Forgot your password?" |
| Change email address | Confirm your new email · Savage Wrestling Academy | `change-email.html` | Only if an email is changed in Supabase |
| Magic link | Your sign-in link · Savage Wrestling Academy | `magic-link.html` | No. Ready in case it is turned on |
| Invite user | You’re invited to Savage Wrestling Academy | `invite.html` | Only if someone is invited from the Supabase dashboard. Coach invites come from the site itself |
| Reauthentication | Your confirmation code · Savage Wrestling Academy | `reauthentication.html` | No. Ready in case it is turned on |

Do the first two first. They are the ones families see.

## Good to know

- **The logo needs the Site URL.** The header loads the logo from `{{ .SiteURL }}/brand/savage-logo-128.png`. Site URL is under Authentication → URL Configuration. It must be the site's address with no slash at the end. If the logo is missing, the header still reads SAVAGE WRESTLING ACADEMY in text.
- **Only Supabase's own variables are used:** `{{ .ConfirmationURL }}` (the link), `{{ .Token }}` (the one-time code, in Reauthentication only) and `{{ .SiteURL }}`. No address is written into the files, so they keep working when the domain changes.
- **Reauthentication has no button.** Supabase sends that one with a code and no link.
- **Who gets them.** Supabase's built-in sender only delivers to members of the Supabase team, a few emails an hour. Families get these emails once a custom email sender (SMTP) is set up (#87).
- **Fonts.** Email apps don't load the site's fonts, so the headings fall back to Arial Narrow and Arial.
- Supabase also has optional security notices (password changed, email changed and others). They are off unless someone turns them on, and they have no template here yet.

## Changing a template

Don't edit the `.html` files by hand. The wording is in `scripts/build-email-templates.mjs` and the layout is in `lib/email-brand.ts`. Change those, then run:

```
node scripts/build-email-templates.mjs
```

`tests/email-templates.mjs` fails if the files don't match. Then paste the changed files into Supabase again.
