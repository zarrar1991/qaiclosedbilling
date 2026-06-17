# Electron UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Electron desktop app with three pages (Renewal, Full downgrade, Settings) that reuses the existing TS core to update DB renewal dates and drive the Stripe test-clock downgrade, with a modern React/Tailwind UI and clear success/failure messages.

**Architecture:** Electron 3-process model. The **main** process imports the existing core modules (`config/db/time/selection/stripe-flow/report`) and exposes typed IPC handlers; **preload** bridges a minimal `window.api`; the **renderer** is a Vite + React + Tailwind SPA. The Stripe flow gains optional non-interactive hooks so the UI can drive it (login becomes a poll, the button replaces the `ADVANCE` prompt) while the CLI keeps its terminal prompts. Settings read/write `.env`.

**Tech Stack:** Electron, TypeScript, Vite, React, Tailwind CSS, electron-builder, Playwright (existing), pg (existing), Vitest.

Spec: `docs/superpowers/specs/2026-06-17-electron-ui-design.md`

---

## File Structure

```
electron/
  ipc.ts            # channel names + request/response & progress types (shared contract)
  main.ts           # app lifecycle, BrowserWindow, registers IPC handlers
  preload.ts        # contextBridge -> window.api
  runners.ts        # renewal + full-flow orchestration (calls core, emits progress)
  paths.ts          # resolve .env path, .auth dir, packaged Chromium executablePath
src/
  env-file.ts       # NEW: parse/serialize/read/write .env (pure + fs)
  stripe-flow.ts    # MODIFY: add optional StripeFlowHooks (non-interactive UI mode)
  span.ts           # NEW: preset/custom interval -> span string mapping
ui/
  index.html
  main.tsx          # React root
  App.tsx           # layout + page routing (sidebar)
  styles.css        # Tailwind entry
  lib/api.ts        # typed wrapper over window.api
  components/Sidebar.tsx  Banner.tsx  Field.tsx  StatusTimeline.tsx  SubscriptionPicker.tsx
  pages/Renewal.tsx  FullDowngrade.tsx  Settings.tsx
tests/
  env-file.test.ts
  span.test.ts
electron-builder.yml
vite.config.ts
run.bat
tsconfig.electron.json   # build config for electron main/preload
```

Build model: renderer built by Vite to `dist-ui/`; electron main/preload compiled by `tsc` (or esbuild) to `dist-electron/`. `npm start` builds both then launches Electron.

---

## Task 1: env-file core (TDD)

**Files:**
- Create: `src/env-file.ts`
- Test: `tests/env-file.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/env-file.test.ts
import { describe, it, expect } from "vitest";
import { parseEnvFile, serializeEnv } from "../src/env-file.js";

describe("parseEnvFile", () => {
  it("parses key=value lines, ignoring comments/blanks", () => {
    const txt = "# c\nPGHOST=localhost\n\nPGPASSWORD=a=b!x\n";
    expect(parseEnvFile(txt)).toEqual({ PGHOST: "localhost", PGPASSWORD: "a=b!x" });
  });
});

describe("serializeEnv", () => {
  it("updates existing keys in place, preserving comments and order", () => {
    const original = "# db\nPGHOST=old\nPGPORT=5432\n";
    const out = serializeEnv({ PGHOST: "new", PGPORT: "5432" }, original);
    expect(out).toBe("# db\nPGHOST=new\nPGPORT=5432\n");
  });
  it("appends keys that are not already present", () => {
    const out = serializeEnv({ PGHOST: "h", PGSCHEMA: "s" }, "PGHOST=h\n");
    expect(out).toContain("PGHOST=h");
    expect(out).toMatch(/PGSCHEMA=s\n?$/);
  });
  it("round-trips values containing = and special chars", () => {
    const vals = { PGPASSWORD: "J7X5!oM*gsl=z" };
    expect(parseEnvFile(serializeEnv(vals, ""))).toEqual(vals);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/env-file.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/env-file.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1);
  }
  return out;
}

export function serializeEnv(values: Record<string, string>, original: string): string {
  const remaining = { ...values };
  const lines = original.length ? original.split(/\r?\n/) : [];
  const result = lines.map((raw) => {
    const t = raw.trim();
    if (!t || t.startsWith("#")) return raw;
    const eq = t.indexOf("=");
    if (eq === -1) return raw;
    const key = t.slice(0, eq).trim();
    if (key in remaining) {
      const v = remaining[key];
      delete remaining[key];
      return `${key}=${v}`;
    }
    return raw;
  });
  // Drop a single trailing empty string from a final newline so we re-add cleanly.
  if (result.length && result[result.length - 1] === "") result.pop();
  for (const [k, v] of Object.entries(remaining)) result.push(`${k}=${v}`);
  return result.join("\n") + "\n";
}

export function readEnv(path: string): Record<string, string> {
  return existsSync(path) ? parseEnvFile(readFileSync(path, "utf8")) : {};
}

export function writeEnv(path: string, values: Record<string, string>): void {
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, serializeEnv(values, original), "utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/env-file.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/env-file.ts tests/env-file.test.ts
git commit -m "feat: .env parse/serialize helpers for settings"
```

---

## Task 2: span/interval mapping (TDD)

