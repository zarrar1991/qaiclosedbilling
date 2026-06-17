import { describe, it, expect } from "vitest";
import { parseEnvFile, serializeEnv } from "../src/env-file.js";

describe("parseEnvFile", () => {
  it("parses key=value lines, ignoring comments/blanks", () => {
    const txt = "# c\nPGHOST=localhost\n\nPGPASSWORD=a=b!x\n";
    expect(parseEnvFile(txt)).toEqual({ PGHOST: "localhost", PGPASSWORD: "a=b!x" });
  });
});

describe("serializeEnv", () => {
  it("updates existing keys in place, preserving comments and order", () => {
    const original = "# db\nPGHOST=old\nPGPORT=5432\n";
    const out = serializeEnv({ PGHOST: "new", PGPORT: "5432" }, original);
    expect(out).toBe("# db\nPGHOST=new\nPGPORT=5432\n");
  });
  it("appends keys that are not already present", () => {
    const out = serializeEnv({ PGHOST: "h", PGSCHEMA: "s" }, "PGHOST=h\n");
    expect(out).toContain("PGHOST=h");
    expect(out).toMatch(/PGSCHEMA=s\n?$/);
  });
  it("round-trips values containing = and special chars", () => {
    const vals = { PGPASSWORD: "J7X5!oM*gsl=z" };
    expect(parseEnvFile(serializeEnv(vals, ""))).toEqual(vals);
  });
});
