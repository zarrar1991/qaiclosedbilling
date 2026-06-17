import React, { useState } from "react";
export function Field({ label, value, onChange, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const isPw = type === "password";
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-400">{label}</span>
      <div className="relative">
        <input
          type={isPw && !show ? "password" : "text"}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-sky-500"
        />
        {isPw && (
          <button type="button" onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-2 text-xs text-slate-400 hover:text-slate-200">
            {show ? "Hide" : "Show"}
          </button>
        )}
      </div>
    </label>
  );
}
