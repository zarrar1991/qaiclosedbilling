// Use the production `playwright` package (not the `@playwright/test` devDependency,
// which electron-builder strips from packaged builds — ERR_MODULE_NOT_FOUND at launch).
import { chromium, type BrowserContext, type Page, type Locator } from "playwright";
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

export interface StripeFlowHooks {
  onStatus?: (step: string, message: string) => void;
  // UI mode: resolve once the dashboard is ready (poll), instead of a terminal prompt.
  waitForLogin?: (page: Page) => Promise<void>;
  // UI mode: return true to advance (the UI button is the confirmation).
  confirmAdvance?: (details: { targetIso: string }) => Promise<boolean>;
}

const ARTIFACTS = "artifacts";

async function shot(page: Page, name: string): Promise<void> {
  const dir = join(ARTIFACTS, "screenshots");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${Date.now()}-${name}.png`), fullPage: true }).catch(() => undefined);
}

// Parse a human date like "August 17, 2026" or "Jun 17, 2026" into a Date.
function parseHumanDate(s: string): Date | null {
  const d = new Date(s.replace(/\s+at\s+.*/i, "").trim());
  return Number.isNaN(d.getTime()) ? null : d;
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

function accountSwitcher(page: Page): Locator {
  return page.getByRole("button", { name: /account options and switcher/i }).first();
}

// In UI mode (hooks.onStatus is set) there is no terminal to prompt, so a manual
// fallback must FAIL clearly (surfaced as a red banner) rather than block forever
// on stdin. In CLI mode, pause and let the user resolve it manually.
async function manualStep(message: string, hooks: StripeFlowHooks): Promise<void> {
  if (hooks.onStatus) throw new Error(message.replace(/,\s*$/, "."));
  await promptEnterWhenReady(message);
}

export async function ensureLoggedIn(page: Page, cfg: AppConfig, hooks: StripeFlowHooks = {}): Promise<void> {
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

// Step 3-4: ensure the configured environment is selected. If the env name is
// blank, skip (assume the saved session is already on the right environment).
export async function ensureEnvironmentSelected(page: Page, cfg: AppConfig, hooks: StripeFlowHooks = {}): Promise<void> {
  if (!cfg.stripe.environmentName) return;
  const switcher = accountSwitcher(page);
  const name = (await switcher.getAttribute("aria-label").catch(() => null)) ?? "";
  if (name.toLowerCase().includes(cfg.stripe.environmentName.toLowerCase())) return;

  await switcher.click();
  const option = page.getByRole("menuitem", { name: new RegExp(cfg.stripe.environmentName, "i") }).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  } else {
    await manualStep(`Could not auto-select environment "${cfg.stripe.environmentName}". Select it manually,`, hooks);
  }
}

// Steps 5-7: switch into a sandbox / Test mode. Detected by "/test/" in the URL.
export async function ensureTestMode(page: Page, hooks: StripeFlowHooks = {}): Promise<void> {
  if (page.url().includes("/test/")) return;

  await accountSwitcher(page).click();
  const switchToSandbox = page.getByRole("menuitem", { name: /switch to sandbox/i }).first();
  if (await switchToSandbox.isVisible().catch(() => false)) {
    await switchToSandbox.click(); // opens the sandbox submenu
  } else {
    await manualStep("Could not find 'Switch to sandbox'. Switch to Test mode manually,", hooks);
    return;
  }

  // The submenu item's accessible name is "T Test mode" (avatar letter prefix),
  // so match a contained "test mode", and wait for the submenu to render.
  const testMode = page.getByRole("menuitem", { name: /test mode/i }).first();
  await testMode.waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
  if (await testMode.isVisible().catch(() => false)) {
    await testMode.click();
  } else {
    await manualStep("Could not find the 'Test mode' option. Select it manually,", hooks);
    return;
  }
  await page.waitForURL(/\/test\//, { timeout: 30000 }).catch(() => undefined);
}

// Step 8-10: open the Customers list, search the email, open the customer.
// Returns the Stripe customer id parsed from the URL (cus_...).
export async function openCustomerByEmail(page: Page, cfg: AppConfig, email: string, hooks: StripeFlowHooks = {}): Promise<string | null> {
  await page.getByRole("link", { name: /^customers$/i }).first().click();
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);

  const search = page.getByRole("searchbox", { name: /search by name, email/i }).first();
  await search.waitFor({ state: "visible", timeout: cfg.stripe.stepTimeoutMs });
  await search.fill(email);
  // Wait for the result row containing the email to appear, then open it.
  const customerLink = page.getByRole("link", { name: email }).first();
  try {
    await customerLink.waitFor({ state: "visible", timeout: cfg.stripe.stepTimeoutMs });
    await customerLink.click();
  } catch {
    await manualStep(`Could not auto-open customer "${email}". Open it manually,`, hooks);
  }
  await page.waitForURL(/\/customers\/cus_/, { timeout: cfg.stripe.stepTimeoutMs }).catch(() => undefined);
  await shot(page, "customer-opened");
  return page.url().match(/customers\/(cus_[A-Za-z0-9]+)/)?.[1] ?? null;
}

// Step 11: wait for the "Collection paused" indicator. Stripe's page only shows
// the badge after a reload, so poll with reloads (every ~6s) up to the long
// timeout, returning true as soon as it appears.
export async function waitForCollectionPaused(page: Page, cfg: AppConfig): Promise<boolean> {
  const deadline = Date.now() + cfg.stripe.longTimeoutMs;
  while (Date.now() < deadline) {
    // Give the (re)loaded customer page time to render its subscription rows,
    // THEN check the badge — i.e. verify the tag after every refresh.
    await page.waitForTimeout(15000);
    const seen = await page.getByText(/collection paused/i).first().isVisible().catch(() => false);
    if (seen) {
      await shot(page, "collection-paused-found");
      return true;
    }
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  }
  await shot(page, "collection-paused-missing");
  return false;
}

// Step 12: open the subscription from the customer page. Returns its sub_ id.
export async function openPausedSubscription(page: Page, cfg: AppConfig, hooks: StripeFlowHooks = {}): Promise<string | null> {
  const link = page.locator('a[href*="/subscriptions/sub_"]').first();
  let id: string | null = null;
  if (await link.isVisible().catch(() => false)) {
    id = (await link.getAttribute("href"))?.match(/subscriptions\/(sub_[A-Za-z0-9]+)/)?.[1] ?? null;
    await link.click();
    await page.waitForURL(/\/subscriptions\/sub_/, { timeout: cfg.stripe.stepTimeoutMs }).catch(() => undefined);
  } else {
    await manualStep("Could not auto-open the paused subscription. Open it manually,", hooks);
    id = page.url().match(/subscriptions\/(sub_[A-Za-z0-9]+)/)?.[1] ?? null;
  }
  return id;
}

// Step 13: open the Run simulation modal (test clock).
// NOTE: Stripe renders the modal's controls (date, presets, "Advance time")
// OUTSIDE the [role=alertdialog] DOM node, so they are NOT descendants of the
// dialog locator. All modal controls below are therefore PAGE-scoped, not
// dialog-scoped (dialog-scoped lookups match nothing and hang).
export async function runSimulation(page: Page, cfg: AppConfig, hooks: StripeFlowHooks = {}): Promise<void> {
  // The modal's date button (e.g. "Tue, Aug 18, 2026") is the reliable signal
  // that the modal is open.
  if (await modalDateButton(page).isVisible().catch(() => false)) {
    await shot(page, "simulation-started");
    return;
  }
  // Fresh subscription shows a "Run simulation" button; once a simulation has
  // run, the page shows an inline "Advance time" button instead. Either opens
  // the modal.
  const opener = page
    .getByRole("button", { name: /^run simulation$/i })
    .or(page.getByRole("button", { name: /^advance time$/i }))
    .first();
  // The subscription detail page (and its test-clock panel) renders async after
  // navigation, so wait for the opener before deciding it's missing.
  await opener.waitFor({ state: "visible", timeout: cfg.stripe.stepTimeoutMs }).catch(() => undefined);
  if (await opener.isVisible().catch(() => false)) {
    await opener.click();
  } else {
    await manualStep("Could not find 'Run simulation'. Open the simulation dialog manually,", hooks);
  }
  await modalDateButton(page).waitFor({ state: "visible", timeout: cfg.stripe.stepTimeoutMs }).catch(() => undefined);
  await shot(page, "simulation-started");
}

// The modal's selected-date button, named like "Tue, Aug 18, 2026" (weekday,
// month day, year) — distinct from the date-range buttons in the pricing table.
function modalDateButton(page: Page): Locator {
  return page.getByRole("button", { name: /\w{3,9},\s\w{3}\s\d{1,2},\s\d{4}/ }).first();
}

// Read the date currently selected in the Run simulation modal.
async function readSelectedDate(page: Page): Promise<Date | null> {
  const txt = await modalDateButton(page).textContent().catch(() => null);
  return txt ? parseHumanDate(txt) : null;
}

// Read the per-step cap from the note ("...advance the simulation time to <date>...").
async function readCapDate(page: Page): Promise<Date | null> {
  const note = page.getByText(/advance the simulation time to/i).first();
  const txt = await note.textContent().catch(() => null);
  const m = txt?.match(/to\s+(.+?)(?:\s+at\b|\.|$)/i);
  return m ? parseHumanDate(m[1]) : null;
}

// Nominal duration a preset button adds, used to pick the largest fitting preset.
function presetCandidate(from: Date, label: string): Date {
  const d = new Date(from.getTime());
  if (label === "1 month") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (label === "1 week") d.setUTCDate(d.getUTCDate() + 7);
  else if (label === "1 day") d.setUTCDate(d.getUTCDate() + 1);
  else d.setUTCHours(d.getUTCHours() + 1);
  return d;
}

// Steps 14-15: advance the test clock toward (current clock + span), looping
// across the per-step cap, waiting for each advance to complete.
export async function advanceClockBySpan(page: Page, cfg: AppConfig, span: ParsedSpan, hooks: StripeFlowHooks = {}): Promise<void> {
  await runSimulation(page, cfg, hooks);
  // Compare by calendar day (floor to local midnight): the modal dates are
  // date-only, but a fallback `new Date()` carries a time-of-day that would
  // otherwise make the target unreachable.
  const floorDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const clockStart = floorDay((await readSelectedDate(page)) ?? new Date());
  const target = floorDay(addSpan(clockStart, span));

  const presets = ["1 month", "1 week", "1 day", "1 hour"];
  let guard = 0;
  while (guard++ < 80) {
    let selected = floorDay((await readSelectedDate(page)) ?? clockStart);
    const cap = floorDay((await readCapDate(page)) ?? target);
    const stepTarget = target.getTime() < cap.getTime() ? target : cap;

    // Click the largest preset whose result stays within this step's target.
    // PAGE-scoped (see runSimulation note): modal controls live outside the dialog node.
    let progressed = false;
    let innerGuard = 0;
    while (selected.getTime() < stepTarget.getTime() && innerGuard++ < 60) {
      const label = presets.find((p) => presetCandidate(selected, p).getTime() <= stepTarget.getTime());
      if (!label) break;
      await page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).first().click({ timeout: cfg.stripe.stepTimeoutMs });
      await page.waitForTimeout(300);
      const after = floorDay((await readSelectedDate(page)) ?? selected);
      if (after.getTime() <= selected.getTime()) break; // no progress (hit cap)
      selected = after;
      progressed = true;
    }

    if (!progressed) {
      // Can't push further within the cap toward target; advance with one day as a fallback.
      await page.getByRole("button", { name: /^1 day$/i }).first().click({ timeout: cfg.stripe.stepTimeoutMs }).catch(() => undefined);
      await page.waitForTimeout(300);
    }

    await page.getByRole("button", { name: /^advance time$/i }).first().click({ timeout: cfg.stripe.stepTimeoutMs });

    // The modal closes once the advance is submitted; wait for its date button to
    // detach, then let the test clock process the step server-side. (The "test
    // clock is advancing" panel text is a static heading, not a progress signal.)
    await modalDateButton(page).waitFor({ state: "hidden", timeout: cfg.stripe.stepTimeoutMs }).catch(() => undefined);
    await page.waitForTimeout(8000);

    if (selected.getTime() >= target.getTime()) break;

    // Reopen the modal for the next step (the cap will have moved forward).
    await runSimulation(page, cfg, hooks);
  }
  await shot(page, "simulation-completed");
}

// Step 16: confirm the downgrade succeeded. On the customer's page there must
// be a subscription row that is Active, has NO "Collection paused" tag, and is a
// DIFFERENT subscription from the old paused one. Polls (with reloads) until it
// appears or the long timeout elapses.
export async function verifyActiveSubscriptionForEmail(
  page: Page,
  cfg: AppConfig,
  customerId: string | null,
  email: string,
  oldSubscriptionId: string | null,
): Promise<{ confirmed: boolean; newSubscriptionId: string | null }> {
  const customerUrl = customerId ? `${cfg.stripe.dashboardUrl}/test/customers/${customerId}` : null;
  const deadline = Date.now() + cfg.stripe.longTimeoutMs;

  let newSubscriptionId: string | null = null;
  let confirmed = false;

  while (Date.now() < deadline) {
    if (customerUrl) {
      await page.goto(customerUrl, { waitUntil: "domcontentloaded" });
    } else {
      await openCustomerByEmail(page, cfg, email);
    }
    // The customer page's subscription rows render async; wait before reading.
    await page.waitForTimeout(10000);

    // Each subscription is a table row containing a /subscriptions/sub_ link.
    const rows = page.getByRole("row").filter({ has: page.locator('a[href*="/subscriptions/sub_"]') });
    const count = await rows.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const text = (await row.innerText().catch(() => "")) ?? "";
      const href = await row
        .locator('a[href*="/subscriptions/sub_"]')
        .first()
        .getAttribute("href")
        .catch(() => null);
      const id = href?.match(/subscriptions\/(sub_[A-Za-z0-9]+)/)?.[1] ?? null;
      const isActive = /\bactive\b/i.test(text);
      const isPaused = /collection paused/i.test(text);
      if (isActive && !isPaused && id && id !== oldSubscriptionId) {
        confirmed = true;
        newSubscriptionId = id;
        break;
      }
    }
    if (confirmed) break;
    await page.waitForTimeout(3000);
  }

  if (confirmed) await shot(page, "active-subscription-confirmed");
  return { confirmed, newSubscriptionId };
}

export async function runStripeSimulation(
  cfg: AppConfig,
  input: StripeFlowInput,
  hooks: StripeFlowHooks = {},
): Promise<StripeFlowResult> {
  const status = (step: string, message: string) => hooks.onStatus?.(step, message);
  const notes: string[] = [];
  const context = await launchStripeContext(cfg);
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    status("login", "Ensuring Stripe login…");
    await ensureLoggedIn(page, cfg, hooks);
    status("environment", "Ensuring correct environment is selected…");
    await ensureEnvironmentSelected(page, cfg, hooks);
    status("testmode", "Ensuring Test mode is active…");
    await ensureTestMode(page, hooks);

    status("customer", "Opening customer by email…");
    const stripeCustomerId = await openCustomerByEmail(page, cfg, input.email, hooks);
    if (input.expectedStripeCustomerId && stripeCustomerId &&
        input.expectedStripeCustomerId !== stripeCustomerId) {
      notes.push(`DB stripeCustomerId (${input.expectedStripeCustomerId}) != opened customer (${stripeCustomerId}).`);
    }

    status("paused", "Waiting for Collection Paused indicator…");
    const collectionPausedSeen = await waitForCollectionPaused(page, cfg);
    if (!collectionPausedSeen) notes.push("Collection Paused tag was not observed.");

    status("subscription", "Opening paused subscription…");
    const oldStripeSubscriptionId = await openPausedSubscription(page, cfg, hooks);
    if (input.expectedStripeSubscriptionId && oldStripeSubscriptionId &&
        input.expectedStripeSubscriptionId !== oldStripeSubscriptionId) {
      notes.push(
        `DB subscriptionId (${input.expectedStripeSubscriptionId}) != opened subscription (${oldStripeSubscriptionId}).`,
      );
      // A mismatch is a warning, not fatal. Only pause (CLI); in UI mode just note it.
      if (!hooks.onStatus) {
        await promptEnterWhenReady("DB/Stripe subscription id mismatch (see note). Verify this is the right subscription,");
      }
    }

    const targetIso = addSpan(new Date(), input.span).toISOString();
    const proceed = hooks.confirmAdvance ? await hooks.confirmAdvance({ targetIso }) : true;
    if (!proceed) {
      notes.push("User declined the ADVANCE confirmation; clock not advanced.");
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

    status("advancing", "Advancing Stripe test clock…");
    await advanceClockBySpan(page, cfg, input.span, hooks);

    status("verifying", "Verifying active subscription after advance…");
    const verify = await verifyActiveSubscriptionForEmail(
      page,
      cfg,
      stripeCustomerId,
      input.email,
      oldStripeSubscriptionId,
    );
    if (verify.newSubscriptionId && oldStripeSubscriptionId &&
        verify.newSubscriptionId === oldStripeSubscriptionId) {
      notes.push("New active subscription id equals old paused id — may be the same subscription resumed.");
    }

    status("done", "Stripe flow complete.");
    await context.tracing.stop({ path: join(ARTIFACTS, `trace-${Date.now()}.zip`) }).catch(() => undefined);
    return {
      stripeCustomerId,
      oldStripeSubscriptionId,
      newStripeSubscriptionId: verify.newSubscriptionId,
      collectionPausedSeen,
      activeSubscriptionConfirmed: verify.confirmed,
      notes,
    };
  } catch (err) {
    notes.push(`Stripe flow error: ${err instanceof Error ? err.message : String(err)}`);
    await shot(page, "failure");
    await context.tracing.stop({ path: join(ARTIFACTS, `trace-failure-${Date.now()}.zip`) }).catch(() => undefined);
    throw err;
  } finally {
    await context.close().catch(() => undefined);
  }
}
