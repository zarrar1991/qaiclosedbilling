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
