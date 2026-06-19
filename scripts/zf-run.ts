// Dev harness to drive the Zero-funds flow headed, with direct console output —
// used for selector finalization (Task 9). Uses the active profile's config.
//   Usage: npx tsx scripts/zf-run.ts <email> <password>
import { readProfiles } from "../src/profiles.js";
import { parseConfig } from "../src/config.js";
import { createPool, lookupAccountId, lookupUserId, insertPaymentMethod } from "../src/db.js";
import { runZeroFundsFlow } from "../src/zerofunds-flow.js";

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("usage: npx tsx scripts/zf-run.ts <email> <password>");
  process.exit(1);
}

const file = readProfiles("profiles.json", ".env");
const cfg = parseConfig(file.profiles[file.activeProfile] ?? {});
const pool = createPool(cfg);

runZeroFundsFlow(
  cfg,
  { email, password },
  {
    onStatus: (s, m) => console.log(`[${s}] ${m}`),
    // Poll for the dashboard instead of blocking on stdin if login is needed.
    waitForLogin: async (page) => {
      await page
        .getByRole("button", { name: /account options and switcher/i })
        .first()
        .waitFor({ state: "visible", timeout: cfg.stripe.longTimeoutMs });
    },
    recordPaymentMethod: async (pm) => {
      const accountId = await lookupAccountId(pool, email);
      if (!accountId) throw new Error(`No account found for email ${email}`);
      const userId = await lookupUserId(pool, email);
      if (!userId) throw new Error(`No user found for email ${email}`);
      const id = await insertPaymentMethod(pool, { accountId, userId, stripePaymentMethodId: pm, type: "card" });
      console.log(`[DB] inserted payment_methods id=${id} (accountId=${accountId}, userId=${userId})`);
      return id;
    },
  },
)
  .then((r) => console.log("RESULT", JSON.stringify(r, null, 2)))
  .catch((e) => console.error("FAILED", e instanceof Error ? e.message : e))
  .finally(() => pool.end().catch(() => undefined));
