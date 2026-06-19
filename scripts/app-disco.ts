// App-side discovery (Task 9): log into the iClosed app and dump nav links/buttons
// so the Settings -> Billing route can be finalized. No Stripe, no card changes.
//   Usage: npx tsx scripts/app-disco.ts <email> <password>
import { chromium } from "playwright";

const [email, password] = process.argv.slice(2);
const appUrl = "https://dev.iclosed.io";

(async () => {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${appUrl}/auth/login`, { waitUntil: "domcontentloaded" });
  // Dismiss the Cookiebot consent banner if present.
  await page.getByRole("button", { name: /^(allow|accept|allow all|accept all)$/i }).first().click({ timeout: 6000 }).catch(() => undefined);

  const inputs = await page.locator("input").evaluateAll((els) =>
    els.map((e) => ({ type: e.getAttribute("type"), name: e.getAttribute("name"), id: e.id, ph: e.getAttribute("placeholder"), al: e.getAttribute("aria-label") })),
  );
  console.log("INPUTS:", JSON.stringify(inputs));
  await page.screenshot({ path: "artifacts/screenshots/app-login-form.png", fullPage: true }).catch(() => undefined);

  // Robust fills: email by type/name/placeholder; password by type=password.
  await page.locator('input[type="email"], input[name*="email" i], input[placeholder*="email" i]').first().fill(email).catch((e) => console.log("email fill err", String(e)));
  await page.locator('input[type="password"]').first().fill(password).catch((e) => console.log("pw fill err", String(e)));
  await page.getByRole("button", { name: /^log ?in$/i }).first().click().catch((e) => console.log("login click err", String(e)));
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(5000);

  console.log("URL after login:", page.url());
  const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
  console.log("BODY (first 400):", bodyText);
  const links = await page.locator("a").evaluateAll((els) =>
    els.map((e) => ({ t: (e.textContent || "").trim().slice(0, 40), href: e.getAttribute("href") })).filter((x) => x.t || x.href),
  );
  console.log("LINKS:", JSON.stringify(links));
  const btns = await page.getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") || e.textContent?.trim()).filter(Boolean));
  console.log("BUTTONS:", JSON.stringify(btns));
  await page.screenshot({ path: "artifacts/screenshots/app-disco-1.png", fullPage: true }).catch(() => undefined);

  await page.waitForTimeout(1500);
  await browser.close();
})().catch((e) => { console.error("DISCO FAILED", e instanceof Error ? e.message : e); process.exit(1); });
