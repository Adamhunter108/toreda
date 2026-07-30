// Where a briefing goes.
//
// Four independent channels, none required. `toreda brief` with no flags prints
// to your terminal and stops there. The source project bundled generation,
// Telegram, and scheduling into one feature because only one combination was
// ever wanted; here they come apart, so "log a briefing to a file on a schedule
// with no bot involved" is a first-class option rather than an awkward one.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { logsDir } from "../core/paths";
import { escapeHtml, sendMessage, type TelegramCredentials } from "./telegram";

export interface Channels {
  stdout: boolean;
  file?: string;
  notify: boolean;
  telegram?: TelegramCredentials;
}

export interface DeliveryReport {
  delivered: string[];
  failed: Array<{ channel: string; error: string }>;
}

/**
 * A desktop notification, on whichever platform this is.
 *
 * The source project called `osascript` directly, which silently did nothing
 * anywhere but macOS. Never throws: a missing notifier is a non-event, not a
 * reason to fail a briefing that already succeeded.
 */
export function notify(title: string, body: string): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean): void => resolve(ok);
    const oneLine = body.replace(/\n/g, " ").slice(0, 200);

    if (process.platform === "darwin") {
      execFile(
        "osascript",
        ["-e", `display notification ${JSON.stringify(oneLine)} with title ${JSON.stringify(title)}`],
        (err) => done(!err),
      );
    } else if (process.platform === "linux") {
      execFile("notify-send", [title, oneLine], (err) => done(!err));
    } else if (process.platform === "win32") {
      const script =
        `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null; ` +
        `Write-Output ${JSON.stringify(`${title}: ${oneLine}`)}`;
      execFile("powershell", ["-NoProfile", "-Command", script], (err) => done(!err));
    } else {
      done(false);
    }
  });
}

/** Where an undelivered failure alert waits for the next successful run. */
function pendingAlertFile(): string {
  return join(logsDir(), ".pending-alert");
}

/**
 * Queue an alert that could not be delivered.
 *
 * The report of a network failure travels over the same network that just
 * failed, so on 2026-07-24 the alert failed too and the failure was completely
 * silent. Writing it to disk means the next successful run delivers it late
 * rather than never.
 */
export function queuePendingAlert(message: string): void {
  try {
    mkdirSync(logsDir(), { recursive: true });
    writeFileSync(pendingAlertFile(), message);
  } catch {
    /* best effort — this is already the fallback path */
  }
}

export function takePendingAlert(): string | null {
  const file = pendingAlertFile();
  try {
    if (!existsSync(file)) return null;
    const text = readFileSync(file, "utf8");
    rmSync(file, { force: true });
    return text.trim() || null;
  } catch {
    return null;
  }
}

/** Append a plain-text copy to a log file. */
function appendToFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${text}\n---\n`);
}

export interface BriefingContent {
  header: string;
  summary: string;
  table: string;
  commentary: string | null;
  notes: string[];
}

/** Plain text, for the terminal and for a log file. */
export function renderPlain(content: BriefingContent): string {
  const parts = [content.header, content.summary, "", content.table];
  if (content.commentary) parts.push("", content.commentary);
  if (content.notes.length > 0) parts.push("", ...content.notes.map((n) => `note: ${n}`));
  return parts.join("\n");
}

/** Telegram HTML: the table in a <pre> block so its columns survive. */
export function renderHtml(content: BriefingContent): string {
  const parts = [
    escapeHtml(content.header),
    escapeHtml(content.summary),
    "",
    `<pre>${escapeHtml(content.table)}</pre>`,
  ];
  if (content.commentary) parts.push("", escapeHtml(content.commentary));
  if (content.notes.length > 0) {
    parts.push("", ...content.notes.map((n) => escapeHtml(`note: ${n}`)));
  }
  return parts.join("\n");
}

export async function deliver(
  content: BriefingContent,
  channels: Channels,
): Promise<DeliveryReport> {
  const report: DeliveryReport = { delivered: [], failed: [] };
  const plain = renderPlain(content);

  if (channels.stdout) {
    process.stdout.write(`\n${plain}\n\n`);
    report.delivered.push("terminal");
  }

  if (channels.file) {
    try {
      appendToFile(channels.file, plain);
      report.delivered.push(`file (${channels.file})`);
    } catch (err) {
      report.failed.push({
        channel: "file",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (channels.notify) {
    const ok = await notify(content.header, content.summary);
    if (ok) report.delivered.push("desktop notification");
    else report.failed.push({ channel: "notify", error: "no notifier available" });
  }

  if (channels.telegram) {
    // Deliver any alert that a previous run could not send, before today's
    // briefing — late, but not lost.
    const pending = takePendingAlert();
    if (pending) {
      await sendMessage(
        channels.telegram,
        `🔁 CATCH-UP of an alert that could not be sent at the time:\n\n${pending}`,
      );
    }

    const res = await sendMessage(channels.telegram, renderHtml(content), { html: true });
    if (res.ok) report.delivered.push("Telegram");
    else report.failed.push({ channel: "Telegram", error: res.error ?? "unknown" });
  }

  return report;
}

/**
 * Report a failed briefing everywhere that might still work.
 *
 * Silence is ambiguous — it looks exactly like a quiet day. An alert is not.
 */
export async function reportFailure(
  reason: string,
  channels: Channels,
  at = new Date(),
): Promise<void> {
  const message =
    `⚠️ Briefing FAILED — ${at.toLocaleString()}\n${reason}\n` +
    `No briefing was generated. Your positions are UNKNOWN, not flat.`;

  if (channels.stdout) process.stderr.write(`\n${message}\n\n`);
  if (channels.file) {
    try {
      appendToFile(channels.file, message);
    } catch {
      /* ignore */
    }
  }

  let telegramDelivered = false;
  if (channels.telegram) {
    telegramDelivered = (await sendMessage(channels.telegram, message)).ok;
  }

  // The alert travels the same path that just failed. If it could not get out,
  // fall back to something that needs no network at all, and queue it.
  if (channels.telegram && !telegramDelivered) {
    queuePendingAlert(message);
    await notify("⚠️ Briefing FAILED", "Positions are UNKNOWN. See toreda logs.");
  }
}
