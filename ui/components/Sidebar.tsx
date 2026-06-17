import React from "react";
import markUrl from "../assets/iclosed-mark.png";

export type Page = "renewal" | "full" | "createuser" | "settings";

const svg = (paths: React.ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
);

const ICONS: Record<Page, React.ReactNode> = {
  createuser: svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></>),
  renewal: svg(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>),
  full: svg(<path d="M12 5v14M19 12l-7 7-7-7" />),
  settings: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.2.61.78 1 1.42 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>),
};

const ITEMS: { id: Page; label: string }[] = [
  { id: "createuser", label: "Create user" },
  { id: "renewal", label: "Update renewal date" },
  { id: "full", label: "Downgrade subscription" },
  { id: "settings", label: "Settings" },
];

export function Sidebar({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  return (
    <nav className="flex w-[212px] flex-shrink-0 flex-col border-r border-line bg-white px-3 py-[18px]">
      <div className="mb-[22px] flex items-center gap-[9px] px-2">
        <img src={markUrl} alt="iClosed" className="block h-[18px] w-[18px] object-contain" />
        <span className="text-[15px] font-extrabold tracking-[-0.02em] text-ink">
          iClosed <span className="text-navy">Billing</span>
        </span>
      </div>

      <div className="flex flex-col gap-[3px]">
        {ITEMS.map((it) => {
          const active = page === it.id;
          return (
            <button
              key={it.id}
              onClick={() => setPage(it.id)}
              className={`flex items-center gap-[9px] rounded-lg px-[11px] py-2 text-left text-[13px] transition ${
                active ? "bg-navy-tint font-bold text-navy" : "font-semibold text-body hover:bg-[#F4F6F9]"
              }`}
            >
              <span className="inline-flex h-4 w-4 flex-shrink-0">{ICONS[it.id]}</span>
              {it.label}
            </button>
          );
        })}
      </div>

      <div className="mt-auto border-t border-[#F1F2F4] px-[9px] py-2.5 text-[11px] text-muted">
        v2.4.0 · internal tools
      </div>
    </nav>
  );
}
