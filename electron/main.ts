import { app, BrowserWindow, ipcMain } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { readProfiles, writeProfiles } from "../src/profiles.js";
import { envPath, authProfileDir, bundledChromiumPath, profilesPath } from "./paths.js";
import { CH, type IpcResult, type RenewalUpdateRequest, type ProfilesList } from "./ipc.js";
import { getRenewalCandidates, searchSubscriptionsUi, updateRenewalUi, runFullFlowUi } from "./runners.js";
import type { AppConfig } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Build config from a named profile (or the active one). All profiles share the
// single .auth Stripe login.
function loadCfg(profileName?: string): AppConfig {
  const file = readProfiles(profilesPath(), envPath());
  const name = profileName || file.activeProfile;
  const values = file.profiles[name] ?? {};
  const cfg = parseConfig(values);
  cfg.stripe.authProfileDir = authProfileDir();
  const chromium = bundledChromiumPath();
  if (chromium) process.env.PLAYWRIGHT_BROWSERS_PATH = chromium;
  return cfg;
}

function listProfiles(): ProfilesList {
  const f = readProfiles(profilesPath(), envPath());
  return { activeProfile: f.activeProfile, names: Object.keys(f.profiles) };
}

async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: "#0b1020",
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  if (app.isPackaged) win.loadFile(join(__dirname, "../dist-ui/index.html"));
  else win.loadURL(process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173");
}

// --- Profile management ---
ipcMain.handle(CH.profilesList, () => wrap(async () => listProfiles()));
ipcMain.handle(CH.profilesGet, (_e, name: string) =>
  wrap(async () => readProfiles(profilesPath(), envPath()).profiles[name] ?? {}),
);
ipcMain.handle(CH.profilesSave, (_e, payload: { name: string; values: Record<string, string> }) =>
  wrap(async () => {
    const f = readProfiles(profilesPath(), envPath());
    f.profiles[payload.name] = payload.values;
    if (!(f.activeProfile in f.profiles)) f.activeProfile = payload.name;
    writeProfiles(profilesPath(), f);
    return { activeProfile: f.activeProfile, names: Object.keys(f.profiles) };
  }),
);
ipcMain.handle(CH.profilesDelete, (_e, name: string) =>
  wrap(async () => {
    const f = readProfiles(profilesPath(), envPath());
    delete f.profiles[name];
    if (Object.keys(f.profiles).length === 0) f.profiles["Default"] = {};
    if (!(f.activeProfile in f.profiles)) f.activeProfile = Object.keys(f.profiles)[0];
    writeProfiles(profilesPath(), f);
    return { activeProfile: f.activeProfile, names: Object.keys(f.profiles) };
  }),
);
ipcMain.handle(CH.profilesSetActive, (_e, name: string) =>
  wrap(async () => {
    const f = readProfiles(profilesPath(), envPath());
    if (name in f.profiles) { f.activeProfile = name; writeProfiles(profilesPath(), f); }
    return { activeProfile: f.activeProfile, names: Object.keys(f.profiles) };
  }),
);

// --- Operations (all take a profile name) ---
ipcMain.handle(CH.settingsTestDb, (_e, profile: string) =>
  wrap(async () => {
    const pool = createPool(loadCfg(profile));
    try { await pool.query("SELECT 1"); return { connected: true }; }
    finally { await pool.end().catch(() => undefined); }
  }),
);
ipcMain.handle(CH.renewalGetCandidates, (_e, p: { profile: string; email: string }) =>
  wrap(() => getRenewalCandidates(loadCfg(p.profile), p.email)),
);
ipcMain.handle(CH.subscriptionsSearch, (_e, p: { profile: string; email: string }) =>
  wrap(() => searchSubscriptionsUi(loadCfg(p.profile), p.email)),
);
ipcMain.handle(CH.renewalUpdate, (_e, p: { profile: string; req: RenewalUpdateRequest }) =>
  wrap(() => updateRenewalUi(loadCfg(p.profile), p.req)),
);
ipcMain.handle(CH.fullflowRun, (e, p: { profile: string; email: string; span: string }) =>
  wrap(() => runFullFlowUi(loadCfg(p.profile), p.email, p.span, (pr) => e.sender.send(CH.fullflowProgress, pr))),
);

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
