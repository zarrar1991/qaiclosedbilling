import type { RunReport } from "./types.js";
import { computeStatus, printReport, saveReport } from "./report.js";

export async function buildAndFinalizeReport(
  fields: Omit<RunReport, "timestamp" | "status">,
): Promise<RunReport> {
  const report: RunReport = {
    ...fields,
    timestamp: new Date().toISOString(),
    status: "FAIL",
  };
  report.status = computeStatus(report);
  printReport(report);
  const { jsonPath, txtPath } = saveReport(report);
  console.log(`Report saved:\n  ${jsonPath}\n  ${txtPath}`);
  return report;
}
