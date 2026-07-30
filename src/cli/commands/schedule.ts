// `toreda schedule` — optional scheduled briefings.
//
// Never runs unless asked for. `install` writes the right thing for this
// platform, with the market-open and market-close times converted into LOCAL
// time first — see src/schedule/time.ts for why that conversion is not optional.

import { telegramFromEnv } from "../../briefing";
import {
  cronLine,
  detectPlatform,
  install,
  launchdPlist,
  schtasksArgs,
  status,
  systemdService,
  systemdTimer,
  uninstall,
  type Job,
  type Platform,
} from "../../schedule/backends";
import {
  dstDriftWarning,
  formatClock,
  MARKET_CLOSE,
  MARKET_OPEN,
  marketTimeIn,
} from "../../schedule/time";
import { hasFlag, type ParsedArgs } from "../args";
import { c, fail, out, warn } from "../format";

const PLATFORM_NAMES: Record<Platform, string> = {
  launchd: "launchd (macOS)",
  systemd: "systemd user timers (Linux)",
  cron: "cron (Linux)",
  schtasks: "Task Scheduler (Windows)",
  unsupported: "unsupported",
};

function jobs(): Job[] {
  return [
    { kind: "open", at: marketTimeIn(MARKET_OPEN) },
    { kind: "close", at: marketTimeIn(MARKET_CLOSE) },
  ];
}

async function doInstall(dryRun: boolean): Promise<number> {
  const platform = detectPlatform();
  if (platform === "unsupported") {
    fail(`Scheduling is not supported on ${process.platform}.`);
    return 1;
  }

  out(
    "",
    c.bold(dryRun ? "Scheduled briefings — dry run" : "Installing scheduled briefings"),
    c.dim(`  via ${PLATFORM_NAMES[platform]}`),
    "",
  );

  // Say plainly what local time each will fire, since that is the number people
  // check against their own clock — and the number that was wrong before.
  const list = jobs();
  for (const job of list) {
    const market = job.kind === "open" ? MARKET_OPEN : MARKET_CLOSE;
    out(
      `  ${job.kind.padEnd(6)} market ${formatClock(market)} New York  →  ` +
        `${c.bold(formatClock(job.at))} your local time, weekdays`,
    );
  }

  const drift = dstDriftWarning(MARKET_OPEN);
  if (drift) {
    out("");
    warn(drift);
  }

  if (!telegramFromEnv()) {
    out("");
    warn(
      "Telegram is not configured, so scheduled briefings will run but only write to the log.",
    );
    out(c.dim("      Configure delivery with: npm run toreda -- setup briefings"));
  }

  if (dryRun) {
    out("", c.dim("  Nothing was installed. This is what would be written:"), "");
    for (const job of list) {
      out(c.bold(`  ── ${job.kind} ──`));
      const artifact =
        platform === "launchd"
          ? launchdPlist(job)
          : platform === "systemd"
            ? `${systemdService(job)}\n${systemdTimer(job)}`
            : platform === "schtasks"
              ? `schtasks ${schtasksArgs(job).join(" ")}`
              : cronLine(job);
      out(
        artifact
          .split("\n")
          .map((l) => `  ${c.dim(l)}`)
          .join("\n"),
      );
      out("");
    }
    out(c.dim("  Install for real with: npm run toreda -- schedule install"), "");
    return 0;
  }

  out("");
  let failures = 0;
  for (const job of list) {
    const result = await install(job, platform);
    if (result.ok) {
      out(`  ${c.green("✓")} ${job.kind} briefing installed ${c.dim(result.detail)}`);
    } else {
      failures++;
      out(`  ${c.red("✗")} ${job.kind} briefing — ${result.detail}`);
    }
  }

  out("", c.dim("  Check any time with: npm run toreda -- schedule status"), "");
  return failures === 0 ? 0 : 1;
}

async function doStatus(): Promise<number> {
  const platform = detectPlatform();
  out("", c.bold("Scheduled briefings"), c.dim(`  ${PLATFORM_NAMES[platform]}`), "");

  let anyInstalled = false;
  for (const job of jobs()) {
    const s = await status(job.kind, platform);
    anyInstalled ||= s.installed;
    const mark = s.installed ? c.green("✓") : c.dim("○");
    const when = s.installed ? ` ${c.dim(`(local ${formatClock(job.at)})`)}` : "";
    out(`  ${mark} ${job.kind.padEnd(6)} ${s.detail}${when}`);
  }

  if (!anyInstalled) {
    // Not installed is a valid, common state — not a fault.
    out("", c.dim("  No schedule installed. That is fine: `toreda brief` works on demand."));
    out(c.dim("  To install: npm run toreda -- schedule install"));
  } else {
    const drift = dstDriftWarning(MARKET_OPEN);
    if (drift) {
      out("");
      warn(drift);
    }
  }
  out("");
  return 0;
}

async function doUninstall(): Promise<number> {
  const platform = detectPlatform();
  out("", c.bold("Removing scheduled briefings"), "");
  for (const job of jobs()) {
    const result = await uninstall(job.kind, platform);
    out(`  ${result.ok ? c.green("✓") : c.red("✗")} ${job.kind} — ${result.detail}`);
  }
  out("");
  return 0;
}

export async function run(args: ParsedArgs): Promise<number> {
  switch (args.positionals[0]) {
    case "install":
      return doInstall(hasFlag(args, "dry-run"));
    case "status":
    case undefined:
      return doStatus();
    case "uninstall":
    case "remove":
      return doUninstall();
    default:
      fail(
        `Unknown schedule subcommand: ${args.positionals[0]}\n` +
          "     Usage: toreda schedule install|status|uninstall",
      );
      return 1;
  }
}
