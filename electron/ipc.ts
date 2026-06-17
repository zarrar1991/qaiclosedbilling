import type { SubscriptionRow, RunReport } from "../src/types.js";

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface SettingsValues { [key: string]: string }

export interface RenewalCandidates { accountId: string; rows: SubscriptionRow[] }
export interface RenewalUpdateRequest { id?: string; accountId?: string; mode?: "all" }
export interface RenewalUpdateResult { updated: SubscriptionRow[]; reselected: SubscriptionRow[] }

export interface FullFlowRequest { email: string; span: string }
export interface FullFlowProgress { step: string; message: string }

export interface DbCheckResult { table: string; ok: boolean; columns: { name: string; present: boolean }[] }

export const CH = {
  settingsLoad: "settings:load",
  settingsSave: "settings:save",
  settingsTestDb: "settings:testDb",
  renewalGetCandidates: "renewal:getCandidates",
  renewalUpdate: "renewal:update",
  fullflowRun: "fullflow:run",
  fullflowProgress: "fullflow:progress",
} as const;
