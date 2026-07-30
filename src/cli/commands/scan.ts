// `toreda scan` — ranked opportunity signals, rule breaches, and discovery.

import { runScan } from "../../scanner";
import { printScan } from "../../scanner/report";
import { hasFlag, type ParsedArgs } from "../args";
import { printBanner } from "../banner";
import { c, err } from "../format";

export async function run(args: ParsedArgs): Promise<number> {
  const json = hasFlag(args, "json");
  const discovery = !hasFlag(args, "no-discovery");

  if (!json) printBanner();

  const result = await runScan({
    discovery,
    // Progress goes to stderr so `toreda scan > file` captures only the report,
    // and --json keeps stdout as pure, parseable JSON.
    onProgress: json ? undefined : (msg) => err(c.dim(`  ${msg}`)),
  });

  if (json) {
    process.stdout.write(JSON.stringify(result));
    return 0;
  }

  printScan(result);
  return 0;
}
