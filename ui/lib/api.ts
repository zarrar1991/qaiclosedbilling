import type { IpcResult, RenewalCandidates, RenewalUpdateRequest, RenewalUpdateResult, SubscriptionSearchResult } from "../../electron/ipc.js";
import type { RunReport } from "../../src/types.js";

interface Api {
  loadSettings(): Promise<IpcResult<Record<string, string>>>;
  saveSettings(v: Record<string, string>): Promise<IpcResult<Record<string, string>>>;
  testDb(): Promise<IpcResult<{ connected: boolean }>>;
  getCandidates(email: string): Promise<IpcResult<RenewalCandidates>>;
  searchSubscriptions(email: string): Promise<IpcResult<SubscriptionSearchResult>>;
  updateRenewal(req: RenewalUpdateRequest): Promise<IpcResult<RenewalUpdateResult>>;
  runFullFlow(req: { email: string; span: string }): Promise<IpcResult<RunReport>>;
  onProgress(cb: (p: { step: string; message: string }) => void): () => void;
}
export const api = (window as unknown as { api: Api }).api;
