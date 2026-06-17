import React from "react";
import type { SubscriptionRow } from "../../src/types.js";

// Status → badge colors (active = green, cancelled/other = slate), per the design.
function badge(status: string | null | undefined): { bg: string; fg: string } {
  return status === "active" ? { bg: "#E7F6EE", fg: "#15803D" } : { bg: "#F1F5F9", fg: "#64748B" };
}

// Read-only table: account email (echoed per row) + subscription columns.
export function SubscriptionsTable({ email, rows }: { email: string; rows: SubscriptionRow[] }) {
  if (rows.length === 0) {
    return <div className="text-[12.5px] text-muted">No subscriptions found for {email}.</div>;
  }
  const headers = ["email", "accountId", "subscriptionId", "status", "renewalDateTime", "pauseCollection", "deletedAt"];
  return (
    <div className="ic-card overflow-auto">
      <table className="w-full text-left text-[12px]">
        <thead>
          <tr className="border-b border-[#EEF0F3] bg-canvas">
            {headers.map((h) => (
              <th key={h} className="whitespace-nowrap px-3.5 py-[9px] text-[10.5px] font-bold uppercase tracking-[.03em] text-muted">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const b = badge(r.status);
            return (
              <tr key={r.id} className={`border-b border-[#F3F4F6] ${r.deletedAt ? "opacity-60" : ""}`}>
                <td className="whitespace-nowrap px-3.5 py-[9px] text-body">{email}</td>
                <td className="whitespace-nowrap px-3.5 py-[9px] tabular-nums text-strong">{r.accountId}</td>
                <td className="whitespace-nowrap px-3.5 py-[9px] font-mono text-[11px] text-navy">{r.stripeSubscriptionId ?? "—"}</td>
                <td className="whitespace-nowrap px-3.5 py-[9px]">
                  <span className="inline-block rounded-full px-[9px] py-0.5 text-[10.5px] font-bold" style={{ background: b.bg, color: b.fg }}>
                    {r.status ?? "—"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3.5 py-[9px] tabular-nums text-body">{r.renewalDateTime ?? "—"}</td>
                <td className="whitespace-nowrap px-3.5 py-[9px] text-[#64748B]">{String(r.pauseCollection)}</td>
                <td className="whitespace-nowrap px-3.5 py-[9px] tabular-nums text-muted">{r.deletedAt ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
