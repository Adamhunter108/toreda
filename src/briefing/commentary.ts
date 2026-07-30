// Written commentary from Claude, wrapped around the data.
//
// Entirely optional: without a token the briefing still goes out carrying the
// numbers alone. That degradation is deliberate — commentary is the nice part,
// the positions table is the necessary part, and losing the former must never
// cost you the latter.

import { execFile } from "node:child_process";
import { COLUMN_MEANINGS, type BriefingKind } from "./build";

const OPEN_ASK = `Write a short MARKET-OPEN commentary (6-9 lines) for the trader. The
portfolio summary and a positions table are shown separately, so DO NOT repeat
the table. Focus on: today's stance, the top 1-2 opportunity signals with a
one-line rationale, and any position to watch. Output PLAIN TEXT ONLY — no
markdown, no asterisks, no tables, no headers.`;

const CLOSE_ASK = `Write a short MARKET-CLOSE commentary (5-8 lines) for the trader. The
portfolio summary and a positions table are shown separately, so DO NOT repeat
the table. Focus on: the best and worst position TODAY — rank these by the DAY
column only — and a one-line outlook for tomorrow. Output PLAIN TEXT ONLY — no
markdown, no asterisks, no tables.`;

/** Text that means the CLI ran but could not authenticate. */
const AUTH_FAILURE = /Failed to authenticate|OAuth session expired|Invalid API key/i;

export interface CommentaryResult {
  text: string | null;
  /** Why it was skipped or failed, for the degraded-sources note. */
  reason?: string;
}

/**
 * Ask Claude for prose. Never throws.
 *
 * Guards on BOTH the exit code and the known auth-failure text, because the CLI
 * prints that message to stdout — so without the text check it would be
 * captured as "commentary" and delivered to Telegram as though it were analysis.
 */
export function generateCommentary(
  kind: BriefingKind,
  data: string,
  options: { token?: string; timeoutMs?: number } = {},
): Promise<CommentaryResult> {
  const token = options.token ?? process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) {
    return Promise.resolve({
      text: null,
      reason: "no CLAUDE_CODE_OAUTH_TOKEN — sending data without commentary",
    });
  }

  const ask = `${kind === "open" ? OPEN_ASK : CLOSE_ASK}\n\n${COLUMN_MEANINGS}\n\nDATA:\n${data}`;

  return new Promise((resolve) => {
    const child = execFile(
      "claude",
      ["-p", "--allowedTools", ""],
      {
        timeout: options.timeoutMs ?? 120_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token },
      },
      (err, stdout) => {
        if (err) {
          const notInstalled = (err as NodeJS.ErrnoException).code === "ENOENT";
          resolve({
            text: null,
            reason: notInstalled
              ? "the `claude` command is not installed — sending data without commentary"
              : `claude failed (${err.message.slice(0, 80)}) — sending data without commentary`,
          });
          return;
        }
        const text = stdout.trim();
        if (!text || AUTH_FAILURE.test(text)) {
          resolve({
            text: null,
            reason: "claude could not authenticate — sending data without commentary",
          });
          return;
        }
        resolve({ text });
      },
    );

    child.stdin?.end(ask);
  });
}
