const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DEFAULT_TIMEOUT = 30000;
const PAYMENT_TIMEOUT = 90000;

// Optional slow-motion delay (ms) on every Playwright action — off by default.
// Reliability comes from waiting for each step's destination URL (advanceTo)
// plus the syncPage() flush; global slowdown isn't needed. Override with
// ICLOSED_SLOWMO for debugging.
const SLOW_MO = process.env.ICLOSED_SLOWMO != null ? Number(process.env.ICLOSED_SLOWMO) : 0;
// Pause after filling a field / arriving on a step, so onChange/validation and
// the route guard's save commit before we act on the next control.
const FIELD_PAUSE_MS = process.env.ICLOSED_FIELD_PAUSE != null ? Number(process.env.ICLOSED_FIELD_PAUSE) : 400;

// Debug instrumentation. When DEBUG_DIR is set (via opts.debug or
// ICLOSED_DEBUG=1) we screenshot and dump visible control labels at each step.
let DEBUG_DIR = null;
let SNAP_N = 0;

function log(onProgress, step, extra = {}) {
  const payload = { step, ts: new Date().toISOString(), ...extra };
  onProgress(payload);
  console.log(`[${payload.ts}] ${step}${extra.detail ? ' — ' + extra.detail : ''}`);
}

async function snap(page, label) {
  if (!DEBUG_DIR) return;
  try {
    const name = String(++SNAP_N).padStart(2, '0') + '-' + label.replace(/[^a-z0-9]+/gi, '-');
    await page.screenshot({ path: path.join(DEBUG_DIR, name + '.png') });
  } catch {
    // ignore screenshot failures
  }
}

// Probe the page for the visible buttons/links and input fields, so we can
// discover the real accessible labels at each step.
async function probePage(page) {
  try {
    return await page.evaluate(() => {
      const txt = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
      const vis = (e) => e.offsetParent !== null || e.getClientRects().length > 0;

      const controls = [];
      const seen = new Set();
      for (const e of document.querySelectorAll('button, a, [role="button"], [role="link"]')) {
        const t = txt(e);
        if (vis(e) && t && !seen.has(t)) {
          seen.add(t);
          controls.push(t);
        }
      }

      const inputs = [];
      for (const e of document.querySelectorAll('input, textarea, [role="textbox"], [contenteditable="true"]')) {
        if (!vis(e)) continue;
        let label =
          e.getAttribute('aria-label') ||
          e.getAttribute('placeholder') ||
          e.getAttribute('name') ||
          '';
        if (!label && e.id) {
          const l = document.querySelector(`label[for="${e.id}"]`);
          if (l) label = txt(l);
        }
        const tag = e.tagName.toLowerCase() + (e.type ? ':' + e.type : '');
        inputs.push(`${tag} — ${label || '(no label)'}`);
      }

      return { controls: controls.slice(0, 60), inputs: inputs.slice(0, 30) };
    });
  } catch {
    return { controls: [], inputs: [] };
  }
}

// Snapshot + dump controls/inputs + url for a step. No-op unless debug is on.
async function dbg(onProgress, page, label) {
  if (!DEBUG_DIR) return;
  await snap(page, label);
  const { controls, inputs } = await probePage(page);
  log(onProgress, 'DBG ' + label, { url: page.url(), controls, inputs });
}

// Force the SPA to flush pending state/route commits before we act on a step.
// A `page.evaluate` (which reads layout) + a screenshot (which forces a paint)
// reliably let the onboarding step settle; without this the route guard
// intermittently bounces us back to /questionnaire. This was discovered because
// the flow was reliable ONLY when debug instrumentation (which does exactly
// this at each step) was enabled — so we now always do it.
async function syncPage(page) {
  try {
    await page.evaluate(() => document.body && document.body.offsetHeight);
  } catch {
    // ignore
  }
  try {
    await page.screenshot(); // returns a buffer; the point is the forced paint
  } catch {
    // ignore
  }
}

function randomString(len = 6) {
  return Math.random().toString(36).slice(2, 2 + len);
}

function randomFutureExpiry() {
  const now = new Date();
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
  const yearsAhead = 3 + Math.floor(Math.random() * 5);
  const yy = String((now.getFullYear() + yearsAhead) % 100).padStart(2, '0');
  return `${month}/${yy}`;
}

function randomCvc() {
  return String(Math.floor(100 + Math.random() * 900));
}

