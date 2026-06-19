// Incrementally records iClosed/Stripe API calls to artifacts/<label>.ndjson as
// they happen (robust to closing the window). Drive the flow manually.
//   npx tsx scripts/har-capture.ts addcard
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Request } from "playwright";

const label = process.argv[2] || "capture";
mkdirSync("artifacts", { recursive: true });
const out = `artifacts/${label}.ndjson`;
writeFileSync(out, "");

const KEEP = /(iclosed\.io|stripe\.com)/i;
const SKIP_EXT = /\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|map)(\?|$)/i;
const KEEP_HEADERS = ["authorization", "cookie", "x-csrf-token", "content-type", "x-requested-with", "x-api-key", "x-client"];

function pickHeaders(h: Record<string, string>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const k of Object.keys(h)) if (KEEP_HEADERS.includes(k.toLowerCase())) o[k] = h[k];
  return o;
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  ctx.on("response", async (resp) => {
    try {
      const req: Request = resp.request();
      const url = req.url();
      if (!KEEP.test(url) || SKIP_EXT.test(url) || req.method() === "OPTIONS") return;
      const ct = resp.headers()["content-type"] || "";
      const respBody = /json|text|html/.test(ct) ? (await resp.text().catch(() => "")).slice(0, 6000) : "";
      appendFileSync(out, JSON.stringify({
        method: req.method(),
        url,
        status: resp.status(),
        reqHeaders: pickHeaders(req.headers()),
        reqBody: (req.postData() || "").slice(0, 6000),
        respCT: ct,
        respBody,
      }) + "\n");
    } catch { /* ignore */ }
  });

  const page = await ctx.newPage();
  await page.goto("https://dev.iclosed.io/auth/login").catch(() => undefined);
  console.log(`\n▶ Recording API calls → ${out}`);
  console.log("  Log in → add card in the opened window, then CLOSE the window.\n");
  await new Promise<void>((res) => browser.on("disconnected", () => res()));
  console.log(`✓ Done → ${out}`);
})().catch((e) => { console.error("CAPTURE FAILED", e instanceof Error ? e.message : e); process.exit(1); });
