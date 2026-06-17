import React from "react";
import type { SubscriptionRow } from "../../src/types.js";
export function SubscriptionPicker({ rows, onPick }: { rows: SubscriptionRow[]; onPick: (id: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="text-[12.5px] text-body">Multiple active subscriptions — choose one to update:</div>
      {rows.map((r) => (
        <button key={r.id} onClick={() => onPick(r.id)}
          className="block w-full rounded-lg border-[1.5px] border-field bg-white p-3 text-left transition hover:border-navy">
          <div className="font-mono text-[13px] text-navy">{r.stripeSubscriptionId ?? "(no stripe id)"}</div>
          <div className="text-[11.5px] text-muted">
            id {r.id} · {r.status} · renews {r.renewalDateTime ?? "-"} · created {r.createdAt ?? "-"}
          </div>
        </button>
      ))}
    </div>
  );
}
