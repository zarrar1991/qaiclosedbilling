import type { ParsedSpan } from "./types.js";

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function formatTimestampUTC(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.000`
  );
}

export function computeRenewalUTC(base: Date, offsetMinutes: number): string {
  const out = new Date(base.getTime() + offsetMinutes * 60_000);
  return formatTimestampUTC(out);
}

export function parseSpan(input: string): ParsedSpan {
  const m = input.trim().toLowerCase().match(/^(\d+)\s+(day|days|month|months|year|years)$/);
  if (!m) {
    throw new Error(`Invalid span "${input}". Use e.g. "3 days", "1 month", "2 years".`);
  }
  const amount = Number(m[1]);
  if (amount <= 0) throw new Error(`Span amount must be > 0 (got ${amount}).`);
  const unitWord = m[2];
  const unit = unitWord.startsWith("day") ? "day" : unitWord.startsWith("month") ? "month" : "year";
  return { unit, amount };
}

export function addSpan(base: Date, span: ParsedSpan): Date {
  const d = new Date(base.getTime());
  if (span.unit === "day") d.setUTCDate(d.getUTCDate() + span.amount);
  else if (span.unit === "month") d.setUTCMonth(d.getUTCMonth() + span.amount);
  else d.setUTCFullYear(d.getUTCFullYear() + span.amount);
  return d;
}
