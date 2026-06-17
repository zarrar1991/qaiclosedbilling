import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parseConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { readProfiles, writeProfiles } from "../src/profiles.js";
import { envPath, authProfileDir, bundledChromiumPath, profilesPath } from "./paths.js";
import { CH, type IpcResult, type RenewalUpdateRequest, type ProfilesList, type IClosedCreateRequest, type IClosedResult, type IClosedProgress, type CampaignLink } from "./ipc.js";
import { getRenewalCandidates, searchSubscriptionsUi, listCampaignsUi, updateRenewalUi, runFullFlowUi } from "./runners.js";
import type { AppConfig } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The iClosed engine is CommonJS (copied as-is). Load it via createRequire; the
// .cjs sits next to the compiled main.js (copied by the electron:build script).
const requireCjs = createRequire(import.meta.url);
type IClosedEngine = {
  createIClosedUser: (opts: Record<string, unknown>) => Promise<IClosedResult>;
  generateRandomEmail: (prefix?: string, domain?: string) => string;
};
const iclosed = requireCjs("./iclosed-flow.cjs") as IClosedEngine;

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

// Raw profile values (for back-office API creds that aren't part of parseConfig).
function profileValues(name?: string): Record<string, string> {
  const f = readProfiles(profilesPath(), envPath());
  return f.profiles[name || f.activeProfile] ?? {};
}

// --- Back-office API token (in-memory only; per profile; cleared on quit) ---
const boTokens = new Map<string, string>();

async function getBoToken(profile: string, force = false): Promise<string> {
  if (!force && boTokens.has(profile)) return boTokens.get(profile)!;
  const v = profileValues(profile);
  const base = (v.BO_BASE_URL || "").replace(/\/+$/, "");
  if (!base || !v.BO_EMAIL || !v.BO_PASSWORD) {
    throw new Error("Back-office API not configured (set BO_BASE_URL, BO_EMAIL, BO_PASSWORD in Settings).");
  }
  const res = await fetch(`${base}/auth/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: v.BO_EMAIL, password: v.BO_PASSWORD, isBackOffice: true }),
  });
  if (!res.ok) throw new Error(`Auth failed (${res.status})`);
  const body = (await res.json()) as { accessToken?: string };
  if (!body.accessToken) throw new Error("Auth response had no accessToken");
  boTokens.set(profile, body.accessToken);
  return body.accessToken;
}

async function fetchCampaignLinks(profile: string, campaignId: number): Promise<CampaignLink[]> {
  const base = (profileValues(profile).BO_BASE_URL || "").replace(/\/+$/, "");
  const call = async (token: string) =>
    fetch(`${base}/campaigns?id=${campaignId}`, { headers: { Authorization: `Bearer ${token}` } });

  let res = await call(await getBoToken(profile));
  if (res.status === 401) res = await call(await getBoToken(profile, true)); // refresh once
  if (!res.ok) throw new Error(`Campaigns API failed (${res.status})`);

  const json = (await res.json()) as { data?: { formattedCampaignLinks?: Array<Record<string, unknown>> } };
  const links = json.data?.formattedCampaignLinks ?? [];
  return links
    .filter((l) => typeof l.hash === "string" && l.hash)
    .map((l) => ({
      label: [l.name, l.cycle].filter(Boolean).join(" ") || String(l.hash),
      hash: String(l.hash),
    }));
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
ipcMain.handle(CH.campaignsList, (_e, profile: string) => wrap(() => listCampaignsUi(loadCfg(profile))));
ipcMain.handle(CH.campaignLinksList, (_e, p: { profile: string; campaignId: number }) =>
  wrap(() => fetchCampaignLinks(p.profile, p.campaignId)),
);
ipcMain.handle(CH.renewalUpdate, (_e, p: { profile: string; req: RenewalUpdateRequest }) =>
  wrap(() => updateRenewalUi(loadCfg(p.profile), p.req)),
);
ipcMain.handle(CH.fullflowRun, (e, p: { profile: string; email: string; span: string }) =>
  wrap(() => runFullFlowUi(loadCfg(p.profile), p.email, p.span, (pr) => e.sender.send(CH.fullflowProgress, pr))),
);

// --- Create iClosed user (in-process; streams onProgress to the renderer) ---
ipcMain.handle(CH.iclosedCreate, (e, req: IClosedCreateRequest) =>
  wrap(() =>
    iclosed.createIClosedUser({
      campaignUrl: req.campaignUrl,
      email: req.emailMode === "custom" ? req.email : iclosed.generateRandomEmail(),
      password: req.password,
      headed: req.headed,
      keepOpen: req.keepOpen,
      onProgress: (pr: IClosedProgress) => e.sender.send(CH.iclosedProgress, pr),
    }),
  ),
);
ipcMain.handle(CH.openExternal, (_e, url: string) => wrap(async () => { await shell.openExternal(url); return true; }));

app.whenReady().then(() => {
  createWindow();
  // Generate the back-office token for the active profile up front (best-effort).
  getBoToken(listProfiles().activeProfile).catch(() => undefined);
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
// Kill tokens when the app closes (in-memory only — discard).
app.on("before-quit", () => { boTokens.clear(); });
