# Dev harness scripts

Diagnostic/automation helpers for the zero-funds flow and API discovery. Run with
`npx tsx scripts/<file>.ts <args>`. They use the **active profile** (`profiles.json` +
`.env`) for config. None contain secrets — credentials are passed as CLI args.

| Script | Purpose |
| --- | --- |
| `zf-run.ts <email> <password>` | Drive the **full** zero-funds flow (Stripe dashboard `…0341` + DB insert + app-Billing API `…5556`) headed, with console step logs. The CLI mirror of the "Add zero funds card" tab. |
| `appcard-check.ts <email> <password>` | Run **only** the app-Billing step (login → `POST /paymentMethods` → poll-verify). No Stripe/DB, so no duplicate `…0341` cards — handy for testing just the card add + verify. |
| `db-probe.ts [email]` | Quick DB reachability check (`lookupAccountId`) on the active profile. |
| `har-capture.ts <label>` | Record iClosed/Stripe API calls to `artifacts/<label>.ndjson` while you drive the UI manually (incremental — survives closing the window). For discovering new API sequences. |
| `app-disco.ts <email> <password>` | Dump the app login page's inputs/links/buttons (selector discovery). |
| `app-login-token.ts <email> <password>` | Verify an automated browser login passes reCAPTCHA and yields an `accessToken`. |

See `docs/superpowers/specs/2026-06-19-api-replay-design.md` for the capture-driven API
approach these support.
