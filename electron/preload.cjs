// CommonJS preload. The project is "type":"module", so an ESM .js preload does
// not load reliably in Electron; a .cjs preload always loads. Channel names are
// inlined here (kept in sync with electron/ipc.ts CH) to avoid importing ESM.
const { contextBridge, ipcRenderer } = require("electron");

const CH = {
  profilesList: "profiles:list",
  profilesGet: "profiles:get",
  profilesSave: "profiles:save",
  profilesDelete: "profiles:delete",
  profilesSetActive: "profiles:setActive",
  settingsTestDb: "settings:testDb",
  renewalGetCandidates: "renewal:getCandidates",
  subscriptionsSearch: "subscriptions:search",
  campaignsList: "campaigns:list",
  campaignLinksList: "campaignlinks:list",
  renewalUpdate: "renewal:update",
  fullflowRun: "fullflow:run",
  fullflowProgress: "fullflow:progress",
  iclosedCreate: "iclosed:create",
  iclosedProgress: "iclosed:progress",
  openExternal: "shell:openExternal",
};

contextBridge.exposeInMainWorld("api", {
  // Profiles
  loadProfiles: () => ipcRenderer.invoke(CH.profilesList),
  getProfile: (name) => ipcRenderer.invoke(CH.profilesGet, name),
  saveProfile: (name, values) => ipcRenderer.invoke(CH.profilesSave, { name, values }),
  deleteProfile: (name) => ipcRenderer.invoke(CH.profilesDelete, name),
  setActiveProfile: (name) => ipcRenderer.invoke(CH.profilesSetActive, name),
  // Operations (each takes the selected profile name)
  testDb: (profile) => ipcRenderer.invoke(CH.settingsTestDb, profile),
  getCandidates: (profile, email) => ipcRenderer.invoke(CH.renewalGetCandidates, { profile, email }),
  searchSubscriptions: (profile, email) => ipcRenderer.invoke(CH.subscriptionsSearch, { profile, email }),
  listCampaigns: (profile) => ipcRenderer.invoke(CH.campaignsList, profile),
  listCampaignLinks: (profile, campaignId) => ipcRenderer.invoke(CH.campaignLinksList, { profile, campaignId }),
  updateRenewal: (profile, req) => ipcRenderer.invoke(CH.renewalUpdate, { profile, req }),
  runFullFlow: (profile, req) => ipcRenderer.invoke(CH.fullflowRun, { profile, email: req.email, span: req.span }),
  onProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on(CH.fullflowProgress, listener);
    return () => ipcRenderer.removeListener(CH.fullflowProgress, listener);
  },
  // Create iClosed user
  createIClosedUser: (req) => ipcRenderer.invoke(CH.iclosedCreate, req),
  onIClosedProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on(CH.iclosedProgress, listener);
    return () => ipcRenderer.removeListener(CH.iclosedProgress, listener);
  },
  openExternal: (url) => ipcRenderer.invoke(CH.openExternal, url),
});
