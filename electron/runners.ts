import type { AppConfig, RunReport } from "../src/types.js";
import { createPool, lookupAccountId, fetchSubscriptions, updateRenewal, reselectByIds } from "../src/db.js";
import { chooseTargetSubscription } from "../src/selection.js";
import { computeRenewalUTC, parseSpan } from "../src/time.js";
import { runStripeSimulation } from "../src/stripe-flow.js";
import type { RenewalCandidates, RenewalUpdateRequest, RenewalUpdateResult, FullFlowProgress } from "./ipc.js";

export async function getRenewalCandidates(cfg: AppConfig, email: string): Promise<RenewalCandidates> {
  const pool = createPool(cfg);
  try {
    const accountId = await lookupAccountId(pool, email);
    if (!accountId) throw new Error(`No account found for email ${email}`);
    const rows = await fetchSubscriptions(pool, accountId); // deletedAt IS NULL only
    if (rows.length === 0) throw new Error("No active (non-deleted) subscription found.");
    return { accountId, rows };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function updateRenewalUi(cfg: AppConfig, req: RenewalUpdateRequest): Promise<RenewalUpdateResult> {
  const pool = createPool(cfg);
  try {
    const newRenewal = computeRenewalUTC(new Date(), cfg.renewalOffsetMinutes);
    const target =
      req.mode === "all" && req.accountId
        ? ({ mode: "all", accountId: req.accountId } as const)
        : req.id
          ? ({ mode: "single", id: req.id } as const)
          : (() => { throw new Error("renewal:update requires an id or accountId+mode:all"); })();
    const updated = await updateRenewal(pool, target, newRenewal);
    const reselected = await reselectByIds(pool, updated.map((r) => r.id));
    return { updated, reselected };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function runFullFlowUi(
  cfg: AppConfig,
  email: string,
  spanStr: string,
  onProgress: (p: FullFlowProgress) => void,
): Promise<RunReport> {
  const span = parseSpan(spanStr);
  const pool = createPool(cfg);
  const notes: string[] = [];
  try {
    onProgress({ step: "db", message: "Looking up account…" });
    const accountId = await lookupAccountId(pool, email);
    if (!accountId) throw new Error(`No account found for email ${email}`);
    const rows = await fetchSubscriptions(pool, accountId);
    if (rows.length === 0) throw new Error("No active (non-deleted) subscription found.");
    const selection = chooseTargetSubscription(rows, undefined);
    if (selection.kind === "needChoice") {
      throw new Error("Multiple active subscriptions; use the Renewal page to pick one first, then re-run.");
    }
    const chosen = selection.kind === "single" ? selection.row : rows[0];

    const now = new Date();
    const newRenewal = computeRenewalUTC(now, cfg.renewalOffsetMinutes);
    onProgress({ step: "db", message: `Setting renewal to ${newRenewal} (UTC)…` });
    await updateRenewal(pool, { mode: "single", id: chosen.id }, newRenewal);
    const oldRenewal = chosen.renewalDateTime;

    onProgress({ step: "stripe", message: "Starting Stripe simulation…" });
    const result = await runStripeSimulation(
      cfg,
      {
        email,
        span,
        expectedStripeSubscriptionId: chosen.stripeSubscriptionId,
        expectedStripeCustomerId: chosen.stripeCustomerId,
      },
      {
        onStatus: (step, message) => onProgress({ step, message }),
        confirmAdvance: async () => true,
        waitForLogin: async (page) => {
          await page
            .getByRole("button", { name: /account options and switcher/i })
            .first()
            .waitFor({ state: "visible", timeout: cfg.stripe.longTimeoutMs });
        },
      },
    );

    const report: RunReport = {
      timestamp: new Date().toISOString(),
      email,
      dbAccountId: accountId,
      dbSubscriptionId: chosen.id,
      oldRenewalDate: oldRenewal,
      newRenewalDate: newRenewal,
      stripeCustomerId: result.stripeCustomerId,
      oldStripeSubscriptionId: result.oldStripeSubscriptionId,
      newStripeSubscriptionId: result.newStripeSubscriptionId,
      collectionPausedSeen: result.collectionPausedSeen,
      activeSubscriptionConfirmed: result.activeSubscriptionConfirmed,
      status: result.collectionPausedSeen && result.activeSubscriptionConfirmed ? "PASS" : "FAIL",
      notes: [...notes, ...result.notes],
    };
    onProgress({ step: "done", message: `Done: ${report.status}` });
    return report;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
