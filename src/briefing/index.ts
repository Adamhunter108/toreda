// Briefing orchestration.

import { getClock } from "../core/alpaca";
import { readEnv } from "../core/config";
import { runScan } from "../scanner";
import { printScan } from "../scanner/report";
import {
  BriefingAbort,
  buildSummary,
  buildTable,
  gather,
  headerFor,
  type BriefingKind,
} from "./build";
import { generateCommentary } from "./commentary";
import { deliver, reportFailure, type BriefingContent, type Channels } from "./deliver";
import type { TelegramCredentials } from "./telegram";

export type { BriefingKind } from "./build";

export interface BriefOptions {
  kind: BriefingKind;
  channels: Channels;
  /** Include the opportunity scan. Defaults to true for `open`. */
  scan?: boolean;
  /** Skip the market-hours sanity check. */
  force?: boolean;
}

export interface BriefResult {
  ok: boolean;
  delivered: string[];
  failed: Array<{ channel: string; error: string }>;
  notes: string[];
}

/** Telegram credentials from .env, or null when not configured. */
export function telegramFromEnv(): TelegramCredentials | null {
  const env = readEnv();
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

/**
 * Capture the scanner's human-readable report as a string.
 *
 * The commentary model reads the same text a person would, rather than raw
 * JSON — the report already explains its own scoring, and re-deriving that in
 * a prompt is how the two descriptions drift apart.
 */
async function scanSummary(): Promise<{ text: string; degraded: string[] }> {
  const result = await runScan({ discovery: false });
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (chunk: unknown): boolean => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    printScan(result);
  } finally {
    (process.stdout as { write: unknown }).write = original;
  }
  // Strip ANSI so the model is not reading escape codes as content.
  // eslint-disable-next-line no-control-regex
  const text = chunks.join("").replace(/\x1b\[[0-9;]*m/g, "");
  return { text, degraded: result.degraded };
}

export async function runBriefing(options: BriefOptions): Promise<BriefResult> {
  const { kind, channels } = options;
  const notes: string[] = [];

  try {
    // A "market open" briefing sent while the market is shut is a scheduling
    // bug wearing a briefing's clothes — most likely a timezone mistake in the
    // installed schedule. Say so rather than quietly reporting stale prices.
    if (!options.force) {
      try {
        const clock = await getClock();
        if (kind === "open" && !clock.isOpen) {
          notes.push(
            "the market is CLOSED — these are last-session prices. " +
              "If this was a scheduled run, check `toreda schedule status`.",
          );
        }
      } catch {
        /* the clock is a nicety; never fail a briefing on it */
      }
    }

    const { account, positions, flows } = await gather();
    const summary = buildSummary(account, flows);
    const table = buildTable(positions);

    let scanText = "";
    if (options.scan ?? kind === "open") {
      try {
        const scan = await scanSummary();
        scanText = scan.text;
        notes.push(...scan.degraded);
      } catch (err) {
        notes.push(
          `opportunity scan unavailable (${err instanceof Error ? err.message.slice(0, 60) : "unknown"})`,
        );
      }
    }

    const data = `ACCOUNT: ${summary}\n\nPOSITIONS:\n${table}\n\nOPPORTUNITY SCANNER:\n${scanText || "(not run)"}`;
    const commentary = await generateCommentary(kind, data);
    if (commentary.reason) notes.push(commentary.reason);

    const content: BriefingContent = {
      header: headerFor(kind),
      summary,
      table,
      commentary: commentary.text,
      notes,
    };

    const report = await deliver(content, channels);
    return {
      ok: report.failed.length === 0,
      delivered: report.delivered,
      failed: report.failed,
      notes,
    };
  } catch (err) {
    const reason =
      err instanceof BriefingAbort ? err.message : err instanceof Error ? err.message : String(err);
    await reportFailure(reason, channels);
    return { ok: false, delivered: [], failed: [{ channel: "briefing", error: reason }], notes };
  }
}
