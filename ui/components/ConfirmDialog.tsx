import React, { useEffect } from "react";

// On-brand modal confirmation (replaces native window.confirm). Centered card
// over a dimmed backdrop; Escape / backdrop click cancels.
export function ConfirmDialog({
  open, title, message, confirmLabel = "Confirm", cancelLabel = "Cancel",
  variant = "danger", onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  const confirmCls =
    variant === "danger"
      ? "ic-btn border-none bg-danger text-white hover:bg-[#B91C1C]"
      : "ic-btn-primary";

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(16,24,40,.45)] p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="ic-card w-full max-w-[400px] p-5 shadow-[0_24px_64px_rgba(16,24,40,.30)]">
        <div className="text-[15px] font-extrabold text-ink">{title}</div>
        {message && <div className="mt-2 text-[13px] leading-relaxed text-body">{message}</div>}
        <div className="mt-5 flex justify-end gap-2.5">
          <button onClick={onCancel} className="ic-btn-secondary px-4 py-[7px] text-[12.5px]">{cancelLabel}</button>
          <button autoFocus onClick={onConfirm} className={`${confirmCls} px-4 py-[7px] text-[12.5px]`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
