# Downgrade Process Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript CLI that looks up an account in Postgres, sets the chosen subscription's `renewalDateTime` to now+offset (UTC), then drives the Stripe dashboard (sandbox/test mode test clock) with Playwright to advance time and verify a new Active subscription.

**Architecture:** Layered, prompt-agnostic core. Pure logic (env validation, time/span math, subscription selection, report formatting) is unit-tested with Vitest. Side-effecting layers (`db.ts` via `pg`, `stripe-flow.ts` via Playwright) are thin, take typed inputs from the pure layer, and are verified via dry-run + manual run against live systems. `index.ts` orchestrates phases 1→2→3 and writes a final report.

**Tech Stack:** Node.js, TypeScript, `pg` (node-postgres), Playwright (headed Chromium, persistent context + tracing), `dotenv`, Vitest, `tsx` (dev runner).

Spec: `docs/superpowers/specs/2026-06-17-downgrade-process-design.md`

---

## File Structure

```
iclosed-billing/
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── src/
│   ├── types.ts          # shared interfaces (SubscriptionRow, RunContext, Report, AppConfig)
│   ├── config.ts         # load + validate .env → AppConfig
│   ├── time.ts           # UTC renewal calc, formatTimestamp, parseSpan, addSpanToDate
│   ├── selection.ts      # pure: chooseTargetSubscription(rows, userChoice)
│   ├── prompts.ts        # interactive input (readline) — replaceable by UI later
│   ├── db.ts             # pg: lookupAccountId, fetchSubscriptions, updateRenewal (txn)
│   ├── stripe-flow.ts    # Playwright helpers + runStripeSimulation()
│   ├── report.ts         # buildReport + saveReport (json/txt) + printReport
│   └── index.ts          # entry: orchestrates phases → report
└── tests/
    ├── config.test.ts
    ├── time.test.ts
    ├── selection.test.ts
    └── report.test.ts
.auth/                    # gitignored — Stripe persistent session
artifacts/                # gitignored — traces, screenshots, reports/
```

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore`, `.env.example`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "iclosed-billing-downgrade",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@types/node": "^22.10.0",
    "@types/pg": "^8.11.10",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Create `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

// Browser launch is handled manually in src/stripe-flow.ts via a persistent
// context (chromium.launchPersistentContext). This config exists so the
// Playwright toolchain/types are available and trace viewing works.
export default defineConfig({
  use: {
    headless: false,
    trace: "on",
  },
});
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
.env
.auth/
artifacts/
```

- [ ] **Step 6: Create `.env.example`**

```
# PostgreSQL
PGHOST=
PGPORT=5432
PGDATABASE=
PGUSER=
PGPASSWORD=
PGSSLMODE=require

# Stripe dashboard
STRIPE_DASHBOARD_URL=https://dashboard.stripe.com
STRIPE_ENVIRONMENT_NAME=iClosed.io (development)
STRIPE_AUTH_PROFILE_DIR=.auth

# Timeouts
STRIPE_STEP_TIMEOUT_MS=30000
STRIPE_LONG_TIMEOUT_MS=120000

# Behavior
DEFAULT_RENEWAL_OFFSET_MINUTES=5
PLAYWRIGHT_SLOW_MO_MS=0
DRY_RUN=true
OPEN_STRIPE_IN_DRY_RUN=false
```

- [ ] **Step 7: Install dependencies and Playwright Chromium**

Run: `npm install && npx playwright install chromium`
Expected: dependencies installed; Chromium downloaded.

- [ ] **Step 8: Commit**

```bash
git init
git add -A
git commit -m "chore: scaffold downgrade process project"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create `src/types.ts`**

```ts
export interface AppConfig {
  pg: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    sslmode: string;
  };
  stripe: {
    dashboardUrl: string;
    environmentName: string;
    authProfileDir: string;
    stepTimeoutMs: number;
    longTimeoutMs: number;
  };
  renewalOffsetMinutes: number;
  slowMoMs: number;
  dryRun: boolean;
  openStripeInDryRun: boolean;
}

export interface SubscriptionRow {
  id: string;
  accountId: string;
  status: string | null;
  renewalDateTime: string | null;
  deletedAt: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  createdAt: string | null;
}

export interface ParsedSpan {
  unit: "day" | "month" | "year";
  amount: number;
}

export interface RunReport {
  timestamp: string;
  email: string;
  dbAccountId: string | null;
  dbSubscriptionId: string | null;
  oldRenewalDate: string | null;
  newRenewalDate: string | null;
  stripeCustomerId: string | null;
  oldStripeSubscriptionId: string | null;
  newStripeSubscriptionId: string | null;
  collectionPausedSeen: boolean;
  activeSubscriptionConfirmed: boolean;
  status: "PASS" | "FAIL";
  notes: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: shared types for downgrade process"
```

---

## Task 3: Config loader (TDD)

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/config.test.ts
import { describe, it, expect } from "vitest";
import { parseConfig } from "../src/config.js";

const base = {
  PGHOST: "localhost",
  PGPORT: "5432",
  PGDATABASE: "billing",
  PGUSER: "user",
  PGPASSWORD: "pass",
  PGSSLMODE: "require",
  STRIPE_DASHBOARD_URL: "https://dashboard.stripe.com",
  STRIPE_ENVIRONMENT_NAME: "iClosed.io (development)",
  STRIPE_AUTH_PROFILE_DIR: ".auth",
  STRIPE_STEP_TIMEOUT_MS: "30000",
  STRIPE_LONG_TIMEOUT_MS: "120000",
  DEFAULT_RENEWAL_OFFSET_MINUTES: "5",
  PLAYWRIGHT_SLOW_MO_MS: "0",
};

