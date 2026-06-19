// Validate ONLY the app-Billing API step (login + add + poll-verify), no Stripe/DB.
//   npx tsx scripts/appcard-check.ts <email> <password>
import { readProfiles } from "../src/profiles.js";
import { parseConfig } from "../src/config.js";
import { addCardOnAppBilling } from "../src/zerofunds-flow.js";

const [email, password] = process.argv.slice(2);
const file = readProfiles("profiles.json", ".env");
const cfg = parseConfig(file.profiles[file.activeProfile] ?? {});
addCardOnAppBilling(cfg, email, password)
  .then((r) => console.log("RESULT", JSON.stringify(r)))
  .catch((e) => console.error("FAIL", e instanceof Error ? e.message : e));