function randomPhoneSuffix() {
  let s = '';
  for (let i = 0; i < 10; i++) s += Math.floor(Math.random() * 10);
  return s;
}

async function acceptCookieBanner(page) {
  const acceptBtn = page.getByTestId('uc-accept-all-button');
  try {
    await acceptBtn.waitFor({ state: 'visible', timeout: 10000 });
    await acceptBtn.click();
  } catch {
    // banner not shown — continue
  }
}

async function fillSignupForm(page, email, password) {
  await page.getByRole('textbox', { name: 'Email *' }).fill(email);
  await page.getByRole('textbox', { name: 'Password * Confirm Password *' }).fill(password);
  await page.getByRole('textbox', { name: 'Re-enter Password' }).fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function fillStripeCheckout(page, username) {
  const frame = page.frameLocator('iframe[name="embedded-checkout"]');

  await frame.getByRole('textbox', { name: 'Company Name' }).waitFor({ timeout: DEFAULT_TIMEOUT });
  await frame.getByRole('textbox', { name: 'Company Name' }).fill(username);
  await frame.getByRole('textbox', { name: 'Card number' }).fill('4242424242424242');
  await frame.getByRole('textbox', { name: 'Expiration' }).fill(randomFutureExpiry());
  await frame.getByRole('textbox', { name: 'CVC' }).fill(randomCvc());
  await frame.getByRole('textbox', { name: 'Cardholder name' }).fill(username);

  // Submit by stable test id — works for both "Start trial" and the no-trial label
  // (e.g. "Subscribe" / "Pay") because Stripe keeps the same data-testid.
  await frame.getByTestId('hosted-payment-submit-button').click();
}

async function fillWelcomeScreen(page, username, onProgress) {
  // The "Welcome to iClosed" screen loads after "Go to iClosed". Key the wait
  // on the username field rather than a URL slug.
  const usernameInput = page.getByRole('textbox', { name: /username/i });
  await usernameInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  await dbg(onProgress, page, 'welcome-loaded');
  await usernameInput.click();
  await usernameInput.fill(username);
  await page.keyboard.press('Tab'); // blur so React commits the value
  await page.waitForTimeout(FIELD_PAUSE_MS);

  // Phone: append 10 random digits (preserves any country prefix, e.g. +92,
  // that the field may already contain).
  const phone = page.getByRole('textbox', { name: /phone number/i });
  await phone.click();
  await page.keyboard.press('End');
  await page.keyboard.type(randomPhoneSuffix(), { delay: 60 });
  await page.keyboard.press('Tab');
  await page.waitForTimeout(FIELD_PAUSE_MS);

  // Three dropdowns: Company Industry, Sales team size, How did you hear.
  // Each unfilled one shows the accessible name "Select"; keep filling whichever
  // is still labeled "Select" and pick the first option until none remain. This
  // sidesteps fragile label-relative selectors.
  const MAX_ITERS = 8;
  for (let i = 0; i < MAX_ITERS; i++) {
    const remaining = page.getByRole('button', { name: 'Select' });
    const count = await remaining.count();
    if (count === 0) break;

    const target = remaining.first();
    await target.scrollIntoViewIfNeeded();
    await target.click();
    await pickFirstDropdownOption(page);
    await page.waitForTimeout(FIELD_PAUSE_MS);
  }

  const selectsLeft = await page.getByRole('button', { name: 'Select' }).count();
  log(onProgress, 'Welcome filled', { url: page.url(), selectsLeft });
  await dbg(onProgress, page, 'welcome-filled');

  // "Next: Create your event" submits the questionnaire and navigates to
  // onboarding-1.
  await clickWhenEnabled(page, /Next:?\s*Create your event/i);
  await advanceTo(page, onProgress, 'onboarding-1', 'after-next-create-event');
}

async function createEventAndFinish(page, companyName, onProgress) {
  // Step 2/6 (onboarding-1): event template — VSL Funnel is pre-selected.
  // "Create and test event" does async work on this URL for a few seconds
  // ("Event saved") before navigating, so advanceTo waits for onboarding-2.
  await clickWhenEnabled(page, /Create and test event/i);
  await advanceTo(page, onProgress, 'onboarding-2', 'after-create-and-test-event');

  // Step 3/6 (onboarding-2): scheduler tutorial. It embeds a live scheduler demo
  // that loads asynchronously — clicking "Next" before its state commits makes
  // the guard bounce us back to /questionnaire. A visible element isn't enough;
  // this step needs a real dwell, so wait for the demo to render, then for the
  // network to quiet, then a deliberate pause before advancing.
  await page
    .getByRole('button', { name: /^Continue$/i })
    .or(page.getByRole('textbox', { name: /first name/i }))
    .first()
    .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
    .catch(() => {});
  await syncPage(page); // flush onboarding-2's state so Next doesn't bounce
  await clickWhenEnabled(page, /^Next$/i);
  await advanceTo(page, onProgress, 'onboarding-3', 'after-next');

  // Step 4/6 (onboarding-3): company name (+ currency / language defaults).
  const companyInput = page.getByRole('textbox', { name: /company name/i });
  await companyInput.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
  await companyInput.click();
  await companyInput.fill(companyName);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(FIELD_PAUSE_MS);

  await clickWhenEnabled(page, /Next:?\s*Connect tools/i);
  await advanceTo(page, onProgress, 'onboarding-4', 'after-next-connect-tools');

  // Step 5/6 (onboarding-4): Connect tools — skip.
  await clickWhenEnabled(page, /Skip for now/i);
  await advanceTo(page, onProgress, 'onboarding-5', 'after-skip-for-now');

  // Step 6/6 (onboarding-5): Invite Team — skip & finish.
  await clickWhenEnabled(page, /Skip\s*&\s*Finish setup/i);
  await page.waitForURL((url) => !/onboarding-5/.test(url.toString()), { timeout: DEFAULT_TIMEOUT }).catch(() => {});
  await dbg(onProgress, page, 'after-finish-setup');
}

// Click a control (button OR link, by accessible-name regex) once it is both
// visible and enabled. Handles native `disabled` as well as aria-disabled
// custom buttons. Many "Skip" controls render as links rather than buttons.
// The onboarding route guard intermittently (~1/10) bounces back to
// /questionnaire when a prior step's async save (event-creation / userOnboarding)
// hasn't committed yet. The bounce is a LATE redirect — it can fire after
// advanceTo() already saw the destination slug — so a pre-click wait can't prevent
// it. Instead: run the onboarding chain, and if it fails while we've been bounced
// to /questionnaire, let in-flight saves settle, re-enter onboarding-1 from the
// welcome "Next", and retry the chain.
async function createEventAndFinishWithRetry(page, username, onProgress, maxAttempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      await createEventAndFinish(page, username, onProgress);
      return;
    } catch (err) {
      const bounced = /\/questionnaire\b/.test(page.url());
      if (attempt >= maxAttempts || !bounced) throw err;
      log(onProgress, 'Onboarding bounced to questionnaire — recovering', { attempt, error: err.message, url: page.url() });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await syncPage(page);
      // The welcome form persists across the bounce, so just re-enter onboarding-1.
      await clickWhenEnabled(page, /Next:?\s*Create your event/i);
      await advanceTo(page, onProgress, 'onboarding-1', `retry-${attempt}-after-next-create-event`);
    }
  }
}

