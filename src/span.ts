export type Interval =
  | { kind: "preset"; preset: "1 day" | "1 week" | "1 month" | "1 year" }
  | { kind: "custom"; amount: number; unit: "day" | "month" | "year" };

// Returns a string compatible with parseSpan() in src/time.ts.
export function intervalToSpanString(i: Interval): string {
  if (i.kind === "preset") {
    return i.preset === "1 week" ? "7 days" : i.preset;
  }
  if (!Number.isInteger(i.amount) || i.amount <= 0) {
    throw new Error(`Interval amount must be a positive integer (got ${i.amount}).`);
  }
  const unit = i.amount === 1 ? i.unit : `${i.unit}s`;
  return `${i.amount} ${unit}`;
}
