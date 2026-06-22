import React from "react";
import { api } from "../lib/api.js";
import markUrl from "../assets/iclosed-mark.png";

// Custom title bar for the frameless window. The whole bar is a drag region;
// the window-control buttons opt out with `ic-no-drag`. On macOS the native
// traffic-light controls are used instead (titleBarStyle:"hidden"), so the
// custom buttons are hidden and the left side is padded to clear them.
export function TitleBar() {
  const isMac = api.platform === "darwin";
  return (
    <div className={`ic-drag relative flex h-[38px] flex-shrink-0 items-center justify-end border-b border-[#EEF0F3] bg-[#FAFBFC] pr-1.5 ${isMac ? "pl-[80px]" : "pl-3.5"}`}>
      <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2">
        <img src={markUrl} alt="iClosed" className="block h-3.5 w-3.5 object-contain" />
        <span className="text-[12px] font-semibold text-strong">iClosed Billing</span>
      </div>
      {!isMac && (
      <div className="ic-no-drag flex items-center">
        <button
          onClick={() => api.windowMinimize()}
          aria-label="Minimize"
          className="flex h-7 w-10 items-center justify-center rounded-md text-[14px] text-[#64748B] hover:bg-[#EEF0F3]"
        >
          –
        </button>
        <button
          onClick={() => api.windowMaximize()}
          aria-label="Maximize"
          className="flex h-7 w-10 items-center justify-center rounded-md text-[10px] text-[#64748B] hover:bg-[#EEF0F3]"
        >
          ▢
        </button>
        <button
          onClick={() => api.windowClose()}
          aria-label="Close"
          className="flex h-7 w-10 items-center justify-center rounded-md text-[12px] text-[#64748B] hover:bg-[#EF4444] hover:text-white"
        >
          ✕
        </button>
      </div>
      )}
    </div>
  );
}