async function clickWhenEnabled(page, nameRe, timeout = DEFAULT_TIMEOUT) {
  const target = page
    .getByRole('button', { name: nameRe })
    .or(page.getByRole('link', { name: nameRe }))
    .first();
  await target.waitFor({ state: 'visible', timeout });
  await page.waitForFunction(
    ({ source, flags }) => {
      const re = new RegExp(source, flags);
      const els = Array.from(document.querySelectorAll('button, a, [role="button"], [role="link"]'));
      const el = els.find((b) => re.test((b.textContent || '').trim()));
      return el && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    },
    { source: nameRe.source, flags: nameRe.flags },
    { timeout }
  );
  await target.click();
}

// Wait for the specific destination step after a navigating click. This is the
// robust gate: some steps navigate immediately, others (e.g. "Create and test
// event") sit on the current URL doing async work for a few seconds before
// moving on, so we wait for the *expected* slug rather than guessing from URL
// stability. If a route guard bounces us elsewhere, this times out with a clear
// error. A short pause after arrival lets the new page render/commit before we
// interact with it.
async function advanceTo(page, onProgress, slug, label) {
  try {
    await page.waitForURL(`**/${slug}**`, { timeout: DEFAULT_TIMEOUT });
  } catch {
    await dbg(onProgress, page, label);
    throw new Error(`Expected to reach "${slug}" but stuck on ${page.url()} (likely a route-guard bounce — the previous step's save may not have committed)`);
  }
  // Let the step finish initializing before we act on it — acting too early
  // makes the onboarding guard bounce back to /questionnaire.
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {
    // some steps embed a live scheduler that never fully idles — keep going
  }
  await page.waitForTimeout(FIELD_PAUSE_MS);
  await syncPage(page);
  await dbg(onProgress, page, label);
}

