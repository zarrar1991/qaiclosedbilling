import { loadConfig } from "./config.js";
import { createPool, lookupAccountId, fetchSubscriptions, updateRenewal, reselectByIds } from "./db.js";
import { chooseTargetSubscription } from "./selection.js";
import { computeRenewalUTC, formatTimestampUTC } from "./time.js";
import type { SubscriptionRow } from "./types.js";

// Phase 1 + 2 ONLY: set the active subscription's renewalDateTime to now+offset
// (UTC). No Stripe involvement. Writes to the DB (transactional).
function printRows(rows: SubscriptionRow[]): void {
  console.table(
    rows.map((r) => ({
      id: r.id, status: r.status, renewalDateTime: r.renewalDateTime,
      pauseCollection: r.pauseCollection, stripeSubscriptionId: r.stripeSubscriptionId, createdAt: r.createdAt,
    })),
  );
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const email = process.env.TARGET_EMAIL || process.argv[2];
  if (!email) throw new Error("Provide an email via TARGET_EMAIL env or as the first argument.");

  const pool = createPool(cfg);
  try {
    const accountId = await lookupAccountId(pool, email);
    if (!accountId) throw new Error(`No account found for email ${email}`);
    console.log(`Account id: ${accountId}`);

    const rows = await fetchSubscriptions(pool, accountId);
    if (rows.length === 0) throw new Error("No active (non-deleted) subscription found.");
    printRows(rows);

    const selection = chooseTargetSubscription(rows, process.env.SUB_CHOICE);
    if (selection.kind !== "single" && selection.kind !== "all") {
      throw new Error(
        `Need a single target. Found ${rows.length} rows; set SUB_CHOICE to a subscription id or "UPDATE ALL".`,
      );
    }

    const now = new Date();
    const newRenewal = computeRenewalUTC(now, cfg.renewalOffsetMinutes);
    console.log(`Local now:   ${now.toString()}`);
    console.log(`UTC now:     ${formatTimestampUTC(now)}`);
    console.log(`New renewal (UTC, +${cfg.renewalOffsetMinutes}m): ${newRenewal}`);

    const target =
      selection.kind === "single"
        ? ({ mode: "single", id: selection.row.id } as const)
        : ({ mode: "all", accountId } as const);

    const updated = await updateRenewal(pool, target, newRenewal);
    console.log("Updated rows (RETURNING):");
    printRows(updated);

    const reselected = await reselectByIds(pool, updated.map((r) => r.id));
    console.log("Re-selected after commit:");
    printRows(reselected);

    console.log("\n✅ Renewal updated. Now watch the Stripe subscription for the 'Collection paused' tag.");
  } catch (err) {
    console.error("\n❌ Update failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main();
