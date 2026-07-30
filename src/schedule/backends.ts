// Per-platform scheduler backends.
//
// Every one of these takes a local time computed by time.ts, never a hard-coded
// market time — see the note at the top of that module for why.
//
// Every path and label here is generated at install time from the paths this
// checkout actually occupies. Hand-written scheduler files tend to hard-code an
// absolute home directory and a personal label, which works in exactly one
// clone — and fails silently in every other, since a job that never fires looks
// identical to a quiet market.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";
import { REPO_ROOT, logsDir } from "../core/paths";
import { formatClock, type ClockTime } from "./time";

const run = promisify(execFile);

export type Platform = "launchd" | "systemd" | "cron" | "schtasks" | "unsupported";

export interface Job {
  /** "open" or "close". */
  kind: string;
  /** Local wall-clock time to fire. */
  at: ClockTime;
}

export interface JobStatus {
  kind: string;
  installed: boolean;
  detail: string;
}

export function detectPlatform(): Platform {
  if (process.platform === "darwin") return "launchd";
  if (process.platform === "win32") return "schtasks";
  if (process.platform === "linux") return "systemd"; // cron is the fallback
  return "unsupported";
}

/** The command a scheduled job runs. */
export function briefCommand(kind: string): { program: string; args: string[] } {
  return {
    program: process.execPath,
    args: [join(REPO_ROOT, "bin", "toreda.mjs"), "brief", kind, "--telegram"],
  };
}

const LABEL_PREFIX = "com.toreda.briefing";

// ── launchd (macOS) ─────────────────────────────────────────────────────────

function launchdLabel(kind: string): string {
  return `${LABEL_PREFIX}-${kind}`;
}

function launchdPlistPath(kind: string): string {
  return join(homedir(), "Library", "LaunchAgents", `${launchdLabel(kind)}.plist`);
}

