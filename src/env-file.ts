import { readFileSync, writeFileSync, existsSync } from "node:fs";

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1);
  }
  return out;
}

export function serializeEnv(values: Record<string, string>, original: string): string {
  const remaining = { ...values };
  const lines = original.length ? original.split(/\r?\n/) : [];
  const result = lines.map((raw) => {
    const t = raw.trim();
    if (!t || t.startsWith("#")) return raw;
    const eq = t.indexOf("=");
    if (eq === -1) return raw;
    const key = t.slice(0, eq).trim();
    if (key in remaining) {
      const v = remaining[key];
      delete remaining[key];
      return `${key}=${v}`;
    }
    return raw;
  });
  if (result.length && result[result.length - 1] === "") result.pop();
  for (const [k, v] of Object.entries(remaining)) result.push(`${k}=${v}`);
  return result.join("\n") + "\n";
}

export function readEnv(path: string): Record<string, string> {
  return existsSync(path) ? parseEnvFile(readFileSync(path, "utf8")) : {};
}

export function writeEnv(path: string, values: Record<string, string>): void {
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, serializeEnv(values, original), "utf8");
}
