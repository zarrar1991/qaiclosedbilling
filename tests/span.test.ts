import { describe, it, expect } from "vitest";
import { intervalToSpanString } from "../src/span.js";

describe("intervalToSpanString", () => {
  it("maps presets to span strings", () => {
    expect(intervalToSpanString({ kind: "preset", preset: "1 day" })).toBe("1 day");
    expect(intervalToSpanString({ kind: "preset", preset: "1 month" })).toBe("1 month");
    expect(intervalToSpanString({ kind: "preset", preset: "1 year" })).toBe("1 year");
  });
  it("maps custom amount+unit to a span string", () => {
    expect(intervalToSpanString({ kind: "custom", amount: 3, unit: "day" })).toBe("3 days");
    expect(intervalToSpanString({ kind: "custom", amount: 1, unit: "month" })).toBe("1 month");
    expect(intervalToSpanString({ kind: "custom", amount: 2, unit: "year" })).toBe("2 years");
  });
  it("rejects non-positive custom amounts", () => {
    expect(() => intervalToSpanString({ kind: "custom", amount: 0, unit: "day" })).toThrow();
  });
});
