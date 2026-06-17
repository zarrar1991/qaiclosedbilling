import React from "react";
export type Page = "renewal" | "full" | "settings";
export function Sidebar({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  const items: { id: Page; label: string }[] = [
    { id: "renewal", label: "Renewal" },
    { id: "full", label: "Full downgrade" },
    { id: "settings", label: "Settings" },
  ];
  return (
    <nav className="w-56 shrink-0 border-r border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-6 bg-gradient-to-r from-sky-400 to-violet-400 bg-clip-text text-lg font-bold text-transparent">
        iClosed Billing
      </div>
      {items.map((it) => (
        <button key={it.id} onClick={() => setPage(it.id)}
          className={`mb-1 block w-full rounded-lg px-3 py-2 text-left ${page === it.id ? "bg-sky-500/20 text-sky-200" : "text-slate-300 hover:bg-slate-800"}`}>
          {it.label}
        </button>
      ))}
    </nav>
  );
}
