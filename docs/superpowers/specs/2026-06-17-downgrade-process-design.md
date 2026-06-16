# Downgrade Process — Design

**Date:** 2026-06-17
**Status:** Approved (pending spec review)

## Purpose

Automate the subscription "downgrade" verification flow for iClosed billing. Given a
target customer email and a time span to advance, the process:

1. Looks up the account in PostgreSQL.
2. Sets the chosen subscription's `renewalDateTime` to "now + offset minutes" (UTC,
   default 5) so renewal is due imminently.
3. Drives the Stripe dashboard (test mode + sandbox, via a Stripe **test clock**) with
   Playwright in headed mode to advance time and confirm a new subscription becomes
   Active for the same customer.

## Runtime & Inputs

- **Language/runtime:** TypeScript on Node.js.
- **Browser automation:** Playwright (headed Chromium, `headless: false`, optional
  `slowMo`).
- **Database:** PostgreSQL via `pg` (node-postgres).
- **Inputs (this phase):** interactive prompt at startup for:
  - target email (e.g. `demotusb37@example.com`)
  - advance span (e.g. `1 month`, `3 days`, `1 year`)
- **Future consideration:** the interactive prompt layer will later be replaced by a UI.
  The core phases (db + stripe-flow) are kept free of prompt logic so this swap is clean.

## Project Structure

```
iclosed-billing/
├── .env.example          # template; copy to .env and fill values
├── .gitignore            # ignores .env, .auth/, artifacts/
├── package.json
├── tsconfig.json
├── playwright.config.ts
├── src/
│   ├── index.ts          # entry: prompts → orchestrates phases 1→2→3 → report
│   ├── config.ts         # loads & validates .env (incl. DRY_RUN)
│   ├── prompts.ts        # interactive input (later replaceable by UI)
│   ├── time.ts           # UTC renewal calc + span parsing/target timestamp
│   ├── db.ts             # phase 1 & 2: lookup + transactional renewal update (pg)
│   ├── stripe-flow.ts    # phase 3: Playwright Stripe dashboard steps (helpers)
│   └── report.ts         # final pass/fail report assembly + print
├── .auth/                # saved Stripe browser session (gitignored)
└── artifacts/            # screenshots + Playwright traces (gitignored)
```

## Configuration — `.env.example`

```
# PostgreSQL
PGHOST=
PGPORT=5432
PGDATABASE=
PGUSER=
PGPASSWORD=
PGSSLMODE=require          # disable | require | verify-full

# Stripe dashboard
STRIPE_DASHBOARD_URL=https://dashboard.stripe.com
STRIPE_ENVIRONMENT_NAME=iClosed.io (development)
STRIPE_AUTH_PROFILE_DIR=.auth

# Timeouts
STRIPE_STEP_TIMEOUT_MS=30000     # standard per-step actions
STRIPE_LONG_TIMEOUT_MS=120000    # Collection Paused, sim completion, Active verify

# Behavior
DEFAULT_RENEWAL_OFFSET_MINUTES=5
PLAYWRIGHT_SLOW_MO_MS=0
DRY_RUN=true                     # optional; defaults to true (safe) on first run
OPEN_STRIPE_IN_DRY_RUN=false     # if true, open Stripe in dry-run (no clock advance)
```

`config.ts` validates required vars, coerces numbers, and parses `DRY_RUN`
(default **true** when unset, so the first run is safe).

## Phase 1 — Account lookup (DB)

Query (printed before execution):

```sql
SELECT id FROM accounts WHERE "emailAssociated" = $1;
-- $1 = <given email>
```

- If no row: stop with a clear "account not found for <email>" message.
- If found: capture `accountId` for the next phases.

## Phase 2 — Update renewal time (DB, transactional)

### 2a. Select & display candidate subscriptions

```sql
SELECT id, "accountId", status, "renewalDateTime", "deletedAt",
       "stripeSubscriptionId", "stripeCustomerId", "createdAt"
FROM "Subscriptions"
WHERE "accountId" = $1 AND "deletedAt" IS NULL
ORDER BY "createdAt" DESC;
-- $1 = <accountId>
```

