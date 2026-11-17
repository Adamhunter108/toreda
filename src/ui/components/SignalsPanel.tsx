import * as React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { actionColor, mutedProps } from "../../core/theme";
import type { OpportunitySignal } from "../../scanner/types";
import { useTheme } from "../theme/ThemeContext";

/**
 * Compact top-signals panel for the main dashboard.
 *
 * Manual-only: it prompts to scan until `r` is pressed, so the dashboard never
 * reaches out to news or social APIs on its own. Focusable like the watchlist.
 *
 * Once there is a list, it stays on screen through a rescan (the spinner moves
 * to the title) or a failed rescan (✗ in the title). Swapping the list for a
 * one-line "scanning…" collapsed the panel and shifted the whole right column
 * on every `r`.
 */
export function SignalsPanel({
  signals,
  scanned,
  scanning,
  error,
  minConf,
  focused = false,
  cursor = 0,
  rows = 6,
}: {
  /** Already sorted by confidence. */
  signals: OpportunitySignal[];
  scanned: boolean;
  scanning: boolean;
  error: string | null;
  minConf: number;
  focused?: boolean;
  cursor?: number;
  /** Signals listed at once; the window follows the cursor beyond that. */
  rows?: number;
}) {
  const t = useTheme();
  const ROWS = Math.max(1, rows);
  const cur = Math.min(cursor, Math.max(0, signals.length - 1));
  const start = focused
    ? Math.max(0, Math.min(cur - Math.floor(ROWS / 2), Math.max(0, signals.length - ROWS)))
    : 0;
  const view = signals.slice(start, start + ROWS);
  const below = signals.length - (start + ROWS);
  const hasList = scanned && signals.length > 0;

  // One status line until there is a list to show.
  let body: React.ReactNode = scanning ? (
    <Text color={t.warning}>
      <Spinner type="dots" /> scanning…
    </Text>
  ) : error ? (
    <Text color={t.negative}>scan failed — r to retry</Text>
  ) : !scanned ? (
    <Text {...mutedProps(t)}>press r to scan</Text>
  ) : (
    <Text {...mutedProps(t)}>no signals found · r rescan</Text>
  );
  if (hasList)
    body = (
      <>
        <Text {...mutedProps(t)}>{start > 0 ? " ↑ more…" : " "}</Text>
        {view.map((o, i) => {
          const sel = focused && start + i === cur;
          // Below the confidence line: shown but dimmed, rather than hidden.
          // A hidden signal and no signal look identical, and they are not.
          const dim = o.confidence < minConf;
          return (
            <Box key={o.symbol}>
              <Text color={sel ? t.accent : dim ? t.muted : undefined} bold={sel}>
                {sel ? "›" : " "}
                {o.symbol.padEnd(5)}
              </Text>
              <Text color={dim ? t.muted : t.info}>{`${o.confidence}/10`.padStart(5)}</Text>
              <Text color={dim ? t.muted : actionColor(t, o.action)}>
                {` ${o.action.toUpperCase()}`}
              </Text>
            </Box>
          );
        })}
        <Text {...mutedProps(t)}>{below > 0 ? ` ↓ ${below} more…` : " "}</Text>
      </>
    );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? t.accent : t.border}
      paddingX={1}
    >
      {/* Same title focused or not — see Watchlist. A focus hint here wrapped
          the title in the narrow right column and shifted the layout. */}
      <Text bold wrap="truncate-end">
        Signals
        {scanned ? (
          <Text {...mutedProps(t)}>
            {" "}
            {signals.length} · line ≥{minConf} ([/])
          </Text>
        ) : null}
        {hasList && scanning ? (
          <Text color={t.warning}>
            {" "}
            <Spinner type="dots" />
          </Text>
        ) : hasList && error ? (
          <Text color={t.negative}> ✗</Text>
        ) : null}
      </Text>
      {body}
    </Box>
  );
}
