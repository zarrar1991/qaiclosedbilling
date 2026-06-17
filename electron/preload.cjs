// CommonJS preload. The project is "type":"module", so an ESM .js preload does
// not load reliably in Electron; a .cjs preload always loads. Channel names are
// inlined here (kept in sync with electron/ipc.ts CH) to avoid importing ESM.
const { contextBridge, ipcRenderer } = require("electron");

const CH = {
  settingsLoad: "settings:load",
  settingsSave: "settings:save",
  settingsTestDb: "settings:testDb",
  renewalGetCandidates: "renewal:getCandidates",
  subscriptionsSearch: "subscriptions:search",
  renewalUpdate: "renewal:update",
  fullflowRun: "fullflow:run",
  fullflowProgress: "fullflow:progress",
};

contextBridge.exposeInMainWorld("api", {
  loadSettings: () => ipcRenderer.invoke(CH.settingsLoad),
  saveSettings: (v) => ipcRenderer.invoke(CH.settingsSave, v),
  testDb: () => ipcRenderer.invoke(CH.settingsTestDb),
  getCandidates: (email) => ipcRenderer.invoke(CH.renewalGetCandidates, email),
  searchSubscriptions: (email) => ipcRenderer.invoke(CH.subscriptionsSearch, email),
  updateRenewal: (req) => ipcRenderer.invoke(CH.renewalUpdate, req),
  runFullFlow: (req) => ipcRenderer.invoke(CH.fullflowRun, req),
  onProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on(CH.fullflowProgress, listener);
    return () => ipcRenderer.removeListener(CH.fullflowProgress, listener);
  },
});
