# iClosed Billing — Downgrade Process

Automates: Postgres account/subscription lookup → set `renewalDateTime` to now+5m (UTC) →
drive the Stripe dashboard (sandbox/test-mode test clock) to advance time and verify a new
Active subscription.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env   # fill DB creds + Stripe values
```

## Run

```bash
npm run dev     # interactive (dev, via tsx)
npm run build   # compile to dist/
npm start       # run compiled build
npm test        # unit tests
```

## Safety

- `DRY_RUN=true` (default) performs **no** DB writes and does **not** advance the Stripe
  clock. Set `DRY_RUN=false` to act for real.
- DB writes run in a transaction (`BEGIN/COMMIT`, `ROLLBACK` on error) and every query is
  printed before execution.
- Advancing the Stripe clock requires typing `ADVANCE` at the prompt.
- First Stripe run pauses for manual login/2FA; the session is saved under `.auth/`.

## Artifacts

Screenshots, traces, and reports are written under `artifacts/`. View a trace with:

```bash
npx playwright show-trace artifacts/trace-<timestamp>.zip
```

## Desktop app (Electron UI)

Two pages — **Renewal** (update renewal date) and **Full downgrade** (DB + Stripe test
clock) — plus a **Settings** page for DB/Stripe config (written to `.env`).

### Run (dev)

```
npm install
npx playwright install chromium
npm start            # or double-click run.bat on Windows
```

### Build installers

```
# Windows (.exe) — on Windows:
npm run app:build:win        # → release/iClosed Billing Setup 1.0.0.exe
#   or double-click build-windows.bat (one-click: install → playwright → build)

# macOS (.dmg) — on a Mac:
npm run app:build:mac        # → release/iClosed Billing-1.0.0.dmg
#   or double-click build-macos.command (one-click: install → playwright → build)
```

**macOS:** see **[README-macos.md](README-macos.md)** for the full Mac build guide.

Notes:
- `.dmg` can only be built on macOS; `.exe` on Windows.
- **Runtime needs Google Chrome installed** — the Create-user flow and the zero-funds
  app-login step drive system Chrome (`channel:'chrome'`); the Stripe/downgrade flow uses
  Playwright's Chromium (`npx playwright install chromium`).
- Builds are **unsigned**, so the first launch warns: on macOS (Gatekeeper) right-click →
  **Open**, or `xattr -d com.apple.quarantine "iClosed Billing.app"`; on Windows
  (SmartScreen) **More info → Run anyway**.
- The Stripe automation opens its own headed window — log in once (saved per user).
- In packaged builds, `.env` and the `.auth` Stripe profile live under the app's user-data
  directory, so each user configures their own credentials in the Settings page on first run.
