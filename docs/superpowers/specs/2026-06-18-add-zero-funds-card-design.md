# Design — "Add zero funds card" tab

**Date:** 2026-06-18
**Status:** Approved (design); spec under review
**Author:** Zarrar + Claude

## Goal

Add a new tab, **Add zero funds card**, that for a given account (Email + Password):
1. Attaches a *zero-funds* test card (`4000000000000341`) to the customer in the **Stripe
   dashboard**, captures its `pm_…` id, and registers it in the **DB** `payment_methods`
   table.
2. Adds a second card (`4000056655665556`) through the **iClosed app's internal Billing
   page** and verifies it appears.

It runs in a **visible (headed)** browser with a live step timeline and a PASS/FAIL result,
mirroring the existing Downgrade page. IPC/`window.api` contract and existing page
behaviors are unchanged; this is additive.

## Decisions (locked)

- **App URL:** add a new setting `ICLOSED_APP_URL` (default `https://dev.iclosed.io`),
  exposed in Settings; `AppConfig.appUrl`. App login uses `${appUrl}/auth/login`.
- **`pm_` id capture:** read the value directly from the Stripe customer page DOM (not the
  OS clipboard).
- **Stripe session:** reuse the existing persistent `.auth` profile + login/env/test-mode
  helpers (no re-login each run).
- **`payment_methods` schema:** `id` (auto-increment PK — omitted from INSERT), `accountId`,
  `userId`, `stripePaymentMethodId`, `type` (`'card'`), `createdAt`, `updatedAt`, `deletedAt`
  (left NULL). `createdAt`/`updatedAt` set to a UTC timestamp matching the app convention.
- **Billing add-card** is the internal iClosed Billing page — **different selectors** from
  the signup embedded-checkout iframe; discovered separately.

## Architecture

Same shape as the Downgrade flow:

```
ui/pages/ZeroFundsCard.tsx
        │  api.runZeroFunds(profile, {email, password})  + api.onZeroFundsProgress(cb)
        ▼
electron/main.ts  ── ipcMain.handle("zerofunds:run") ──► runZeroFundsUi(cfg, req, onProgress)
                                                              │  (electron/runners.ts)
                                                              ▼
                                          src/zerofunds-flow.ts  runZeroFundsFlow(cfg, req, hooks)
                                              ├─ src/stripe-flow.ts  (reused helpers)
                                              └─ src/db.ts           (lookupUserId, insertPaymentMethod)
```

Progress streams main → renderer over `zerofunds:progress`, rendered by the existing
`StatusTimeline`.

## Components

### 1. Renderer — `ui/pages/ZeroFundsCard.tsx` + Sidebar

- Sidebar: new page id `zerofunds`, label **"Add zero funds card"**, placed **last** (after
  Settings), with a credit-card icon. `Page` type extended in `ui/components/Sidebar.tsx`;
  routed in `ui/App.tsx`.
- Page: header "Add zero funds card", **Email** field, **Password** field, **Add** button.
  Button disabled while running, or when email/password empty, or no active profile.
- On Add → `setState("running")`, clear steps, call `api.runZeroFunds(profile, {email,
  password})`; `api.onZeroFundsProgress` appends to a `StatusTimeline`.
- Result: green card "Zero funds card added" listing `pm_…` id, new `payment_methods` row
  id, and verified app card (`…5556`); or red FAIL card with the humanized error + notes.
- Always headed (no toggle).

### 2. Settings — App URL

- New section **"Application"** in `ui/pages/Settings.tsx` with one field `ICLOSED_APP_URL`.
- `src/config.ts`: parse `ICLOSED_APP_URL` (optional; default `https://dev.iclosed.io`,
  trailing slash trimmed). `src/types.ts`: `AppConfig.appUrl: string`.

### 3. Backend orchestrator — `src/zerofunds-flow.ts`

`runZeroFundsFlow(cfg, { email, password }, hooks)` returns
`ZeroFundsResult` and streams `hooks.onStatus(step, message)`. Phases:

**A. Stripe dashboard (reused):** `launchStripeContext` → `ensureLoggedIn` →
`ensureEnvironmentSelected` → `ensureTestMode` → `openCustomerByEmail(email)`.

**B. Add zero-funds card in dashboard (new helper, e.g. `addZeroFundsCardInDashboard`):**
- Scroll to the **Payment methods** section.
- Click the **+** next to "Payment methods" → **Add card**.
- Fill card `4000000000000341`, a random future expiry `MM/YY`, a random CVC.
- Click **Add card**; wait for the new method to appear.
- Open the card ending **`0341`**; read the **`pm_…`** id from the ID field DOM.
- Returns `paymentMethodId` (`pm_…`).

