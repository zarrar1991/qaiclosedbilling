import { describe, it, expect } from "vitest";
import { formatTimestampUTC, computeRenewalUTC, parseSpan, addSpan } from "../src/time.js";

describe("formatTimestampUTC", () => {
  it("formats as YYYY-MM-DD HH:mm:ss.000 in UTC", () => {
    const d = new Date(Date.UTC(2024, 3, 1, 16, 5, 32));
    expect(formatTimestampUTC(d)).toBe("2024-04-01 16:05:32.000");
  });
});

describe("computeRenewalUTC", () => {
  it("adds offset minutes to the base UTC time", () => {
    const base = new Date(Date.UTC(2024, 3, 1, 16, 0, 0));
    expect(computeRenewalUTC(base, 5)).toBe("2024-04-01 16:05:00.000");
  });
});

describe("parseSpan", () => {
  it("parses days/months/years (singular and plural)", () => {
    expect(parseSpan("3 days")).toEqual({ unit: "day", amount: 3 });
    expect(parseSpan("1 month")).toEqual({ unit: "month", amount: 1 });
    expect(parseSpan("2 years")).toEqual({ unit: "year", amount: 2 });
  });
  it("is case/space tolerant", () => {
    expect(parseSpan("  1   Month ")).toEqual({ unit: "month", amount: 1 });
  });
  it("rejects invalid spans", () => {
    expect(() => parseSpan("soon")).toThrow();
    expect(() => parseSpan("0 days")).toThrow();
    expect(() => parseSpan("5 weeks")).toThrow();
  });
});

describe("addSpan", () => {
  it("adds a month in UTC", () => {
    const base = new Date(Date.UTC(2024, 0, 15, 12, 0, 0));
    const out = addSpan(base, { unit: "month", amount: 1 });
    expect(out.toISOString()).toBe("2024-02-15T12:00:00.000Z");
  });
  it("adds days and years in UTC", () => {
    const base = new Date(Date.UTC(2024, 0, 1, 0, 0, 0));
    expect(addSpan(base, { unit: "day", amount: 3 }).toISOString()).toBe("2024-01-04T00:00:00.000Z");
    expect(addSpan(base, { unit: "year", amount: 2 }).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
