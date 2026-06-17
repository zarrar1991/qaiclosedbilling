import React, { useState } from "react";

export function Field({ label, value, onChange, type = "text", placeholder, dense }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; dense?: boolean;
}) {
  const [show, setShow] = useState(false);
  const isPw = type === "password";
  return (
    <label className="block">
      {label && <span className={dense ? "ic-sublabel" : "ic-label"}>{label}</span>}
      <div className="relative">
        <input
          type={isPw && !show ? "password" : "text"}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`ic-input ${dense ? "h-[34px] text-[12.5px]" : ""} ${isPw ? "pr-16" : ""}`}
        />
        {isPw && (
          <button type="button" onClick={() => setShow((s) => !s)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer border-none bg-transparent px-2 py-1 text-[12px] font-semibold text-navy">
            {show ? "Hide" : "Show"}
          </button>
        )}
      </div>
    </label>
  );
}
