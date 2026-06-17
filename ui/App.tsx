import React, { useEffect, useState } from "react";
import { Sidebar, type Page } from "./components/Sidebar.js";
import { Renewal } from "./pages/Renewal.js";
import { FullDowngrade } from "./pages/FullDowngrade.js";
import { CreateUser } from "./pages/CreateUser.js";
import { Settings } from "./pages/Settings.js";
import { api } from "./lib/api.js";

export default function App() {
  const [page, setPage] = useState<Page>("renewal");
  const [profile, setProfile] = useState("");
  const [names, setNames] = useState<string[]>([]);

  async function loadProfiles() {
    const r = await api.loadProfiles();
    if (!r.ok) return;
    setNames(r.data.names);
    setProfile((cur) => (cur && r.data.names.includes(cur) ? cur : r.data.activeProfile || r.data.names[0] || ""));
  }

  // Load on mount, and refresh when switching pages (e.g. after editing in Settings).
  useEffect(() => { loadProfiles(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page]);

  return (
    <div className="flex h-screen">
      <Sidebar page={page} setPage={setPage} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-end gap-2 border-b border-slate-800 bg-slate-900/40 px-6 py-3">
          <span className="text-slate-400" aria-hidden>👤</span>
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            title="Active profile"
            aria-label="Active profile"
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
          >
            {names.length === 0 && <option value="">(no profiles)</option>}
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </header>
        <main className="flex-1 overflow-auto p-8">
          {page === "renewal" && <Renewal profile={profile} />}
          {page === "full" && <FullDowngrade profile={profile} />}
          {page === "createuser" && <CreateUser />}
          {page === "settings" && <Settings onProfilesChanged={loadProfiles} />}
        </main>
      </div>
    </div>
  );
}
