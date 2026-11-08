# Access required for collaboration

Justin should grant individual collaborator access through each service, with the minimum role needed. Account passwords, MFA seeds, bearer bypass tokens and private keys are not part of this handoff.

| Service or resource | Needed access and current uncertainty |
|---|---|
| ChatGPT Sites project | Editor/source access to the existing Site and its version/deployment controls. Current source is packaged; platform tooling and deployment credentials are external. |
| GitHub | Confirm whether a canonical repository exists. No configured remote was found. If absent, create a private repository with owner authorization and import reviewed source/history through the canonical source channel. |
| Supabase | Development project and Auth configuration access. Production project reference mdxyylvdgntkjfuiovxi. Inspect redirects, SMTP/email, MFA policy and leaked-password protection. |
| D1 / Cloudflare hosting | Verify live database binding, migration state, recovery/export and platform-supported access. A standalone Cloudflare account relationship was not verified. |
| Stripe | Team access to the Savage test environment first. Confirm restricted key permissions and future live-mode ownership without sharing secret values. |
| App owner role | The app currently recognizes a hard-coded owner email plus verified MFA. Platform editor access does not grant this role. |
| Legal/business decisions | Final cancellation, early-exit, renewal, scholarship duration/repayment and guardian terms need authorized review. Existing signature capture does not establish enforceability. |
| Domain, email delivery, support | Custom domain/DNS ownership, transactional email configuration and operating support procedures remain unverified. |

Prior AI tooling and exact model history cannot be reconstructed from files alone. Verified current tooling includes ChatGPT Work, Codex, Sites, terminal tools and service integrations. The project contains no implemented AI model feature in its application runtime. Ask the project owner for additional vendor records or historical context where necessary.
