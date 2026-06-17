import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Field } from "../components/Field.js";
import { Banner } from "../components/Banner.js";
import { StatusTimeline, type Step } from "../components/StatusTimeline.js";
import type { RunReport } from "../../src/types.js";

const PRESETS = ["1 day", "1 week", "1 month", "1 year", "Custom"] as const;

export function FullDowngrade() {
  const [email, setEmail] = useState("");
  const [preset, setPreset] = useState<(typeof PRESETS)[number]>("1 month");
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<"day" | "month" | "year">("month");
  const [steps, setSteps] = useState<Step[]>([]);
  const [report, setReport] = useState<RunReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => api.onProgress((p) => setSteps((s) => [...s, p])), []);

  function span(): string {
    if (preset !== "Custom") return preset === "1 week" ? "7 days" : preset;
    const n = parseInt(amount, 10);
    return `${n} ${n === 1 ? unit : unit + "s"}`;
  }

  async function run() {
    setSteps([]); setReport(null); setError(null); setBusy(true);
    const res = await api.runFullFlow({ email, span: span() });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setReport(res.data);
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Run full downgrade</h1>
      <Field label="Customer email" value={email} onChange={setEmail} placeholder="demo@example.com" />
      <div className="flex gap-3">
        <label className="block">
          <span className="mb-1 block text-sm text-slate-400">Advance interval</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
            {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        {preset === "Custom" && (
          <>
            <Field label="Amount" value={amount} onChange={setAmount} />
            <label className="block">
              <span className="mb-1 block text-sm text-slate-400">Unit</span>
              <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
                <option value="day">day</option><option value="month">month</option><option value="year">year</option>
              </select>
            </label>
          </>
        )}
      </div>
      <button disabled={busy || !email} onClick={run}
        className="rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 font-semibold disabled:opacity-50">
        {busy ? "Running…" : "Run downgrade"}
      </button>
      {steps.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <StatusTimeline steps={steps} done={!!report && report.status === "PASS"} failed={!!error || (!!report && report.status === "FAIL")} />
        </div>
      )}
      {error && <Banner kind="error" title="Downgrade failed">{error}</Banner>}
      {report && (
        <Banner kind={report.status === "PASS" ? "success" : "error"} title={`Downgrade ${report.status}`}>
          <div className="space-y-0.5 font-mono text-xs">
            <div>account {report.dbAccountId} · sub {report.dbSubscriptionId}</div>
            <div>renewal {report.oldRenewalDate} → {report.newRenewalDate}</div>
            <div>old stripe sub {report.oldStripeSubscriptionId ?? "-"}</div>
            <div>new active sub {report.newStripeSubscriptionId ?? "-"}</div>
            {report.notes.length > 0 && <div>notes: {report.notes.join("; ")}</div>}
          </div>
        </Banner>
      )}
    </div>
  );
}
