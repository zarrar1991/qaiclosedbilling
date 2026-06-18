import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Field } from "../components/Field.js";
import { Banner } from "../components/Banner.js";
import { StatusTimeline, type Step } from "../components/StatusTimeline.js";
import { humanizeError } from "../lib/errors.js";
import type { ZeroFundsResult } from "../../electron/ipc.js";

type RunState = "idle" | "running" | "success" | "error";

export function ZeroFundsCard({ profile }: { profile: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<RunState>("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<ZeroFundsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => api.onZeroFundsProgress((p) => setSteps((s) => [...s, p])), []);

  const running = state === "running";
  const canRun = !running && email.trim() !== "" && password.trim() !== "" && !!profile;

  async function run() {
    setState("running"); setSteps([]); setResult(null); setError(null);
    const res = await api.runZeroFunds(profile, { email: email.trim(), password });
    if (!res.ok) { setError(humanizeError(res.error)); setState("error"); return; }
    setResult(res.data); setState(res.data.verified ? "success" : "error");
  }

  return (
    <div className="max-w-[820px]">
      <h1 className="ic-page-title">Add zero funds card</h1>

      <div className="max-w-[420px]">
        <Field label="Email" value={email} onChange={setEmail} placeholder="demo@example.com" />
      </div>
      <div className="mt-4 max-w-[420px]">
        <Field label="Password" value={password} onChange={setPassword} type="password" />
      </div>

      <button disabled={!canRun} onClick={run} className="ic-btn-primary mt-[18px] px-[22px] py-[9px] text-[13px]">
        {running ? "Adding…" : "Add"}
      </button>

      {steps.length > 0 && (
        <div className="ic-card mt-[22px] p-[18px]">
          <StatusTimeline steps={steps} done={state === "success"} failed={state === "error"} />
        </div>
      )}

      {error && <div className="mt-3.5"><Banner kind="error" title="Add failed">{error}</Banner></div>}

      {result && (
        <div className="mt-3.5">
          <Banner kind={result.verified ? "success" : "error"} title={result.verified ? "Zero funds card added" : "Completed with warnings"}>
            <div className="space-y-0.5 font-mono text-[12px]">
              <div>stripe pm {result.paymentMethodId ?? "-"}</div>
              <div>payment_methods id {result.dbPaymentMethodId ?? "-"}</div>
              <div>app card …{result.appCardLast4 ?? "----"} {result.verified ? "verified" : "NOT confirmed"}</div>
              {result.notes.length > 0 && <div>notes: {result.notes.join("; ")}</div>}
            </div>
          </Banner>
        </div>
      )}
    </div>
  );
}
