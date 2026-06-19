# Session Handoff — iClosed Billing tooling

**Date:** 2026-06-19
**Repo:** https://github.com/zarrar1991/qaiclosedbilling (branch `main`, all work pushed & in sync)
**Version:** v2.4.0
**Supersedes:** `docs/handoff/2026-06-17-session-handoff.md` (UI overhaul). Read that for the
design-system/frameless-window context.

---

## What this project is

Internal QA tool for iClosed billing — an **Electron desktop app** (`electron/` main+preload,
`ui/` Vite+React+Tailwind renderer) over a **TS core** (`src/`, Vitest-tested). Light "iClosed"
design system, frameless window with a custom title bar.

### App tabs (sidebar order)
1. **Create user** — drives the copied iClosed engine (`electron/iclosed-flow.cjs`): signup →
   Stripe checkout (4242) → onboarding on dev. Campaign + Campaign Link dropdowns.
2. **Update renewal date** — set `renewalDateTime` to now+offset (UTC); read-only subs table.
3. **Downgrade subscription** — DB → Stripe test-clock downgrade with live timeline + PASS/FAIL.
4. **Add zero funds card** — NEW this session (see below).
5. **Settings** — credential **profiles** (DB / Stripe / Back-office / `ICLOSED_APP_URL`);
   top-right active-profile selector.

---

## What changed this session

### 1. New tab: "Add zero funds card" (`src/zerofunds-flow.ts`)
For a given account (Email + Password), headed:
1. **Stripe dashboard** (reuses `src/stripe-flow.ts` helpers): open customer → **Add payment
   method → Add card** `4000000000000341` → capture the new `pm_…` (before/after diff, tied to
   the `…0341` row).
2. **DB**: `INSERT INTO payment_methods (accountId,userId,stripePaymentMethodId,type)` — only
   those 4 cols; `id`/`createdAt`/`updatedAt` auto. New `src/db.ts` helpers `lookupUserId`,
   `insertPaymentMethod`. Recorded between phases via a `recordPaymentMethod` hook.
3. **App Billing (hybrid — NOT the UI)**: headed Chrome (`channel:'chrome'`) login to get the
   bearer token past reCAPTCHA, then **back-office API** `POST /paymentMethods`
   `{number,exp_month,exp_year,cvc,type}` (raw card — backend does Stripe) + **poll**
   `GET /paymentMethods` until `…5556` appears. Client: `src/api/iclosed-app.ts`. See the
   `iclosed-paymentmethods-api` memory.

Wiring: `zerofunds:run`/`zerofunds:progress` IPC, `runZeroFundsUi` in `electron/runners.ts`,
page `ui/pages/ZeroFundsCard.tsx`. Spec/plan under `docs/superpowers/{specs,plans}/`.

### 2. API-replay investigation (`docs/superpowers/specs/2026-06-19-api-replay-design.md`)
Captured real UI traffic via HAR to decide UI-vs-API per step.
- **Add-card step → API'd** (clean win: server-side Stripe, single call).
- **Add User → KEPT on the browser engine.** Signup (`/auth/signup/v2`) needs **reCAPTCHA**,
  and payment uses **Stripe Embedded Checkout (client-side)** + a long stateful onboarding
  chain — not worth API-replaying.

### 3. Fixed the ~8/10 Create-user end-of-flow flake
Root cause: the onboarding route guard **bounced back to `/questionnaire`** because the script
advanced before the **event-creation `POST`** (from "Create and test event") committed; the
old code only waited for the URL slug. Fix in `electron/iclosed-flow.cjs`: **gate the advance
on the event-creation API response** (`/events/v2|public` POST) + a **bounce-retry** wrapper
(`createEventAndFinishWithRetry`). Field-validated: "working good now".

### 4. Packaging + docs
- Windows installer builds: `npm run app:build:win` → `release/iClosed Billing Setup 1.0.0.exe`
  (verified launches & renders). electron-builder config in `package.json` (`asar:false`;
  excludes secrets + `iclosed-module.zip`). Branded icon `build/icon.png`.
- macOS: `npm run app:build:mac` (Mac only) or one-click **`build-macos.command`**; guide in
  **`README-macos.md`**. Main `README.md` build section refreshed.
- Earlier this session also fixed two packaging launch bugs (see `packaging-installers` memory):
  `@playwright/test` (devDep) → import from `playwright`; packaged UI path `../../dist-ui`.

---

## How to run / build
```
npm install                      # user runs (corp TLS proxy breaks agent npm)
npx playwright install chromium
npm start                        # dev (Vite + Electron)
npm test                         # vitest (33 tests)
npm run app:build:win            # Windows .exe
npm run app:build:mac            # macOS .dmg (on a Mac) — or build-macos.command
```
Dev loop: renderer hot-reloads; **`electron/`, `src/`, preload edits need an Electron restart**
(`Get-Process electron | Stop-Process -Force`, then `npm start`). The `.cjs` engine + flow
helpers can be driven directly via `scripts/` harness (tsx) — no rebuild needed.

## Dev harness (`scripts/`, see `scripts/README.md`)
`zf-run` (full zero-funds flow), `appcard-check` (app-card step only), `db-probe` (DB reach),
`har-capture` (incremental network capture for API discovery), `app-disco`, `app-login-token`.

## Key gotchas (also in agent memory)
- **Corp TLS interception** breaks Node networking → `node:https` with a scoped insecure agent
  (back-office + `src/api/iclosed-app.ts`); pg `ssl rejectUnauthorized:false`. User runs `npm install`.
- **reCAPTCHA** gates both user login and signup → must log in via a real browser; automated
  headed `channel:'chrome'` passes it. We capture the token from `/auth/authenticate`.
- **`payment_methods` API id == DB id.** Add via `POST /paymentMethods` (raw card); list lags,
  so poll. `GET` returns `data.card[]`.
- **HAR recording:** Playwright `recordHar` only flushes on `context.close()`, skipped when you
  close the window → use incremental `ctx.on("response")` NDJSON (what `har-capture.ts` does).
- **Stripe:** sandbox/test mode; run-simulation modal controls are page-scoped; compare clock
  dates by day; reload+wait before checking "Collection paused".
- **Electron:** preload must be CJS; iClosed engine is CJS (createRequire); needs Chrome installed.
- **Secrets** gitignored: `.env`, `profiles.json`, `.auth/`, `artifacts/`, `.har-profile/`,
  `.design-tmp/`, `release/`.

## State
- Everything committed and pushed to `origin/main`. Working tree clean. `npm test` green (33).
- Shared a team announcement message (clone from repo, configure Settings, Chrome required).

## Possible next targets
- Field-watch the Create-user fix; if a bounce ever slips through, gate the *other* onboarding
  transitions on their `userOnboarding` save responses too.
- Optional cleanup: stale DB row `payment_methods id=10645` (wrong `pm_` from a pre-fix bug)
  + duplicate test cards on the test customers — left as-is per user.
- Code signing (Win/Mac) to drop SmartScreen/Gatekeeper warnings, if distribution widens.
- Optionally bundle Playwright Chromium into the package for full portability.
