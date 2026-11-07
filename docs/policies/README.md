# Policy drafts for attorney review

**These are drafts. None of them is published on the site, and none is legal advice.** They were written from what the platform actually does (checked against the code on main), so the attorney starts from accurate facts. Bracketed notes mark what needs a decision or legal review:

- **[Decision: …]** something Justin decides as the owner
- **[Attorney: …]** a question for the academy's attorney

| Draft | Unblocks | Where it will live once approved |
|---|---|---|
| [Privacy policy](privacy-policy-draft.md) | Launch (families' and children's data) | A new `/privacy` page, linked from sign-up and every page footer |
| [Refund and cancellation policy](refund-policy-draft.md) | Online payment for walk-ins, Friday Night Live, camps and lessons (#3, #80) | The `/membership-terms` page, then `CHECKOUT_KINDS` |
| [Data retention](data-retention-draft.md) | Handling account closure requests (#113) | The owner guide and the privacy policy |
| [Membership terms review checklist](membership-terms-checklist.md) | 12-month memberships (#2) | The existing `/membership-terms` page |
| [Parent Consent Form](parent-consent-form-draft.md) | Requiring the form before booking (#195, decision Q15 on #197) | Published by the owner on `/consent-forms`; families sign it on `/consent` |

## How to finish them

1. Justin answers the **[Decision]** items, in the matching GitHub issue.
2. The attorney reviews and edits the text, and answers the **[Attorney]** items.
3. A pull request publishes the final wording on the site, removes the "draft" labels, and opens the matching purchase types in `CHECKOUT_KINDS`.
