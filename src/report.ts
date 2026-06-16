import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RunReport } from "./types.js";

export function computeStatus(r: RunReport): "PASS" | "FAIL" {
  return r.collectionPausedSeen && r.activeSubscriptionConfirmed ? "PASS" : "FAIL";
}

export function formatReportText(r: RunReport): string {
  return [
    "=== Downgrade Process Report ===",
    `Timestamp:                ${r.timestamp}`,
    `Email:                    ${r.email}`,
    `DB Account ID:            ${r.dbAccountId ?? "-"}`,
    `DB Subscription ID:       ${r.dbSubscriptionId ?? "-"}`,
    `Old Renewal (UTC):        ${r.oldRenewalDate ?? "-"}`,
    `New Renewal (UTC):        ${r.newRenewalDate ?? "-"}`,
    `Stripe Customer ID:       ${r.stripeCustomerId ?? "-"}`,
    `Old Stripe Subscription:  ${r.oldStripeSubscriptionId ?? "-"}`,
    `New Stripe Subscription:  ${r.newStripeSubscriptionId ?? "-"}`,
    `Collection Paused seen:   ${r.collectionPausedSeen}`,
    `Active confirmed:         ${r.activeSubscriptionConfirmed}`,
    `Status:                   ${r.status}`,
    r.notes.length ? `Notes:\n - ${r.notes.join("\n - ")}` : "Notes: -",
  ].join("\n");
}

export function printReport(r: RunReport): void {
  console.log("\n" + formatReportText(r) + "\n");
}

export function saveReport(r: RunReport, dir = join("artifacts", "reports")): { jsonPath: string; txtPath: string } {
  mkdirSync(dir, { recursive: true });
  const stamp = r.timestamp.replace(/[:.]/g, "-");
  const jsonPath = join(dir, `${stamp}-downgrade-report.json`);
  const txtPath = join(dir, `${stamp}-downgrade-report.txt`);
  writeFileSync(jsonPath, JSON.stringify(r, null, 2), "utf8");
  writeFileSync(txtPath, formatReportText(r), "utf8");
  return { jsonPath, txtPath };
}
