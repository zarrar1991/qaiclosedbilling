import React, { useEffect, useState } from "react";
import { Sidebar, type Page } from "./components/Sidebar.js";
import { TitleBar } from "./components/TitleBar.js";
import { Select } from "./components/Select.js";
import { ToastProvider } from "./components/Toast.js";
import { Renewal } from "./pages/Renewal.js";
import { FullDowngrade } from "./pages/FullDowngrade.js";
import { CreateUser } from "./pages/CreateUser.js";
import { Settings } from "./pages/Settings.js";
import { ZeroFundsCard } from "./pages/ZeroFundsCard.js";
import { api } from "./lib/api.js";

export default function App() {
  const [page, setPage] = useState<Page>("createuser");
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
    <ToastProvider>
      <div className="relative flex h-screen flex-col bg-canvas">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar page={page} setPage={setPage} />
          <div className="flex flex-1 flex-col overflow-hidden bg-canvas">
            <header className="flex h-[50px] flex-shrink-0 items-center justify-end gap-3 border-b border-[#EEF0F3] bg-white px-[22px]">
              <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-navy-tint text-navy">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
                </svg>
              </div>
              <Select
                value={profile}
                onChange={setProfile}
                title="Active profile"
                ariaLabel="Active profile"
                className="w-[160px]"
              >
                {names.length === 0 && <option value="">(no profiles)</option>}
                {names.map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </header>
            <main className="flex-1 overflow-auto px-8 py-[26px]">
              {page === "renewal" && <Renewal profile={profile} />}
              {page === "full" && <FullDowngrade profile={profile} />}
              {page === "createuser" && <CreateUser profile={profile} />}
              {page === "settings" && <Settings onProfilesChanged={loadProfiles} />}
              {page === "zerofunds" && <ZeroFundsCard profile={profile} />}
            </main>
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
