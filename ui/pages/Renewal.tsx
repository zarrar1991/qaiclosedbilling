import React, { useState } from "react";
import { api } from "../lib/api.js";
import { Field } from "../components/Field.js";
import { Banner } from "../components/Banner.js";
import { SubscriptionPicker } from "../components/SubscriptionPicker.js";
import type { SubscriptionRow } from "../../src/types.js";

export function Renewal() {
  const [email, setEmail] = useState("");
  const [rows, setRows] = useState<SubscriptionRow[] | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setResult(null); setRows(null); setBusy(true);
    const res = await api.getCandidates(email);
    setBusy(false);
    if (!res.ok) { setResult({ ok: false, msg: res.error }); return; }
    setAccountId(res.data.accountId);
    if (res.data.rows.length === 1) await doUpdate(res.data.rows[0].id, res.data.accountId);
    else setRows(res.data.rows);
  }

  // acct is passed explicitly because React state (accountId) hasn't applied yet
  // on the single-subscription path; fall back to state for the picker path.
  async function doUpdate(id: string, acct?: string) {
    setBusy(true); setRows(null);
    const res = await api.updateRenewal({ id });
    setBusy(false);
    if (!res.ok) { setResult({ ok: false, msg: res.error }); return; }
    const r = res.data.reselected[0];
    setResult({ ok: true, msg: `Account ${acct ?? accountId}, subscription ${r.id} → renewal ${r.renewalDateTime} (UTC).` });
  }

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-bold">Update renewal date</h1>
      <Field label="Customer email" value={email} onChange={setEmail} placeholder="demo@example.com" />
      <button disabled={busy || !email} onClick={start}
        className="rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 font-semibold disabled:opacity-50">
        {busy ? "Working…" : "Update renewal"}
      </button>
      {rows && <SubscriptionPicker rows={rows} onPick={doUpdate} />}
      {result && <Banner kind={result.ok ? "success" : "error"} title={result.ok ? "Renewal updated" : "Failed"}>{result.msg}</Banner>}
    </div>
  );
}
