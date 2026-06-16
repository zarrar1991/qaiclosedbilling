import type { SubscriptionRow } from "./types.js";

export type SelectionResult =
  | { kind: "none" }
  | { kind: "single"; row: SubscriptionRow }
  | { kind: "needChoice"; rows: SubscriptionRow[] }
  | { kind: "all"; rows: SubscriptionRow[] }
  | { kind: "invalid"; input: string };

export function chooseTargetSubscription(
  rows: SubscriptionRow[],
  userChoice: string | undefined,
): SelectionResult {
  if (rows.length === 0) return { kind: "none" };
  if (rows.length === 1 && (userChoice === undefined || userChoice === "")) {
    return { kind: "single", row: rows[0] };
  }
  if (userChoice === undefined || userChoice === "") {
    return { kind: "needChoice", rows };
  }
  if (userChoice.trim().toUpperCase() === "UPDATE ALL") {
    return { kind: "all", rows };
  }
  const match = rows.find((r) => r.id === userChoice.trim());
  return match ? { kind: "single", row: match } : { kind: "invalid", input: userChoice };
}
