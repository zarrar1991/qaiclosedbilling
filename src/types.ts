export interface AppConfig {
  pg: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    sslmode: string;
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
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
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
