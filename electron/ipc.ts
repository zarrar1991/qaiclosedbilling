import type { SubscriptionRow, RunReport } from "../src/types.js";

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface SettingsValues { [key: string]: string }

export interface RenewalCandidates { accountId: string; rows: SubscriptionRow[] }
// Read-only search results: ALL subscriptions (incl. deleted) for the email.
export interface SubscriptionSearchResult { accountId: string; email: string; rows: SubscriptionRow[] }
export interface RenewalUpdateRequest { id?: string; accountId?: string; mode?: "all" }
export interface RenewalUpdateResult { updated: SubscriptionRow[]; reselected: SubscriptionRow[] }

export interface FullFlowRequest { email: string; span: string }
export interface FullFlowProgress { step: string; message: string }

export interface DbCheckResult { table: string; ok: boolean; columns: { name: string; present: boolean }[] }

// Profile management: list of profile names + which is the default/active.
export interface ProfilesList { activeProfile: string; names: string[] }

// Create iClosed user (signup → Stripe → onboarding via lib engine).
export interface IClosedCreateRequest {
  campaignUrl: string;
  emailMode: "random" | "custom";
  email?: string;
  password: string;
  headed: boolean;
  keepOpen: boolean;
}
export interface IClosedResult { email: string; password: string; username: string; workspaceUrl: string }
export interface IClosedProgress {
  step: string;
  ts?: number;
  detail?: string;
  done?: boolean;
  error?: string;
  result?: IClosedResult;
}

export const CH = {
  profilesList: "profiles:list",
  profilesGet: "profiles:get",
  profilesSave: "profiles:save",
  profilesDelete: "profiles:delete",
  profilesSetActive: "profiles:setActive",
  settingsTestDb: "settings:testDb",
  renewalGetCandidates: "renewal:getCandidates",
  subscriptionsSearch: "subscriptions:search",
  renewalUpdate: "renewal:update",
  fullflowRun: "fullflow:run",
  fullflowProgress: "fullflow:progress",
  iclosedCreate: "iclosed:create",
  iclosedProgress: "iclosed:progress",
  openExternal: "shell:openExternal",
} as const;