describe("parseConfig", () => {
  it("parses a valid env into typed config with numeric coercion", () => {
    const cfg = parseConfig({ ...base, DRY_RUN: "false" });
    expect(cfg.pg.port).toBe(5432);
    expect(cfg.renewalOffsetMinutes).toBe(5);
    expect(cfg.stripe.longTimeoutMs).toBe(120000);
    expect(cfg.dryRun).toBe(false);
  });

  it("defaults DRY_RUN to true when unset", () => {
    const cfg = parseConfig({ ...base });
    expect(cfg.dryRun).toBe(true);
  });

  it("defaults openStripeInDryRun to false when unset", () => {
    const cfg = parseConfig({ ...base });
    expect(cfg.openStripeInDryRun).toBe(false);
  });

  it("throws listing all missing required vars", () => {
    expect(() => parseConfig({})).toThrow(/PGHOST/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — cannot find `parseConfig`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/config.ts
import { config as loadDotenv } from "dotenv";
import type { AppConfig } from "./types.js";

type Env = Record<string, string | undefined>;

function required(env: Env, key: string, missing: string[]): string {
  const v = env[key];
  if (v === undefined || v === "") missing.push(key);
  return v ?? "";
}

function num(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true";
}

export function parseConfig(env: Env): AppConfig {
  const missing: string[] = [];
  const cfg: AppConfig = {
    pg: {
      host: required(env, "PGHOST", missing),
      port: num(required(env, "PGPORT", missing), 5432),
      database: required(env, "PGDATABASE", missing),
      user: required(env, "PGUSER", missing),
      password: required(env, "PGPASSWORD", missing),
      sslmode: required(env, "PGSSLMODE", missing),
    },
    stripe: {
      dashboardUrl: required(env, "STRIPE_DASHBOARD_URL", missing),
      environmentName: required(env, "STRIPE_ENVIRONMENT_NAME", missing),
      authProfileDir: required(env, "STRIPE_AUTH_PROFILE_DIR", missing),
      stepTimeoutMs: num(env.STRIPE_STEP_TIMEOUT_MS ?? "", 30000),
      longTimeoutMs: num(env.STRIPE_LONG_TIMEOUT_MS ?? "", 120000),
    },
    renewalOffsetMinutes: num(env.DEFAULT_RENEWAL_OFFSET_MINUTES ?? "", 5),
    slowMoMs: num(env.PLAYWRIGHT_SLOW_MO_MS ?? "", 0),
    dryRun: bool(env.DRY_RUN, true),
    openStripeInDryRun: bool(env.OPEN_STRIPE_IN_DRY_RUN, false),
  };
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
  return cfg;
}

export function loadConfig(): AppConfig {
  loadDotenv();
  return parseConfig(process.env);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: env config loader with validation"
```

---

## Task 4: Time & span logic (TDD)

**Files:**
- Create: `src/time.ts`
- Test: `tests/time.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/time.test.ts
import { describe, it, expect } from "vitest";
import { formatTimestampUTC, computeRenewalUTC, parseSpan, addSpan } from "../src/time.js";

describe("formatTimestampUTC", () => {
  it("formats as YYYY-MM-DD HH:mm:ss.000 in UTC", () => {
    const d = new Date(Date.UTC(2024, 3, 1, 16, 5, 32));
    expect(formatTimestampUTC(d)).toBe("2024-04-01 16:05:32.000");
  });
});

describe("computeRenewalUTC", () => {
  it("adds offset minutes to the base UTC time", () => {
    const base = new Date(Date.UTC(2024, 3, 1, 16, 0, 0));
    expect(computeRenewalUTC(base, 5)).toBe("2024-04-01 16:05:00.000");
  });
});

describe("parseSpan", () => {
  it("parses days/months/years (singular and plural)", () => {
    expect(parseSpan("3 days")).toEqual({ unit: "day", amount: 3 });
    expect(parseSpan("1 month")).toEqual({ unit: "month", amount: 1 });
    expect(parseSpan("2 years")).toEqual({ unit: "year", amount: 2 });
  });
  it("is case/space tolerant", () => {
    expect(parseSpan("  1   Month ")).toEqual({ unit: "month", amount: 1 });
  });
  it("rejects invalid spans", () => {
    expect(() => parseSpan("soon")).toThrow();
    expect(() => parseSpan("0 days")).toThrow();
    expect(() => parseSpan("5 weeks")).toThrow();
  });
});

describe("addSpan", () => {
  it("adds a month in UTC", () => {
    const base = new Date(Date.UTC(2024, 0, 15, 12, 0, 0));
    const out = addSpan(base, { unit: "month", amount: 1 });
    expect(out.toISOString()).toBe("2024-02-15T12:00:00.000Z");
  });
  it("adds days and years in UTC", () => {
    const base = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));
    expect(addSpan(base, { unit: "day", amount: 3 }).toISOString()).toBe("2024-01-04T00:00:00.000Z");
    expect(addSpan(base, { unit: "year", amount: 2 }).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/time.test.ts`
Expected: FAIL — module/functions not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/time.ts
import type { ParsedSpan } from "./types.js";

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function formatTimestampUTC(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.000`
  );
}

export function computeRenewalUTC(base: Date, offsetMinutes: number): string {
  const out = new Date(base.getTime() + offsetMinutes * 60_000);
  return formatTimestampUTC(out);
}

export function parseSpan(input: string): ParsedSpan {
  const m = input.trim().toLowerCase().match(/^(\d+)\s+(day|days|month|months|year|years)$/);
  if (!m) {
    throw new Error(`Invalid span "${input}". Use e.g. "3 days", "1 month", "2 years".`);
  }
  const amount = Number(m[1]);
  if (amount <= 0) throw new Error(`Span amount must be > 0 (got ${amount}).`);
  const unitWord = m[2];
  const unit = unitWord.startsWith("day") ? "day" : unitWord.startsWith("month") ? "month" : "year";
  return { unit, amount };
}

export function addSpan(base: Date, span: ParsedSpan): Date {
  const d = new Date(base.getTime());
  if (span.unit === "day") d.setUTCDate(d.getUTCDate() + span.amount);
  else if (span.unit === "month") d.setUTCMonth(d.getUTCMonth() + span.amount);
  else d.setUTCFullYear(d.getUTCFullYear() + span.amount);
  return d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/time.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/time.ts tests/time.test.ts
git commit -m "feat: UTC time formatting and span parsing"
```

---

## Task 5: Subscription selection logic (TDD)

**Files:**
- Create: `src/selection.ts`
- Test: `tests/selection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/selection.test.ts
import { describe, it, expect } from "vitest";
import { chooseTargetSubscription } from "../src/selection.js";
import type { SubscriptionRow } from "../src/types.js";

function row(id: string): SubscriptionRow {
  return {
    id, accountId: "acc1", status: "active", renewalDateTime: null,
    deletedAt: null, stripeSubscriptionId: "sub_" + id, stripeCustomerId: "cus_1", createdAt: "2024-01-01",
  };
}

describe("chooseTargetSubscription", () => {
  it("returns NoSubscriptions when list empty", () => {
    expect(chooseTargetSubscription([], undefined)).toEqual({ kind: "none" });
  });
  it("returns the single row needing confirmation when exactly one", () => {
    const rows = [row("a")];
    expect(chooseTargetSubscription(rows, undefined)).toEqual({ kind: "single", row: rows[0] });
  });
  it("requires a choice when multiple and none given", () => {
    const rows = [row("a"), row("b")];
    expect(chooseTargetSubscription(rows, undefined)).toEqual({ kind: "needChoice", rows });
  });
  it("selects by id when multiple and id provided", () => {
    const rows = [row("a"), row("b")];
    expect(chooseTargetSubscription(rows, "b")).toEqual({ kind: "single", row: rows[1] });
  });
  it("selects all when UPDATE ALL given", () => {
    const rows = [row("a"), row("b")];
    expect(chooseTargetSubscription(rows, "UPDATE ALL")).toEqual({ kind: "all", rows });
  });
  it("returns invalid when id not found", () => {
    const rows = [row("a"), row("b")];
    expect(chooseTargetSubscription(rows, "zzz")).toEqual({ kind: "invalid", input: "zzz" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/selection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/selection.ts
import type { SubscriptionRow } from "./types.js";

export type SelectionResult =
  | { kind: "none" }
  | { kind: "single"; row: SubscriptionRow }
  | { kind: "needChoice"; rows: SubscriptionRow[] }
  | { kind: "all"; rows: SubscriptionRow[] }
  | { kind: "invalid"; input: string };

export function chooseTargetSubscription(
  rows: SubscriptionRow[],
  userChoice: string | undefined,
): SelectionResult {
  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1 && (userChoice === undefined || userChoice === "")) {
    return { kind: "single", row: rows[0] };
  }
  if (userChoice === undefined || userChoice === "") {
    return { kind: "needChoice", rows };
  }
  if (userChoice.trim().toUpperCase() === "UPDATE ALL") {
    return { kind: "all", rows };
  }
  const match = rows.find((r) => r.id === userChoice.trim());
  return match ? { kind: "single", row: match } : { kind: "invalid", input: userChoice };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/selection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/selection.ts tests/selection.test.ts
git commit -m "feat: pure subscription selection logic"
```

---

## Task 6: Report builder (TDD)

**Files:**
- Create: `src/report.ts`
- Test: `tests/report.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/report.test.ts
import { describe, it, expect } from "vitest";
import { computeStatus, formatReportText } from "../src/report.js";
import type { RunReport } from "../src/types.js";

const baseReport: RunReport = {
  timestamp: "2026-06-17T00:00:00.000Z",
  email: "demo@example.com",
  dbAccountId: "acc1",
  dbSubscriptionId: "sub1",
  oldRenewalDate: "2024-04-01 16:00:00.000",
  newRenewalDate: "2024-04-01 16:05:00.000",
  stripeCustomerId: "cus_1",
  oldStripeSubscriptionId: "sub_old",
  newStripeSubscriptionId: "sub_new",
  collectionPausedSeen: true,
  activeSubscriptionConfirmed: true,
  status: "FAIL",
  notes: [],
};

describe("computeStatus", () => {
  it("PASS when paused seen and active confirmed", () => {
    expect(computeStatus({ ...baseReport })).toBe("PASS");
  });
  it("FAIL when active not confirmed", () => {
    expect(computeStatus({ ...baseReport, activeSubscriptionConfirmed: false })).toBe("FAIL");
  });
  it("FAIL when collection paused never seen", () => {
    expect(computeStatus({ ...baseReport, collectionPausedSeen: false })).toBe("FAIL");
  });
});

describe("formatReportText", () => {
  it("includes key fields", () => {
    const txt = formatReportText({ ...baseReport, status: "PASS" });
    expect(txt).toContain("demo@example.com");
    expect(txt).toContain("acc1");
    expect(txt).toContain("sub_old");
    expect(txt).toContain("sub_new");
    expect(txt).toContain("PASS");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/report.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/report.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RunReport } from "./types.js";

export function computeStatus(r: RunReport): "PASS" | "FAIL" {
  return r.collectionPausedSeen && r.activeSubscriptionConfirmed ? "PASS" : "FAIL";
}

export function formatReportText(r: RunReport): string {
  return [
    "=== Downgrade Process Report ===",
    `Timestamp:                ${r.timestamp}`,
    `Email:                    ${r.email}`,
    `DB Account ID:            ${r.dbAccountId ?? "-"}`,
    `DB Subscription ID:       ${r.dbSubscriptionId ?? "-"}`,
    `Old Renewal (UTC):        ${r.oldRenewalDate ?? "-"}`,
    `New Renewal (UTC):        ${r.newRenewalDate ?? "-"}`,
    `Stripe Customer ID:       ${r.stripeCustomerId ?? "-"}`,
    `Old Stripe Subscription:  ${r.oldStripeSubscriptionId ?? "-"}`,
    `New Stripe Subscription:  ${r.newStripeSubscriptionId ?? "-"}`,
    `Collection Paused seen:   ${r.collectionPausedSeen}`,
    `Active confirmed:         ${r.activeSubscriptionConfirmed}`,
    `Status:                   ${r.status}`,
    r.notes.length ? `Notes:\n - ${r.notes.join("\n - ")}` : "Notes: -",
  ].join("\n");
}

export function printReport(r: RunReport): void {
  console.log("\n" + formatReportText(r) + "\n");
}

export function saveReport(r: RunReport, dir = join("artifacts", "reports")): { jsonPath: string; txtPath: string } {
  mkdirSync(dir, { recursive: true });
  const stamp = r.timestamp.replace(/[:.]/g, "-");
  const jsonPath = join(dir, `${stamp}-downgrade-report.json`);
  const txtPath = join(dir, `${stamp}-downgrade-report.txt`);
  writeFileSync(jsonPath, JSON.stringify(r, null, 2), "utf8");
  writeFileSync(txtPath, formatReportText(r), "utf8");
  return { jsonPath, txtPath };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report.ts tests/report.test.ts
git commit -m "feat: run report builder + file output"
```

---

## Task 7: Interactive prompts

**Files:**
- Create: `src/prompts.ts`

- [ ] **Step 1: Create `src/prompts.ts`**

```ts
// src/prompts.ts
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

export async function promptEmail(): Promise<string> {
  let email = "";
  while (!email) {
    email = await ask("Target customer email: ");
    if (!email.includes("@")) {
      console.log("  Please enter a valid email.");
      email = "";
    }
  }
  return email;
}

export async function promptSpan(): Promise<string> {
  return ask('Advance time span (e.g. "1 month", "3 days", "1 year"): ');
}

export async function promptConfirm(message: string): Promise<boolean> {
  const a = (await ask(`${message} [y/N]: `)).toLowerCase();
  return a === "y" || a === "yes";
}

// Returns the raw choice: a subscription id, "UPDATE ALL", or "" (empty).
export async function promptSubscriptionChoice(): Promise<string> {
  return ask('Enter subscription id to update (or type "UPDATE ALL"): ');
}

// Used as the second explicit gate before advancing the Stripe clock.
export async function promptTypeToken(token: string, message: string): Promise<boolean> {
  const a = await ask(`${message}\nType "${token}" to proceed: `);
  return a === token;
}

export async function promptEnterWhenReady(message: string): Promise<void> {
  await ask(`${message}\nPress Enter when ready to continue...`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/prompts.ts
git commit -m "feat: interactive prompt helpers"
```

---

## Task 8: Database layer

**Files:**
- Create: `src/db.ts`

> No unit test here: this layer only issues SQL against the live DB. Its pure decision
> logic lives in `selection.ts` (already tested). Verified via dry-run + manual run in
> Task 10. Every query is printed before execution.

- [ ] **Step 1: Create `src/db.ts`**

```ts
// src/db.ts
import pg from "pg";
import type { AppConfig, SubscriptionRow } from "./types.js";

const { Pool } = pg;

export function createPool(cfg: AppConfig): pg.Pool {
  return new Pool({
    host: cfg.pg.host,
    port: cfg.pg.port,
    database: cfg.pg.database,
    user: cfg.pg.user,
    password: cfg.pg.password,
    ssl: cfg.pg.sslmode === "disable" ? false : { rejectUnauthorized: cfg.pg.sslmode === "verify-full" },
  });
}

function logQuery(sql: string, params: unknown[]): void {
  console.log("\n--- SQL ---");
  console.log(sql.trim());
  console.log("params:", JSON.stringify(params));
  console.log("-----------");
}

export async function lookupAccountId(pool: pg.Pool, email: string): Promise<string | null> {
  const sql = `SELECT id FROM accounts WHERE "emailAssociated" = $1;`;
  logQuery(sql, [email]);
  const res = await pool.query(sql, [email]);
  return res.rows.length ? String(res.rows[0].id) : null;
}

const SUB_COLUMNS = `id, "accountId", status, "renewalDateTime", "deletedAt", "stripeSubscriptionId", "stripeCustomerId", "createdAt"`;

function mapRow(r: Record<string, unknown>): SubscriptionRow {
  return {
    id: String(r.id),
    accountId: String(r.accountId),
    status: r.status === null ? null : String(r.status),
    renewalDateTime: r.renewalDateTime === null ? null : String(r.renewalDateTime),
    deletedAt: r.deletedAt === null ? null : String(r.deletedAt),
    stripeSubscriptionId: r.stripeSubscriptionId == null ? null : String(r.stripeSubscriptionId),
    stripeCustomerId: r.stripeCustomerId == null ? null : String(r.stripeCustomerId),
    createdAt: r.createdAt === null ? null : String(r.createdAt),
  };
}

export async function fetchSubscriptions(pool: pg.Pool, accountId: string): Promise<SubscriptionRow[]> {
  // stripeCustomerId may not exist in every schema; fall back if the column is missing.
  const withCustomer = `SELECT ${SUB_COLUMNS} FROM "Subscriptions" WHERE "accountId" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC;`;
  logQuery(withCustomer, [accountId]);
  try {
    const res = await pool.query(withCustomer, [accountId]);
    return res.rows.map(mapRow);
  } catch (err) {
    if (err instanceof Error && /stripeCustomerId/i.test(err.message)) {
      const fallback = `SELECT id, "accountId", status, "renewalDateTime", "deletedAt", "stripeSubscriptionId", "createdAt" FROM "Subscriptions" WHERE "accountId" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC;`;
      console.log('Note: "stripeCustomerId" column not found; retrying without it.');
      logQuery(fallback, [accountId]);
      const res = await pool.query(fallback, [accountId]);
      return res.rows.map((r) => mapRow({ ...r, stripeCustomerId: null }));
    }
    throw err;
  }
}

// Transactional update. `target` is either a single id or "ALL" with accountId.
export async function updateRenewal(
  pool: pg.Pool,
  target: { mode: "single"; id: string } | { mode: "all"; accountId: string },
  newRenewal: string,
): Promise<SubscriptionRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let sql: string;
    let params: unknown[];
    if (target.mode === "single") {
      sql = `UPDATE "Subscriptions" SET "renewalDateTime" = $1 WHERE id = $2 RETURNING ${SUB_COLUMNS};`;
      params = [newRenewal, target.id];
    } else {
      sql = `UPDATE "Subscriptions" SET "renewalDateTime" = $1 WHERE "accountId" = $2 AND "deletedAt" IS NULL RETURNING ${SUB_COLUMNS};`;
      params = [newRenewal, target.accountId];
    }
    logQuery(sql, params);
    const res = await client.query(sql, params);
    await client.query("COMMIT");
    return res.rows.map(mapRow);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("DB update failed — ROLLBACK issued.");
    throw err;
  } finally {
    client.release();
  }
}

// Re-select updated rows to confirm persisted values.
export async function reselectByIds(pool: pg.Pool, ids: string[]): Promise<SubscriptionRow[]> {
  if (ids.length === 0) return [];
  const sql = `SELECT ${SUB_COLUMNS} FROM "Subscriptions" WHERE id = ANY($1::text[]) ORDER BY "createdAt" DESC;`;
  logQuery(sql, [ids]);
  const res = await pool.query(sql, [ids]);
  return res.rows.map(mapRow);
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/db.ts
git commit -m "feat: transactional Postgres layer with query logging"
```

---

## Task 9: Stripe Playwright flow

**Files:**
- Create: `src/stripe-flow.ts`

> No unit test: drives the live Stripe dashboard. Uses stable role/text locators, a
> persistent headed context, tracing, and screenshots. Verified by manual run (Task 10).
> Selectors are centralized so they can be tuned against the live UI.

- [ ] **Step 1: Create `src/stripe-flow.ts`**

```ts
// src/stripe-flow.ts
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig, ParsedSpan } from "./types.js";
import { addSpan } from "./time.js";
import { promptEnterWhenReady } from "./prompts.js";

export interface StripeFlowInput {
  email: string;
  span: ParsedSpan;
  expectedStripeSubscriptionId: string | null;
  expectedStripeCustomerId: string | null;
}

export interface StripeFlowResult {
  stripeCustomerId: string | null;
  oldStripeSubscriptionId: string | null;
  newStripeSubscriptionId: string | null;
  collectionPausedSeen: boolean;
  activeSubscriptionConfirmed: boolean;
  notes: string[];
}

const ARTIFACTS = "artifacts";

async function shot(page: Page, name: string): Promise<void> {
  const dir = join(ARTIFACTS, "screenshots");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${Date.now()}-${name}.png`), fullPage: true });
}

export async function launchStripeContext(cfg: AppConfig): Promise<BrowserContext> {
  mkdirSync(cfg.stripe.authProfileDir, { recursive: true });
  mkdirSync(ARTIFACTS, { recursive: true });
  const context = await chromium.launchPersistentContext(cfg.stripe.authProfileDir, {
    headless: false,
    slowMo: cfg.slowMoMs,
    viewport: { width: 1440, height: 900 },
  });
  context.setDefaultTimeout(cfg.stripe.stepTimeoutMs);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  return context;
}

async function ensureLoggedIn(page: Page, cfg: AppConfig): Promise<void> {
  await page.goto(cfg.stripe.dashboardUrl, { waitUntil: "domcontentloaded" });
  // If redirected to a login/2FA page, pause for manual completion.
  if (/login|signin|authenticate/i.test(page.url())) {
    await promptEnterWhenReady(
      "Stripe login/2FA required. Complete login in the opened browser, navigate to the dashboard,",
    );
  }
}

export async function ensureEnvironmentSelected(page: Page, cfg: AppConfig): Promise<void> {
  const already = page.getByText(cfg.stripe.environmentName, { exact: false });
  if (await already.first().isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: /menu|account|switch/i }).first().click();
  const option = page.getByText(cfg.stripe.environmentName, { exact: false });
  if (await option.first().isVisible().catch(() => false)) {
    await option.first().click();
  } else {
    await promptEnterWhenReady(
      `Could not auto-select environment "${cfg.stripe.environmentName}". Select it manually,`,
    );
  }
}

export async function ensureSandboxMode(page: Page): Promise<void> {
  await page.getByRole("button", { name: /menu|account|switch/i }).first().click();
  const sandbox = page.getByText(/switch to sandbox/i);
  if (await sandbox.first().isVisible().catch(() => false)) {
    await sandbox.first().click();
  } else {
    await promptEnterWhenReady("Could not find 'Switch to sandbox'. Switch manually,");
  }
}

export async function ensureTestModeEnabled(page: Page): Promise<void> {
  const toggle = page.getByText(/test mode/i).first();
  if (await toggle.isVisible().catch(() => false)) {
    const isOn = await toggle.getAttribute("aria-checked").catch(() => null);
    if (isOn === "false") await toggle.click();
  }
}

export async function openCustomerByEmail(page: Page, cfg: AppConfig, email: string): Promise<void> {
  await page.getByRole("link", { name: /customers/i }).first().click();
  const search = page.getByPlaceholder(/search/i).first();
  await search.click();
  // Prefer the Email filter when available.
  const emailFilter = page.getByText(/^email$/i).first();
  if (await emailFilter.isVisible().catch(() => false)) await emailFilter.click();
  await search.fill(email);
  await page.keyboard.press("Enter");
  const result = page.getByRole("link", { name: new RegExp(email, "i") }).first();
  if (await result.isVisible().catch(() => false)) {
    await result.click();
  } else {
    await promptEnterWhenReady(`Could not auto-open customer "${email}". Open it manually,`);
  }
  await shot(page, "customer-opened");
}

export async function waitForCollectionPaused(page: Page, cfg: AppConfig): Promise<boolean> {
  const tag = page.getByText(/collection paused/i).first();
  try {
    await tag.waitFor({ state: "visible", timeout: cfg.stripe.longTimeoutMs });
    await shot(page, "collection-paused-found");
    return true;
  } catch {
    await shot(page, "collection-paused-missing");
    return false;
  }
}

export async function openPausedSubscription(page: Page): Promise<string | null> {
  const sub = page.getByRole("link", { name: /sub_/ }).first();
  let id: string | null = null;
  if (await sub.isVisible().catch(() => false)) {
    id = (await sub.textContent())?.trim() ?? null;
    await sub.click();
  } else {
    await promptEnterWhenReady("Could not auto-open the paused subscription. Open it manually,");
  }
  return id;
}

export async function runSimulation(page: Page): Promise<void> {
  const btn = page.getByRole("button", { name: /run simulation/i }).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
  } else {
    await promptEnterWhenReady("Could not find 'Run Simulation'. Click it manually,");
  }
  await shot(page, "simulation-started");
}

// Advance the test clock toward target. Loops until target reached.
export async function advanceClockBySpan(page: Page, cfg: AppConfig, span: ParsedSpan): Promise<void> {
  const target = addSpan(new Date(), span);
  let guard = 0;
  while (guard++ < 60) {
    const advanceBtn = page.getByRole("button", { name: /advance time/i }).first();
    if (!(await advanceBtn.isVisible().catch(() => false))) {
      await promptEnterWhenReady("Could not find 'Advance time'. Advance manually toward target,");
      break;
    }
    await advanceBtn.click();
    // Confirm dialog's advance button (if shown).
    const confirm = page.getByRole("button", { name: /^advance( time)?$/i }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    // Wait for the simulation to finish this step.
    await page
      .getByText(/advancing|simulating|in progress/i)
      .first()
      .waitFor({ state: "hidden", timeout: cfg.stripe.longTimeoutMs })
      .catch(() => undefined);
    // Re-read the displayed clock time; stop when at/after target.
    const clockText = await page.getByText(/\d{4}/).first().textContent().catch(() => null);
    const current = clockText ? new Date(clockText) : null;
    if (current && !Number.isNaN(current.getTime()) && current.getTime() >= target.getTime()) break;
    // If Stripe doesn't expose a parseable clock, ask the user whether target is reached.
    if (!current || Number.isNaN(current.getTime())) {
      await promptEnterWhenReady(
        `Confirm whether the test clock has reached ${target.toISOString()}. If yes, continue; if not, advance again manually then`,
      );
      break;
    }
  }
  await shot(page, "simulation-completed");
}

export async function verifyActiveSubscriptionForEmail(
  page: Page,
  cfg: AppConfig,
  email: string,
): Promise<{ confirmed: boolean; newSubscriptionId: string | null }> {
  // Refresh / re-open customer to read fresh state from the detail page.
  await page.reload({ waitUntil: "domcontentloaded" });
  await openCustomerByEmail(page, cfg, email);
  const active = page.getByText(/^active$/i).first();
  const confirmed = await active.isVisible({ timeout: cfg.stripe.longTimeoutMs }).catch(() => false);
  let newSubscriptionId: string | null = null;
  const sub = page.getByRole("link", { name: /sub_/ }).first();
  if (await sub.isVisible().catch(() => false)) {
    newSubscriptionId = (await sub.textContent())?.trim() ?? null;
  }
  if (confirmed) await shot(page, "active-subscription-confirmed");
  return { confirmed, newSubscriptionId };
}

export async function runStripeSimulation(
  cfg: AppConfig,
  input: StripeFlowInput,
  confirmAdvance: (details: { targetIso: string }) => Promise<boolean>,
): Promise<StripeFlowResult> {
  const notes: string[] = [];
  const context = await launchStripeContext(cfg);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await ensureLoggedIn(page, cfg);
    await ensureEnvironmentSelected(page, cfg);
    await ensureSandboxMode(page);
    await ensureTestModeEnabled(page);
    await openCustomerByEmail(page, cfg, input.email);

    const collectionPausedSeen = await waitForCollectionPaused(page, cfg);
    if (!collectionPausedSeen) notes.push("Collection Paused tag was not observed.");

    const oldStripeSubscriptionId = await openPausedSubscription(page);

    if (input.expectedStripeSubscriptionId && oldStripeSubscriptionId &&
        input.expectedStripeSubscriptionId !== oldStripeSubscriptionId) {
      notes.push(
        `DB stripeSubscriptionId (${input.expectedStripeSubscriptionId}) != paused Stripe sub (${oldStripeSubscriptionId}).`,
      );
      await promptEnterWhenReady("DB/Stripe subscription id mismatch (see note). Verify this is the right subscription,");
    }

    await runSimulation(page);

    const targetIso = addSpan(new Date(), input.span).toISOString();
    const proceed = await confirmAdvance({ targetIso });
    if (!proceed) {
      notes.push("User declined the ADVANCE confirmation; clock not advanced.");
      await context.tracing.stop({ path: join(ARTIFACTS, `trace-${Date.now()}.zip`) });
      await context.close();
      return {
        stripeCustomerId: input.expectedStripeCustomerId,
        oldStripeSubscriptionId,
        newStripeSubscriptionId: null,
        collectionPausedSeen,
        activeSubscriptionConfirmed: false,
        notes,
      };
    }

    await advanceClockBySpan(page, cfg, input.span);
    const verify = await verifyActiveSubscriptionForEmail(page, cfg, input.email);
    if (verify.newSubscriptionId && oldStripeSubscriptionId &&
        verify.newSubscriptionId === oldStripeSubscriptionId) {
      notes.push("New active subscription id equals old paused id — may not be a new subscription.");
    }

    await context.tracing.stop({ path: join(ARTIFACTS, `trace-${Date.now()}.zip`) });
    return {
      stripeCustomerId: input.expectedStripeCustomerId,
      oldStripeSubscriptionId,
      newStripeSubscriptionId: verify.newSubscriptionId,
      collectionPausedSeen,
      activeSubscriptionConfirmed: verify.confirmed,
      notes,
    };
  } catch (err) {
    notes.push(`Stripe flow error: ${err instanceof Error ? err.message : String(err)}`);
    await shot(page, "failure").catch(() => undefined);
    await context.tracing.stop({ path: join(ARTIFACTS, `trace-failure-${Date.now()}.zip`) }).catch(() => undefined);
    throw err;
  } finally {
    await context.close().catch(() => undefined);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/stripe-flow.ts
git commit -m "feat: Playwright Stripe test-clock flow with helpers, tracing, screenshots"
```

---

## Task 10: Orchestrator (index.ts) + manual verification

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create `src/index.ts`**

```ts
// src/index.ts
import { loadConfig } from "./config.js";
import { promptEmail, promptSpan, promptConfirm, promptSubscriptionChoice, promptTypeToken } from "./prompts.js";
import { createPool, lookupAccountId, fetchSubscriptions, updateRenewal, reselectByIds } from "./db.js";
import { chooseTargetSubscription } from "./selection.js";
import { computeRenewalUTC, formatTimestampUTC, parseSpan } from "./time.js";
import { runStripeSimulation } from "./stripe-flow.js";
import { buildAndFinalizeReport } from "./report-helpers.js";
import type { SubscriptionRow } from "./types.js";

function printRows(rows: SubscriptionRow[]): void {
  console.table(
    rows.map((r) => ({
      id: r.id, status: r.status, renewalDateTime: r.renewalDateTime,
      stripeSubscriptionId: r.stripeSubscriptionId, stripeCustomerId: r.stripeCustomerId, createdAt: r.createdAt,
    })),
  );
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  console.log(`DRY_RUN=${cfg.dryRun}  (set DRY_RUN=false in .env to perform writes/advance)`);

  const email = await promptEmail();
  const spanRaw = await promptSpan();
  const span = parseSpan(spanRaw);

  const pool = createPool(cfg);
  const notes: string[] = [];
  let dbSubscriptionId: string | null = null;
  let oldRenewal: string | null = null;
  let chosenRow: SubscriptionRow | null = null;

  try {
    // Phase 1
    const accountId = await lookupAccountId(pool, email);
    if (!accountId) throw new Error(`No account found for email ${email}`);
    console.log(`Account id: ${accountId}`);

    // Phase 2 — select
    const rows = await fetchSubscriptions(pool, accountId);
    if (rows.length === 0) throw new Error("No active (non-deleted) subscription found.");
    printRows(rows);

    let choice: string | undefined = rows.length > 1 ? await promptSubscriptionChoice() : undefined;
    let selection = chooseTargetSubscription(rows, choice);
    while (selection.kind === "invalid") {
      console.log(`Invalid id "${selection.input}". Try again.`);
      choice = await promptSubscriptionChoice();
      selection = chooseTargetSubscription(rows, choice);
    }

    const now = new Date();
    const newRenewal = computeRenewalUTC(now, cfg.renewalOffsetMinutes);
    console.log(`Local now:   ${now.toString()}`);
    console.log(`UTC now:     ${formatTimestampUTC(now)}`);
    console.log(`New renewal (UTC, +${cfg.renewalOffsetMinutes}m): ${newRenewal}`);

    // Phase 2 — write
    let target: { mode: "single"; id: string } | { mode: "all"; accountId: string } | null = null;
    if (selection.kind === "single") {
      chosenRow = selection.row;
      dbSubscriptionId = selection.row.id;
      oldRenewal = selection.row.renewalDateTime;
      target = { mode: "single", id: selection.row.id };
    } else if (selection.kind === "all") {
      target = { mode: "all", accountId };
      notes.push("UPDATE ALL selected — all non-deleted subscriptions updated.");
    } else if (selection.kind === "needChoice") {
      throw new Error("Multiple subscriptions; a choice is required.");
    }

    if (cfg.dryRun) {
      console.log("[DRY_RUN] Skipping DB write. Would update:", JSON.stringify(target));
      notes.push("DRY_RUN: DB not written.");
    } else if (target) {
      const ok = await promptConfirm(`Confirm UPDATE renewalDateTime to ${newRenewal} for ${JSON.stringify(target)}?`);
      if (!ok) throw new Error("User cancelled the DB update.");
      const updated = await updateRenewal(pool, target, newRenewal);
      console.log("Updated rows (RETURNING):");
      printRows(updated);
      const reselected = await reselectByIds(pool, updated.map((r) => r.id));
      console.log("Re-selected after commit:");
      printRows(reselected);
      if (!chosenRow && updated.length === 1) {
        chosenRow = updated[0];
        dbSubscriptionId = updated[0].id;
      }
    }

    // Phase 3 — Stripe
    const expectedSubId = chosenRow?.stripeSubscriptionId ?? null;
    const expectedCusId = chosenRow?.stripeCustomerId ?? null;

    if (cfg.dryRun && !cfg.openStripeInDryRun) {
      console.log("[DRY_RUN] Skipping Stripe flow (set OPEN_STRIPE_IN_DRY_RUN=true to open read-only).");
      notes.push("DRY_RUN: Stripe flow skipped.");
      await buildAndFinalizeReport({
        email, dbAccountId: accountId, dbSubscriptionId, oldRenewal, newRenewal,
        stripeCustomerId: expectedCusId, oldStripeSubscriptionId: expectedSubId, newStripeSubscriptionId: null,
        collectionPausedSeen: false, activeSubscriptionConfirmed: false, notes,
      });
      return;
    }

    const result = await runStripeSimulation(
      cfg,
      { email, span, expectedStripeSubscriptionId: expectedSubId, expectedStripeCustomerId: expectedCusId },
      async ({ targetIso }) => {
        if (cfg.dryRun) {
          console.log(`[DRY_RUN] Would advance clock toward ${targetIso}. Not advancing.`);
          return false;
        }
        return promptTypeToken(
          "ADVANCE",
          `About to advance Stripe test clock:\n  email: ${email}\n  customer: ${expectedCusId ?? "-"}\n  paused sub: ${expectedSubId ?? "-"}\n  span: ${spanRaw}\n  target: ${targetIso}`,
        );
      },
    );

    await buildAndFinalizeReport({
      email, dbAccountId: accountId, dbSubscriptionId, oldRenewal, newRenewal,
      stripeCustomerId: result.stripeCustomerId ?? expectedCusId,
      oldStripeSubscriptionId: result.oldStripeSubscriptionId ?? expectedSubId,
      newStripeSubscriptionId: result.newStripeSubscriptionId,
      collectionPausedSeen: result.collectionPausedSeen,
      activeSubscriptionConfirmed: result.activeSubscriptionConfirmed,
      notes: [...notes, ...result.notes],
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Create `src/report-helpers.ts`**

```ts
// src/report-helpers.ts
import type { RunReport } from "./types.js";
import { computeStatus, printReport, saveReport } from "./report.js";

export async function buildAndFinalizeReport(
  fields: Omit<RunReport, "timestamp" | "status">,
): Promise<RunReport> {
  const report: RunReport = {
    ...fields,
    timestamp: new Date().toISOString(),
    status: "FAIL",
  };
  report.status = computeStatus(report);
  printReport(report);
  const { jsonPath, txtPath } = saveReport(report);
  console.log(`Report saved:\n  ${jsonPath}\n  ${txtPath}`);
  return report;
}
```

- [ ] **Step 3: Type-check and run unit tests**

Run: `npx tsc -p tsconfig.json --noEmit && npx vitest run`
Expected: no type errors; all unit tests pass.

- [ ] **Step 4: Dry-run verification (no DB/Stripe writes)**

Prereq: copy `.env.example` to `.env`, fill **real DB creds**, leave `DRY_RUN=true`.
Run: `npm run dev`
Enter a known email and `1 month`.
Expected: prints SELECT queries + candidate rows, local/UTC times, computed renewal, and `[DRY_RUN]` skip messages for both DB and Stripe; writes a report under `artifacts/reports/`. No DB write occurs.

- [ ] **Step 5: Live run verification**

Set `DRY_RUN=false` in `.env`.
Run: `npm run dev`
Expected: prints UPDATE with `RETURNING` + re-selected row; opens headed Chromium; on first run pauses for Stripe login; requires typing `ADVANCE` before the clock advances; saves screenshots + trace + report; prints PASS/FAIL.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/report-helpers.ts
git commit -m "feat: orchestrator wiring phases + dry-run + final report"
```

---

## Task 11: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup, run, and safety notes"
```

---

## Self-Review Notes (coverage vs. spec)

- Runtime/inputs/structure → Tasks 1, 2, 7.
- `.env.example` (all vars incl. timeouts, OPEN_STRIPE_IN_DRY_RUN) → Task 1.
- Phase 1 lookup → Task 8 (`lookupAccountId`), wired in Task 10.
- Phase 2 select key fields, single/multiple/`UPDATE ALL`, `RETURNING`, txn, re-select,
  UTC local+UTC print → Tasks 4, 5, 8, 10.
- DB↔Stripe cross-check (sub id compare, customer id preference, email required) → Task 9 + 10.
- Second `ADVANCE` confirmation with details → Task 10 (`confirmAdvance` → `promptTypeToken`).
- Timeouts (step vs long) → Tasks 1, 2, 9.
- Stripe helpers (all nine named) + stable locators + manual fallbacks + login pause → Task 9.
- Test-clock span parse → target → loop until reached → Tasks 4, 9.
- Verification from refreshed detail page + new≠old id → Task 9.
- Report to console + json + txt with all fields → Tasks 6, 10.
- Tracing + step/failure screenshots → Task 9.
- Dry-run (no DB, no advance, no Stripe unless OPEN_STRIPE_IN_DRY_RUN), default-safe → Tasks 3, 10.
- Run instructions + scripts → Tasks 1, 11.
