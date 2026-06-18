import { describe, it, expect } from "vitest";
import { parseConfig } from "../src/config.js";

const base = {
  PGHOST: "localhost",
  PGPORT: "5432",
  PGDATABASE: "billing",
  PGUSER: "user",
  PGPASSWORD: "pass",
  PGSSLMODE: "require",
  STRIPE_DASHBOARD_URL: "https://dashboard.stripe.com",
  STRIPE_ENVIRONMENT_NAME: "iClosed.io (development)",
  STRIPE_AUTH_PROFILE_DIR: ".auth",
  STRIPE_STEP_TIMEOUT_MS: "30000",
  STRIPE_LONG_TIMEOUT_MS: "120000",
  DEFAULT_RENEWAL_OFFSET_MINUTES: "5",
  PLAYWRIGHT_SLOW_MO_MS: "0",
};

describe("parseConfig", () => {
  it("parses a valid env into typed config with numeric coercion", () => {
    const cfg = parseConfig({ ...base, DRY_RUN: "false" });
    expect(cfg.pg.port).toBe(5432);
    expect(cfg.renewalOffsetMinutes).toBe(5);
    expect(cfg.stripe.longTimeoutMs).toBe(120000);
    expect(cfg.dryRun).toBe(false);
  });

  it("defaults DRY_RUN to true when unset", () => {
    const cfg = parseConfig({ ...base });
    expect(cfg.dryRun).toBe(true);
  });

  it("defaults openStripeInDryRun to false when unset", () => {
    const cfg = parseConfig({ ...base });
    expect(cfg.openStripeInDryRun).toBe(false);
  });

  it("throws listing all missing required vars", () => {
    expect(() => parseConfig({})).toThrow(/PGHOST/);
  });

  it("defaults appUrl to https://dev.iclosed.io when ICLOSED_APP_URL unset", () => {
    const cfg = parseConfig({ ...base });
    expect(cfg.appUrl).toBe("https://dev.iclosed.io");
  });

  it("uses ICLOSED_APP_URL and trims trailing slashes", () => {
    const cfg = parseConfig({ ...base, ICLOSED_APP_URL: "https://app.example.com/" });
    expect(cfg.appUrl).toBe("https://app.example.com");
  });
});