**Files:**
- Create: `src/span.ts`
- Test: `tests/span.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/span.test.ts
import { describe, it, expect } from "vitest";
import { intervalToSpanString } from "../src/span.js";

describe("intervalToSpanString", () => {
  it("maps presets to span strings", () => {
    expect(intervalToSpanString({ kind: "preset", preset: "1 day" })).toBe("1 day");
    expect(intervalToSpanString({ kind: "preset", preset: "1 month" })).toBe("1 month");
    expect(intervalToSpanString({ kind: "preset", preset: "1 year" })).toBe("1 year");
  });
  it("maps custom amount+unit to a span string", () => {
    expect(intervalToSpanString({ kind: "custom", amount: 3, unit: "day" })).toBe("3 days");
    expect(intervalToSpanString({ kind: "custom", amount: 1, unit: "month" })).toBe("1 month");
    expect(intervalToSpanString({ kind: "custom", amount: 2, unit: "year" })).toBe("2 years");
  });
  it("rejects non-positive custom amounts", () => {
    expect(() => intervalToSpanString({ kind: "custom", amount: 0, unit: "day" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/span.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/span.ts
export type Interval =
  | { kind: "preset"; preset: "1 day" | "1 week" | "1 month" | "1 year" }
  | { kind: "custom"; amount: number; unit: "day" | "month" | "year" };

// Returns a string compatible with parseSpan() in src/time.ts.
export function intervalToSpanString(i: Interval): string {
  if (i.kind === "preset") {
    // "1 week" -> parseSpan doesn't support weeks; expand to 7 days.
    return i.preset === "1 week" ? "7 days" : i.preset;
  }
  if (!Number.isInteger(i.amount) || i.amount <= 0) {
    throw new Error(`Interval amount must be a positive integer (got ${i.amount}).`);
  }
  const unit = i.amount === 1 ? i.unit : `${i.unit}s`;
  return `${i.amount} ${unit}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/span.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/span.ts tests/span.test.ts
