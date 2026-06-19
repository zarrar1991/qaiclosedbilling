// Validate that an AUTOMATED browser login passes reCAPTCHA and yields the
// accessToken (intercepted from /auth/authenticate).
//   npx tsx scripts/app-login-token.ts <email> <password>
import { chromium } from "playwright";

const [email, password] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("https://dev.iclosed.io/auth/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^(allow|accept|allow all|accept all)$/i }).first().click({ timeout: 6000 }).catch(() => undefined);
  await page.locator('input[name="email"], #email').first().fill(email);
  await page.locator('input[type="password"], #password').first().fill(password);
  const respP = page.waitForResponse((r) => /\/auth\/authenticate/.test(r.url()), { timeout: 30000 });
  await page.getByRole("button", { name: /^log ?in$/i }).first().click();
  try {
    const resp = await respP;
    const j = await resp.json().catch(() => null) as { accessToken?: string; message?: string } | null;
    console.log("AUTH status:", resp.status(), "| token captured:", !!j?.accessToken, "| msg:", j?.message || "");
    console.log("URL now:", page.url());
  } catch (e) {
    console.log("no /auth/authenticate response:", e instanceof Error ? e.message : e);
  }
  await page.waitForTimeout(1500);
  await browser.close();
})().catch((e) => { console.error("FAIL", e instanceof Error ? e.message : e); process.exit(1); });
