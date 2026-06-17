import React from "react";
export interface Step { step: string; message: string }
export function StatusTimeline({ steps, done, failed }: { steps: Step[]; done: boolean; failed: boolean }) {
  return (
    <ol className="flex flex-col gap-[9px]">
      {steps.map((s, i) => {
        const isLast = i === steps.length - 1;
        // Finished steps are green. The current (last) step pulses navy while in
        // progress; red on failure; green once the whole run is done.
        const running = isLast && !done && !failed;
        const color = failed && isLast ? "#DC2626" : running ? "#031953" : "#15803D";
        return (
          <li key={i} className="flex items-start gap-[11px]">
            <span
              className={`mt-[3px] h-2 w-2 flex-shrink-0 rounded-full ${running ? "animate-icPulse" : ""}`}
              style={{ background: color }}
            />
            <span className="text-[10.5px] font-bold uppercase tracking-[.05em] text-muted">{s.step}</span>
            <span className="break-all text-[12.5px] text-strong">{s.message}</span>
          </li>
        );
      })}
    </ol>
  );
}
