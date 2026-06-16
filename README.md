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
