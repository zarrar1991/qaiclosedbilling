# Add Zero Funds Card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Add zero funds card" tab that attaches a zero-funds card (`4000000000000341`) to a Stripe customer + records it in `payment_methods`, then adds a second card (`4000056655665556`) via the internal iClosed Billing page and verifies it.

**Architecture:** Mirrors the Downgrade flow — a renderer page calls an IPC method that runs a main-process orchestrator (`src/zerofunds-flow.ts`) using the shared persistent Stripe auth context and new DB helpers, streaming progress to a `StatusTimeline`. Browser automation reuses `src/stripe-flow.ts` helpers for Stripe login/env/test-mode/customer.

**Tech Stack:** TypeScript (ESM core in `src/`, CJS preload), Electron 33, React 18 + Tailwind renderer, Playwright (`playwright` package — production dep), node-postgres, Vitest.

## Global Constraints

- Keep the existing `window.api`/IPC contract and all current page behaviors intact; this feature is purely additive.
- Runtime/main-process code may import only **production** deps (`dotenv`, `pg`, `playwright`, `electron`) — never `@playwright/test` (devDep, stripped from packaged builds).
- Preload stays CommonJS (`electron/preload.cjs`); channel names inlined in sync with `electron/ipc.ts`.
- Renderer changes hot-reload; `electron/`, `src/`, and preload changes require an Electron restart (`Get-Process electron | Stop-Process -Force`, then `npm start`).
- Cards: zero-funds (Stripe dashboard) = `4000000000000341`; app Billing card = `4000056655665556`.
- `payment_methods` INSERT sets ONLY `accountId`, `userId`, `stripePaymentMethodId`, `type='card'`. `id`/`createdAt`/`updatedAt` are auto-populated; `deletedAt` defaults NULL.
- `ICLOSED_APP_URL` default = `https://dev.iclosed.io` (trailing slashes trimmed); login URL = `${appUrl}/auth/login`.
- Always run this flow **headed**.
- Commit per task. On `main` (the project's established workflow); push only when the user asks.

## File Structure

- `src/cards.ts` (create) — `randomFutureExpiry`, `randomCvc`, `last4`. Pure, unit-tested.
- `tests/cards.test.ts` (create) — tests for the above.
- `src/types.ts` (modify) — add `appUrl: string` to `AppConfig`.
- `src/config.ts` (modify) — parse `ICLOSED_APP_URL` (optional, default).
- `tests/config.test.ts` (modify) — appUrl parsing tests.
- `src/db.ts` (modify) — `lookupUserId`, `insertPaymentMethod`.
- `src/zerofunds-flow.ts` (create) — orchestrator + `addZeroFundsCardInDashboard` + `addCardOnAppBilling`.
- `electron/ipc.ts` (modify) — channels + types.
- `electron/preload.cjs` (modify) — `runZeroFunds`, `onZeroFundsProgress`.
- `ui/lib/api.ts` (modify) — `Api` additions.
- `electron/runners.ts` (modify) — `runZeroFundsUi`.
- `electron/main.ts` (modify) — `zerofunds:run` handler.
- `ui/pages/Settings.tsx` (modify) — "Application" section with `ICLOSED_APP_URL`.
- `ui/components/Sidebar.tsx` (modify) — new `zerofunds` nav item (last).
- `ui/App.tsx` (modify) — route the new page.
- `ui/pages/ZeroFundsCard.tsx` (create) — the new tab.

---

### Task 1: Card helpers (`src/cards.ts`)

**Files:**
- Create: `src/cards.ts`
- Test: `tests/cards.test.ts`

**Interfaces:**
- Produces: `randomFutureExpiry(): string` (`"MM/YY"`), `randomCvc(): string` (3 digits), `last4(cardNumber: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/cards.test.ts
import { describe, it, expect } from "vitest";
import { randomFutureExpiry, randomCvc, last4 } from "../src/cards.js";

describe("card helpers", () => {
  it("randomFutureExpiry is MM/YY with month 01-12", () => {
    for (let i = 0; i < 50; i++) {
      const e = randomFutureExpiry();
      expect(e).toMatch(/^\d{2}\/\d{2}$/);
      const month = Number(e.slice(0, 2));
      expect(month).toBeGreaterThanOrEqual(1);
      expect(month).toBeLessThanOrEqual(12);
    }
  });

  it("randomCvc is exactly 3 digits", () => {
    for (let i = 0; i < 50; i++) expect(randomCvc()).toMatch(/^\d{3}$/);
  });

  it("last4 returns the last 4 digits, ignoring non-digits", () => {
    expect(last4("4000056655665556")).toBe("5556");
    expect(last4("4000 0000 0000 0341")).toBe("0341");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cards.test.ts`
Expected: FAIL — cannot find module `../src/cards.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/cards.ts
// Test-card helpers shared by browser-automation flows.
export function randomFutureExpiry(): string {
  const now = new Date();
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
  const yearsAhead = 3 + Math.floor(Math.random() * 5);
  const yy = String((now.getFullYear() + yearsAhead) % 100).padStart(2, "0");
  return `${month}/${yy}`;
}

export function randomCvc(): string {
  return String(Math.floor(100 + Math.random() * 900));
}

export function last4(cardNumber: string): string {
  return cardNumber.replace(/\D/g, "").slice(-4);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cards.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cards.ts tests/cards.test.ts
git commit -m "feat(cards): shared test-card helpers (expiry/cvc/last4)"
```

---

### Task 2: `ICLOSED_APP_URL` config

**Files:**
- Modify: `src/types.ts` (add `appUrl` to `AppConfig`)
- Modify: `src/config.ts` (parse `ICLOSED_APP_URL`)
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `AppConfig.appUrl: string` (default `https://dev.iclosed.io`, trailing slashes trimmed).

- [ ] **Step 1: Write the failing test** — append to `tests/config.test.ts` inside the `describe("parseConfig", …)` block:

```ts
  it("defaults appUrl to https://dev.iclosed.io when ICLOSED_APP_URL unset", () => {
    const cfg = parseConfig({ ...base });
    expect(cfg.appUrl).toBe("https://dev.iclosed.io");
  });

  it("uses ICLOSED_APP_URL and trims trailing slashes", () => {
    const cfg = parseConfig({ ...base, ICLOSED_APP_URL: "https://app.example.com/" });
    expect(cfg.appUrl).toBe("https://app.example.com");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `cfg.appUrl` is `undefined`.

- [ ] **Step 3a: Add the field to `AppConfig`** in `src/types.ts`. Find the `AppConfig` interface opening:

```ts
export interface AppConfig {
  pg: {
```

Insert `appUrl: string;` as the first member:

```ts
export interface AppConfig {
  appUrl: string;
  pg: {
```

- [ ] **Step 3b: Parse it** in `src/config.ts`. In `parseConfig`, locate the start of the `cfg` object:

```ts
  const cfg: AppConfig = {
    pg: {
```

Change to:

```ts
  const cfg: AppConfig = {
    // Optional: iClosed app base URL for the app-side flows. Default to dev.
    appUrl: (env.ICLOSED_APP_URL?.trim() || "https://dev.iclosed.io").replace(/\/+$/, ""),
    pg: {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (all, including the 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/config.ts tests/config.test.ts
git commit -m "feat(config): ICLOSED_APP_URL setting (AppConfig.appUrl)"
```

---

### Task 3: DB helpers — `lookupUserId`, `insertPaymentMethod`

**Files:**
- Modify: `src/db.ts`

**Interfaces:**
- Consumes: `pg.Pool`, `logQuery` (existing in `src/db.ts`).
- Produces: `lookupUserId(pool, email): Promise<string | null>`; `insertPaymentMethod(pool, { accountId: string; userId: string; stripePaymentMethodId: string; type?: string }): Promise<string>` (returns new row id).

- [ ] **Step 1: Add the helpers** — append to `src/db.ts`:

```ts
export async function lookupUserId(pool: pg.Pool, email: string): Promise<string | null> {
  const sql = `SELECT id FROM users WHERE email = $1;`;
  logQuery(sql, [email]);
  const res = await pool.query(sql, [email]);
  return res.rows.length ? String(res.rows[0].id) : null;
}

// Insert a payment method row. Only the four columns below are set; id,
// createdAt and updatedAt are auto-populated by the DB and deletedAt defaults NULL.
export async function insertPaymentMethod(
  pool: pg.Pool,
  values: { accountId: string; userId: string; stripePaymentMethodId: string; type?: string },
): Promise<string> {
  const sql = `INSERT INTO payment_methods ("accountId","userId","stripePaymentMethodId","type")
    VALUES ($1,$2,$3,$4) RETURNING id;`;
  const params = [Number(values.accountId), Number(values.userId), values.stripePaymentMethodId, values.type ?? "card"];
  logQuery(sql, params);
  const res = await pool.query(sql, params);
  return String(res.rows[0].id);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/db.ts
git commit -m "feat(db): lookupUserId + insertPaymentMethod helpers"
```

---

### Task 4: IPC contract — channels, types, preload, api

**Files:**
- Modify: `electron/ipc.ts`
- Modify: `electron/preload.cjs`
- Modify: `ui/lib/api.ts`

**Interfaces:**
- Produces: channels `CH.zerofundsRun = "zerofunds:run"`, `CH.zerofundsProgress = "zerofunds:progress"`; types `ZeroFundsRequest { email: string; password: string }`, `ZeroFundsResult { stripeCustomerId: string | null; paymentMethodId: string | null; dbPaymentMethodId: string | null; appCardLast4: string | null; verified: boolean; notes: string[] }`, `ZeroFundsProgress { step: string; message: string }`. `window.api.runZeroFunds(profile, req): Promise<IpcResult<ZeroFundsResult>>`, `window.api.onZeroFundsProgress(cb): () => void`.

- [ ] **Step 1: Add types + channels** in `electron/ipc.ts`. Before the `export const CH = {` line, add:

```ts
export interface ZeroFundsRequest { email: string; password: string }
export interface ZeroFundsResult {
  stripeCustomerId: string | null;
  paymentMethodId: string | null;
  dbPaymentMethodId: string | null;
  appCardLast4: string | null;
  verified: boolean;
  notes: string[];
}
export interface ZeroFundsProgress { step: string; message: string }
```

Then inside the `CH` object, after `windowClose: "window:close",`, add:

```ts
  zerofundsRun: "zerofunds:run",
  zerofundsProgress: "zerofunds:progress",
```

- [ ] **Step 2: Expose in preload** — in `electron/preload.cjs`, add to the `CH` object (after `windowClose`):

```js
  zerofundsRun: "zerofunds:run",
  zerofundsProgress: "zerofunds:progress",
```

Then in the `exposeInMainWorld("api", { … })` object, after the `windowClose` line, add:

```js
  // Add zero funds card
  runZeroFunds: (profile, req) => ipcRenderer.invoke(CH.zerofundsRun, { profile, req }),
  onZeroFundsProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on(CH.zerofundsProgress, listener);
    return () => ipcRenderer.removeListener(CH.zerofundsProgress, listener);
  },
```

- [ ] **Step 3: Add to the `Api` interface** in `ui/lib/api.ts`. Update the imports on line 1 to include the new types:

```ts
import type { IpcResult, RenewalCandidates, RenewalUpdateRequest, RenewalUpdateResult, SubscriptionSearchResult, ProfilesList, IClosedCreateRequest, IClosedResult, IClosedProgress, ZeroFundsRequest, ZeroFundsResult, ZeroFundsProgress } from "../../electron/ipc.js";
```

Then inside `interface Api`, after the `windowClose(): Promise<void>;` line, add:

```ts
  // Add zero funds card
  runZeroFunds(profile: string, req: ZeroFundsRequest): Promise<IpcResult<ZeroFundsResult>>;
  onZeroFundsProgress(cb: (p: ZeroFundsProgress) => void): () => void;
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: exit 0. (`ui/lib/api.ts` is checked via the renderer build later; the electron project covers `ipc.ts`.)

- [ ] **Step 5: Commit**

```bash
git add electron/ipc.ts electron/preload.cjs ui/lib/api.ts
git commit -m "feat(ipc): zerofunds channels, types, preload + api bindings"
```

---

### Task 5: Backend orchestrator — `src/zerofunds-flow.ts`

**Files:**
- Create: `src/zerofunds-flow.ts`

**Interfaces:**
- Consumes: `launchStripeContext`, `ensureLoggedIn`, `ensureEnvironmentSelected`, `ensureTestMode`, `openCustomerByEmail` from `src/stripe-flow.ts`; `randomFutureExpiry`, `randomCvc`, `last4` from `src/cards.ts`; `AppConfig` from `src/types.ts`.
- Produces: `runZeroFundsFlow(cfg: AppConfig, req: { email: string; password: string }, hooks?: { onStatus?: (step: string, message: string) => void; waitForLogin?: (page: import("playwright").Page) => Promise<void> }): Promise<{ stripeCustomerId: string | null; paymentMethodId: string | null; appCardLast4: string | null; verified: boolean; notes: string[] }>`.

> NOTE: Selectors for the Stripe dashboard add-card modal and the internal iClosed Billing form are best-guess here and **finalized in Task 9 (headed pass)**. Keep each step wrapped so a missing selector throws a clear, single-line error (surfaced as a red result), never blocks.

- [ ] **Step 1: Create the file with the orchestrator and helpers**

```ts
// src/zerofunds-flow.ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import type { AppConfig } from "./types.js";
import {
  launchStripeContext, ensureLoggedIn, ensureEnvironmentSelected, ensureTestMode, openCustomerByEmail,
} from "./stripe-flow.js";
import { randomFutureExpiry, randomCvc, last4 } from "./cards.js";

const ZERO_FUNDS_CARD = "4000000000000341";
const APP_CARD = "4000056655665556";
const ARTIFACTS = "artifacts";

export interface ZeroFundsHooks {
  onStatus?: (step: string, message: string) => void;
  waitForLogin?: (page: Page) => Promise<void>;
}

export interface ZeroFundsFlowResult {
  stripeCustomerId: string | null;
  paymentMethodId: string | null;
  appCardLast4: string | null;
  verified: boolean;
  notes: string[];
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = join(ARTIFACTS, "screenshots");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${Date.now()}-zf-${name}.png`), fullPage: true }).catch(() => undefined);
}

// Fill a card field that may be a bare input or live inside a Stripe Elements
// iframe. Tries the page first, then any frame exposing a matching textbox.
async function fillCardField(page: Page, name: RegExp, value: string): Promise<void> {
  const direct = page.getByRole("textbox", { name }).first();
  if (await direct.isVisible().catch(() => false)) { await direct.fill(value); return; }
  for (const frame of page.frames()) {
    const inFrame = frame.getByRole("textbox", { name }).first();
    if (await inFrame.isVisible().catch(() => false)) { await inFrame.fill(value); return; }
  }
  throw new Error(`Could not find the "${name.source}" field.`);
}

// Steps 11-20: add the zero-funds card in the Stripe dashboard, then read its pm_ id.
export async function addZeroFundsCardInDashboard(page: Page, cfg: AppConfig): Promise<string> {
  // Open the "Add a payment method" / "Add card" UI from the Payment methods section.
  const addBtn = page.getByRole("button", { name: /add (a )?payment method|add card/i }).first();
  await addBtn.waitFor({ state: "visible", timeout: cfg.stripe.stepTimeoutMs });
  await addBtn.click();
  const addCard = page.getByRole("menuitem", { name: /add card/i })
    .or(page.getByRole("button", { name: /^add card$/i })).first();
  if (await addCard.isVisible().catch(() => false)) await addCard.click();

  await fillCardField(page, /card number/i, ZERO_FUNDS_CARD);
  await fillCardField(page, /expir/i, randomFutureExpiry());
  await fillCardField(page, /cvc|cvv/i, randomCvc());

  await page.getByRole("button", { name: /^add card$/i }).first().click({ timeout: cfg.stripe.stepTimeoutMs });

  // Wait for the new …0341 method, open it, then read the pm_ id from the page.
  const cardRow = page.getByText(/0341/).first();
  await cardRow.waitFor({ state: "visible", timeout: cfg.stripe.longTimeoutMs });
  await cardRow.click();
  const pmText = page.getByText(/pm_[A-Za-z0-9]+/).first();
  await pmText.waitFor({ state: "visible", timeout: cfg.stripe.stepTimeoutMs });
  const pm = (await pmText.innerText().catch(() => "")).match(/pm_[A-Za-z0-9]+/)?.[0] ?? null;
  await shot(page, "pm-captured");
  if (!pm) throw new Error("Could not read the pm_ id of the added card.");
  return pm;
}

// Steps 24-35: log into the app, add a card on the internal Billing page, verify it.
export async function addCardOnAppBilling(
  page: Page, cfg: AppConfig, email: string, password: string,
): Promise<{ last4: string; verified: boolean }> {
  await page.goto(`${cfg.appUrl}/auth/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: /email/i }).first().fill(email);
  await page.getByRole("textbox", { name: /password/i }).first().fill(password);
  await page.getByRole("button", { name: /log ?in|sign ?in/i }).first().click();
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);

  await page.getByRole("link", { name: /settings/i }).or(page.getByRole("button", { name: /settings/i })).first().click();
  await page.getByRole("link", { name: /billing/i }).first().click();
  await page.getByRole("button", { name: /add new payment method|add payment method/i }).first().click();

  await fillCardField(page, /card number/i, APP_CARD);
  await fillCardField(page, /expir/i, randomFutureExpiry());
  await fillCardField(page, /cvc|cvv/i, randomCvc());
  await page.getByRole("button", { name: /^add card$/i }).first().click({ timeout: cfg.stripe.stepTimeoutMs });

  const wanted = last4(APP_CARD); // "5556"
  const verified = await page.getByText(new RegExp(wanted)).first()
    .waitFor({ state: "visible", timeout: cfg.stripe.longTimeoutMs }).then(() => true).catch(() => false);
  await shot(page, verified ? "app-card-verified" : "app-card-missing");
  return { last4: wanted, verified };
}

export async function runZeroFundsFlow(
  cfg: AppConfig, req: { email: string; password: string }, hooks: ZeroFundsHooks = {},
): Promise<ZeroFundsFlowResult> {
  const status = (s: string, m: string) => hooks.onStatus?.(s, m);
  const notes: string[] = [];
  const context = await launchStripeContext(cfg);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    status("LOGIN", "Ensuring Stripe login…");
    await ensureLoggedIn(page, cfg, hooks);
    status("ENVIRONMENT", "Ensuring correct environment is selected…");
    await ensureEnvironmentSelected(page, cfg, hooks);
    status("TESTMODE", "Ensuring Test mode is active…");
    await ensureTestMode(page, hooks);

    status("CUSTOMER", "Opening customer by email…");
    const stripeCustomerId = await openCustomerByEmail(page, cfg, req.email, hooks);

    status("DASHBOARD CARD", "Adding zero-funds card in Stripe…");
    const paymentMethodId = await addZeroFundsCardInDashboard(page, cfg);

    status("APP BILLING", "Adding card on the iClosed Billing page…");
    const app = await addCardOnAppBilling(page, cfg, req.email, req.password);
    if (!app.verified) notes.push(`App card ending ${app.last4} was not confirmed on the Billing page.`);

    status("DONE", "Zero funds flow complete.");
    return { stripeCustomerId, paymentMethodId, appCardLast4: app.last4, verified: app.verified, notes };
  } catch (err) {
    await shot(page, "failure");
    throw err;
  } finally {
    await context.close().catch(() => undefined);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/zerofunds-flow.ts
git commit -m "feat(zerofunds): browser+DB orchestrator (initial selectors)"
```

---

### Task 6: Runner + main handler

**Files:**
- Modify: `electron/runners.ts`
- Modify: `electron/main.ts`

**Interfaces:**
- Consumes: `runZeroFundsFlow` (Task 5); `createPool`, `lookupAccountId`, `lookupUserId`, `insertPaymentMethod` (Tasks 3 + existing `src/db.ts`); `ZeroFundsRequest`, `ZeroFundsResult`, `ZeroFundsProgress` (Task 4).
- Produces: `runZeroFundsUi(cfg: AppConfig, req: ZeroFundsRequest, onProgress: (p: ZeroFundsProgress) => void): Promise<ZeroFundsResult>`; `ipcMain.handle(CH.zerofundsRun, …)`.

- [ ] **Step 1: Add the runner** — in `electron/runners.ts`, extend the imports and append the function.

Update the `src/db.js` import to add the two helpers:

```ts
import { createPool, lookupAccountId, lookupUserId, insertPaymentMethod, fetchSubscriptions, fetchAllSubscriptions, fetchCampaigns, updateRenewal, reselectByIds } from "../src/db.js";
```

Update the `./ipc.js` type import to add the zerofunds types:

```ts
import type { RenewalCandidates, RenewalUpdateRequest, RenewalUpdateResult, FullFlowProgress, SubscriptionSearchResult, ZeroFundsRequest, ZeroFundsResult, ZeroFundsProgress } from "./ipc.js";
```

Add the import for the flow near the `runStripeSimulation` import:

```ts
import { runZeroFundsFlow } from "../src/zerofunds-flow.js";
```

Append the runner:

```ts
export async function runZeroFundsUi(
  cfg: AppConfig,
  req: ZeroFundsRequest,
  onProgress: (p: ZeroFundsProgress) => void,
): Promise<ZeroFundsResult> {
  const pool = createPool(cfg);
  try {
    const flow = await runZeroFundsFlow(cfg, req, {
      onStatus: (step, message) => onProgress({ step, message }),
      waitForLogin: async (page) => {
        await page
          .getByRole("button", { name: /account options and switcher/i })
          .first()
          .waitFor({ state: "visible", timeout: cfg.stripe.longTimeoutMs });
      },
    });

    onProgress({ step: "DB", message: "Recording payment method in the database…" });
    const accountId = await lookupAccountId(pool, req.email);
    if (!accountId) throw new Error(`No account found for email ${req.email}`);
    const userId = await lookupUserId(pool, req.email);
    if (!userId) throw new Error(`No user found for email ${req.email}`);
    if (!flow.paymentMethodId) throw new Error("No Stripe payment method id was captured.");
    const dbPaymentMethodId = await insertPaymentMethod(pool, {
      accountId, userId, stripePaymentMethodId: flow.paymentMethodId, type: "card",
    });

    onProgress({ step: "DONE", message: `Done${flow.verified ? "" : " (app card not confirmed)"}.` });
    return {
      stripeCustomerId: flow.stripeCustomerId,
      paymentMethodId: flow.paymentMethodId,
      dbPaymentMethodId,
      appCardLast4: flow.appCardLast4,
      verified: flow.verified,
      notes: flow.notes,
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}
```

> NOTE: The DB insert here runs AFTER the browser flow completes. The flow already added the app card too; this ordering matches the spec's best-effort, non-transactional behavior (the `pm_` is captured mid-flow and recorded once the browser work returns).

- [ ] **Step 2: Add the IPC handler** — in `electron/main.ts`, add to the `./runners.js` import:

```ts
import { getRenewalCandidates, searchSubscriptionsUi, listCampaignsUi, updateRenewalUi, runFullFlowUi, runZeroFundsUi } from "./runners.js";
```

Add the type to the `./ipc.js` import (append `ZeroFundsRequest`):

```ts
import { CH, type IpcResult, type RenewalUpdateRequest, type ProfilesList, type IClosedCreateRequest, type IClosedResult, type IClosedProgress, type CampaignLink, type ZeroFundsRequest } from "./ipc.js";
```

Near the other `ipcMain.handle` calls (e.g. after the `fullflowRun` handler), add:

```ts
ipcMain.handle(CH.zerofundsRun, (e, p: { profile: string; req: ZeroFundsRequest }) =>
  wrap(() => runZeroFundsUi(loadCfg(p.profile), p.req, (pr) => e.sender.send(CH.zerofundsProgress, pr))),
);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add electron/runners.ts electron/main.ts
git commit -m "feat(zerofunds): runner + IPC handler wiring"
```

---

### Task 7: Settings — "Application" section (`ICLOSED_APP_URL`)

**Files:**
- Modify: `ui/pages/Settings.tsx`

**Interfaces:**
- Consumes: existing `section(title, keys, secretKey?)` helper + `Field`.

- [ ] **Step 1: Add the key list** — in `ui/pages/Settings.tsx`, after the `BO_KEYS` constant, add:

```ts
const APP_KEYS = ["ICLOSED_APP_URL"];
```

- [ ] **Step 2: Render the section** — in the JSX, after the line `{section("Back Office API", BO_KEYS, "BO_PASSWORD")}` add:

```tsx
      {section("Application", APP_KEYS)}
```

- [ ] **Step 3: Verify the renderer builds**

Run: `npm run ui:build`
Expected: built, no errors.

- [ ] **Step 4: Commit**

```bash
git add ui/pages/Settings.tsx
git commit -m "feat(ui): ICLOSED_APP_URL field in Settings (Application)"
```

---

### Task 8: New tab — Sidebar, routing, page

**Files:**
- Modify: `ui/components/Sidebar.tsx`
- Modify: `ui/App.tsx`
- Create: `ui/pages/ZeroFundsCard.tsx`

**Interfaces:**
- Consumes: `api.runZeroFunds`, `api.onZeroFundsProgress` (Task 4); `Field`, `Banner`, `StatusTimeline`, `humanizeError`.
- Produces: `Page` type extended with `"zerofunds"`; `<ZeroFundsCard profile={profile} />`.

- [ ] **Step 1: Extend the Sidebar** — in `ui/components/Sidebar.tsx`:

Change the `Page` type:

```ts
export type Page = "renewal" | "full" | "createuser" | "settings" | "zerofunds";
```

Add a credit-card icon to the `ICONS` map (after the `settings` entry):

```ts
  zerofunds: svg(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>),
```

Add the nav item to `ITEMS` as the **last** entry (after `settings`):

```ts
  { id: "zerofunds", label: "Add zero funds card" },
```

- [ ] **Step 2: Route it** — in `ui/App.tsx`:

Add the import near the other page imports:

```ts
import { ZeroFundsCard } from "./pages/ZeroFundsCard.js";
```

In the `<main>` body, after the `{page === "settings" && <Settings … />}` line, add:

```tsx
              {page === "zerofunds" && <ZeroFundsCard profile={profile} />}
```

- [ ] **Step 3: Create the page** — `ui/pages/ZeroFundsCard.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Field } from "../components/Field.js";
import { Banner } from "../components/Banner.js";
import { StatusTimeline, type Step } from "../components/StatusTimeline.js";
import { humanizeError } from "../lib/errors.js";
import type { ZeroFundsResult } from "../../electron/ipc.js";

type RunState = "idle" | "running" | "success" | "error";

export function ZeroFundsCard({ profile }: { profile: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<RunState>("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<ZeroFundsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => api.onZeroFundsProgress((p) => setSteps((s) => [...s, p])), []);

  const running = state === "running";
  const canRun = !running && email.trim() !== "" && password.trim() !== "" && !!profile;

  async function run() {
    setState("running"); setSteps([]); setResult(null); setError(null);
    const res = await api.runZeroFunds(profile, { email: email.trim(), password });
    if (!res.ok) { setError(humanizeError(res.error)); setState("error"); return; }
    setResult(res.data); setState(res.data.verified ? "success" : "error");
  }

  return (
    <div className="max-w-[820px]">
      <h1 className="ic-page-title">Add zero funds card</h1>

      <div className="max-w-[420px]">
        <Field label="Email" value={email} onChange={setEmail} placeholder="demo@example.com" />
      </div>
      <div className="mt-4 max-w-[420px]">
        <Field label="Password" value={password} onChange={setPassword} type="password" />
      </div>

      <button disabled={!canRun} onClick={run} className="ic-btn-primary mt-[18px] px-[22px] py-[9px] text-[13px]">
        {running ? "Adding…" : "Add"}
      </button>

      {steps.length > 0 && (
        <div className="ic-card mt-[22px] p-[18px]">
          <StatusTimeline steps={steps} done={state === "success"} failed={state === "error"} />
        </div>
      )}

      {error && <div className="mt-3.5"><Banner kind="error" title="Add failed">{error}</Banner></div>}

      {result && (
        <div className="mt-3.5">
          <Banner kind={result.verified ? "success" : "error"} title={result.verified ? "Zero funds card added" : "Completed with warnings"}>
            <div className="space-y-0.5 font-mono text-[12px]">
              <div>stripe pm {result.paymentMethodId ?? "-"}</div>
              <div>payment_methods id {result.dbPaymentMethodId ?? "-"}</div>
              <div>app card …{result.appCardLast4 ?? "----"} {result.verified ? "verified" : "NOT confirmed"}</div>
              {result.notes.length > 0 && <div>notes: {result.notes.join("; ")}</div>}
            </div>
          </Banner>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify the renderer builds**

Run: `npm run ui:build`
Expected: built, no errors.

- [ ] **Step 5: Commit**

```bash
git add ui/components/Sidebar.tsx ui/App.tsx ui/pages/ZeroFundsCard.tsx
git commit -m "feat(ui): Add zero funds card tab (page + nav + routing)"
```

---

### Task 9: Headed end-to-end verification + selector finalization

**Files:**
- Modify (as needed): `src/zerofunds-flow.ts`

**Goal:** Run the real flow headed against a dev account and finalize the unseen-DOM selectors (Stripe dashboard add-card modal incl. the `pm_` ID field; the internal iClosed Billing add-card form). This task is iterative debugging, not TDD.

- [ ] **Step 1: Pre-reqs** — confirm Settings has a valid profile (DB, Stripe, `ICLOSED_APP_URL`), the Stripe `.auth` session is logged in (run the Downgrade page once if needed), and the dev account email/password are known.

- [ ] **Step 2: Build backend + start the app**

Run (PowerShell): `Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force; npm start`
Expected: app launches; open the "Add zero funds card" tab.

- [ ] **Step 3: Run the flow** with the test account's Email + Password and watch the headed browser. Note the exact step where a selector fails (the timeline shows the last step; the result shows the error).

- [ ] **Step 4: Fix the failing selector** in `src/zerofunds-flow.ts` using the live DOM (use the headed browser's devtools / Playwright's `getByRole`/`getByText` against the actual labels). Change ONE selector, rebuild backend (`Get-Process electron | Stop-Process -Force; npm start`), re-run. Repeat per failing step. Capture screenshots are saved under `artifacts/screenshots/zf-*.png` to aid diagnosis.

- [ ] **Step 5: Confirm success end-to-end** — the `…0341` card exists on the Stripe customer, a new `payment_methods` row exists (`SELECT * FROM payment_methods WHERE "stripePaymentMethodId" = '<pm_…>'`), and the `…5556` card shows on the app Billing page; the result card shows green "Zero funds card added".

- [ ] **Step 6: Commit the finalized selectors**

```bash
git add src/zerofunds-flow.ts
git commit -m "fix(zerofunds): finalize Stripe dashboard + Billing selectors (headed verification)"
```

---

## Self-Review

- **Spec coverage:** App-URL setting → Tasks 2 + 7. `pm_` read from page → Task 5 (`addZeroFundsCardInDashboard`). Reuse saved Stripe login → Task 5 (reused `launchStripeContext`/`ensureLoggedIn`). `payment_methods` insert (4 cols) → Task 3. Steps 1-10 → Task 5 (reused helpers). Steps 11-20 → Task 5. Steps 21-23 → Tasks 3 + 6. Steps 24-35 → Task 5 (`addCardOnAppBilling`). UI tab + result/timeline → Task 8. IPC/runner/main → Tasks 4 + 6. Error handling/screenshots → Task 5. Selector-discovery risk → Task 9. All covered.
- **Placeholder scan:** No TBD/TODO; every code step has full code. The only "discover later" is Task 9, which is an explicit verification task with concrete steps, not a placeholder in code.
- **Type consistency:** `ZeroFundsResult` fields (`stripeCustomerId`, `paymentMethodId`, `dbPaymentMethodId`, `appCardLast4`, `verified`, `notes`) are identical across `ipc.ts` (Task 4), the runner return (Task 6), and the page consumer (Task 8). `runZeroFundsFlow` returns the flow-level subset (no `dbPaymentMethodId`); the runner adds `dbPaymentMethodId` from `insertPaymentMethod` — consistent. `runZeroFunds(profile, req)` signature matches preload, api, and handler payload `{ profile, req }`.
