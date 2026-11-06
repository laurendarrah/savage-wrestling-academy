# Financials and monthly calendars

The owner-only Financials sidebar item opens `/financials`. Entries are manually recorded income or expenses, with date, category, description and USD amount. Monthly totals include all active entries, with net equal to recorded income minus recorded expenses. Edits use revision checks and voiding preserves the record while removing it from totals. Amounts are stored as integer cents. Entry changes and their audit events commit together. No sample prices, projected dues, unpaid invoices or simulated payouts are treated as received money. No live payment or bank connection is introduced.

Migration 0015 adds `financial_entries` and a date index. It does not insert records or change existing payments or family accounts. MFA owner access is checked on the page and API. Coaches and families cannot read or change financial records. Existing legacy backup exports do not include this table; a complete D1 backup policy remains separate.

The `/coach` profile contains a monthly private lesson calendar. Coaches select a date and save/remove one-hour openings through the existing account-scoped API. The calendar reads the same `coach_openings` used by the owner's availability calendar and verified families. Signed-in families see upcoming openings once the coach's profile is saved. No booking, charge or reservation is created by posting a time.

Visible month selectors display full English month names and years with previous/next arrows. Existing public practice, registration and schedule-planner arrows are retained; arrows were added where missing in practice plans and owner availability. Parent lesson month selection, coach availability and Financials use shared `month-controls.js` formatting. New screens preserve month/day view state through Back navigation. Times use America/New_York and the underlying month keys stay YYYY-MM for API requests.

`tests/financials.mjs` covers ledger permissions, validation, exact-cent calculations, totals, stale edits, voids and month rollover using isolated SQLite and fictional records. Browser checks use local sample fixtures only; no actual income or expenses were entered in production.
