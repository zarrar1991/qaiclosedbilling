import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readEnv } from "./env-file.js";

// Named credential profiles (e.g. Default, Stage, Prod). Each holds the same
// keys as .env. Stored as JSON; seeded once from the existing .env.
export interface ProfilesFile {
  activeProfile: string;
  profiles: Record<string, Record<string, string>>;
}

export function readProfiles(path: string, envFallbackPath: string): ProfilesFile {
  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as ProfilesFile;
      if (data && data.profiles && typeof data.profiles === "object" && Object.keys(data.profiles).length > 0) {
        if (!data.activeProfile || !(data.activeProfile in data.profiles)) {
          data.activeProfile = Object.keys(data.profiles)[0];
        }
        return data;
      }
    } catch {
      /* malformed — fall through to seed */
    }
  }
  const seeded: ProfilesFile = {
    activeProfile: "Default",
    profiles: { Default: existsSync(envFallbackPath) ? readEnv(envFallbackPath) : {} },
  };
  writeProfiles(path, seeded);
  return seeded;
}

export function writeProfiles(path: string, data: ProfilesFile): void {
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}
