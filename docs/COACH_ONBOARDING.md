# Coach accounts and profiles

Owner setup is at `/staff`. Save the coach's exact email, name and assigned programs. Copy the `/coach-join` link and send it yourself. Saving access does not send email. The shared link never grants a role; active `staff_access` records and verified Supabase email determine access on every request.

Coaches follow the link to create an account or sign in. Email confirmation and authenticator verification are required. Existing SWA accounts can be used with the approved email. After sign-in/MFA, coaches reach `/coach` and can save their name, phone, bio, experience and specialties. Name and bio are required. Their account email is read-only. Profiles remain private to the coach and owner. The owner reviews profiles from `/staff`.

Profile data is stored in D1 `coach_profiles`, added by migration 0013. Revision checks prevent overwriting another window's text edits. Coach photos use the private R2 `BUCKET` binding, with authenticated owner/coach reads, a 2 MB upload limit, and JPG/PNG/WebP signature validation. SVG and arbitrary uploads are rejected. Uploaded photos are not public website assets. Removing/replacing a photo removes its previous R2 object. Revoking a coach immediately denies coach profile/photo access through the role checks.

`APP_ORIGIN` now points to the current published `justinaccordino546.chatgpt.site` hostname. Coach signup/resend callbacks retain the coach context without accepting client-supplied roles or arbitrary redirect destinations. Supabase must allow the current `/auth/confirm` redirect URLs, including query variants, in its Auth URL Configuration. Email delivery and that external allowlist are not established by source tests.

Validation includes the existing suite plus `tests/coaches.mjs`, which exercises profile ownership, MFA, revoked roles, field/body limits, stale revisions, owner review, private photo reads, raster types, photo size/removal, and callback origins. Browser UI checks use temporary local fictional fixtures only; fixtures are removed before builds and are never deployed. No real coach account or staff grant is created by these tests.

The legacy backup tool does not include all newer tables or R2 photos. Arrange a complete D1/R2 backup policy separately before treating it as a full recovery solution.

The owner scholarship page now retains a responsive academy sidebar. Links back to workspace sections use a bounded `#workspace=` whitelist, with existing dedicated attendance, schedule and practice-calendar anchors preserved. No scholarship terms or acceptance behavior changed.

## Owner who also coaches

The verified MFA owner can use `/coach` for their own profile, photo and openings under the existing owner login. `/staff` includes an Owner + Coach card with Edit my coach profile and Set my coaching programs. Saving owner program assignments through the existing staff form does not change `accountRole`, owner destinations, or owner permissions. Revoking the owner through staff management is rejected. Coach profile/photo writes remain scoped to the signed-in account, including when an owner supplies another email in a body/query. Other coaches still cannot read/edit the owner's profile or photo. No database migration or automatic personal-data seed is needed.

## Integrated owner coach directory

Owner coach administration now lives at `/#coaches` inside the main workspace. The Coaches sidebar expands saved coach names; selecting a name loads the same `/api/staff`, `/api/coach-profile` and private photo records used previously. The owner can manage access/programs, edit their own profile/photo inline, and copy a profile-completion link or open an email draft. No invitation is sent automatically. Old `/staff` links authenticate the owner then redirect to the integrated directory. Private Lessons links to the same directory; its older sample availability/booking model is unchanged and is not presented as live booking synchronization. Coach self-service `/coach` remains available for invited coaches. No duplicate profile store or migration was added.

## Parent availability

`/private-lessons` shows verified signed-in families the upcoming `coach_openings` of active coaches with saved profiles, plus the owner. Coach name and an opaque identifier are exposed along with times; contact data, photos and bios are not. The owner Private Lessons calendar now manages these same records through the owner-only `/api/owner-coach-openings` endpoint. Older `academy_state.lessonAvailability` sample values are retained in storage but are not published as real openings. The original legacy preview helper code remains for older sample tests, with no visible calendar using it. There is no invented migration of sample staff or sample availability into real identities. A saved profile is required to associate an availability record with a real coach. Coach self-service opening writes remain scoped to their own user ID. Selecting an opening passes it into the existing inquiry-review flow and rechecks current availability server-side; no reservation, charge, lesson booking or paid entitlement is created. All dates/times use America/New_York. Revoked coaches and already-started openings are omitted.

## Navigation cleanup

Coaches owns staff invitations, access, assignments, profiles and owner coaching details. The old sample staff editor and inviteStaff function were removed from the main workspace. Academy Settings now links to existing program pricing, payment setup, document/policy management, security and recovery tools. Old Staff & settings deep links map to Academy Settings for compatibility. No staff records or permissions were deleted or changed.
