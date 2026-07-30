// `toreda brief` — a market briefing.
//
//   toreda brief                 print an open briefing to your terminal
//   toreda brief close           the close version
//   toreda brief --out FILE      also append to a log file
//   toreda brief --notify        also raise a desktop notification
//   toreda brief --telegram      also send to Telegram
//
// With no flags it prints and stops. Delivery channels are additive and each is
// configured independently, so none of them is a prerequisite for any other.

import { runBriefing, telegramFromEnv, type BriefingKind } from "../../briefing";
import type { Channels } from "../../briefing/deliver";
import { flagValue, hasFlag, type ParsedArgs } from "../args";
import { c, fail, out } from "../format";

export async function run(args: ParsedArgs): Promise<number> {
  const positional = args.positionals[0];
  if (positional !== undefined && positional !== "open" && positional !== "close") {
    fail(`Unknown briefing kind: ${positional}\n     Usage: toreda brief [open|close] [--out FILE] [--notify] [--telegram]`);
    return 1;
  }
  const kind: BriefingKind = positional === "close" ? "close" : "open";

  const wantTelegram = hasFlag(args, "telegram");
  const telegram = wantTelegram ? telegramFromEnv() : null;
  if (wantTelegram && !telegram) {
    fail(
      "Telegram was requested but is not configured.\n" +
        "     Set it up with: npm run toreda -- setup briefings\n" +
        "     Or drop --telegram to print the briefing here instead.",
    );
    return 1;
  }

  // stdout is on unless the briefing is going somewhere else and quiet is asked
  // for — a scheduled run does not need to write to a log nobody reads.
  const channels: Channels = {
    stdout: !hasFlag(args, "quiet"),
    notify: hasFlag(args, "notify"),
    ...(flagValue(args, "out") ? { file: flagValue(args, "out")! } : {}),
    ...(telegram ? { telegram } : {}),
  };

  const result = await runBriefing({
    kind,
    channels,
    force: hasFlag(args, "force"),
    ...(hasFlag(args, "no-scan") ? { scan: false } : {}),
  });

  if (result.delivered.length > 0) {
    out(c.dim(`  delivered to: ${result.delivered.join(", ")}`));
  }
  for (const failure of result.failed) {
    out(`  ${c.red("✗")} ${failure.channel}: ${failure.error}`);
  }
  return result.ok ? 0 : 1;
}
