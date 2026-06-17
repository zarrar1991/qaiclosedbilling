# Session Handoff — iClosed Billing tooling

**Date:** 2026-06-17
**Repo:** https://github.com/zarrar1991/qaiclosedbilling (branch `main`, all work pushed & in sync)
**Next target:** **App UI overhaul — a new design is ready** (design artifact not yet in the repo; ask the user for it).

---

## What this project is

An internal QA tool for iClosed billing, in two layers:

1. **CLI core** (`src/`, TypeScript ESM, tested with Vitest) — the business logic.
2. **Electron desktop app** (`electron/` main+preload, `ui/` Vite+React+Tailwind renderer) that reuses the core. This is the primary deliverable now.

### App pages (sidebar order)
- **Create user** — drives the copied iClosed engine (`electron/iclosed-flow.cjs`) to sign up → Stripe test card → onboarding. Has a **Campaign** dropdown (from DB `campaigns`, latest-first, searchable, default-selected) and a **Campaign Link** dropdown (from back-office API, searchable) that fills the Campaign URL. Selections are session-scoped (stick across tabs, reset to latest on app restart).
- **Update renewal date** — set a subscription's `renewalDateTime` to now+offset (UTC); shows a read-only subscriptions search table (incl. deleted); Update / Search / refresh.
- **Downgrade** — full DB→Stripe test-clock downgrade with a live step timeline + PASS/FAIL.
- **Settings** — **credential profiles** (Default/…); Create / Duplicate / Rename / Delete / Set-as-default; per-profile DB, Stripe, and Back-office API creds. Top-right header has the active-profile selector.

## How to run / build
```
npm install                      # user runs this themselves (corp TLS proxy breaks agent npm)
npx playwright install chromium
npm start                        # dev (Vite + Electron); or run.bat
npm run app:build                # electron-builder: .exe (Windows) / .dmg (macOS only)
npm test                         # vitest (core)
```
- Dev loop used all session: edit → `npm run ui:build` (renderer HMR is live) or `npx tsc -p tsconfig.electron.json` for backend, then restart Electron (`Get-Process electron | Stop-Process -Force` then `npm start`). Renderer-only changes are hot-reloaded; main/preload/`src` changes need a restart.

## Key facts / gotchas (also in agent memory)
- **Corporate TLS interception** breaks Node networking (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`): npm (user installs themselves), and Node `fetch` — the back-office API calls use `node:https` with a scoped insecure agent; pg uses `ssl rejectUnauthorized:false`.
- **DB:** AWS RDS `icloseddevdb` (Postgres 17). Schema `icloseddevdb` (also `icloseddevdbfresh`), chosen via `PGSCHEMA`. Table `subscriptions` (lowercase), Stripe id col `subscriptionId`, `pauseCollection` bool, integer ids; `accounts."emailAssociated"`.
- **Stripe:** sandbox/test-mode via account menu → Switch to sandbox → Test mode (URL gains `/test/`). Run-simulation modal controls are **page-scoped, not inside `[role=alertdialog]`**. Compare clock dates by calendar day. Reload + ~15s wait before checking "Collection paused"; the completion signal is a NEW Active, non-paused subscription.
- **Electron:** preload must be **CommonJS** (`electron/preload.cjs`) in this `type:module` project, copied into `dist-electron` by `electron:build`. The iClosed engine is CJS too, loaded via `createRequire`; needs **Google Chrome installed**.
- **Back-office API:** token via `POST {BO_BASE_URL}/auth/authenticate {email,password,isBackOffice:true}` → `accessToken`; sent as `Authorization: Bearer`; cached in memory per profile, generated on launch, cleared on quit. Campaign links from `GET {BO_BASE_URL}/campaigns?id=<id>` → `data.formattedCampaignLinks[*].hash`; URL = `https://dev.iclosed.io/campaign?plan_hash=<hash>`.
- **Secrets** are gitignored: `.env`, `profiles.json`, `.auth/`, `artifacts/`, the module zip.

## State
- Everything committed and pushed to `origin/main` (~57 commits). Working tree clean.
- Specs/plans under `docs/superpowers/`. This handoff under `docs/handoff/`.

## Next target — UI overhaul
A new design is ready (not yet in the repo). Start by getting the design artifact (Figma link / screenshots / spec) from the user, then brainstorm scope before changing `ui/`. Keep the existing IPC/`window.api` contract and page behaviors; this is a visual/layout overhaul of the Tailwind/React renderer (`ui/components`, `ui/pages`, `ui/styles.css`, `ui/App.tsx`).
