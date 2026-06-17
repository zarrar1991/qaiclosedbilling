import React from "react";
export function Banner({ kind, title, children }: { kind: "success" | "error" | "info"; title: string; children?: React.ReactNode }) {
  const styles = {
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    error: "border-rose-500/40 bg-rose-500/10 text-rose-200",
    info: "border-sky-500/40 bg-sky-500/10 text-sky-200",
  }[kind];
  return (
    <div className={`rounded-xl border p-4 ${styles}`}>
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-1 text-sm opacity-90">{children}</div>}
    </div>
  );
}
