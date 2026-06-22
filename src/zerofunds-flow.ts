import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium, type Page } from "playwright";
import type { AppConfig } from "./types.js";
import {
  launchStripeContext, ensureLoggedIn, ensureEnvironmentSelected, ensureTestMode, openCustomerByEmail,
} from "./stripe-flow.js";
import { randomFutureExpiry, randomCvc, last4 } from "./cards.js";
import { addPaymentMethod, listPaymentMethods } from "./api/iclosed-app.js";

const ZERO_FUNDS_CARD = "4000000000000341";
const APP_CARD = "4000056655665556";
// Set per-run to an absolute writable dir (relative "artifacts" → ENOENT in a
// packaged app where cwd isn't writable). See launchStripeContext / runZeroFundsFlow.
let ARTIFACTS = "artifacts";

export interface ZeroFundsHooks {
  onStatus?: (step: string, message: string) => void;
  waitForLogin?: (page: Page) => Promise<void>;
  // Record the captured Stripe pm_ in the DB (between the dashboard and app
  // phases, per spec). Returns the new payment_methods row id.
  recordPaymentMethod?: (paymentMethodId: string) => Promise<string>;
}

export interface ZeroFundsFlowResult {
  stripeCustomerId: string | null;
  paymentMethodId: string | null;
  dbPaymentMethodId: string | null;
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
// iframe. Polls (up to ~15s) so the iframe has time to mount.
async function fillCardField(page: Page, name: RegExp, value: string): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const direct = page.getByRole("textbox", { name }).first();
    if (await direct.isVisible().catch(() => false)) { await direct.fill(value); return; }
    for (const frame of page.frames()) {
      const inFrame = frame.getByRole("textbox", { name }).first();
      if (await inFrame.isVisible().catch(() => false)) { await inFrame.fill(value); return; }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Could not find the "${name.source}" field.`);
}

// Ordered accessible names of every button on the customer page. Card rows and
// their pm_ ids appear here; a card row is immediately followed by its pm_.
async function readButtonNames(page: Page): Promise<string[]> {
  return page
    .getByRole("button")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") || e.textContent?.trim() || ""))
    .catch(() => [] as string[]);
}

const pmSet = (names: string[]): Set<string> => new Set(names.filter((n) => /^pm_[A-Za-z0-9]+$/.test(n)));

// The pm_ that immediately follows the first card row containing `last4`
// (Stripe lists newest-first), optionally restricted to `allow`.
function pmAfterCard(names: string[], last4: string, allow: Set<string>): string | null {
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    if (n.includes(last4) && /(expires|more options|visa|mastercard|amex|debit|credit)/i.test(n)) {
      for (let j = i + 1; j < names.length; j++) {
        if (/^pm_[A-Za-z0-9]+$/.test(names[j]) && (allow.size === 0 || allow.has(names[j]))) return names[j];
      }
    }
  }
  return null;
}

// Steps 11-20: add the zero-funds card in the Stripe dashboard; return its new pm_ id.
export async function addZeroFundsCardInDashboard(page: Page, cfg: AppConfig): Promise<string> {
  const wanted = last4(ZERO_FUNDS_CARD); // "0341"
  const addPmBtn = page.getByRole("button", { name: /^add payment method$/i }).first();
  await addPmBtn.scrollIntoViewIfNeeded().catch(() => undefined);
  await addPmBtn.waitFor({ state: "visible", timeout: cfg.stripe.stepTimeoutMs });
  // Let the pm_ list render so the before-snapshot is complete (else the diff
  // below would treat a pre-existing pm_ as "new").
  await page.getByRole("button", { name: /^pm_[A-Za-z0-9]+$/ }).first()
    .waitFor({ state: "visible", timeout: cfg.stripe.stepTimeoutMs }).catch(() => undefined);
  await page.waitForTimeout(1000);
  const before = pmSet(await readButtonNames(page));

  await addPmBtn.click({ timeout: cfg.stripe.stepTimeoutMs });
  await page.getByRole("menuitem", { name: /^add card$/i }).first().click({ timeout: cfg.stripe.stepTimeoutMs });

  await fillCardField(page, /card number/i, ZERO_FUNDS_CARD);
  await fillCardField(page, /expir/i, randomFutureExpiry());
  await fillCardField(page, /cvc|cvv/i, randomCvc());

  // Submit the modal's "Add card" button (distinct from the menu item above).
  await page.getByRole("button", { name: /^add card$/i }).first().click({ timeout: cfg.stripe.stepTimeoutMs });
  // Wait for the modal to close so the card list reflects the new card.
  await page.getByText(/^add a card$/i).first().waitFor({ state: "hidden", timeout: cfg.stripe.stepTimeoutMs }).catch(() => undefined);

  // Pick the pm_ that is newly present AND tied to a 0341 card row.
  const deadline = Date.now() + cfg.stripe.longTimeoutMs;
  let pm: string | null = null;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    const names = await readButtonNames(page);
    const added = new Set([...pmSet(names)].filter((x) => !before.has(x)));
    if (added.size) { pm = pmAfterCard(names, wanted, added) ?? [...added][0]; break; }
  }
  await shot(page, "pm-captured");
  if (!pm) throw new Error("Could not detect the new payment method (pm_) after adding the card.");
  return pm;
}

// Log into the app via a headed browser (reCAPTCHA is enforced, so this must run
// in a real browser) and capture the user's bearer token from /auth/authenticate.
async function getAppAccessToken(cfg: AppConfig, email: string, password: string): Promise<string> {
  const browser = await chromium.launch({ headless: false, channel: "chrome", slowMo: cfg.slowMoMs });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${cfg.appUrl}/auth/login`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^(allow|accept|allow all|accept all)$/i }).first().click({ timeout: 6000 }).catch(() => undefined);
    await page.locator('input[name="email"], #email').first().fill(email);
    await page.locator('input[type="password"], #password').first().fill(password);
    const respP = page.waitForResponse((r) => /\/auth\/authenticate/.test(r.url()), { timeout: cfg.stripe.stepTimeoutMs });
    await page.getByRole("button", { name: /^log ?in$/i }).first().click();
    const resp = await respP;
    const j = (await resp.json().catch(() => null)) as { accessToken?: string; message?: string } | null;
    if (!j?.accessToken) throw new Error(`App login failed (${resp.status()})${j?.message ? ": " + j.message : ""}`);
    return j.accessToken;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

