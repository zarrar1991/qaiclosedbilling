# iClosed Billing — Electron UI Design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)

## Purpose

Provide two graphical workflows on top of the existing CLI core, in a single Electron
desktop app:

1. **Renewal** — enter an email, click a button, the subscription's `renewalDateTime` is
   updated (DB only).
2. **Full downgrade** — enter an email, choose a Stripe test-clock interval, click a
   button, and the full DB + Stripe simulation runs to completion.

A shared **Settings** page stores all DB credentials and Stripe info. The UI must be
modern/"fancy" (not old-style) with clear success and failure messages.

## Reuse, not rewrite

All business logic stays in the existing core modules and is called from Electron's main
process: `config.ts`, `db.ts`, `time.ts`, `selection.ts`, `stripe-flow.ts`, `report.ts`.
The CLI (`index.ts`, `db-update-only.ts`, `db-check.ts`) remains and keeps working.

## Architecture

Electron three-process model:

- **Main process (Node):** the only place with DB/Playwright access. Imports the core
  modules and exposes typed IPC handlers. Reads/writes `.env`.
- **Preload (contextBridge):** exposes a minimal, typed `window.api` to the renderer. No
  Node integration in the renderer (`contextIsolation: true`, `nodeIntegration: false`).
- **Renderer:** **Vite + React + Tailwind CSS**, modern dark theme, gradient cards, a
  step-by-step status timeline, and success/failure banners.

The Stripe automation continues to open its **own headed Chromium** (separate from the app
window) via `chromium.launchPersistentContext`, so the user can watch and log in.

```
iclosed-billing/
├── src/                      # existing CLI core (unchanged except stripe-flow hooks)
│   ├── config.ts  db.ts  time.ts  selection.ts  report.ts
│   ├── stripe-flow.ts        # + non-interactive hooks (see below)
│   └── env-file.ts           # NEW: read/parse/write .env for the Settings page
├── electron/
│   ├── main.ts               # app lifecycle, window, IPC handlers
│   ├── preload.ts            # contextBridge -> window.api
│   ├── ipc.ts                # IPC channel names + payload/response types
│   └── runners.ts            # orchestrates renewal + full-flow, emits progress
├── ui/                       # Vite + React + Tailwind renderer
│   ├── index.html  main.tsx  App.tsx
│   ├── pages/{Renewal,FullDowngrade,Settings}.tsx
│   ├── components/{Sidebar,StatusTimeline,Banner,SubscriptionPicker,Field}.tsx
│   └── lib/api.ts            # typed wrapper over window.api
├── electron-builder.yml      # NSIS (.exe) + dmg config, Chromium bundling
├── run.bat                   # dev one-click launch
├── vite.config.ts            # renderer build
└── (existing files: package.json, tsconfig.json, .env, etc.)
```

## IPC contract (typed, all return `{ ok: true, data } | { ok: false, error }`)

- `settings:load` → current `.env` values (passwords included; local app).
- `settings:save(values)` → writes `.env`, returns saved values.
- `settings:testDb` → connect + run the `db:check` column checks; returns table/column
  status.
- `renewal:getCandidates(email)` → `{ accountId, rows: SubscriptionRow[] }`.
- `renewal:update({ id })` or `renewal:update({ accountId, mode:"all" })` → updated +
  re-selected rows (old/new renewal).
- `fullflow:run({ email, span })` → final `RunReport`. Streams progress via
  `fullflow:progress` events (`{ step, status, message }`).

## Page behavior

### Renewal page
1. Email field + "Update renewal".
2. On click → `renewal:getCandidates`. If **one** active sub → confirm inline and
   `renewal:update`. If **multiple** → show **SubscriptionPicker** (id, status,
   renewalDateTime, stripeSubscriptionId, createdAt); user selects → `renewal:update`.
3. Success banner shows account id, subscription id, old → new renewal (UTC). Failure
   banner shows the error.

### Full downgrade page
1. Email field + interval control: presets **1 day / 1 week / 1 month / 1 year** plus a
   **Custom** option (amount number + unit dropdown). Mapped to a span string for
   `parseSpan`.
