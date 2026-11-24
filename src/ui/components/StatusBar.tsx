import * as React from "react";
import { Box, Text, useStdout } from "ink";
import { mutedProps, streamColor } from "../../core/theme";
import type { StreamStatus } from "../../core/types";
import { padR } from "../format";
import { useTheme } from "../theme/ThemeContext";

// Deliberately minimal. A status bar earns its line by carrying things that
// change what you do next — connection state, staleness, the current keymap —
// and nothing that is merely true.

/** One entry in the key legend: "s sort", or a plain label like "risk rules". */
export interface KeyHint {
  /** Empty for a label that is not a key. */
  key: string;
  label: string;
}

/** A single key, an arrow pair, a named key, or alternatives like "space/esc". */
const KEY_TOKEN = /^(?:[A-Za-z]|↑↓|⏎|esc|space|tab|\[\/\]|\S+\/\S+)$/;

/** "↑↓ select · s sort · risk rules" → keys and their labels. */
export function parseHints(hint: string): KeyHint[] {
  return hint
    .split(" · ")
    .filter((seg) => seg.trim())
    .map((seg) => {
      const space = seg.indexOf(" ");
      const first = space > 0 ? seg.slice(0, space) : "";
      return KEY_TOKEN.test(first) ? { key: first, label: seg.slice(space + 1) } : { key: "", label: seg };
    });
}

const hintWidth = (h: KeyHint): number => (h.key ? h.key.length + 1 : 0) + h.label.length;

/** Space between legend entries on one line, and the least between grid cells. */
const GAP = 2;

export interface FooterLayout {
  /** Everything on one line: the status on the left, the keys on the right. */
  inline: boolean;
  /** The keys in rows, when they go under the status line. */
  rows: KeyHint[][];
  /** Width of each grid cell, so the columns line up. */
  cell: number;
}

/**
 * Fit the key legend to the terminal without losing any of it.
 *
 * It used to be one line that dropped keys from the right until it fitted,
 * which on a narrow (say, vertical) screen hid most of them. Now, when the
 * status and every key fit on one line they share it; otherwise the keys go
 * under the status in a grid of equal cells, as many rows as it takes.
 */
export function layoutFooter(statusWidth: number, hints: KeyHint[], cols: number): FooterLayout {
  const inner = Math.max(1, cols - 2); // paddingX=1 each side
  const keysWidth = hints.reduce((n, h) => n + hintWidth(h), 0) + GAP * Math.max(0, hints.length - 1);
  if (hints.length === 0 || statusWidth + 3 + keysWidth <= inner) {
    return { inline: true, rows: hints.length ? [hints] : [], cell: 0 };
  }
  const cell = Math.max(...hints.map(hintWidth)) + GAP;
  // The last cell in a row needs no gap after it. Rows are then evened out,
  // so a wrap reads as 7 + 7 rather than 11 + 3.
  const most = Math.max(1, Math.floor((inner + GAP) / cell));
  const perRow = Math.ceil(hints.length / Math.ceil(hints.length / most));
  const rows: KeyHint[][] = [];
  for (let i = 0; i < hints.length; i += perRow) rows.push(hints.slice(i, i + perRow));
  return { inline: false, rows, cell };
}

/** The status line's text: connection, any note, positions and freshness. */
export function statusText(stream: StreamStatus, note: string | undefined, count: number, updatedAt: Date | null): {
  left: string;
  right: string;
} {
  // Seconds are dropped so the line stays short.
  const clock = updatedAt ? updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—";
  return {
    left: `stream ●${stream}` + (note ? `   ⚠ ${note}` : ""),
    right: `${count} pos · updated ${clock}`,
  };
}

/** Rows the status bar takes for this hint at this width. */
export function statusBarHeight(
  stream: StreamStatus,
  note: string | undefined,
  count: number,
  updatedAt: Date | null,
  hint: string,
  cols: number,
): number {
  const s = statusText(stream, note, count, updatedAt);
  const layout = layoutFooter(s.left.length + 3 + s.right.length, parseHints(hint), cols);
  return layout.inline ? 1 : 1 + layout.rows.length;
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
  const s = statusText(stream, note, count, updatedAt);
  const layout = layoutFooter(s.left.length + 3 + s.right.length, parseHints(hint), cols);

  const entry = (h: KeyHint, width: number) => (
    <Text key={h.key + h.label}>
      {h.key ? <Text bold>{h.key + " "}</Text> : null}
      <Text {...mutedProps(t)}>{padR(h.label, Math.max(0, width - (h.key ? h.key.length + 1 : 0)))}</Text>
    </Text>
  );

  const status = (
    <Text wrap="truncate-end">
      stream <Text color={streamColor(t, stream)}>●{stream}</Text>
      {note ? <Text color={t.warning}>{"   ⚠ " + note}</Text> : null}
      <Text {...mutedProps(t)}>{"   " + s.right}</Text>
    </Text>
  );

  if (layout.inline) {
    const keys = layout.rows[0] ?? [];
    return (
      <Box justifyContent="space-between" paddingX={1}>
        {status}
        <Text wrap="truncate-end">
          {keys.map((h, i) => (
            <React.Fragment key={h.key + h.label}>
              {i > 0 ? " ".repeat(GAP) : ""}
              {entry(h, hintWidth(h))}
            </React.Fragment>
          ))}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {status}
      {layout.rows.map((row, r) => (
        <Text key={r} wrap="truncate-end">
          {row.map((h, i) => entry(h, i === row.length - 1 ? hintWidth(h) : layout.cell))}
        </Text>
      ))}
    </Box>
  );
}
