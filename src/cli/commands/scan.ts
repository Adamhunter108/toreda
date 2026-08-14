// `toreda scan` — ranked opportunity signals, rule breaches, and discovery.

import { runScan } from "../../scanner";
import { printScan } from "../../scanner/report";
import { hasFlag, type ParsedArgs } from "../args";
import { printBanner } from "../banner";
import { startScanProgress } from "../scan-progress";

export async function run(args: ParsedArgs): Promise<number> {
  const json = hasFlag(args, "json");
  const discovery = !hasFlag(args, "no-discovery");

  if (!json) printBanner();

  // Progress goes to stderr so `toreda scan > file` captures only the report,
  // and --json keeps stdout as pure, parseable JSON — so --json gets no
  // progress reporting at all.
  const progress = json ? null : startScanProgress();

  let result;
  try {
    result = await runScan({
      discovery,
      onProgress: progress?.onProgress,
    });
  } finally {
    // A mounted Ink tree holds the event loop open. Tearing it down on the
    // error path is what keeps a failed scan reporting its error rather than
    // hanging with a spinner still turning.
    progress?.stop();
  }

  if (json) {
    process.stdout.write(JSON.stringify(result));
    return 0;
  }

  printScan(result);
  return 0;
}
