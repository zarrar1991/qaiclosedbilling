import React from "react";
export interface Step { step: string; message: string }
export function StatusTimeline({ steps, done, failed }: { steps: Step[]; done: boolean; failed: boolean }) {
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const isLast = i === steps.length - 1;
        // Each finished step is green. The current (last) step pulses while in
        // progress; on failure it turns red, and when the whole run is done the
        // last step is green too.
        const dot =
          failed && isLast
            ? "bg-rose-400"
            : isLast && !done
              ? "bg-sky-400 animate-pulse"
              : "bg-emerald-400";
        return (
          <li key={i} className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
            <span className="text-xs uppercase tracking-wide text-slate-500">{s.step}</span>
            <span className="text-sm text-slate-200">{s.message}</span>
          </li>
        );
      })}
    </ol>
  );
}