2. "Run downgrade" → `fullflow:run`. A **StatusTimeline** updates live from
   `fullflow:progress`: DB renewal updated → environment/test mode → customer opened →
   collection paused detected → run simulation → advancing clock → verifying →
   done.
3. On success: green banner with DB account/sub id, old→new renewal, Stripe customer id,
   old (paused) sub id, new Active sub id. On failure: red banner with the failing step
   and error; screenshots/trace already saved under `artifacts/`.

### Settings page
- Grouped form: **Database** (`PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE,
  PGSCHEMA`) and **Stripe** (`STRIPE_DASHBOARD_URL, STRIPE_ENVIRONMENT_NAME,
  STRIPE_AUTH_PROFILE_DIR, STRIPE_STEP_TIMEOUT_MS, STRIPE_LONG_TIMEOUT_MS,
  DEFAULT_RENEWAL_OFFSET_MINUTES, PLAYWRIGHT_SLOW_MO_MS`). Password fields masked with a
  show/hide toggle.
- "Save" writes `.env` (preserving comments/order where practical); "Test DB connection"
  runs `settings:testDb`.

## Core changes

### `stripe-flow.ts` — non-interactive hooks
Add an optional `hooks` parameter to `runStripeSimulation`:

```ts
interface StripeFlowHooks {
  onStatus?(step: string, message: string): void;       // -> UI timeline
  waitForLogin?(page): Promise<void>;                    // UI: poll until dashboard ready
  confirmAdvance?(d: { targetIso: string }): Promise<boolean>; // UI: returns true
}
```

- When `hooks` is provided (UI mode), the terminal `promptEnterWhenReady`/`promptTypeToken`
  calls are replaced by `onStatus` + a **login poll** (wait until the account switcher is
  present, with the long timeout) instead of "press Enter". CLI mode keeps the prompts.
- `confirmAdvance` in UI mode returns `true` (the button click already authorized the run).
- `onStatus` is emitted at each helper boundary so the renderer timeline reflects progress.

### `env-file.ts` — Settings persistence
Pure helpers: `parseEnvFile(text)`, `serializeEnv(values, originalText)` (preserve
comments/key order, update values, append missing keys), plus `readEnv()/writeEnv()` using
the app's `.env` path. Unit-tested.

### Settings location
Reads/writes the project `.env`. In a packaged build, the `.env` lives next to the app's
user-data dir (`app.getPath("userData")/.env`); in dev it's the repo `.env`. The Stripe
persistent profile (`.auth`) likewise lives under userData when packaged.

## Packaging

- **Dev:** `run.bat` → builds the renderer (Vite) and launches Electron (`npm start`).
- **Ship:** `electron-builder` targets **NSIS `.exe`** (Windows) and **`.dmg`** (macOS).
- **Playwright Chromium bundling:** include the Playwright browser via `extraResources`
  and `asarUnpack`; at runtime resolve `executablePath` (or `PLAYWRIGHT_BROWSERS_PATH`) to
  the bundled location when `app.isPackaged`. In dev, use the normally-installed browser.
- **Constraint:** `.dmg` is built on macOS only (electron-builder cannot cross-build it
  from Windows); `.exe` is built on Windows. Config/scripts provided for both.

## Error handling

- Every IPC handler wraps work in try/catch and returns `{ ok:false, error }` — never
  throws across the bridge.
- The renderer shows a red **Banner** with the error text and (for full-flow) the failing
  step; success shows a green Banner with the result fields.
- DB writes remain transactional (`BEGIN/COMMIT/ROLLBACK`) in the core.

## Testing

- Unit tests (Vitest) for `env-file.ts` (parse/serialize round-trip, comment preservation,
  password values with `=`/special chars) and any new span→preset mapping helper.
- Existing core unit tests stay green.
- DB and Stripe paths verified by manual dev runs (live systems), as with the CLI.

## Out of scope (YAGNI)

- No auth/multi-user, no cloud sync, no telemetry.
- No headless/CI Stripe automation (login needs a human).
- No embedding the Playwright browser inside the Electron window (it stays a separate
  Chromium window by design).
