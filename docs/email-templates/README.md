# Sign-in emails

Savage-branded versions of the emails Supabase sends (issue #155). Supabase stores these templates in its dashboard, not in this repository, so paste each one in by hand. Re-paste it whenever the file here changes.

Supabase → the academy project → **Authentication → Emails → Templates**:

| Template in Supabase | Subject | Message body (paste the whole file) |
|---|---|---|
| Confirm sign up | Confirm your email · Savage Wrestling Academy | `confirm-signup.html` |
| Reset password | Reset your password · Savage Wrestling Academy | `reset-password.html` |
| Change email address | Confirm your new email · Savage Wrestling Academy | `change-email.html` |

Click **Save** after each one, then sign up with a test address to check it.

Notes:
- The templates use only Supabase's own variables. `{{ .ConfirmationURL }}` is the link, and `{{ .SiteURL }}` is the site address set under Authentication → URL Configuration, used for the logo. No address is written into the files, so they keep working when the domain changes.
- Supabase's built-in sender only delivers to members of the Supabase team, a few emails an hour. Families get these emails once a custom email sender (SMTP) is set up (#87).
- Email apps don't load the site's fonts, so the headings fall back to Arial Narrow and Arial.
