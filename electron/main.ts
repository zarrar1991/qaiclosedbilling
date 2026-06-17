import { app, BrowserWindow, ipcMain } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { readEnv, writeEnv } from "../src/env-file.js";
import { envPath, authProfileDir, bundledChromiumPath } from "./paths.js";
import { CH, type IpcResult } from "./ipc.js";
import { getRenewalCandidates, searchSubscriptionsUi, updateRenewalUi, runFullFlowUi } from "./runners.js";
import type { AppConfig } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadCfg(): AppConfig {
  const env = readEnv(envPath());
  const cfg = parseConfig(env);
  cfg.stripe.authProfileDir = authProfileDir();
  const chromium = bundledChromiumPath();
  if (chromium) process.env.PLAYWRIGHT_BROWSERS_PATH = chromium;
  return cfg;
}

async function wrap<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100, height: 760, backgroundColor: "#0b1020",
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  if (app.isPackaged) win.loadFile(join(__dirname, "../dist-ui/index.html"));
  else win.loadURL(process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173");
}

ipcMain.handle(CH.settingsLoad, () => wrap(async () => readEnv(envPath())));
ipcMain.handle(CH.settingsSave, (_e, v: Record<string, string>) =>
  wrap(async () => { writeEnv(envPath(), v); return readEnv(envPath()); }),
);
ipcMain.handle(CH.settingsTestDb, () =>
  wrap(async () => {
    const pool = createPool(loadCfg());
    try { await pool.query("SELECT 1"); return { connected: true }; }
    finally { await pool.end().catch(() => undefined); }
  }),
);
ipcMain.handle(CH.renewalGetCandidates, (_e, email: string) => wrap(() => getRenewalCandidates(loadCfg(), email)));
ipcMain.handle(CH.subscriptionsSearch, (_e, email: string) => wrap(() => searchSubscriptionsUi(loadCfg(), email)));
ipcMain.handle(CH.renewalUpdate, (_e, req) => wrap(() => updateRenewalUi(loadCfg(), req)));
ipcMain.handle(CH.fullflowRun, (e, req: { email: string; span: string }) =>
  wrap(() => runFullFlowUi(loadCfg(), req.email, req.span, (p) => e.sender.send(CH.fullflowProgress, p))),
);

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