// Steps 24-35: add the app card via the back-office API (login in a browser to
// get the token, then POST/GET /paymentMethods). This replaces the brittle
// Settings -> Billing UI; the backend handles Stripe tokenization server-side.
export async function addCardOnAppBilling(
  cfg: AppConfig, email: string, password: string,
): Promise<{ last4: string; verified: boolean }> {
  const base = (cfg.boBaseUrl || "").replace(/\/+$/, "");
  if (!base) throw new Error("Back office API base URL not set (BO_BASE_URL in Settings).");
  const token = await getAppAccessToken(cfg, email, password);

  const [mm, yy] = randomFutureExpiry().split("/");
  await addPaymentMethod(base, token, { number: APP_CARD, exp_month: Number(mm), exp_year: Number(yy), cvc: randomCvc() });

  // The new card can take a moment to appear in GET /paymentMethods, so poll.
  const wanted = last4(APP_CARD); // "5556"
  const deadline = Date.now() + cfg.stripe.stepTimeoutMs;
  let verified = false;
  while (Date.now() < deadline) {
    if ((await listPaymentMethods(base, token)).some((c) => c.last4 === wanted)) { verified = true; break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { last4: wanted, verified };
}

export async function runZeroFundsFlow(
  cfg: AppConfig, req: { email: string; password: string }, hooks: ZeroFundsHooks = {},
): Promise<ZeroFundsFlowResult> {
  const status = (s: string, m: string) => hooks.onStatus?.(s, m);
  const notes: string[] = [];
  ARTIFACTS = join(dirname(cfg.stripe.authProfileDir), "artifacts"); // writable when packaged
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

    // Record in the DB between phases (per spec) so it persists even if the
    // app-Billing step below fails.
    status("DB", "Recording payment method in the database…");
    const dbPaymentMethodId = hooks.recordPaymentMethod ? await hooks.recordPaymentMethod(paymentMethodId) : null;

    // App-Billing phase is non-fatal: a failure is noted, not thrown, so the
    // dashboard + DB success is still reported.
    let appCardLast4: string | null = null;
    let verified = false;
    try {
      status("APP BILLING", "Adding card via the iClosed Billing API…");
      const app = await addCardOnAppBilling(cfg, req.email, req.password);
      appCardLast4 = app.last4;
      verified = app.verified;
      if (!verified) notes.push(`App card ending ${app.last4} was not confirmed in the Billing payment methods.`);
    } catch (err) {
      notes.push(`App Billing step failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    status("DONE", "Zero funds flow complete.");
    return { stripeCustomerId, paymentMethodId, dbPaymentMethodId, appCardLast4, verified, notes };
  } catch (err) {
    await shot(page, "failure");
    throw err;
  } finally {
    await context.close().catch(() => undefined);
  }
}
