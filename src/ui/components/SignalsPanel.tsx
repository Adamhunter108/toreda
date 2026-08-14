import * as React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { actionColor, mutedProps } from "../../core/theme";
import type { OpportunitySignal } from "../../scanner/types";
import { useTheme } from "../theme/ThemeContext";

const ROWS = 6;

/**
 * Compact top-signals panel for the main dashboard.
 *
 * Manual-only: it prompts to scan until `r` is pressed, so the dashboard never
 * reaches out to news or social APIs on its own. Focusable like the watchlist.
 */
export function SignalsPanel({
  signals,
  scanned,
  scanning,
  error,
  minConf,
  focused = false,
  cursor = 0,
}: {
  /** Already sorted by confidence. */
  signals: OpportunitySignal[];
  scanned: boolean;
  scanning: boolean;
  error: string | null;
  minConf: number;
  focused?: boolean;
  cursor?: number;
}) {
  const t = useTheme();
  const cur = Math.min(cursor, Math.max(0, signals.length - 1));
  const start = focused
    ? Math.max(0, Math.min(cur - Math.floor(ROWS / 2), Math.max(0, signals.length - ROWS)))
    : 0;
  const view = signals.slice(start, start + ROWS);
  const below = signals.length - (start + ROWS);

  let body: React.ReactNode;
  if (scanning)
    body = (
      <Text color={t.warning}>
        <Spinner type="dots" /> scanning…
      </Text>
    );
  else if (error) body = <Text color={t.negative}>scan failed — r to retry</Text>;
  else if (!scanned) body = <Text {...mutedProps(t)}>press r to scan</Text>;
  else if (signals.length === 0)
    body = <Text {...mutedProps(t)}>no signals found · r rescan</Text>;
  else
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
      <Text bold>
        Signals
        {scanned ? (
          <Text {...mutedProps(t)}>
            {" "}
            {signals.length} · line ≥{minConf} ([/]){focused ? " · ↑↓ · o" : ""}
          </Text>
        ) : null}
      </Text>
      {body}
    </Box>
  );
}
