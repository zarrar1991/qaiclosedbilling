import { describe, it, expect } from "vitest";
import { chooseTargetSubscription } from "../src/selection.js";
import type { SubscriptionRow } from "../src/types.js";

function row(id: string): SubscriptionRow {
  return {
    id, accountId: "acc1", status: "active", renewalDateTime: null,
    deletedAt: null, stripeSubscriptionId: "sub_" + id, stripeCustomerId: "cus_1", createdAt: "2024-01-01",
  };
}

describe("chooseTargetSubscription", () => {
  it("returns NoSubscriptions when list empty", () => {
    expect(chooseTargetSubscription([], undefined)).toEqual({ kind: "none" });
  });
  it("returns the single row needing confirmation when exactly one", () => {
    const rows = [row("a")];
    expect(chooseTargetSubscription(rows, undefined)).toEqual({ kind: "single", row: rows[0] });
  });
  it("requires a choice when multiple and none given", () => {
    const rows = [row("a"), row("b")];
    expect(chooseTargetSubscription(rows, undefined)).toEqual({ kind: "needChoice", rows });
  });
  it("selects by id when multiple and id provided", () => {
    const rows = [row("a"), row("b")];
    expect(chooseTargetSubscription(rows, "b")).toEqual({ kind: "single", row: rows[1] });
  });
  it("selects all when UPDATE ALL given", () => {
    const rows = [row("a"), row("b")];
    expect(chooseTargetSubscription(rows, "UPDATE ALL")).toEqual({ kind: "all", rows });
  });
  it("returns invalid when id not found", () => {
    const rows = [row("a"), row("b")];
    expect(chooseTargetSubscription(rows, "zzz")).toEqual({ kind: "invalid", input: "zzz" });
  });
});
