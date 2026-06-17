import React from "react";
import type { SubscriptionRow } from "../../src/types.js";

// Read-only table: account email (echoed per row) + subscription columns.
export function SubscriptionsTable({ email, rows }: { email: string; rows: SubscriptionRow[] }) {
  if (rows.length === 0) {
    return <div className="text-sm text-slate-400">No subscriptions found for {email}.</div>;
  }
  const headers = ["email", "accountId", "subscriptionId", "status", "renewalDateTime", "pauseCollection", "deletedAt"];
  return (
    <div className="overflow-auto rounded-xl border border-slate-800">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-900/70 text-slate-400">
          <tr>
            {headers.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`border-t border-slate-800 ${r.deletedAt ? "opacity-60" : ""}`}>
              <td className="whitespace-nowrap px-3 py-2 text-slate-300">{email}</td>
              <td className="whitespace-nowrap px-3 py-2 text-slate-300">{r.accountId}</td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-sky-200">{r.stripeSubscriptionId ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-slate-300">{r.status ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-slate-300">{r.renewalDateTime ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-slate-300">{String(r.pauseCollection)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-slate-300">{r.deletedAt ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
