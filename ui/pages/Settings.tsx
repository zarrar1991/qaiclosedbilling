import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Field } from "../components/Field.js";
import { Banner } from "../components/Banner.js";

const DB_KEYS = ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGSCHEMA"];
const STRIPE_KEYS = ["STRIPE_DASHBOARD_URL", "STRIPE_ENVIRONMENT_NAME", "STRIPE_AUTH_PROFILE_DIR",
  "STRIPE_STEP_TIMEOUT_MS", "STRIPE_LONG_TIMEOUT_MS", "DEFAULT_RENEWAL_OFFSET_MINUTES", "PLAYWRIGHT_SLOW_MO_MS"];

export function Settings() {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { api.loadSettings().then((r) => { if (r.ok) setVals(r.data); }); }, []);
  const set = (k: string) => (v: string) => setVals((s) => ({ ...s, [k]: v }));

  async function save() {
    const r = await api.saveSettings(vals);
    setMsg(r.ok ? { ok: true, text: "Settings saved to .env" } : { ok: false, text: r.error });
  }
  async function test() {
    const r = await api.testDb();
    setMsg(r.ok ? { ok: true, text: "Database connection OK" } : { ok: false, text: r.error });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-400">Database</h2>
        {DB_KEYS.map((k) => <Field key={k} label={k} type={k === "PGPASSWORD" ? "password" : "text"} value={vals[k] ?? ""} onChange={set(k)} />)}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-400">Stripe</h2>
        {STRIPE_KEYS.map((k) => <Field key={k} label={k} value={vals[k] ?? ""} onChange={set(k)} />)}
      </section>
      <div className="flex gap-3">
        <button onClick={save} className="rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 font-semibold">Save</button>
        <button onClick={test} className="rounded-lg border border-slate-700 px-4 py-2">Test DB connection</button>
      </div>
      {msg && <Banner kind={msg.ok ? "success" : "error"} title={msg.ok ? "OK" : "Error"}>{msg.text}</Banner>}
    </div>
  );
}
