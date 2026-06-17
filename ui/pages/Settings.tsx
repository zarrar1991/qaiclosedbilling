import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Field } from "../components/Field.js";
import { Banner } from "../components/Banner.js";

const DB_KEYS = ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGSCHEMA"];
const STRIPE_KEYS = ["STRIPE_DASHBOARD_URL", "STRIPE_ENVIRONMENT_NAME", "STRIPE_AUTH_PROFILE_DIR",
  "STRIPE_STEP_TIMEOUT_MS", "STRIPE_LONG_TIMEOUT_MS", "DEFAULT_RENEWAL_OFFSET_MINUTES", "PLAYWRIGHT_SLOW_MO_MS"];
const BO_KEYS = ["BO_BASE_URL", "BO_EMAIL", "BO_PASSWORD"];

export function Settings({ onProfilesChanged }: { onProfilesChanged?: () => void }) {
  const [names, setNames] = useState<string[]>([]);
  const [active, setActive] = useState<string>("");
  const [selected, setSelected] = useState<string>("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newName, setNewName] = useState("");

  async function loadProfile(name: string) {
    if (!name) { setVals({}); return; }
    const r = await api.getProfile(name);
    if (r.ok) setVals(r.data);
  }

  async function refreshList(selectName?: string) {
    const r = await api.loadProfiles();
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    setNames(r.data.names);
    setActive(r.data.activeProfile);
    const pick = selectName ?? r.data.activeProfile;
    setSelected(pick);
    await loadProfile(pick);
  }

  useEffect(() => { refreshList(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const set = (k: string) => (v: string) => setVals((s) => ({ ...s, [k]: v }));

  async function onSelect(name: string) {
    setSelected(name);
    setMsg(null);
    await loadProfile(name);
  }

  async function save() {
    if (!selected) return;
    const r = await api.saveProfile(selected, vals);
    if (r.ok) { setNames(r.data.names); setActive(r.data.activeProfile); onProfilesChanged?.(); }
    setMsg(r.ok ? { ok: true, text: `Profile "${selected}" saved` } : { ok: false, text: r.error });
  }

  async function test() {
    const r = await api.testDb(selected);
    setMsg(r.ok ? { ok: true, text: `Database connection OK (${selected})` } : { ok: false, text: r.error });
  }

  async function newProfile() {
    const name = newName.trim();
    if (!name) { setMsg({ ok: false, text: "Enter a profile name first" }); return; }
    if (names.includes(name)) { setMsg({ ok: false, text: `Profile "${name}" already exists` }); return; }
    const r = await api.saveProfile(name, {});
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    setNewName("");
    await refreshList(name);
    onProfilesChanged?.();
    setMsg({ ok: true, text: `Profile "${name}" created — fill in its values and Save` });
  }

  async function deleteProfile() {
    if (!selected) return;
    if (!window.confirm(`Delete profile "${selected}"?`)) return;
    const r = await api.deleteProfile(selected);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    setNames(r.data.names);
    setActive(r.data.activeProfile);
    const next = r.data.names[0] ?? "";
    setSelected(next);
    await loadProfile(next);
    onProfilesChanged?.();
    setMsg({ ok: true, text: "Profile deleted" });
  }

  async function makeActive() {
    if (!selected) return;
    const r = await api.setActiveProfile(selected);
    if (r.ok) { setActive(r.data.activeProfile); onProfilesChanged?.(); setMsg({ ok: true, text: `"${selected}" is now the default profile` }); }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="text-sm font-semibold uppercase text-slate-400">Profile</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-sm text-slate-400">Editing profile</span>
            <select value={selected} onChange={(e) => onSelect(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
              {names.map((n) => <option key={n} value={n}>{n}{n === active ? " (default)" : ""}</option>)}
            </select>
          </label>
          <button onClick={makeActive} disabled={!selected} className="rounded-lg border border-slate-700 px-3 py-2 hover:bg-slate-800 disabled:opacity-50">Set as default</button>
          <button onClick={deleteProfile} disabled={!selected} className="rounded-lg border border-rose-700/60 px-3 py-2 text-rose-300 hover:bg-rose-900/30 disabled:opacity-50">Delete</button>
        </div>
        <div className="flex items-end gap-2 pt-1">
          <label className="block">
            <span className="mb-1 block text-sm text-slate-400">New profile name</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") newProfile(); }}
              placeholder="e.g. Stage, Prod"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-sky-500"
            />
          </label>
          <button onClick={newProfile} disabled={!newName.trim()} className="rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 font-semibold disabled:opacity-50">Create</button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-400">Database</h2>
        {DB_KEYS.map((k) => <Field key={k} label={k} type={k === "PGPASSWORD" ? "password" : "text"} value={vals[k] ?? ""} onChange={set(k)} />)}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-400">Stripe</h2>
        {STRIPE_KEYS.map((k) => <Field key={k} label={k} value={vals[k] ?? ""} onChange={set(k)} />)}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-400">Back office API</h2>
        {BO_KEYS.map((k) => <Field key={k} label={k} type={k === "BO_PASSWORD" ? "password" : "text"} value={vals[k] ?? ""} onChange={set(k)} />)}
      </section>
      <div className="flex gap-3">
        <button onClick={save} disabled={!selected} className="rounded-lg bg-gradient-to-r from-sky-500 to-violet-500 px-4 py-2 font-semibold disabled:opacity-50">Save</button>
        <button onClick={test} disabled={!selected} className="rounded-lg border border-slate-700 px-4 py-2 disabled:opacity-50">Test DB connection</button>
      </div>
      {msg && <Banner kind={msg.ok ? "success" : "error"} title={msg.ok ? "OK" : "Error"}>{msg.text}</Banner>}
    </div>
  );
}
