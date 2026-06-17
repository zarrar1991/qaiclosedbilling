import React, { useEffect, useState } from "react";
import { api } from "../lib/api.js";

// Profile dropdown. Loads the profile names and defaults to the active profile
// (unless a value is already set). Calls onChange with the selected name.
export function ProfileSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    api.loadProfiles().then((r) => {
      if (!r.ok) return;
      setNames(r.data.names);
      if (!value && r.data.names.length > 0) onChange(r.data.activeProfile || r.data.names[0]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-400">Profile</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-sky-500"
      >
        {names.length === 0 && <option value="">(none)</option>}
        {names.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
    </label>
  );
}
