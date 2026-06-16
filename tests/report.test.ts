import { describe, it, expect } from "vitest";
import { computeStatus, formatReportText } from "../src/report.js";
import type { RunReport } from "../src/types.js";

const baseReport: RunReport = {
  timestamp: "2026-06-17T00:00:00.000Z",
  email: "demo@example.com",
  dbAccountId: "acc1",
  dbSubscriptionId: "sub1",
  oldRenewalDate: "2024-04-01 16:00:00.000",
  newRenewalDate: "2024-04-01 16:05:00.000",
  stripeCustomerId: "cus_1",
  oldStripeSubscriptionId: "sub_old",
  newStripeSubscriptionId: "sub_new",
  collectionPausedSeen: true,
  activeSubscriptionConfirmed: true,
  status: "FAIL",
  notes: [],
};

describe("computeStatus", () => {
  it("PASS when paused seen and active confirmed", () => {
    expect(computeStatus({ ...baseReport })).toBe("PASS");
  });
  it("FAIL when active not confirmed", () => {
    expect(computeStatus({ ...baseReport, activeSubscriptionConfirmed: false })).toBe("FAIL");
  });
  it("FAIL when collection paused never seen", () => {
    expect(computeStatus({ ...baseReport, collectionPausedSeen: false })).toBe("FAIL");
  });
});

describe("formatReportText", () => {
  it("includes key fields", () => {
    const txt = formatReportText({ ...baseReport, status: "PASS" });
    expect(txt).toContain("demo@example.com");
    expect(txt).toContain("acc1");
    expect(txt).toContain("sub_old");
    expect(txt).toContain("sub_new");
    expect(txt).toContain("PASS");
  });
});
