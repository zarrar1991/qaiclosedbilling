import React, { useState } from "react";
import { api } from "../lib/api.js";
import { Field } from "../components/Field.js";
import { Banner } from "../components/Banner.js";
import { SubscriptionPicker } from "../components/SubscriptionPicker.js";
import { SubscriptionsTable } from "../components/SubscriptionsTable.js";
import { humanizeError } from "../lib/errors.js";
import type { SubscriptionRow } from "../../src/types.js";

export function Renewal({ profile }: { profile: string }) {
  const [email, setEmail] = useState("");
  const [rows, setRows] = useState<SubscriptionRow[] | null>(null); // update picker rows
  const [accountId, setAccountId] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Read-only results table (shares the email field).
  const [searchRows, setSearchRows] = useState<SubscriptionRow[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  async function runSearch() {
    if (!email) return;
    setSearching(true); setSearchError(null);
    const res = await api.searchSubscriptions(profile, email);
    setSearching(false);
    if (!res.ok) { setSearchError(humanizeError(res.error)); setSearchRows(null); return; }
    setSearchRows(res.data.rows);
  }

  // Search button: a fresh search should drop the previous Update outcome (and
  // any pending picker). The internal refresh in doUpdate keeps calling runSearch
  // directly so it preserves the just-set success message.
  function onSearchClick() {
    setResult(null); setRows(null);
    void runSearch();
  }

  async function start() {
    setResult(null); setRows(null); setBusy(true);
    const res = await api.getCandidates(profile, email);
    setBusy(false);
    if (!res.ok) { setResult({ ok: false, msg: humanizeError(res.error) }); return; }
    setAccountId(res.data.accountId);
    if (res.data.rows.length === 1) await doUpdate(res.data.rows[0].id, res.data.accountId);
    else setRows(res.data.rows);
  }

  // acct is passed explicitly because React state (accountId) hasn't applied yet
  // on the single-subscription path; fall back to state for the picker path.
  async function doUpdate(id: string, acct?: string) {
    setBusy(true); setRows(null);
    const res = await api.updateRenewal(profile, { id });
    setBusy(false);
    if (!res.ok) { setResult({ ok: false, msg: humanizeError(res.error) }); return; }
    const r = res.data.reselected[0];
    setResult({ ok: true, msg: `Account ${acct ?? accountId}, subscription ${r.id} → renewal ${r.renewalDateTime} (UTC).` });
    // Refresh the table so it reflects the update.
    await runSearch();
  }

  const disabled = busy || searching || !email || !profile;

  return (
    <div className="max-w-[920px]">
      <h1 className="ic-page-title">Update renewal date</h1>
      <div className="max-w-[460px]">
        <Field label="Customer email" value={email} onChange={setEmail} placeholder="demo@example.com" />
      </div>
      <div className="mt-4 flex items-center gap-2.5">
        <button disabled={disabled} onClick={start} className="ic-btn-primary px-[18px] py-2 text-[13px]">
          {busy ? "Working…" : "Update"}
        </button>
        <button disabled={disabled} onClick={onSearchClick} className="ic-btn-secondary px-[17px] py-[7px] text-[13px]">
          {searching ? "Searching…" : "Search"}
        </button>
        <button title="Refresh results" aria-label="Refresh results" disabled={disabled} onClick={runSearch}
          className="ic-btn-secondary h-9 w-9 text-[#64748B]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            className={searching ? "animate-spin" : ""}>
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
          </svg>
        </button>
      </div>

      {rows && <div className="mt-5"><SubscriptionPicker rows={rows} onPick={doUpdate} /></div>}
      {result && <div className="mt-4"><Banner kind={result.ok ? "success" : "error"} title={result.ok ? "Renewal updated" : "Failed"}>{result.msg}</Banner></div>}
      {searchError && <div className="mt-4"><Banner kind="error" title="Search failed">{searchError}</Banner></div>}

      {searchRows && (
        <section className="mt-[26px]">
          <h2 className="mb-[11px] text-[15px] font-extrabold tracking-[-0.01em] text-ink">Subscription(s)</h2>
          <SubscriptionsTable email={email} rows={searchRows} />
        </section>
      )}
    </div>
  );
}
