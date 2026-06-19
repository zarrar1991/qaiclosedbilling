// Quick DB connectivity check on the active profile.
//   npx tsx scripts/db-probe.ts <email?>
import { readProfiles } from "../src/profiles.js";
import { parseConfig } from "../src/config.js";
import { createPool, lookupAccountId } from "../src/db.js";

const email = process.argv[2] || "afro5@iclosed.io";
const file = readProfiles("profiles.json", ".env");
const cfg = parseConfig(file.profiles[file.activeProfile] ?? {});
console.log("PGHOST:", cfg.pg.host, "schema:", cfg.pg.schema || "(default)");
const pool = createPool(cfg);
const t = Date.now();
lookupAccountId(pool, email)
  .then((id) => console.log(`OK in ${Date.now() - t}ms — accountId for ${email}: ${id}`))
  .catch((e) => console.log("DB ERROR:", e instanceof Error ? e.message : e))
  .finally(() => pool.end().catch(() => undefined));
