# Parent Consent Form (DRAFT for attorney review)

**This is a draft. It has not been reviewed by an attorney, it is not published on the site, and it is not legal advice.** Nothing in the code publishes it. The owner publishes the approved wording himself on the **Parent Consent Form** page (`/consent-forms`), and only after the attorney has approved it (#195, decision Q15 on #197).

The wording below is the starter text from Justin's earlier ChatGPT Sites version (`lib/parent-consent.ts` on the `sites/v131` branch), copied word for word so the attorney starts from what Justin wrote. His notes say it was checked against New York General Obligations Law § 5-326 without attorney approval, and that it deliberately does not attempt a release of negligence (that belongs in the waiver).

## What the site does with it once published

Written from what the platform does (checked against the code), so the attorney can confirm the form matches it:

- Families sign two documents: the waiver and this form (decision Q15 on #197).
- A **parent or guardian** signs it once for each wrestler, also for wrestlers 18 and older. A wrestler never signs for themselves (decision Q16 on #197). The site refuses a signature whose printed name is the wrestler's own name.
- Signing takes the printed full name, a drawn signature, a tick for "I am the parent or legal guardian of this wrestler, and I have read and agree to the Parent Consent Form above", and a tick for the electronic-signature consent: "I consent to use an electronic signature for this form and intend my drawn signature to record my agreement. I can save or print a copy of the signed form."
- The site records the signer's account email, the wrestler, the server's date and time, the drawn signature and a fingerprint (SHA-256) of the exact published text. The family and the owner can view and print the signed copy at any time. Published text is never edited; a corrected version is published as a new version, and every family signs again.
- Once published, a wrestler cannot book anything (memberships, walk-ins, extra practices, camps and events, private lessons, or a payment the owner records at the desk) until the form is signed. The owner can let a specific wrestler book anyway until a set date, with a reason, as with the waiver.

## Questions for the attorney

- [Attorney: Is this wording suitable for New York, and does it work alongside the academy's waiver without overlapping or contradicting it?]
- [Attorney: Is the electronic signature process above (drawn signature, printed name, consent tick, recorded account and time) sufficient for this form under ESIGN and New York's Electronic Signatures and Records Act? The same question is open for scholarship agreements in #44.]
- [Attorney: Section 4 says the form does not appoint staff as medical decision-makers. Should the academy also have a separate emergency medical treatment authorization?]
- [Attorney: A parent signs for wrestlers 18 and older (decision Q16). Does a parent's consent for an adult wrestler need different wording, or should the adult also acknowledge it?]
- [Attorney: Should the form state how long the signed copy is kept? See the data retention draft.]

## Decision still open

- [Decision: Can the booking requirement go live before the attorney has reviewed the form? Decision Q15 on #197 leaves this open. Until it is decided, do not publish the form.]

## Draft wording (from Justin's Sites version, unchanged)

> SAVAGE WRESTLING ACADEMY
> PARENT / LEGAL GUARDIAN CONSENT TO PARTICIPATE
>
> WRESTLER AND FAMILY
> This consent applies to the wrestler identified in this document's signing record. The parent or legal guardian's verified account and printed name are recorded with the signed copy.
>
> 1. PARENT / GUARDIAN AUTHORITY AND PERMISSION
> I confirm that I am the named wrestler's parent or legal guardian and have authority to give this permission. I give permission for my child to participate in the Savage Wrestling Academy practices, instruction, and other on-site wrestling activities for which I separately enroll my child.
>
> 2. PHYSICAL ACTIVITY AND SAFETY
> I understand that wrestling involves physical contact, exercise, and activities in which injuries can occur. I will discuss participation with my child and reinforce the importance of following coaches' instructions, facility rules, and safety procedures. My child should tell a coach promptly if they are hurt, feel unwell, or need to stop.
>
> 3. PARTICIPATION RESTRICTIONS AND CONTACT INFORMATION
> I will notify SWA of any current participation restrictions or medical instructions that affect my child's safe involvement. I will keep my family account's phone number and contact information current and notify SWA when important information changes.
>
> 4. EMERGENCY CONTACT
> If staff believe an emergency exists, I authorize them to contact emergency services and to use the parent / guardian contact information in my family account. This form does not appoint SWA staff as medical decision-makers or replace any separate emergency-care authorization that may be required.
>
> 5. ARRIVAL, DEPARTURE, AND CONDUCT
> I will follow the academy's communicated arrival, pickup, attendance, and conduct procedures, and make appropriate arrangements for my child's safe arrival and departure.
>
> 6. SCOPE OF THIS CONSENT
> This form gives permission for participation. It does not authorize new purchases, recurring charges, transportation, off-site travel, or use of my child's image in publicity. Those matters require separate arrangements or consent. This form does not change any separately signed membership, scholarship, cancellation, or payment agreement.
>
> 7. WITHDRAWING PERMISSION
> I may withdraw permission for future participation by notifying SWA in writing. I understand that withdrawal of participation permission does not by itself cancel a separate membership or resolve any payment obligations under a separate agreement.
>
> PARENT / GUARDIAN ACKNOWLEDGMENT
> I have read this consent, have had the opportunity to ask questions, and give the participation permission described above. My printed full name, drawn signature, and the actual signing date and time will be saved with this document.
