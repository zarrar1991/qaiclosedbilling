import { loadConfig } from "./config.js";
import { promptEmail, promptSpan, promptConfirm, promptSubscriptionChoice, promptTypeToken } from "./prompts.js";
import { createPool, lookupAccountId, fetchSubscriptions, updateRenewal, reselectByIds } from "./db.js";
import { chooseTargetSubscription } from "./selection.js";
import { computeRenewalUTC, formatTimestampUTC, parseSpan } from "./time.js";
import { runStripeSimulation } from "./stripe-flow.js";
import { buildAndFinalizeReport } from "./report-helpers.js";
import type { SubscriptionRow } from "./types.js";

function printRows(rows: SubscriptionRow[]): void {
  console.table(
    rows.map((r) => ({
      id: r.id, status: r.status, renewalDateTime: r.renewalDateTime,
      stripeSubscriptionId: r.stripeSubscriptionId, stripeCustomerId: r.stripeCustomerId, createdAt: r.createdAt,
    })),
  );
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  console.log(`DRY_RUN=${cfg.dryRun}  (set DRY_RUN=false in .env to perform writes/advance)`);

  const email = await promptEmail();
  const spanRaw = await promptSpan();
  const span = parseSpan(spanRaw);

  const pool = createPool(cfg);
  const notes: string[] = [];
  let dbSubscriptionId: string | null = null;
  let oldRenewal: string | null = null;
  let chosenRow: SubscriptionRow | null = null;

  try {
    // Phase 1
    const accountId = await lookupAccountId(pool, email);
    if (!accountId) throw new Error(`No account found for email ${email}`);
    console.log(`Account id: ${accountId}`);

    // Phase 2 — select
    const rows = await fetchSubscriptions(pool, accountId);
    if (rows.length === 0) throw new Error("No active (non-deleted) subscription found.");
    printRows(rows);

    let choice: string | undefined = rows.length > 1 ? await promptSubscriptionChoice() : undefined;
    let selection = chooseTargetSubscription(rows, choice);
    while (selection.kind === "invalid") {
      console.log(`Invalid id "${selection.input}". Try again.`);
      choice = await promptSubscriptionChoice();
      selection = chooseTargetSubscription(rows, choice);
    }

    const now = new Date();
    const newRenewal = computeRenewalUTC(now, cfg.renewalOffsetMinutes);
    console.log(`Local now:   ${now.toString()}`);
    console.log(`UTC now:     ${formatTimestampUTC(now)}`);
    console.log(`New renewal (UTC, +${cfg.renewalOffsetMinutes}m): ${newRenewal}`);

    // Phase 2 — write
    let target: { mode: "single"; id: string } | { mode: "all"; accountId: string } | null = null;
    if (selection.kind === "single") {
      chosenRow = selection.row;
      dbSubscriptionId = selection.row.id;
      oldRenewal = selection.row.renewalDateTime;
      target = { mode: "single", id: selection.row.id };
    } else if (selection.kind === "all") {
      target = { mode: "all", accountId };
      notes.push("UPDATE ALL selected — all non-deleted subscriptions updated.");
    } else if (selection.kind === "needChoice") {
      throw new Error("Multiple subscriptions; a choice is required.");
    }

    if (cfg.dryRun) {
      console.log("[DRY_RUN] Skipping DB write. Would update:", JSON.stringify(target));
      notes.push("DRY_RUN: DB not written.");
    } else if (target) {
      const ok = await promptConfirm(`Confirm UPDATE renewalDateTime to ${newRenewal} for ${JSON.stringify(target)}?`);
      if (!ok) throw new Error("User cancelled the DB update.");
      const updated = await updateRenewal(pool, target, newRenewal);
      console.log("Updated rows (RETURNING):");
      printRows(updated);
      const reselected = await reselectByIds(pool, updated.map((r) => r.id));
      console.log("Re-selected after commit:");
      printRows(reselected);
      if (!chosenRow && updated.length === 1) {
        chosenRow = updated[0];
        dbSubscriptionId = updated[0].id;
      }
    }

    // Phase 3 — Stripe
    const expectedSubId = chosenRow?.stripeSubscriptionId ?? null;
    const expectedCusId = chosenRow?.stripeCustomerId ?? null;

    if (cfg.dryRun && !cfg.openStripeInDryRun) {
      console.log("[DRY_RUN] Skipping Stripe flow (set OPEN_STRIPE_IN_DRY_RUN=true to open read-only).");
      notes.push("DRY_RUN: Stripe flow skipped.");
      await buildAndFinalizeReport({
        email, dbAccountId: accountId, dbSubscriptionId, oldRenewalDate: oldRenewal, newRenewalDate: newRenewal,
        stripeCustomerId: expectedCusId, oldStripeSubscriptionId: expectedSubId, newStripeSubscriptionId: null,
        collectionPausedSeen: false, activeSubscriptionConfirmed: false, notes,
      });
      return;
    }

    const result = await runStripeSimulation(
      cfg,
      { email, span, expectedStripeSubscriptionId: expectedSubId, expectedStripeCustomerId: expectedCusId },
      async ({ targetIso }) => {
        if (cfg.dryRun) {
          console.log(`[DRY_RUN] Would advance clock toward ${targetIso}. Not advancing.`);
          return false;
        }
        return promptTypeToken(
          "ADVANCE",
          `About to advance Stripe test clock:\n  email: ${email}\n  customer: ${expectedCusId ?? "-"}\n  paused sub: ${expectedSubId ?? "-"}\n  span: ${spanRaw}\n  target: ${targetIso}`,
        );
      },
    );

    await buildAndFinalizeReport({
      email, dbAccountId: accountId, dbSubscriptionId, oldRenewalDate: oldRenewal, newRenewalDate: newRenewal,
      stripeCustomerId: result.stripeCustomerId ?? expectedCusId,
      oldStripeSubscriptionId: result.oldStripeSubscriptionId ?? expectedSubId,
      newStripeSubscriptionId: result.newStripeSubscriptionId,
      collectionPausedSeen: result.collectionPausedSeen,
      activeSubscriptionConfirmed: result.activeSubscriptionConfirmed,
      notes: [...notes, ...result.notes],
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("\nFATAL:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