async function pickFirstDropdownOption(page) {
  // After clicking a "Select" dropdown, options appear in a popup. They might
  // be role=option, role=menuitem, role=listitem, or plain <li>/<div>. Try
  // strategies in order and pick the first item that isn't the placeholder.
  const candidates = [
    page.getByRole('option').filter({ hasNotText: /^Select$/i }),
    page.getByRole('menuitem').filter({ hasNotText: /^Select$/i }),
    page.locator('[role="listbox"] li, [role="menu"] li, [role="dialog"] li').filter({ hasNotText: /^Select$/i }),
    // Last-resort: anything inside a popup that looks clickable and isn't
    // the trigger itself.
    page.locator('[role="listbox"] [role], [role="menu"] [role]').filter({ hasNotText: /^Select$/i }),
  ];

  for (const loc of candidates) {
    try {
      await loc.first().waitFor({ state: 'visible', timeout: 3000 });
      await loc.first().click();
      // Allow the popup to dismiss.
      await page.waitForTimeout(250);
      return;
    } catch {
      // try next
    }
  }

  throw new Error('Could not locate a non-placeholder option in the open dropdown');
}

async function createIClosedUser(opts) {
  const {
    campaignUrl,
    email,
    password,
    headed = true,
    keepOpen = true,
    onProgress = () => {},
  } = opts;

  if (!campaignUrl) throw new Error('campaignUrl is required');
  if (!email) throw new Error('email is required');
  if (!password) throw new Error('password is required');

  // Enable debug instrumentation (screenshots + control dumps) via opts.debug
  // or ICLOSED_DEBUG=1.
  if (opts.debug || process.env.ICLOSED_DEBUG === '1') {
    DEBUG_DIR = path.join(process.cwd(), 'debug');
    SNAP_N = 0;
    try {
      fs.mkdirSync(DEBUG_DIR, { recursive: true });
    } catch {
      // ignore
    }
  }

  const username = email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase() || 'user' + randomString();

  log(onProgress, 'Launching Chrome', { headed });
  const browser = await chromium.launch({ headless: !headed, channel: 'chrome', slowMo: SLOW_MO });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    log(onProgress, 'Opening campaign URL', { detail: campaignUrl });
    await page.goto(campaignUrl, { waitUntil: 'domcontentloaded' });

    log(onProgress, 'Accepting cookies (if shown)');
    await acceptCookieBanner(page);

    log(onProgress, 'Filling signup form', { detail: email });
    await fillSignupForm(page, email, password);

    log(onProgress, 'Waiting for Stripe checkout');
    await page.waitForURL('**/checkout**', { timeout: DEFAULT_TIMEOUT });

    log(onProgress, 'Filling Stripe checkout');
    await fillStripeCheckout(page, username);

    log(onProgress, 'Waiting for payment to succeed');
    await page.waitForURL('**/checkout-success**', { timeout: PAYMENT_TIMEOUT });

    log(onProgress, 'Clicking Go to iClosed');
    await page.getByRole('button', { name: 'Go to iClosed' }).click();

    log(onProgress, 'Filling Welcome to iClosed screen', { detail: username });
    await fillWelcomeScreen(page, username, onProgress);

    log(onProgress, 'Creating event and finishing setup');
    await createEventAndFinishWithRetry(page, username, onProgress);

    const result = {
      email,
      password,
      username,
      workspaceUrl: `https://dev.iclosed.io/e/${username}`,
    };
    log(onProgress, 'Done', { done: true, result });
    return result;
  } catch (err) {
    await snap(page, 'error');
    const { controls, inputs } = await probePage(page);
    log(onProgress, 'Error', { error: err.message, url: page.url(), controls, inputs });
    throw err;
  } finally {
    if (!keepOpen) {
      await browser.close();
    }
  }
}

function generateRandomEmail(prefix = 'demo', domain = 'example.com') {
  return `${prefix}${randomString()}@${domain}`;
}

module.exports = {
  createIClosedUser,
  generateRandomEmail,
};
