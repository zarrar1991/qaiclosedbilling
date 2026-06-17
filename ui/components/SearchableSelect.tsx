import React, { useEffect, useRef, useState } from "react";

export interface Option { label: string; value: string }

// A searchable dropdown (combobox). Calls onOpen each time it opens (for lazy
// refresh), filters options by a search box, and reports the picked value.
export function SearchableSelect({
  options,
  value,
  onChange,
  onOpen,
  loading,
  placeholder = "Select…",
  disabled,
}: {
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  onOpen?: () => void;
  loading?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  function toggle() {
    if (disabled) return;
    const next = !open;
    setOpen(next);
    if (next) { setQuery(""); onOpen?.(); }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-left outline-none focus:border-sky-500 disabled:opacity-50"
      >
        <span className={selectedLabel ? "text-slate-100" : "text-slate-500"}>
          {selectedLabel || placeholder}
        </span>
        <span className="text-slate-500">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          <div className="p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
            />
          </div>
          <ul className="max-h-64 overflow-auto pb-1">
            {loading && <li className="px-3 py-2 text-sm text-slate-400">Loading…</li>}
            {!loading && filtered.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No matches</li>}
            {filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-800 ${o.value === value ? "bg-sky-500/15 text-sky-200" : "text-slate-200"}`}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
