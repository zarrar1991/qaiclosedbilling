import { config as loadDotenv } from "dotenv";
import type { AppConfig } from "./types.js";

type Env = Record<string, string | undefined>;

function required(env: Env, key: string, missing: string[]): string {
  const v = env[key];
  if (v === undefined || v === "") missing.push(key);
  return v ?? "";
}

function num(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true";
}

export function parseConfig(env: Env): AppConfig {
  const missing: string[] = [];
  const cfg: AppConfig = {
    pg: {
      host: required(env, "PGHOST", missing),
      port: num(required(env, "PGPORT", missing), 5432),
      database: required(env, "PGDATABASE", missing),
      user: required(env, "PGUSER", missing),
      password: required(env, "PGPASSWORD", missing),
      sslmode: required(env, "PGSSLMODE", missing),
    },
    stripe: {
      dashboardUrl: required(env, "STRIPE_DASHBOARD_URL", missing),
      environmentName: required(env, "STRIPE_ENVIRONMENT_NAME", missing),
      authProfileDir: required(env, "STRIPE_AUTH_PROFILE_DIR", missing),
      stepTimeoutMs: num(env.STRIPE_STEP_TIMEOUT_MS ?? "", 30000),
      longTimeoutMs: num(env.STRIPE_LONG_TIMEOUT_MS ?? "", 120000),
    },
    renewalOffsetMinutes: num(env.DEFAULT_RENEWAL_OFFSET_MINUTES ?? "", 5),
    slowMoMs: num(env.PLAYWRIGHT_SLOW_MO_MS ?? "", 0),
    dryRun: bool(env.DRY_RUN, true),
    openStripeInDryRun: bool(env.OPEN_STRIPE_IN_DRY_RUN, false),
  };
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
  return cfg;
}

export function loadConfig(): AppConfig {
  loadDotenv();
  return parseConfig(process.env);
}