Print the matched row(s) as a readable table. Capture `stripeSubscriptionId` and
`stripeCustomerId` (if present) on the chosen row — used later for the DB↔Stripe
cross-check (see Phase 3).

> If `stripeCustomerId` does not exist as a column, the script tolerates its absence and
> falls back to email-only customer matching.

### 2b. Choose the target subscription (no blind bulk update)

- **Zero rows:** stop with "no active (non-deleted) subscription found".
- **Exactly one row:** show it, ask for confirmation, then update **that specific `id`**.
- **Multiple rows:** display all and prompt the user to **enter a subscription `id`** to
  update. To update every non-deleted row, the user must explicitly type `UPDATE ALL`.

### 2c. Compute renewal value (UTC)

- Value = **current UTC time + `DEFAULT_RENEWAL_OFFSET_MINUTES`** (default 5).
- Format: `YYYY-MM-DD HH:mm:ss.000` (e.g. `2024-04-01 16:05:32.000`).
- Print **local time and UTC time separately** to avoid timezone confusion.

### 2d. Transactional update

Wrap the write in a transaction. On any failure → `ROLLBACK`.

```sql
BEGIN;

UPDATE "Subscriptions"
SET "renewalDateTime" = $1
WHERE id = $2            -- or: WHERE "accountId" = $X AND "deletedAt" IS NULL (UPDATE ALL)
RETURNING id, "accountId", status, "renewalDateTime", "deletedAt",
          "stripeSubscriptionId", "createdAt";

COMMIT;
```

- Print the row(s) returned by `RETURNING`.
- After `COMMIT`, **re-select** the updated subscription(s) and print them to confirm the
  persisted value.

**Safety rules for the DB phase:**
- Every query (text + parameter values) is printed before it runs.
- Selection logic prevents accidental bulk updates (explicit `UPDATE ALL` required).
- In **dry-run**: print the queries, candidate rows, chosen target, and computed renewal
  time, but do **not** execute `BEGIN/UPDATE/COMMIT`.

## Phase 3 — Stripe simulation (Playwright, headed)

Launch a **persistent headed Chromium** context from `STRIPE_AUTH_PROFILE_DIR` (`.auth/`)
so the Stripe session is reused across runs. Tracing enabled (see Artifacts).

**Selector policy:** prefer stable role/text/label locators — `getByRole`, `getByText`,
`getByLabel`, `getByPlaceholder`. Avoid fragile generated CSS selectors.

**Timeouts:** use `STRIPE_STEP_TIMEOUT_MS` (default 30s) for standard actions; use
`STRIPE_LONG_TIMEOUT_MS` (default 120s) for waiting on **Collection Paused**, **simulation
completion**, and **Active subscription verification**.

**DB ↔ Stripe cross-check (before advancing the clock):**
- Prefer `stripeCustomerId` (when available on the chosen row) to open the correct Stripe
  customer; otherwise fall back to email search. Email match is always required.
- If the chosen row has `stripeSubscriptionId`, compare it with the **paused** Stripe
  subscription id. If they differ, warn and require manual confirmation before proceeding.

### Helper functions

- `ensureEnvironmentSelected()` — open top-left menu, select
  `STRIPE_ENVIRONMENT_NAME` if not already selected.
- `ensureSandboxMode()` — open top-left menu, click **Switch to sandbox**.
- `ensureTestModeEnabled()` — enable **Test Mode** if not already on.
- `openCustomerByEmail(email)` — Customers tab → Email filter → search → open match.
- `waitForCollectionPaused()` — wait for the **"Collection Paused"** tag on the active
  subscription.
- `openPausedSubscription()` — open the paused subscription.
- `runSimulation()` — click **Run Simulation** (test clock).
- `advanceClockBySpan(span)` — advance the clock toward the target (see below).
- `verifyActiveSubscriptionForEmail(email)` — confirm a new Active subscription.

### Second confirmation before advancing (`ADVANCE` gate)

