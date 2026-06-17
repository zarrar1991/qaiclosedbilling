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
        className="ic-input flex items-center justify-between text-left disabled:cursor-default disabled:opacity-50"
      >
        <span className={selectedLabel ? "text-ink" : "text-muted"}>
          {selectedLabel || placeholder}
        </span>
        <span className="text-[10px] text-muted">▼</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-line bg-white shadow-[0_12px_32px_rgba(16,24,40,.18)]">
          <div className="p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="ic-input h-8 text-[12.5px]"
            />
          </div>
          <ul className="max-h-64 overflow-auto pb-1">
            {loading && <li className="px-3 py-2 text-[12.5px] text-muted">Loading…</li>}
            {!loading && filtered.length === 0 && <li className="px-3 py-2 text-[12.5px] text-muted">No matches</li>}
            {filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`block w-full px-3 py-2 text-left text-[12.5px] hover:bg-[#F4F6F9] ${o.value === value ? "bg-navy-tint font-semibold text-navy" : "text-strong"}`}
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