git commit -m "feat: interval-to-span mapping for the UI"
```

---

## Task 3: Non-interactive hooks in stripe-flow

**Files:**
- Modify: `src/stripe-flow.ts`

> No new unit test (drives the live dashboard). Verified via the full-flow dev run in Task 11. The change must keep CLI behavior identical when `hooks` is omitted.

- [ ] **Step 1: Add the hooks type and thread it through `runStripeSimulation`**

In `src/stripe-flow.ts`, add this interface near the other interfaces (after `StripeFlowResult`):

```ts
export interface StripeFlowHooks {
  onStatus?: (step: string, message: string) => void;
  // UI mode: resolve once the dashboard is ready (poll), instead of a terminal prompt.
  waitForLogin?: (page: Page) => Promise<void>;
  // UI mode: return true to advance (the UI button is the confirmation).
  confirmAdvance?: (details: { targetIso: string }) => Promise<boolean>;
}
```

- [ ] **Step 2: Add a small status helper and use hooks in the orchestrator**

Change the signature of `runStripeSimulation` to accept hooks, and replace the standalone `confirmAdvance` param with the hooks version. Replace the existing function signature:

```ts
export async function runStripeSimulation(
  cfg: AppConfig,
  input: StripeFlowInput,
  hooks: StripeFlowHooks = {},
): Promise<StripeFlowResult> {
  const status = (step: string, message: string) => hooks.onStatus?.(step, message);
```

Then, inside the function body, replace the previous `confirmAdvance(...)` call block with:

```ts
    const targetIso = addSpan(new Date(), input.span).toISOString();
    const proceed = hooks.confirmAdvance ? await hooks.confirmAdvance({ targetIso }) : true;
    if (!proceed) {
      notes.push("Advance not confirmed; clock not advanced.");
      await context.tracing.stop({ path: join(ARTIFACTS, `trace-${Date.now()}.zip`) }).catch(() => undefined);
      return {
        stripeCustomerId,
        oldStripeSubscriptionId,
        newStripeSubscriptionId: null,
        collectionPausedSeen,
        activeSubscriptionConfirmed: false,
        notes,
      };
    }
```

And add `status(...)` calls at each stage boundary (before each helper call), e.g.:

```ts
    status("login", "Opening Stripe dashboard…");
    await ensureLoggedIn(page, cfg, hooks);
    status("environment", "Selecting environment…");
    await ensureEnvironmentSelected(page, cfg);
    status("testmode", "Switching to test mode…");
    await ensureTestMode(page);
    status("customer", `Opening customer ${input.email}…`);
    const stripeCustomerId = await openCustomerByEmail(page, cfg, input.email);
    status("paused", "Waiting for Collection paused…");
    const collectionPausedSeen = await waitForCollectionPaused(page, cfg);
    status("subscription", "Opening paused subscription…");
    const oldStripeSubscriptionId = await openPausedSubscription(page, cfg);
    status("simulation", "Starting simulation…");
    // (runSimulation is called inside advanceClockBySpan via runSimulation; keep existing order)
    status("advancing", "Advancing the test clock…");
    await advanceClockBySpan(page, cfg, input.span);
    status("verifying", "Verifying the new active subscription…");
    const verify = await verifyActiveSubscriptionForEmail(page, cfg, stripeCustomerId, input.email, oldStripeSubscriptionId);
    status("done", "Simulation complete.");
```

(Keep the existing variable names and the existing mismatch-note logic; only add `status(...)` lines and swap the confirm/login calls. Do not duplicate variable declarations.)

- [ ] **Step 3: Make `ensureLoggedIn` use the hook when provided**

Replace the body of `ensureLoggedIn` so it accepts hooks and, in UI mode, polls instead of prompting:

```ts
async function ensureLoggedIn(page: Page, cfg: AppConfig, hooks: StripeFlowHooks = {}): Promise<void> {
  await page.goto(cfg.stripe.dashboardUrl, { waitUntil: "domcontentloaded" });
  const needsLogin = /\/login|\/signin|authenticate/i.test(page.url()) || (await accountSwitcher(page).count()) === 0;
  if (!needsLogin) return;
  if (hooks.waitForLogin) {
    hooks.onStatus?.("login", "Waiting for you to log into Stripe in the opened window…");
    await hooks.waitForLogin(page);
  } else {
    await promptEnterWhenReady(
      "Stripe login/2FA may be required. Complete login in the opened browser so the dashboard is visible,",
    );
  }
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify CLI still works (regression)**

Run: `npx vitest run`
Expected: existing 25 tests pass (21 prior + env-file 4 + span 3 = 28; accept the current count, all green).
Then confirm `src/index.ts` still compiles and calls `runStripeSimulation(cfg, {...}, async ({targetIso}) => {...})`. Since the 3rd arg is now `hooks`, update `src/index.ts` to pass a hooks object instead of a bare callback:

In `src/index.ts`, replace the `runStripeSimulation(cfg, {...}, async ({ targetIso }) => {...})` call's third argument with:

```ts
      {
        confirmAdvance: async ({ targetIso }) => {
          if (cfg.dryRun) {
            console.log(`[DRY_RUN] Would advance clock toward ${targetIso}. Not advancing.`);
            return false;
          }
          return promptTypeToken(
            "ADVANCE",
            `About to advance Stripe test clock:\n  email: ${email}\n  customer: ${expectedCusId ?? "-"}\n  paused sub: ${expectedSubId ?? "-"}\n  span: ${spanRaw}\n  target: ${targetIso}`,
          );
        },
      },
```

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/stripe-flow.ts src/index.ts
git commit -m "feat: non-interactive hooks in stripe-flow (UI mode), CLI unchanged"
```

---

## Task 4: paths + IPC contract

**Files:**
- Create: `electron/paths.ts`, `electron/ipc.ts`

- [ ] **Step 1: Create `electron/paths.ts`**

```ts
// electron/paths.ts
import { app } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";

// In dev, use the repo files; when packaged, use the per-user data dir.
export function envPath(): string {
  return app.isPackaged ? join(app.getPath("userData"), ".env") : join(process.cwd(), ".env");
}

export function authProfileDir(): string {
  return app.isPackaged ? join(app.getPath("userData"), ".auth") : join(process.cwd(), ".auth");
}

// When packaged, point Playwright at the bundled Chromium (set in Task 10).
// In dev, return undefined so Playwright uses its normally-installed browser.
export function bundledChromiumPath(): string | undefined {
  if (!app.isPackaged) return undefined;
  const base = join(process.resourcesPath, "ms-playwright");
  return existsSync(base) ? base : undefined;
}
```

- [ ] **Step 2: Create `electron/ipc.ts` (shared types + channel names)**

```ts
// electron/ipc.ts
import type { SubscriptionRow, RunReport } from "../src/types.js";

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface SettingsValues { [key: string]: string }

export interface RenewalCandidates { accountId: string; rows: SubscriptionRow[] }
export interface RenewalUpdateRequest { id?: string; accountId?: string; mode?: "all" }
export interface RenewalUpdateResult { updated: SubscriptionRow[]; reselected: SubscriptionRow[] }

export interface FullFlowRequest { email: string; span: string }
export interface FullFlowProgress { step: string; message: string }

export const CH = {
  settingsLoad: "settings:load",
  settingsSave: "settings:save",
  settingsTestDb: "settings:testDb",
  renewalGetCandidates: "renewal:getCandidates",
  renewalUpdate: "renewal:update",
  fullflowRun: "fullflow:run",
  fullflowProgress: "fullflow:progress",
} as const;

export interface DbCheckResult { table: string; ok: boolean; columns: { name: string; present: boolean }[] }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors (these files are referenced by later tasks; standalone they compile).

- [ ] **Step 4: Commit**

```bash
git add electron/paths.ts electron/ipc.ts
git commit -m "feat: electron paths + IPC contract types"
```

---

## Task 5: runners (renewal + full-flow orchestration)

**Files:**
- Create: `electron/runners.ts`

> No unit test (calls live DB/Stripe). Verified via dev runs in Task 11. Reuses the tested core selection/db/time logic.

- [ ] **Step 1: Create `electron/runners.ts`**

```ts
// electron/runners.ts
import type pg from "pg";
import type { AppConfig } from "../src/types.js";
import { createPool, lookupAccountId, fetchSubscriptions, updateRenewal, reselectByIds } from "../src/db.js";
import { chooseTargetSubscription } from "../src/selection.js";
import { computeRenewalUTC, parseSpan } from "../src/time.js";
import { runStripeSimulation } from "../src/stripe-flow.js";
import type { RenewalCandidates, RenewalUpdateRequest, RenewalUpdateResult, FullFlowProgress } from "./ipc.js";
import type { RunReport } from "../src/types.js";

export async function getRenewalCandidates(cfg: AppConfig, email: string): Promise<RenewalCandidates> {
  const pool = createPool(cfg);
  try {
    const accountId = await lookupAccountId(pool, email);
    if (!accountId) throw new Error(`No account found for email ${email}`);
    const rows = await fetchSubscriptions(pool, accountId); // deletedAt IS NULL only
    if (rows.length === 0) throw new Error("No active (non-deleted) subscription found.");
    return { accountId, rows };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function updateRenewalUi(cfg: AppConfig, req: RenewalUpdateRequest): Promise<RenewalUpdateResult> {
  const pool = createPool(cfg);
  try {
    const newRenewal = computeRenewalUTC(new Date(), cfg.renewalOffsetMinutes);
    const target =
      req.mode === "all" && req.accountId
        ? ({ mode: "all", accountId: req.accountId } as const)
        : req.id
          ? ({ mode: "single", id: req.id } as const)
          : (() => { throw new Error("renewal:update requires an id or accountId+mode:all"); })();
    const updated = await updateRenewal(pool, target, newRenewal);
    const reselected = await reselectByIds(pool, updated.map((r) => r.id));
    return { updated, reselected };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function runFullFlowUi(
  cfg: AppConfig,
  email: string,
  spanStr: string,
  onProgress: (p: FullFlowProgress) => void,
): Promise<RunReport> {
  const span = parseSpan(spanStr);
  const pool = createPool(cfg);
  const notes: string[] = [];
  try {
    onProgress({ step: "db", message: "Looking up account…" });
    const accountId = await lookupAccountId(pool, email);
    if (!accountId) throw new Error(`No account found for email ${email}`);
    const rows = await fetchSubscriptions(pool, accountId);
    if (rows.length === 0) throw new Error("No active (non-deleted) subscription found.");
    const selection = chooseTargetSubscription(rows, undefined);
    if (selection.kind === "needChoice") {
      throw new Error("Multiple active subscriptions; use the Renewal page to pick one first, then re-run.");
    }
    const chosen = selection.kind === "single" ? selection.row : rows[0];

    const now = new Date();
    const newRenewal = computeRenewalUTC(now, cfg.renewalOffsetMinutes);
    onProgress({ step: "db", message: `Setting renewal to ${newRenewal} (UTC)…` });
    const updated = await updateRenewal(pool, { mode: "single", id: chosen.id }, newRenewal);
    const oldRenewal = chosen.renewalDateTime;

    onProgress({ step: "stripe", message: "Starting Stripe simulation…" });
    const result = await runStripeSimulation(
      cfg,
      {
        email,
        span,
        expectedStripeSubscriptionId: chosen.stripeSubscriptionId,
        expectedStripeCustomerId: chosen.stripeCustomerId,
      },
      {
        onStatus: (step, message) => onProgress({ step, message }),
        confirmAdvance: async () => true,
        waitForLogin: async (page) => {
          // Poll until the dashboard account switcher exists (long timeout).
          await page
            .getByRole("button", { name: /account options and switcher/i })
            .first()
            .waitFor({ state: "visible", timeout: cfg.stripe.longTimeoutMs });
        },
      },
    );

    const report: RunReport = {
      timestamp: new Date().toISOString(),
      email,
      dbAccountId: accountId,
      dbSubscriptionId: chosen.id,
      oldRenewalDate: oldRenewal,
      newRenewalDate: newRenewal,
      stripeCustomerId: result.stripeCustomerId,
      oldStripeSubscriptionId: result.oldStripeSubscriptionId,
      newStripeSubscriptionId: result.newStripeSubscriptionId,
      collectionPausedSeen: result.collectionPausedSeen,
      activeSubscriptionConfirmed: result.activeSubscriptionConfirmed,
      status: result.collectionPausedSeen && result.activeSubscriptionConfirmed ? "PASS" : "FAIL",
      notes: [...notes, ...result.notes],
    };
    onProgress({ step: "done", message: `Done: ${report.status}` });
    void updated;
    return report;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add electron/runners.ts
git commit -m "feat: electron runners for renewal + full-flow"
```

---

## Task 6: Electron main + preload

**Files:**
- Create: `electron/main.ts`, `electron/preload.ts`, `tsconfig.electron.json`

- [ ] **Step 1: Create `tsconfig.electron.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "outDir": "dist-electron",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["electron", "src"]
}
```

- [ ] **Step 2: Create `electron/preload.ts`**

```ts
// electron/preload.ts
import { contextBridge, ipcRenderer } from "electron";
import { CH } from "./ipc.js";

contextBridge.exposeInMainWorld("api", {
  loadSettings: () => ipcRenderer.invoke(CH.settingsLoad),
  saveSettings: (v: Record<string, string>) => ipcRenderer.invoke(CH.settingsSave, v),
  testDb: () => ipcRenderer.invoke(CH.settingsTestDb),
  getCandidates: (email: string) => ipcRenderer.invoke(CH.renewalGetCandidates, email),
  updateRenewal: (req: unknown) => ipcRenderer.invoke(CH.renewalUpdate, req),
  runFullFlow: (req: unknown) => ipcRenderer.invoke(CH.fullflowRun, req),
  onProgress: (cb: (p: { step: string; message: string }) => void) => {
    const listener = (_e: unknown, p: { step: string; message: string }) => cb(p);
    ipcRenderer.on(CH.fullflowProgress, listener);
    return () => ipcRenderer.removeListener(CH.fullflowProgress, listener);
  },
});
```

- [ ] **Step 3: Create `electron/main.ts`**

```ts
// electron/main.ts
import { app, BrowserWindow, ipcMain } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig } from "../src/config.js";
import { createPool, lookupAccountId } from "../src/db.js";
import { readEnv, writeEnv } from "../src/env-file.js";
import { envPath, authProfileDir, bundledChromiumPath } from "./paths.js";
import { CH, type IpcResult } from "./ipc.js";
import { getRenewalCandidates, updateRenewalUi, runFullFlowUi } from "./runners.js";
import type { AppConfig } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCfg(): AppConfig {
  const env = readEnv(envPath());
  const cfg = parseConfig(env);
  cfg.stripe.authProfileDir = authProfileDir();
  const chromium = bundledChromiumPath();
  if (chromium) process.env.PLAYWRIGHT_BROWSERS_PATH = chromium;
  return cfg;
}

async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100, height: 760, backgroundColor: "#0b1020",
    webPreferences: { preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  if (app.isPackaged) win.loadFile(join(__dirname, "../dist-ui/index.html"));
  else win.loadURL(process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173");
}

ipcMain.handle(CH.settingsLoad, () => wrap(async () => readEnv(envPath())));
ipcMain.handle(CH.settingsSave, (_e, v: Record<string, string>) =>
  wrap(async () => { writeEnv(envPath(), v); return readEnv(envPath()); }),
);
ipcMain.handle(CH.settingsTestDb, () =>
  wrap(async () => {
    const pool = createPool(loadCfg());
    try { await pool.query("SELECT 1"); return { connected: true }; }
    finally { await pool.end().catch(() => undefined); }
  }),
);
ipcMain.handle(CH.renewalGetCandidates, (_e, email: string) => wrap(() => getRenewalCandidates(loadCfg(), email)));
ipcMain.handle(CH.renewalUpdate, (_e, req) => wrap(() => updateRenewalUi(loadCfg(), req)));
ipcMain.handle(CH.fullflowRun, (e, req: { email: string; span: string }) =>
  wrap(() => runFullFlowUi(loadCfg(), req.email, req.span, (p) => e.sender.send(CH.fullflowProgress, p))),
);

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
```

- [ ] **Step 4: Type-check electron**

Run: `npx tsc -p tsconfig.electron.json --noEmit`
Expected: no errors. (`lookupAccountId` import is allowed even if only used indirectly; remove it if tsc flags unused — `noUnusedLocals` is off.)

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts tsconfig.electron.json
git commit -m "feat: electron main process + preload bridge + IPC handlers"
```

---

## Task 7: Renderer scaffold (Vite + React + Tailwind)

**Files:**
- Create: `ui/index.html`, `ui/main.tsx`, `ui/App.tsx`, `ui/styles.css`, `ui/lib/api.ts`, `vite.config.ts`, `postcss.config.js`, `tailwind.config.js`
- Modify: `package.json` (scripts + deps)

- [ ] **Step 1: Add renderer deps and scripts to `package.json`**

Add to `devDependencies`: `"electron": "^33.0.0"`, `"electron-builder": "^25.0.0"`, `"vite": "^5.4.0"`, `"@vitejs/plugin-react": "^4.3.0"`, `"react": "^18.3.1"`, `"react-dom": "^18.3.1"`, `"@types/react": "^18.3.0"`, `"@types/react-dom": "^18.3.0"`, `"tailwindcss": "^3.4.0"`, `"postcss": "^8.4.0"`, `"autoprefixer": "^10.4.0"`, `"concurrently": "^9.0.0"`, `"wait-on": "^8.0.0"`, `"cross-env": "^7.0.3"`.

Add to `scripts`:

```json
    "ui:dev": "vite",
    "ui:build": "vite build",
    "electron:build": "tsc -p tsconfig.electron.json",
    "start": "concurrently -k \"npm:ui:dev\" \"wait-on tcp:5173 && npm run electron:build && cross-env VITE_DEV_SERVER_URL=http://localhost:5173 electron dist-electron/electron/main.js\"",
    "app:build": "npm run ui:build && npm run electron:build && electron-builder"
```

Run: `npm install`
Expected: deps installed. (If TLS fails, the user runs `npm install` themselves — see project memory.)

- [ ] **Step 2: Create `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "ui",
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist-ui", emptyOutDir: true },
  server: { port: 5173, strictPort: true },
});
```

- [ ] **Step 3: Create Tailwind config files**

`tailwind.config.js`:
```js
export default { content: ["./ui/index.html", "./ui/**/*.{ts,tsx}"], theme: { extend: {} }, plugins: [] };
```
`postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 4: Create `ui/index.html`, `ui/styles.css`, `ui/main.tsx`**

