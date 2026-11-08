# Demo and access

The public deployment is https://savage-registration-preview.justinaccordino546.chatgpt.site . Sites version 70 was confirmed deployed successfully from the reviewed commit. The preview hostname is the current live Site. No separate staging environment was verified.

| URL path | Purpose and access |
|---|---|
| /calendar | Public schedule drawn from saved configuration |
| /admin-demo | Public sample owner workspace, fictional records |
| /scholarship-signature-preview | Public fictional scholarship signature form |
| /attendance-demo | Sample camera/pass demonstration, not real attendance |
| /login | Real Supabase sign-in |
| /register | Real registration review, payment disabled |
| /booking | Event and lesson review, no purchase or reserved place |
| /family | Verified family account, optional enrolled MFA challenge |
| / | Owner workspace requiring owner identity and MFA |
| /accounts | Owner-only list of up to 500 real family profiles |
| /scholarships | Owner offer administration |
| /scholarship | Recipient invitation flow, valid link and matching verified account required |
| /coach | Active coach role and MFA required |

Use the public sample pages first. The sample parent view shows fictional Alex Demo and Sam Demo. The scholarship signature preview uses fictional data and does not create an accepted agreement. It has no production signing effect.

No shared live test-account credentials were verified or created. The test scripts use mocked identities, passwords and authenticator codes. Those are not usable platform accounts. For an end-to-end review, create a dedicated non-customer account in an isolated development Supabase environment after correcting the origin and redirect configuration. Ask Justin to grant the intended owner/coach access through the existing service controls. Do not borrow his password or MFA seed.

The screenshots in docs/screenshots were captured from public pages during this review. They show the fictional owner dashboard, fictional family overview, sample signature form and actual public December 2026 calendar. The calendar can change after capture. No private family account or accepted signature was captured.

Review did not submit a real registration, change a schedule, create an invitation, sign an agreement, access customer records, send an email, or take a payment. Some live flows therefore remain unverified despite passing isolated tests.
