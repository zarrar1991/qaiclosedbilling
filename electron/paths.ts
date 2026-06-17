import { app } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";

// In dev, use the repo files; when packaged, use the per-user data dir.
export function envPath(): string {
  return app.isPackaged ? join(app.getPath("userData"), ".env") : join(process.cwd(), ".env");
}

export function authProfileDir(): string {
  return app.isPackaged ? join(app.getPath("userData"), ".auth") : join(process.cwd(), ".auth");
}

// When packaged, point Playwright at the bundled Chromium (set in packaging task).
// In dev, return undefined so Playwright uses its normally-installed browser.
export function bundledChromiumPath(): string | undefined {
  if (!app.isPackaged) return undefined;
  const base = join(process.resourcesPath, "ms-playwright");
  return existsSync(base) ? base : undefined;
}