export function launchdPlist(job: Job): string {
  const { program, args } = briefCommand(job.kind);
  const logDir = logsDir();
  // Weekdays only: the market is shut at the weekend and a briefing that says
  // so every Saturday trains you to ignore the whole channel.
  const weekdays = [1, 2, 3, 4, 5]
    .map(
      (d) =>
        `    <dict><key>Weekday</key><integer>${d}</integer>` +
        `<key>Hour</key><integer>${job.at.hour}</integer>` +
        `<key>Minute</key><integer>${job.at.minute}</integer></dict>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${launchdLabel(job.kind)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${program}</string>
${args.map((a) => `    <string>${a}</string>`).join("\n")}
  </array>
  <key>StartCalendarInterval</key>
  <array>
${weekdays}
  </array>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${join(logDir, "briefing.log")}</string>
  <key>StandardErrorPath</key>
  <string>${join(logDir, "briefing.err.log")}</string>
  <key>WorkingDirectory</key>
  <string>${REPO_ROOT}</string>
</dict>
</plist>
`;
}

// ── systemd (Linux) ─────────────────────────────────────────────────────────

function systemdUnitDir(): string {
  return join(homedir(), ".config", "systemd", "user");
}

export function systemdService(job: Job): string {
  const { program, args } = briefCommand(job.kind);
  return `[Unit]
Description=toreda market ${job.kind} briefing

[Service]
Type=oneshot
WorkingDirectory=${REPO_ROOT}
ExecStart=${program} ${args.join(" ")}
`;
}

export function systemdTimer(job: Job): string {
  return `[Unit]
Description=toreda market ${job.kind} briefing timer

[Timer]
OnCalendar=Mon..Fri *-*-* ${formatClock(job.at)}:00
Persistent=false

[Install]
WantedBy=timers.target
`;
}

// ── cron (Linux fallback) ───────────────────────────────────────────────────

export function cronLine(job: Job): string {
  const { program, args } = briefCommand(job.kind);
  return (
    `${job.at.minute} ${job.at.hour} * * 1-5 cd ${REPO_ROOT} && ` +
    `${program} ${args.join(" ")} >> ${join(logsDir(), "briefing.log")} 2>&1` +
    `  # ${LABEL_PREFIX}-${job.kind}`
  );
}

// ── Task Scheduler (Windows) ────────────────────────────────────────────────

export function schtasksName(kind: string): string {
  return `toreda-briefing-${kind}`;
}

export function schtasksArgs(job: Job): string[] {
  const { program, args } = briefCommand(job.kind);
  return [
    "/Create",
    "/F",
    "/TN",
    schtasksName(job.kind),
    "/SC",
    "WEEKLY",
    "/D",
    "MON,TUE,WED,THU,FRI",
    "/ST",
    formatClock(job.at),
    "/TR",
    `"${program}" ${args.map((a) => `"${a}"`).join(" ")}`,
  ];
}

// ── Install / uninstall / status ────────────────────────────────────────────

export interface InstallResult {
  ok: boolean;
  detail: string;
}

export async function install(job: Job, platform = detectPlatform()): Promise<InstallResult> {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(logsDir(), { recursive: true });

  switch (platform) {
    case "launchd": {
      const path = launchdPlistPath(job.kind);
      mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
      writeFileSync(path, launchdPlist(job));
      // Unload first so a re-install replaces rather than errors.
      await run("launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}/${launchdLabel(job.kind)}`]).catch(
        () => undefined,
      );
      try {
        await run("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 0}`, path]);
        return { ok: true, detail: path };
      } catch (err) {
        return {
          ok: false,
          detail: `wrote ${path} but launchctl refused it: ${err instanceof Error ? err.message.slice(0, 120) : err}`,
        };
      }
    }

    case "systemd": {
      const dir = systemdUnitDir();
      mkdirSync(dir, { recursive: true });
      const base = `${LABEL_PREFIX}-${job.kind}`;
      writeFileSync(join(dir, `${base}.service`), systemdService(job));
      writeFileSync(join(dir, `${base}.timer`), systemdTimer(job));
      try {
        await run("systemctl", ["--user", "daemon-reload"]);
        await run("systemctl", ["--user", "enable", "--now", `${base}.timer`]);
        return { ok: true, detail: join(dir, `${base}.timer`) };
      } catch (err) {
        return {
          ok: false,
          detail: `wrote units to ${dir} but systemctl failed: ${err instanceof Error ? err.message.slice(0, 120) : err}`,
        };
      }
    }

    case "schtasks":
      try {
        await run("schtasks", schtasksArgs(job));
        return { ok: true, detail: schtasksName(job.kind) };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message.slice(0, 160) : String(err) };
      }

    case "cron":
      return {
        ok: false,
        detail: `add this line to your crontab (\`crontab -e\`):\n    ${cronLine(job)}`,
      };

    default:
      return { ok: false, detail: `scheduling is not supported on ${process.platform}` };
  }
}

export async function uninstall(kind: string, platform = detectPlatform()): Promise<InstallResult> {
  const { rmSync } = await import("node:fs");

  switch (platform) {
    case "launchd": {
      await run("launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}/${launchdLabel(kind)}`]).catch(
        () => undefined,
      );
      rmSync(launchdPlistPath(kind), { force: true });
      return { ok: true, detail: `removed ${launchdLabel(kind)}` };
    }
    case "systemd": {
      const base = `${LABEL_PREFIX}-${kind}`;
      await run("systemctl", ["--user", "disable", "--now", `${base}.timer`]).catch(() => undefined);
      rmSync(join(systemdUnitDir(), `${base}.timer`), { force: true });
      rmSync(join(systemdUnitDir(), `${base}.service`), { force: true });
      await run("systemctl", ["--user", "daemon-reload"]).catch(() => undefined);
      return { ok: true, detail: `removed ${base}` };
    }
    case "schtasks":
      try {
        await run("schtasks", ["/Delete", "/F", "/TN", schtasksName(kind)]);
        return { ok: true, detail: `removed ${schtasksName(kind)}` };
      } catch {
        return { ok: true, detail: `no task named ${schtasksName(kind)}` };
      }
    default:
      return { ok: false, detail: "nothing to remove on this platform" };
  }
}

export async function status(kind: string, platform = detectPlatform()): Promise<JobStatus> {
  switch (platform) {
    case "launchd":
      try {
        const { stdout } = await run("launchctl", [
          "print",
          `gui/${process.getuid?.() ?? 0}/${launchdLabel(kind)}`,
        ]);
        const next = /next fire date = (.+)/.exec(stdout)?.[1]?.trim();
        return { kind, installed: true, detail: next ? `next run ${next}` : "loaded" };
      } catch {
        return { kind, installed: false, detail: "not installed" };
      }

    case "systemd":
      try {
        const { stdout } = await run("systemctl", [
          "--user",
          "list-timers",
          `${LABEL_PREFIX}-${kind}.timer`,
          "--no-pager",
        ]);
        const installed = stdout.includes(`${LABEL_PREFIX}-${kind}`);
        return { kind, installed, detail: installed ? "timer active" : "not installed" };
      } catch {
        return { kind, installed: false, detail: "not installed" };
      }

    case "schtasks":
      try {
        await run("schtasks", ["/Query", "/TN", schtasksName(kind)]);
        return { kind, installed: true, detail: "task registered" };
      } catch {
        return { kind, installed: false, detail: "not installed" };
      }

    default:
      return { kind, installed: false, detail: "unsupported platform" };
  }
}
