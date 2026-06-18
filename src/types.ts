export interface AppConfig {
  appUrl: string;
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

export interface Campaign {
  id: number;
  name: string;
}

// A campaign link from the back-office API (data.formattedCampaignLinks[*]).
export interface CampaignLink {
  label: string; // friendly, e.g. "Startup Month"
  hash: string;  // used to build the campaign URL (plan_hash)
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
