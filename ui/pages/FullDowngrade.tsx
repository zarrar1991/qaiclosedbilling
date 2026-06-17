import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Field } from "../components/Field.js";
import { Banner } from "../components/Banner.js";
import { Select } from "../components/Select.js";
import { StatusTimeline, type Step } from "../components/StatusTimeline.js";
import type { RunReport } from "../../src/types.js";

const PRESETS = ["1 day", "1 week", "1 month", "1 year", "Custom"] as const;

export function FullDowngrade({ profile }: { profile: string }) {
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
    const res = await api.runFullFlow(profile, { email, span: span() });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setReport(res.data);
  }

  return (
    <div className="max-w-[820px]">
      <h1 className="ic-page-title">Downgrade subscription</h1>
      <div className="max-w-[420px]">
        <Field label="Customer email" value={email} onChange={setEmail} placeholder="demo@example.com" />
      </div>

      <div className="mt-4 flex items-end gap-3">
        <div>
          <span className="ic-label">Advance interval</span>
          <Select value={preset} onChange={(v) => setPreset(v as typeof preset)} className="w-[150px]">
            {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>
        {preset === "Custom" && (
          <>
            <div className="w-[110px]"><Field label="Amount" value={amount} onChange={setAmount} /></div>
            <div>
              <span className="ic-label">Unit</span>
              <Select value={unit} onChange={(v) => setUnit(v as typeof unit)} className="w-[130px]">
                <option value="day">day</option><option value="month">month</option><option value="year">year</option>
              </Select>
            </div>
          </>
        )}
      </div>

      <button disabled={busy || !email || !profile} onClick={run} className="ic-btn-primary mt-[18px] px-5 py-[9px] text-[13px]">
        {busy ? "Running…" : "Downgrade"}
      </button>

      {steps.length > 0 && (
        <div className="ic-card mt-[22px] p-[18px]">
          <StatusTimeline steps={steps} done={!!report && report.status === "PASS"} failed={!!error || (!!report && report.status === "FAIL")} />
        </div>
      )}
      {error && <div className="mt-3.5"><Banner kind="error" title="Downgrade failed">{error}</Banner></div>}
      {report && (
        <div className="mt-3.5">
          <Banner kind={report.status === "PASS" ? "success" : "error"} title={`Downgrade ${report.status}`}>
            <div className="space-y-0.5 font-mono text-[11.5px] leading-relaxed">
              <div>account {report.dbAccountId} · sub {report.dbSubscriptionId}</div>
              <div>renewal {report.oldRenewalDate} → {report.newRenewalDate}</div>
              <div>old stripe sub {report.oldStripeSubscriptionId ?? "-"}</div>
              <div>new active sub {report.newStripeSubscriptionId ?? "-"}</div>
              {report.notes.length > 0 && <div>notes: {report.notes.join("; ")}</div>}
            </div>
          </Banner>
        </div>
      )}
    </div>
  );
}
