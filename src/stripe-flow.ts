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
