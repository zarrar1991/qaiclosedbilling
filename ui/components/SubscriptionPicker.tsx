import React from "react";
import type { SubscriptionRow } from "../../src/types.js";
export function SubscriptionPicker({ rows, onPick }: { rows: SubscriptionRow[]; onPick: (id: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="text-sm text-slate-400">Multiple active subscriptions — choose one to update:</div>
      {rows.map((r) => (
        <button key={r.id} onClick={() => onPick(r.id)}
          className="block w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-left hover:border-sky-500">
          <div className="font-mono text-sm text-sky-200">{r.stripeSubscriptionId ?? "(no stripe id)"}</div>
          <div className="text-xs text-slate-400">
            id {r.id} · {r.status} · renews {r.renewalDateTime ?? "-"} · created {r.createdAt ?? "-"}
          </div>
        </button>
      ))}
    </div>
  );
}
