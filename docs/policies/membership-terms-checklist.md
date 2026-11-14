# Membership terms: review checklist

> **Superseded Nov 13, 2026.** Justin decided with Lauren on #2 that memberships are **month to month with no contract**, and the academy's attorney confirmed New York's Health Club Services Act doesn't apply. The final terms are on `/membership-terms` and are built in #314:
>
> - The program's monthly price (team code discounts as before), charged at sign-up and on the same day every month until canceled. No 12-month term, no year upfront, no end date at Stripe.
> - Cancel any time, online from the membership on `/family` (or `/register`), or by email, phone or in person. No more charges; access continues to the end of the paid month. No partial refund and no exit fee. The owner can cancel for a family from Payments.
> - Changing programs doesn't change the price.
> - A failed payment keeps the wrestler on the roster for 7 days while Stripe retries. If Stripe gives up, the membership pauses: off the roster, no more charges, family and owner told. **Restart membership** is a new monthly sign-up from that day with no back pay (#313).
> - New York's automatic-renewal law (GBL §527-a): the renewal terms are shown beside the consent box before payment, the family must tick it, an acknowledgment email with the terms, amount, frequency, next billing day and how to cancel is sent once after sign-up, and cancellation is online. A price increase for existing members needs notice 5 to 30 days ahead and their consent or a chance to cancel; nothing for it is built.
>
> The checklist below is the earlier 12-month plan, kept for the record.

The draft terms were on the site at `/membership-terms`, labeled "Draft for owner and attorney review". This checklist matched that page to what the platform did then.

## What the site does today (check that the terms match)
- 12-month commitment paid monthly ($200 × 12), using the program's saved prices. A team code discount can apply. A year paid upfront is not offered (Justin's decision, #197 Q9, #210).
- The monthly plan bills on the monthly anniversary of the purchase and stops automatically after 12 payments. The site sets the end date on the Stripe subscription.
- The membership ends after 12 months. Continuing requires a new signup; there is **no automatic renewal**.
- Regular scheduled practices in the chosen program are included. Friday Night Live, camps, clinics and lessons are separate. SWA Advance requires coach approval.
- Each monthly payment covers through the next billing day itself. A failed monthly payment shows "Payment needs attention" to the family and tells the owner; the wrestler stays on the roster for 7 days after the paid-through day while Stripe retries the card (#271), never past the 12-month end. If Stripe gives up and cancels the plan, the membership ends on the paid-through day and both are told. [Decision: confirm the 7-day grace, or choose another length.]
- Program transfers are made by the owner, and no money moves automatically.
- Every wrestler needs a current USA Wrestling card and, if published, a signed waiver before booking.

## Decisions still open on the page
- [Decision: early-release rule and any fee: the draft says none is configured.]
- [Decision: what happens to a monthly plan after repeated failed payments: pause, cancel, or collect?]
- [Decision: medical or hardship relief.]
- [Decision: price differences when transferring between programs.]

## For the attorney
- [Attorney: New York Health Club Services Act: does it apply to SWA? If so, confirm the 3-business-day cancellation wording, the other statutory cancellation rights, refund timing, and **bonding or financial security** requirements, which are noted on the page.]
- [Attorney: wording for parent or guardian authorization and recurring payment consent.]
- [Attorney: how the signed agreement is delivered and stored. The site can show and keep a signed copy, as it already does for waivers and scholarships.]