`ui/index.html`:
```html
<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>iClosed Billing</title></head>
  <body><div id="root"></div><script type="module" src="./main.tsx"></script></body>
</html>
```

`ui/styles.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
body { @apply bg-slate-950 text-slate-100; }
```

`ui/main.tsx`:
```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import "./styles.css";
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
```

- [ ] **Step 5: Create `ui/lib/api.ts` (typed window.api wrapper)**

```ts
// ui/lib/api.ts
import type { IpcResult, RenewalCandidates, RenewalUpdateRequest, RenewalUpdateResult } from "../../electron/ipc.js";
import type { RunReport } from "../../src/types.js";

interface Api {
  loadSettings(): Promise<IpcResult<Record<string, string>>>;
  saveSettings(v: Record<string, string>): Promise<IpcResult<Record<string, string>>>;
  testDb(): Promise<IpcResult<{ connected: boolean }>>;
  getCandidates(email: string): Promise<IpcResult<RenewalCandidates>>;
  updateRenewal(req: RenewalUpdateRequest): Promise<IpcResult<RenewalUpdateResult>>;
  runFullFlow(req: { email: string; span: string }): Promise<IpcResult<RunReport>>;
  onProgress(cb: (p: { step: string; message: string }) => void): () => void;
}
export const api = (window as unknown as { api: Api }).api;
```

