import * as React from "react";
import { Box, Text, useStdout } from "ink";
import { mutedProps, streamColor } from "../../core/theme";
import type { StreamStatus } from "../../core/types";
import { useTheme } from "../theme/ThemeContext";

// Deliberately minimal. A status bar earns its line by carrying things that
// change what you do next — connection state, staleness, the current keymap —
// and nothing that is merely true.

/**
 * Drop hint segments from the right until the bar fits.
 *
 * Ink clips an overflowing row mid-character, which produced
 * "stream ●connectin1 pos" — two independent readings fused into one
 * meaningless token. Dropping whole segments degrades legibly instead: you lose
 * the least important keybinding, not the connection status.
 */
export function fitHint(hint: string, available: number): string {
  if (available <= 0) return "";
  if (hint.length <= available) return hint;

  const segments = hint.split(" · ");
  while (segments.length > 1) {
    segments.pop();
    const joined = segments.join(" · ") + " …";
    if (joined.length <= available) return joined;
  }
  return (segments[0] ?? "").slice(0, Math.max(0, available));
}

export function StatusBar({
  stream,
  updatedAt,
  count,
  hint,
  note,
}: {
  stream: StreamStatus;
  updatedAt: Date | null;
  count: number;
  hint: string;
  /** A transient warning, e.g. "reconnecting". */
  note?: string;
}) {
  const t = useTheme();
  const { stdout } = useStdout();
  const cols = Number(process.env.DASH_COLS) || stdout?.columns || 80;

  // Seconds are dropped so the bar does not overflow at 80 columns.
  const clock = updatedAt
    ? updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "—";

  const left = `stream ●${stream}` + (note ? `   ⚠ ${note}` : "");
  const prefix = `${count} pos · updated ${clock} · `;
  // paddingX=1 each side, plus a space between the two halves.
  const available = cols - left.length - prefix.length - 3;
  const shownHint = fitHint(hint, available);

  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text>
        stream <Text color={streamColor(t, stream)}>●{stream}</Text>
        {note ? <Text color={t.warning}>{"   ⚠ " + note}</Text> : null}
      </Text>
      <Text {...mutedProps(t)}>
        {prefix}
        {shownHint}
      </Text>
    </Box>
  );
}
