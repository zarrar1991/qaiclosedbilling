import React, { createContext, useCallback, useContext, useState } from "react";

export type ToastKind = "success" | "error" | "info";
interface Toast { id: number; kind: ToastKind; title: string; msg?: string }

const KIND: Record<ToastKind, { bg: string; border: string; fg: string; icon: string }> = {
  success: { bg: "#E7F6EE", border: "#BBE6CC", fg: "#15803D", icon: "✓" },
  error: { bg: "#FEF2F2", border: "#FECACA", fg: "#DC2626", icon: "✕" },
  info: { bg: "#E9EDF6", border: "#C7D2E8", fg: "#031953", icon: "i" },
};

type Push = (kind: ToastKind, title: string, msg?: string) => void;
const ToastCtx = createContext<Push>(() => {});

// Top-right transient feedback (per the design): success/error/info, auto-dismiss
// after ~4.2s with a manual close. Long-running results keep their inline cards.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback<Push>((kind, title, msg) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, title, msg }]);
    setTimeout(() => dismiss(id), 4200);
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none absolute right-3.5 top-12 z-[60] flex flex-col gap-2.5">
        {toasts.map((t) => {
          const c = KIND[t.kind];
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex min-w-[280px] max-w-[360px] animate-icToastIn items-start gap-2.5 rounded-[10px] border p-3 shadow-[0_12px_32px_rgba(16,24,40,.18)]"
              style={{ background: c.bg, borderColor: c.border }}
            >
              <span
                className="mt-px flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white"
                style={{ background: c.fg }}
              >
                {c.icon}
              </span>
              <div className="flex-1">
                <div className="text-[13px] font-extrabold" style={{ color: c.fg }}>{t.title}</div>
                {t.msg && <div className="mt-0.5 text-[12px] leading-snug text-body">{t.msg}</div>}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                className="cursor-pointer border-none bg-transparent px-0.5 text-[13px] leading-none text-muted hover:text-strong"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): Push {
  return useContext(ToastCtx);
}
