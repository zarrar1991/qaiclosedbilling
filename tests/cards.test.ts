import { describe, it, expect } from "vitest";
import { randomFutureExpiry, randomCvc, last4 } from "../src/cards.js";

describe("card helpers", () => {
  it("randomFutureExpiry is MM/YY with month 01-12", () => {
    for (let i = 0; i < 50; i++) {
      const e = randomFutureExpiry();
      expect(e).toMatch(/^\d{2}\/\d{2}$/);
      const month = Number(e.slice(0, 2));
      expect(month).toBeGreaterThanOrEqual(1);
      expect(month).toBeLessThanOrEqual(12);
    }
  });

  it("randomCvc is exactly 3 digits", () => {
    for (let i = 0; i < 50; i++) expect(randomCvc()).toMatch(/^\d{3}$/);
  });

  it("last4 returns the last 4 digits, ignoring non-digits", () => {
    expect(last4("4000056655665556")).toBe("5556");
    expect(last4("4000 0000 0000 0341")).toBe("0341");
  });
});
