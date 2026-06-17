export interface AppConfig {
  pg: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    sslmode: string;
    schema: string; // optional search_path override; "" = DB role default
  };
  stripe: {
    dashboardUrl: string;
    environmentName: string;
    authProfileDir: string;
    stepTimeoutMs: number;
    longTimeoutMs: number;
  };
  renewalOffsetMinutes: number;
  slowMoMs: number;
  dryRun: boolean;
  openStripeInDryRun: boolean;
}

export interface SubscriptionRow {
  id: string;
  accountId: string;
  status: string | null;
  renewalDateTime: string | null;
  deletedAt: string | null;
  stripeSubscriptionId: string | null; // mapped from the DB "subscriptionId" column
  stripeCustomerId: string | null; // not stored in this schema; always null
  pauseCollection: boolean | null;
  createdAt: string | null;
}

export interface ParsedSpan {
  unit: "day" | "month" | "year";
  amount: number;
}

export interface RunReport {
  timestamp: string;
  email: string;
  dbAccountId: string | null;
  dbSubscriptionId: string | null;
  oldRenewalDate: string | null;
  newRenewalDate: string | null;
  stripeCustomerId: string | null;
  oldStripeSubscriptionId: string | null;
  newStripeSubscriptionId: string | null;
  collectionPausedSeen: boolean;
  activeSubscriptionConfirmed: boolean;
  status: "PASS" | "FAIL";
  notes: string[];
}