- [ ] **Step 6: Create a minimal `ui/App.tsx` (replaced in Task 8)**

```tsx
import React from "react";
export default function App() {
  return <div className="p-8 text-2xl">iClosed Billing — loading…</div>;
}
```

- [ ] **Step 7: Verify the renderer builds**

Run: `npm run ui:build`
Expected: builds to `dist-ui/` with no errors.

- [ ] **Step 8: Commit**

```bash
git add ui vite.config.ts tailwind.config.js postcss.config.js package.json package-lock.json
git commit -m "feat: Vite + React + Tailwind renderer scaffold"
```

---

## Task 8: Shared UI components

**Files:**
- Create: `ui/components/Sidebar.tsx`, `Banner.tsx`, `Field.tsx`, `StatusTimeline.tsx`, `SubscriptionPicker.tsx`

- [ ] **Step 1: Create `ui/components/Banner.tsx`**

```tsx
import React from "react";
export function Banner({ kind, title, children }: { kind: "success" | "error" | "info"; title: string; children?: React.ReactNode }) {
  const styles = {
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    error: "border-rose-500/40 bg-rose-500/10 text-rose-200",
    info: "border-sky-500/40 bg-sky-500/10 text-sky-200",
  }[kind];
  return (
    <div className={`rounded-xl border p-4 ${styles}`}>
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-1 text-sm opacity-90">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Create `ui/components/Field.tsx`**

```tsx
import React, { useState } from "react";
export function Field({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const isPw = type === "password";
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-400">{label}</span>
      <div className="relative">
        <input
          type={isPw && !show ? "password" : "text"}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-sky-500"
        />
        {isPw && (
          <button type="button" onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-2 text-xs text-slate-400 hover:text-slate-200">
            {show ? "Hide" : "Show"}
          </button>
        )}
      </div>
    </label>
  );
}
```

- [ ] **Step 3: Create `ui/components/Sidebar.tsx`**

```tsx
import React from "react";
export type Page = "renewal" | "full" | "settings";
export function Sidebar({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  const items: { id: Page; label: string }[] = [
    { id: "renewal", label: "Renewal" },
    { id: "full", label: "Full downgrade" },
    { id: "settings", label: "Settings" },
  ];
  return (
    <nav className="w-56 shrink-0 border-r border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-6 bg-gradient-to-r from-sky-400 to-violet-400 bg-clip-text text-lg font-bold text-transparent">
        iClosed Billing
      </div>
      {items.map((it) => (
        <button key={it.id} onClick={() => setPage(it.id)}
          className={`mb-1 block w-full rounded-lg px-3 py-2 text-left ${page === it.id ? "bg-sky-500/20 text-sky-200" : "text-slate-300 hover:bg-slate-800"}`}>
          {it.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Create `ui/components/StatusTimeline.tsx`**

```tsx
import React from "react";
export interface Step { step: string; message: string }
export function StatusTimeline({ steps, done, failed }: { steps: Step[]; done: boolean; failed: boolean }) {
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const isLast = i === steps.length - 1;
        const dot = failed && isLast ? "bg-rose-400" : done && isLast ? "bg-emerald-400" : isLast ? "bg-sky-400 animate-pulse" : "bg-slate-500";
        return (
          <li key={i} className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
            <span className="text-xs uppercase tracking-wide text-slate-500">{s.step}</span>
            <span className="text-sm text-slate-200">{s.message}</span>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 5: Create `ui/components/SubscriptionPicker.tsx`**

```tsx
import React from "react";
import type { SubscriptionRow } from "../../src/types.js";
export function SubscriptionPicker({ rows, onPick }: { rows: SubscriptionRow[]; onPick: (id: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="text-sm text-slate-400">Multiple active subscriptions — choose one to update:</div>
      {rows.map((r) => (
        <button key={r.id} onClick={() => onPick(r.id)}
          className="block w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-left hover:border-sky-500">
          <div className="font-mono text-sm text-sky-200">{r.stripeSubscriptionId ?? "(no stripe id)"}</div>
          <div className="text-xs text-slate-400">
            id {r.id} · {r.status} · renews {r.renewalDateTime ?? "-"} · created {r.createdAt ?? "-"}
          </div>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Type-check renderer**

Run: `npm run ui:build`
Expected: builds with no errors.

- [ ] **Step 7: Commit**

```bash
git add ui/components
git commit -m "feat: shared UI components (sidebar, banner, field, timeline, picker)"
```

---

## Task 9: Pages + App wiring

**Files:**
- Create: `ui/pages/Renewal.tsx`, `ui/pages/FullDowngrade.tsx`, `ui/pages/Settings.tsx`
- Modify: `ui/App.tsx`

- [ ] **Step 1: Create `ui/pages/Renewal.tsx`**

```tsx
import React, { useState } from "react";
import { api } from "../lib/api.js";
import { Field } from "../components/Field.js";
import { Banner } from "../components/Banner.js";
import { SubscriptionPicker } from "../components/SubscriptionPicker.js";
import type { SubscriptionRow } from "../../src/types.js";

export function Renewal() {
  const [email, setEmail] = useState("");
  const [rows, setRows] = useState<SubscriptionRow[] | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setResult(null); setRows(null); setBusy(true);
    const res = await api.getCandidates(email);
    setBusy(false);
    if (!res.ok) { setResult({ ok: false, msg: res.error }); return; }
    setAccountId(res.data.accountId);
    if (res.data.rows.length === 1) await doUpdate(res.data.rows[0].id);
    else setRows(res.data.rows);
  }

  async function doUpdate(id: string) {
    setBusy(true); setRows(null);
    const res = await api.updateRenewal({ id });
    setBusy(false);
    if (!res.ok) { setResult({ ok: false, msg: res.error }); return; }
    const r = res.data.reselected[0];
    setResult({ ok: true, msg: `Account ${accountId}, subscription ${r.id} → renewal ${r.renewalDateTime} (UTC).` });
  }

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Update renewal date</h1>
      <Field label="Customer email" value={email} onChange={setEmail} placeholder="demo@example.com" />
      <button disabled={busy || !email} onClick={start}
        className="rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 font-semibold disabled:opacity-50">
        {busy ? "Working…" : "Update renewal"}
      </button>
      {rows && <SubscriptionPicker rows={rows} onPick={doUpdate} />}
      {result && <Banner kind={result.ok ? "success" : "error"} title={result.ok ? "Renewal updated" : "Failed"}>{result.msg}</Banner>}
    </div>
  );
}
```

- [ ] **Step 2: Create `ui/pages/FullDowngrade.tsx`**

```tsx
import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Field } from "../components/Field.js";
import { Banner } from "../components/Banner.js";
import { StatusTimeline, type Step } from "../components/StatusTimeline.js";
import type { RunReport } from "../../src/types.js";

const PRESETS = ["1 day", "1 week", "1 month", "1 year", "Custom"] as const;

export function FullDowngrade() {
  const [email, setEmail] = useState("");
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>("1 month");
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<"day" | "month" | "year">("month");
  const [steps, setSteps] = useState<Step[]>([]);
  const [report, setReport] = useState<RunReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => api.onProgress((p) => setSteps((s) => [...s, p])), []);

  function span(): string {
    if (preset !== "Custom") return preset === "1 week" ? "7 days" : preset;
    const n = parseInt(amount, 10);
    return `${n} ${n === 1 ? unit : unit + "s"}`;
  }

  async function run() {
    setSteps([]); setReport(null); setError(null); setBusy(true);
    const res = await api.runFullFlow({ email, span: span() });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setReport(res.data);
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Run full downgrade</h1>
      <Field label="Customer email" value={email} onChange={setEmail} placeholder="demo@example.com" />
      <div className="flex gap-3">
        <label className="block">
          <span className="mb-1 block text-sm text-slate-400">Advance interval</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
            {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        {preset === "Custom" && (
          <>
            <Field label="Amount" value={amount} onChange={setAmount} />
            <label className="block">
              <span className="mb-1 block text-sm text-slate-400">Unit</span>
              <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
                <option value="day">day</option><option value="month">month</option><option value="year">year</option>
              </select>
            </label>
          </>
        )}
      </div>
      <button disabled={busy || !email} onClick={run}
        className="rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 font-semibold disabled:opacity-50">
        {busy ? "Running…" : "Run downgrade"}
      </button>
      {steps.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <StatusTimeline steps={steps} done={!!report && report.status === "PASS"} failed={!!error || (!!report && report.status === "FAIL")} />
        </div>
      )}
      {error && <Banner kind="error" title="Downgrade failed">{error}</Banner>}
      {report && (
        <Banner kind={report.status === "PASS" ? "success" : "error"} title={`Downgrade ${report.status}`}>
          <div className="space-y-0.5 font-mono text-xs">
            <div>account {report.dbAccountId} · sub {report.dbSubscriptionId}</div>
            <div>renewal {report.oldRenewalDate} → {report.newRenewalDate}</div>
            <div>old stripe sub {report.oldStripeSubscriptionId ?? "-"}</div>
            <div>new active sub {report.newStripeSubscriptionId ?? "-"}</div>
            {report.notes.length > 0 && <div>notes: {report.notes.join("; ")}</div>}
          </div>
        </Banner>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `ui/pages/Settings.tsx`**

```tsx
import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Field } from "../components/Field.js";
import { Banner } from "../components/Banner.js";

const DB_KEYS = ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGSCHEMA"];
const STRIPE_KEYS = ["STRIPE_DASHBOARD_URL", "STRIPE_ENVIRONMENT_NAME", "STRIPE_AUTH_PROFILE_DIR",
  "STRIPE_STEP_TIMEOUT_MS", "STRIPE_LONG_TIMEOUT_MS", "DEFAULT_RENEWAL_OFFSET_MINUTES", "PLAYWRIGHT_SLOW_MO_MS"];

export function Settings() {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { api.loadSettings().then((r) => { if (r.ok) setVals(r.data); }); }, []);
  const set = (k: string) => (v: string) => setVals((s) => ({ ...s, [k]: v }));

  async function save() {
    const r = await api.saveSettings(vals);
    setMsg(r.ok ? { ok: true, text: "Settings saved to .env" } : { ok: false, text: r.error });
  }
  async function test() {
    const r = await api.testDb();
    setMsg(r.ok ? { ok: true, text: "Database connection OK" } : { ok: false, text: r.error });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-400">Database</h2>
        {DB_KEYS.map((k) => <Field key={k} label={k} type={k === "PGPASSWORD" ? "password" : "text"} value={vals[k] ?? ""} onChange={set(k)} />)}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-400">Stripe</h2>
        {STRIPE_KEYS.map((k) => <Field key={k} label={k} value={vals[k] ?? ""} onChange={set(k)} />)}
      </section>
      <div className="flex gap-3">
        <button onClick={save} className="rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 font-semibold">Save</button>
        <button onClick={test} className="rounded-lg border border-slate-700 px-4 py-2">Test DB connection</button>
      </div>
      {msg && <Banner kind={msg.ok ? "success" : "error"} title={msg.ok ? "OK" : "Error"}>{msg.text}</Banner>}
    </div>
  );
}
```

- [ ] **Step 4: Replace `ui/App.tsx`**

```tsx
import React, { useState } from "react";
import { Sidebar, type Page } from "./components/Sidebar.js";
import { Renewal } from "./pages/Renewal.js";
import { FullDowngrade } from "./pages/FullDowngrade.js";
import { Settings } from "./pages/Settings.js";

export default function App() {
  const [page, setPage] = useState<Page>("renewal");
  return (
    <div className="flex h-screen">
      <Sidebar page={page} setPage={setPage} />
      <main className="flex-1 overflow-auto p-8">
        {page === "renewal" && <Renewal />}
        {page === "full" && <FullDowngrade />}
        {page === "settings" && <Settings />}
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Build the renderer**

Run: `npm run ui:build`
Expected: builds with no type/JSX errors.

- [ ] **Step 6: Commit**

```bash
git add ui/pages ui/App.tsx
git commit -m "feat: Renewal, Full downgrade, and Settings pages"
```

---

## Task 10: electron-builder config + Chromium bundling + run.bat

**Files:**
- Create: `electron-builder.yml`, `run.bat`
- Modify: `package.json` (`main`, `build` metadata)

- [ ] **Step 1: Set the Electron entry in `package.json`**

Add top-level `"main": "dist-electron/electron/main.js"`.

- [ ] **Step 2: Create `electron-builder.yml`**

```yaml
appId: io.iclosed.billing
productName: iClosed Billing
files:
  - dist-electron/**
  - dist-ui/**
  - package.json
extraResources:
  # Bundle the Playwright browsers cache so the packaged app has Chromium.
  - from: "${env.PLAYWRIGHT_BROWSERS_PATH}"
    to: "ms-playwright"
asarUnpack:
  - "**/*.node"
win:
  target: nsis
mac:
  target: dmg
  category: public.app-category.developer-tools
```

> Note: before `electron-builder`, set `PLAYWRIGHT_BROWSERS_PATH` to the installed
> browsers dir and run `npx playwright install chromium` so the path is populated. On
> Windows that default is `%USERPROFILE%\AppData\Local\ms-playwright`. The `.dmg` target
> must be built on macOS.

- [ ] **Step 3: Create `run.bat` (dev one-click)**

```bat
@echo off
cd /d "%~dp0"
call npm run start
pause
```

- [ ] **Step 4: Verify the app launches in dev**

Run: `npm start`
Expected: Vite dev server starts on 5173, Electron compiles, the app window opens showing the sidebar + Renewal page. Close the window to stop.

- [ ] **Step 5: Commit**

```bash
git add electron-builder.yml run.bat package.json
git commit -m "feat: electron-builder config (exe/dmg), Chromium bundling, run.bat"
```

---

## Task 11: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Settings round-trip**

Run: `npm start`. Open Settings, confirm DB + Stripe fields are populated from `.env`. Change `PLAYWRIGHT_SLOW_MO_MS` to `250`, click Save, restart the app, confirm it persisted (and `.env` shows the new value). Click "Test DB connection" → expect green "Database connection OK".

- [ ] **Step 2: Renewal page (single sub)**

On the Renewal page enter a known email (e.g. a fresh demo account), click "Update renewal". Expect a green banner: account id, subscription id, and the new renewal time (UTC, now+offset). Verify in the DB (or `npm run db:check`/`db:update` dry inspection) that only the `deletedAt IS NULL` row changed.

- [ ] **Step 3: Renewal page (multiple subs)**

Use an account with >1 non-deleted subscription (or temporarily simulate). Click "Update renewal" → expect the picker; pick one → green banner. Confirm only the chosen row updated.

- [ ] **Step 4: Full downgrade page**

Enter a fresh demo email, choose interval "1 month", click "Run downgrade". Expect: the status timeline fills in (db → environment → test mode → customer → paused → simulation → advancing → verifying → done), a headed Chromium opens (log in if prompted), and a green "Downgrade PASS" banner with old/new renewal, old paused sub id, and the new Active sub id. Confirm the new Active, non-paused subscription exists for the customer in Stripe.

- [ ] **Step 5: Failure messaging**

Temporarily set a wrong `PGPASSWORD` in Settings, save, run the Renewal page → expect a red error banner with the DB error text. Restore the correct password.

- [ ] **Step 6: Commit (docs note)**

```bash
git commit --allow-empty -m "test: manual E2E verification of Electron UI (renewal, full flow, settings)"
```

---

## Task 12: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append a "Desktop app (Electron UI)" section to `README.md`**

```markdown
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
# Windows (.exe), run on Windows:
set PLAYWRIGHT_BROWSERS_PATH=%USERPROFILE%\AppData\Local\ms-playwright
npx playwright install chromium
npm run app:build

# macOS (.dmg), run on a Mac:
export PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright"
npx playwright install chromium
npm run app:build
```

Notes: the Stripe automation opens its own headed Chromium window — log in once (saved per
user). `.dmg` can only be built on macOS. Settings/`.auth` live under the app's user-data
dir in packaged builds.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: Electron desktop app usage in README"
```

---

## Self-Review Notes (coverage vs. spec)

- Two UIs in one app + sidebar nav → Tasks 7, 9.
- Renewal: email→button, single auto / multiple picker, `deletedAt IS NULL` only → Tasks 5, 9 (`getRenewalCandidates` reuses `fetchSubscriptions`).
- Full downgrade: email + preset/custom interval + run, live progress, new-active verification → Tasks 2, 5, 9.
- Settings: DB + Stripe fields, write `.env`, test DB → Tasks 1, 6, 9.
- Reuse core (no rewrite); CLI preserved → Tasks 3, 5 (only hooks added).
- Non-interactive Stripe (login poll, button = confirm, status stream) → Tasks 3, 5.
- Electron 3-process (main/preload/renderer), contextIsolation → Tasks 6, 7.
- Fancy UI (Tailwind, gradients, timeline, banners) → Tasks 7, 8, 9.
- Success/failure messaging (IpcResult, banners) → Tasks 4, 6, 8, 9.
- Packaging: run.bat dev, exe + dmg, Chromium bundling, dmg-on-mac note → Tasks 10, 12.
- `.env`/`.auth` under userData when packaged → Task 4 (`paths.ts`), used in Task 6.
- Tests for env-file + span; core tests stay green → Tasks 1, 2, 3.
