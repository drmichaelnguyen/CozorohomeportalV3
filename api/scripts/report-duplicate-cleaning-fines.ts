/**
 * Report-only diagnostic for duplicate cleaning fines.
 * Usage (from api/): npx tsx scripts/report-duplicate-cleaning-fines.ts
 *
 * Defaults to dry-run / report-only. No cleanup mode is available in this script.
 */
import "dotenv/config";

import { reportDuplicateCleaningFines } from "../src/cleaning-fine-diagnostics.js";

async function main() {
  const mutateRequested = process.argv.includes("--cleanup") || process.argv.includes("--mutate");
  if (mutateRequested) {
    console.error(
      "Cleanup/mutate mode is not enabled. This utility is report-only. Re-run without --cleanup/--mutate."
    );
    process.exitCode = 2;
    return;
  }

  const report = await reportDuplicateCleaningFines();
  console.log(JSON.stringify(report, null, 2));
  console.log(
    `\nSummary: duplicateTaskIdGroups=${report.summary.duplicateTaskIdGroups}` +
      ` duplicateEvasionGroups=${report.summary.duplicateEvasionGroups}` +
      ` orphanActionLogCreations=${report.summary.orphanActionLogCreations}`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
