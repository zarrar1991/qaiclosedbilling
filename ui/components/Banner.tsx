import React from "react";

export function Banner({ kind, title, children }: { kind: "success" | "error" | "info"; title: string; children?: React.ReactNode }) {
  const style = {
    success: { bg: "#E7F6EE", border: "#BBE6CC", fg: "#15803D" },
    error: { bg: "#FEF2F2", border: "#FECACA", fg: "#DC2626" },
    info: { bg: "#E9EDF6", border: "#C7D2E8", fg: "#031953" },
  }[kind];
  return (
    <div className="rounded-xl border p-4" style={{ background: style.bg, borderColor: style.border }}>
      <div className="text-[14.5px] font-extrabold" style={{ color: style.fg }}>{title}</div>
      {children && <div className="mt-2 text-[12.5px] text-body">{children}</div>}
    </div>
  );
}