Before any test-clock advance, print: target **email**, **Stripe customer id**, **paused
subscription id**, requested **advance span**, and computed **target time**. Require the
user to type **`ADVANCE`** to proceed. (Skipped in dry-run, which never advances.)

### Test-clock advance (`advanceClockBySpan`)

- Parse spans like `1 month`, `3 days`, `1 year`.
- Convert the span into a **target test-clock timestamp** (relative to the clock's
  current time).
- **Loop** if Stripe won't allow the full jump in one step: after each advance, wait for
  simulation completion (long timeout), refresh/re-read the current clock time, and
  continue until the target timestamp is reached.

### Login / manual fallback

- On first run (or expired session), if login/2FA is required, **pause** and ask the user
  to complete login manually, then continue.
- Add manual-fallback prompts if the **environment**, **customer**, **subscription**, or
  **simulation button** can't be found automatically (let the user resolve it in the
  open browser, then resume).

## Verification & Final Report

`verifyActiveSubscriptionForEmail` + `report.ts` confirm and report:

- customer email matches the given email
- the old subscription had **Collection Paused**
- after simulation, an **Active** subscription exists for the same customer
- if determinable, the new active subscription id **differs** from the old paused one

**Verify from refreshed detail pages:** after simulation completes, **refresh/re-open**
the customer and subscription pages and confirm **Active** status from the subscription
**detail page** where possible — not only from customer-list cards.

Final **pass/fail report** prints to console **and** is saved to files:

- `artifacts/reports/<timestamp>-downgrade-report.json`
- `artifacts/reports/<timestamp>-downgrade-report.txt`

Report fields:

- DB account id
- DB subscription id (updated)
- old renewal date → new renewal date (UTC)
- Stripe customer id
- old (paused) Stripe subscription id
- new (active) Stripe subscription id
- final status (PASS / FAIL)

## Artifacts & Debugging

- **Playwright tracing** enabled for the Stripe flow; trace saved under `artifacts/`.
- **Screenshots** saved after key steps and on failure:
  - customer opened
  - collection paused found
  - simulation started
  - simulation completed
  - active subscription confirmed
  - failure (on any error)
- Failure screenshot + trace written to `artifacts/` with timestamped names.

## Dry-run Mode

- `DRY_RUN=true` (the default on first run unless explicitly disabled):
  - **No DB writes** (no `BEGIN/UPDATE/COMMIT`).
  - **No Stripe test-clock advance.**
  - Prints DB queries, selected/candidate rows, computed renewal time (local + UTC), and
    the planned Stripe steps.
  - **Does not open Stripe at all** unless `OPEN_STRIPE_IN_DRY_RUN=true`, in which case it
    may navigate/inspect read-only but still never advances the clock.
- `DRY_RUN=false`: execute the DB transaction and the live Stripe simulation.

## Run Instructions & Scripts

`package.json` scripts: `dev` (ts-node/tsx run), `build` (tsc), `start` (run compiled).

```
npm install
cp .env.example .env     # then fill DB creds + Stripe values
npm run dev              # interactive run (dev)
npm run build            # compile TypeScript
npm start                # run compiled build
```

## Error Handling & Safety

- Fail fast with clear messages: account not found, no active subscription, login
  required, element/selector timeouts, ambiguous subscription selection.
- DB writes wrapped in `BEGIN/COMMIT` with `ROLLBACK` on failure.
- Explicit waits for the "Collection Paused" tag and for each test-clock advance.
- Secrets only in `.env` (gitignored). `.env.example` provided.

## Open Items / Assumptions

- Exact Stripe dashboard DOM locators finalized against the live UI during
  implementation (and may need updates as Stripe changes its UI).
- Test-clock max advance per step and the exact "completed" indicator confirmed during
  implementation.
- Subscription columns assumed: `id`, `"accountId"`, `status`, `"renewalDateTime"`,
  `"deletedAt"`, `"stripeSubscriptionId"`, `"createdAt"`, in table `"Subscriptions"`;
  verified against printed rows before any write.
- `renewalDateTime` assumed to store UTC.