**C. DB (new helpers in `src/db.ts`):**
- `lookupUserId(pool, email)` → `SELECT id FROM users WHERE email = $1`.
- `insertPaymentMethod(pool, { accountId, userId, stripePaymentMethodId, type })`:
  `INSERT INTO payment_methods ("accountId","userId","stripePaymentMethodId","type","createdAt","updatedAt")
   VALUES ($1,$2,$3,$4,$5,$5) RETURNING id;` where `$5` is a UTC timestamp string.
- Orchestrator: `accountId = lookupAccountId(email)`, `userId = lookupUserId(email)`,
  `dbPaymentMethodId = insertPaymentMethod(...)`. Errors if either id is missing.

**D. App Billing (new, internal iClosed page):**
- `goto ${cfg.appUrl}/auth/login`; fill **Email** + **Password**; click **Login**.
- Open **Settings** (gear) → **Billing**.
- Click **+ Add new payment method**.
- Fill card `4000056655665556`, random future expiry `MM/YY`, random CVV (card fields may be
  a Stripe Elements iframe inside the internal page — discovered at implementation time).
- Click **Add Card**; **verify** a method ending **`5556`** appears under "Your payment
  methods". Returns `{ appCardLast4: "5556", verified: boolean }`.

**E. Result:** PASS if `pm_` captured **and** DB insert succeeded **and** app card verified;
otherwise FAIL with notes. A failure screenshot is saved to `artifacts/`.

Small TS helpers `randomFutureExpiry()` / `randomCvc()` ported from `iclosed-flow.cjs`.
UI-mode fallbacks fail with a clear message (no terminal prompt), like `manualStep`.

### 4. Wiring (IPC / preload / api / runner / main)

- `electron/ipc.ts`: channels `zerofundsRun: "zerofunds:run"`, `zerofundsProgress:
  "zerofunds:progress"`; types `ZeroFundsRequest { email; password }`,
  `ZeroFundsResult { stripeCustomerId: string|null; paymentMethodId: string|null;
  dbPaymentMethodId: string|null; appCardLast4: string|null; verified: boolean;
  notes: string[] }`, `ZeroFundsProgress { step; message }`.
- `electron/preload.cjs` + `ui/lib/api.ts`: `runZeroFunds(profile, req)`,
  `onZeroFundsProgress(cb)`.
- `electron/runners.ts`: `runZeroFundsUi(cfg, req, onProgress)` — builds the pool, runs the
  flow, returns the result.
- `electron/main.ts`: `ipcMain.handle(CH.zerofundsRun, …)` forwarding progress over
  `CH.zerofundsProgress`, with the same `waitForLogin` poll (account switcher visible) as the
  Downgrade handler.

## Data flow

1. Renderer collects `{email, password}` + active `profile` → `runZeroFunds`.
2. Main loads the profile config, runs `runZeroFundsFlow`.
3. Stripe phase yields `paymentMethodId` (`pm_…`) and `stripeCustomerId`.
4. DB phase yields `accountId`, `userId`, `dbPaymentMethodId`.
5. App phase yields `appCardLast4` + `verified`.
6. Aggregated `ZeroFundsResult` returned; progress streamed throughout.

## Error handling

- Every step streamed via `onStatus` → `StatusTimeline` (navy pulse → green; red on fail).
- Thrown errors → FAIL result with `humanizeError(message)` + a failure screenshot.
- **Non-transactional** across browser + DB: if the DB insert succeeds but a later app step
  fails, the result reports partial completion in `notes` (no rollback of the inserted row).
- Reuses the existing `manualStep`-style "fail clearly in UI mode" pattern for unfound
  selectors rather than blocking.

## Testing

- Unit (Vitest): `randomFutureExpiry()` (matches `MM/YY`, future) and `randomCvc()`
  (3 digits); `insertPaymentMethod` SQL shape via a thin query-builder test if extracted.
- Manual/headed: run the full flow against a real dev account and confirm the timeline,
  the new `payment_methods` row, and the `…5556` card in the app. Selector discovery for the
  Stripe dashboard add-card modal and the internal Billing page happens during this pass.

## Known risks

- **Unseen DOM:** the Stripe dashboard add-card modal (incl. the ID field) and the internal
  iClosed Billing add-card form are not yet known. Selectors discovered iteratively in headed
  mode with waits/screenshots; expect a debug pass to finalize.
- **`payment_methods.id`** assumed auto-increment; if it is not, the INSERT must supply an id
  (surfaces immediately as a clear DB error).

## Out of scope

- Bundling Playwright Chromium for portability (separate follow-up).
- Any change to existing tabs/flows beyond adding the new tab and the `ICLOSED_APP_URL`
  setting field.
