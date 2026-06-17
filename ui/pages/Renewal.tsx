import React, { useState } from "react";
import { api } from "../lib/api.js";
import { Field } from "../components/Field.js";
import { Banner } from "../components/Banner.js";
import { SubscriptionPicker } from "../components/SubscriptionPicker.js";
import { SubscriptionsTable } from "../components/SubscriptionsTable.js";
import type { SubscriptionRow } from "../../src/types.js";

export function Renewal() {
  const [email, setEmail] = useState("");
  const [rows, setRows] = useState<SubscriptionRow[] | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Read-only search section (separate email + table).
  const [searchEmail, setSearchEmail] = useState("");
  const [searchRows, setSearchRows] = useState<SubscriptionRow[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

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

  async function runSearch() {
    if (!searchEmail) return;
    setSearching(true); setSearchError(null);
    const res = await api.searchSubscriptions(searchEmail);
    setSearching(false);
    if (!res.ok) { setSearchError(res.error); setSearchRows(null); return; }
    setSearchRows(res.data.rows);
  }

  return (
    <div className="max-w-4xl space-y-10">
      <section className="max-w-xl space-y-4">
        <h1 className="text-2xl font-bold">Update renewal date</h1>
        <Field label="Customer email" value={email} onChange={setEmail} placeholder="demo@example.com" />
        <button disabled={busy || !email} onClick={start}
          className="rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 font-semibold disabled:opacity-50">
          {busy ? "Working…" : "Update renewal"}
        </button>
        {rows && <SubscriptionPicker rows={rows} onPick={doUpdate} />}
        {result && <Banner kind={result.ok ? "success" : "error"} title={result.ok ? "Renewal updated" : "Failed"}>{result.msg}</Banner>}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold">Search subscriptions</h2>
        <div className="flex items-end gap-3">
          <div className="w-full max-w-md">
            <Field label="Customer email" value={searchEmail} onChange={setSearchEmail} placeholder="demo@example.com" />
          </div>
          <button disabled={searching || !searchEmail} onClick={runSearch}
            className="rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 font-semibold disabled:opacity-50">
            {searching ? "Searching…" : "Search"}
          </button>
          <button
            title="Refresh results"
            aria-label="Refresh results"
            disabled={searching || !searchEmail}
            onClick={runSearch}
            className="rounded-lg border border-slate-700 px-3 py-2 text-slate-300 hover:bg-slate-800 disabled:opacity-50">
            <span className={searching ? "inline-block animate-spin" : "inline-block"}>⟳</span>
          </button>
        </div>
        {searchError && <Banner kind="error" title="Search failed">{searchError}</Banner>}
        {searchRows && <SubscriptionsTable email={searchEmail} rows={searchRows} />}
      </section>
    </div>
  );
}
