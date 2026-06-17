import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { Field } from "../components/Field.js";
import { Select } from "../components/Select.js";
import { useToast } from "../components/Toast.js";

const DB_KEYS = ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGSCHEMA"];
const STRIPE_KEYS = ["STRIPE_DASHBOARD_URL", "STRIPE_ENVIRONMENT_NAME", "STRIPE_AUTH_PROFILE_DIR",
  "STRIPE_STEP_TIMEOUT_MS", "STRIPE_LONG_TIMEOUT_MS", "DEFAULT_RENEWAL_OFFSET_MINUTES", "PLAYWRIGHT_SLOW_MO_MS"];
const BO_KEYS = ["BO_BASE_URL", "BO_EMAIL", "BO_PASSWORD"];

export function Settings({ onProfilesChanged }: { onProfilesChanged?: () => void }) {
  const toast = useToast();
  const [names, setNames] = useState<string[]>([]);
  const [active, setActive] = useState<string>("");
  const [selected, setSelected] = useState<string>("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");

  async function loadProfile(name: string) {
    if (!name) { setVals({}); return; }
    const r = await api.getProfile(name);
    if (r.ok) setVals(r.data);
  }

  async function refreshList(selectName?: string) {
    const r = await api.loadProfiles();
    if (!r.ok) { toast("error", "Couldn't load profiles", r.error); return; }
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
    await loadProfile(name);
  }

  async function save() {
    if (!selected) return;
    const r = await api.saveProfile(selected, vals);
    if (r.ok) { setNames(r.data.names); setActive(r.data.activeProfile); onProfilesChanged?.(); }
    if (r.ok) toast("success", "Settings saved", `Profile "${selected}" saved.`);
    else toast("error", "Save failed", r.error);
  }

  async function test() {
    const r = await api.testDb(selected);
    if (r.ok) toast("success", "Connection OK", `Connected to the database (${selected}).`);
    else toast("error", "Connection failed", r.error);
  }

  async function createProfile(values: Record<string, string>, successText: (name: string) => string) {
    const name = newName.trim();
    if (!name) { toast("error", "Name required", "Enter a profile name first."); return; }
    if (names.includes(name)) { toast("error", "Already exists", `Profile "${name}" already exists.`); return; }
    const r = await api.saveProfile(name, values);
    if (!r.ok) { toast("error", "Couldn't create profile", r.error); return; }
    setNewName("");
    await refreshList(name);
    onProfilesChanged?.();
    toast("success", "Profile created", successText(name));
  }

  function newProfile() {
    return createProfile({}, (n) => `Profile "${n}" created — fill in its values and Save.`);
  }

  // Duplicate the currently selected profile's values into a new profile.
  function duplicateProfile() {
    if (!selected) { toast("error", "Select a profile", "Select a profile to duplicate first."); return; }
    return createProfile({ ...vals }, (n) => `Duplicated "${selected}" → "${n}".`);
  }

  // Rename the selected profile to the name typed in "New profile name".
  async function renameProfile() {
    if (!selected) { toast("error", "Select a profile", "Select a profile to rename first."); return; }
    const to = newName.trim();
    if (!to) { toast("error", "Name required", "Enter the new name in 'New profile name'."); return; }
    if (to !== selected && names.includes(to)) { toast("error", "Already exists", `Profile "${to}" already exists.`); return; }
    const r = await api.renameProfile(selected, to);
    if (!r.ok) { toast("error", "Rename failed", r.error); return; }
    setNewName("");
    setNames(r.data.names); setActive(r.data.activeProfile);
    setSelected(to);
    await loadProfile(to);
    onProfilesChanged?.();
    toast("info", "Profile renamed", `Renamed to "${to}".`);
  }

  async function deleteProfile() {
    if (!selected) return;
    if (!window.confirm(`Delete profile "${selected}"?`)) return;
    const r = await api.deleteProfile(selected);
    if (!r.ok) { toast("error", "Delete failed", r.error); return; }
    setNames(r.data.names);
    setActive(r.data.activeProfile);
    const next = r.data.names[0] ?? "";
    setSelected(next);
    await loadProfile(next);
    onProfilesChanged?.();
    toast("error", "Profile deleted", "The profile has been removed.");
  }

  async function makeActive() {
    if (!selected) return;
    const r = await api.setActiveProfile(selected);
    if (r.ok) { setActive(r.data.activeProfile); onProfilesChanged?.(); toast("info", "Default profile set", `"${selected}" is now the default profile.`); }
    else toast("error", "Couldn't set default", r.error);
  }

  const section = (title: string, keys: string[], secretKey?: string) => (
    <>
      <div className="ic-section mt-6 mb-3">{title}</div>
      {keys.map((k) => (
        <div key={k} className="mb-3">
          <Field label={k} dense type={k === secretKey ? "password" : "text"} value={vals[k] ?? ""} onChange={set(k)} />
        </div>
      ))}
    </>
  );

  return (
    <div className="max-w-[680px]">
      <h1 className="ic-page-title">Settings</h1>

      <div className="ic-card mb-[26px] px-5 py-[18px]">
        <div className="ic-section mb-3.5">Profile</div>
        <span className="ic-sublabel">Editing profile</span>
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <Select value={selected} onChange={onSelect} className="w-[200px]">
            {names.map((n) => <option key={n} value={n}>{n}{n === active ? " (default)" : ""}</option>)}
          </Select>
          <button onClick={makeActive} disabled={!selected} className="ic-btn-secondary px-4 py-[7px] text-[12.5px]">Set as default</button>
          <button onClick={deleteProfile} disabled={!selected} className="ic-btn-danger px-4 py-[7px] text-[12.5px]">Delete</button>
        </div>
        <span className="ic-sublabel">New profile name</span>
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") newProfile(); }}
            placeholder="e.g. Stage, Prod"
            className="ic-input h-[34px] max-w-[300px] flex-1 text-[12.5px]"
          />
          <button onClick={newProfile} disabled={!newName.trim()} className="ic-btn-primary px-5 py-2 text-[12.5px]">Create</button>
          <button onClick={duplicateProfile} disabled={!newName.trim() || !selected} title={selected ? `Copy values from "${selected}"` : "Select a profile to duplicate"} className="ic-btn-secondary px-4 py-[7px] text-[12.5px]">Duplicate</button>
          <button onClick={renameProfile} disabled={!newName.trim() || !selected} title={selected ? `Rename "${selected}"` : "Select a profile to rename"} className="ic-btn-secondary px-4 py-[7px] text-[12.5px]">Rename</button>
        </div>
      </div>

      {section("Database", DB_KEYS, "PGPASSWORD")}
      {section("Stripe", STRIPE_KEYS)}
      {section("Back Office API", BO_KEYS, "BO_PASSWORD")}

      <div className="mt-[22px] flex gap-2.5 border-t border-[#EEF0F3] pt-[18px]">
        <button onClick={save} disabled={!selected} className="ic-btn-primary px-5 py-2 text-[13px]">Save</button>
        <button onClick={test} disabled={!selected} className="ic-btn-secondary px-[18px] py-[7px] text-[13px]">Test DB connection</button>
      </div>
    </div>
  );
}
