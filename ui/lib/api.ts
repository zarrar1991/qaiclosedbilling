import type { IpcResult, RenewalCandidates, RenewalUpdateRequest, RenewalUpdateResult, SubscriptionSearchResult, ProfilesList, IClosedCreateRequest, IClosedResult, IClosedProgress } from "../../electron/ipc.js";
import type { RunReport, Campaign, CampaignLink } from "../../src/types.js";

interface Api {
  // Profiles
  loadProfiles(): Promise<IpcResult<ProfilesList>>;
  getProfile(name: string): Promise<IpcResult<Record<string, string>>>;
  saveProfile(name: string, values: Record<string, string>): Promise<IpcResult<ProfilesList>>;
  renameProfile(from: string, to: string): Promise<IpcResult<ProfilesList>>;
  deleteProfile(name: string): Promise<IpcResult<ProfilesList>>;
  setActiveProfile(name: string): Promise<IpcResult<ProfilesList>>;
  // Operations (each takes the selected profile name)
  testDb(profile: string): Promise<IpcResult<{ connected: boolean }>>;
  getCandidates(profile: string, email: string): Promise<IpcResult<RenewalCandidates>>;
  searchSubscriptions(profile: string, email: string): Promise<IpcResult<SubscriptionSearchResult>>;
  listCampaigns(profile: string): Promise<IpcResult<Campaign[]>>;
  listCampaignLinks(profile: string, campaignId: number): Promise<IpcResult<CampaignLink[]>>;
  updateRenewal(profile: string, req: RenewalUpdateRequest): Promise<IpcResult<RenewalUpdateResult>>;
  runFullFlow(profile: string, req: { email: string; span: string }): Promise<IpcResult<RunReport>>;
  onProgress(cb: (p: { step: string; message: string }) => void): () => void;
  // Create iClosed user
  createIClosedUser(req: IClosedCreateRequest): Promise<IpcResult<IClosedResult>>;
  onIClosedProgress(cb: (p: IClosedProgress) => void): () => void;
  openExternal(url: string): Promise<IpcResult<boolean>>;
}
export const api = (window as unknown as { api: Api }).api;
