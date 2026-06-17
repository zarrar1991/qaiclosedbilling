import { contextBridge, ipcRenderer } from "electron";
import { CH } from "./ipc.js";

contextBridge.exposeInMainWorld("api", {
  loadSettings: () => ipcRenderer.invoke(CH.settingsLoad),
  saveSettings: (v: Record<string, string>) => ipcRenderer.invoke(CH.settingsSave, v),
  testDb: () => ipcRenderer.invoke(CH.settingsTestDb),
  getCandidates: (email: string) => ipcRenderer.invoke(CH.renewalGetCandidates, email),
  updateRenewal: (req: unknown) => ipcRenderer.invoke(CH.renewalUpdate, req),
  runFullFlow: (req: unknown) => ipcRenderer.invoke(CH.fullflowRun, req),
  onProgress: (cb: (p: { step: string; message: string }) => void) => {
    const listener = (_e: unknown, p: { step: string; message: string }) => cb(p);
    ipcRenderer.on(CH.fullflowProgress, listener);
    return () => ipcRenderer.removeListener(CH.fullflowProgress, listener);
  },
});
