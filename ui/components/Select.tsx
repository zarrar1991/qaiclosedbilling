import React from "react";

// Native <select> styled to the iClosed system, with a custom chevron.
// Width is controlled by the caller via `className` on the wrapper.
export function Select({
  value, onChange, disabled, children, className = "", title, ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        className="ic-select disabled:cursor-default disabled:opacity-50"
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted">▼</span>
    </div>
  );
}
