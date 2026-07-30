import * as React from "react";
import { Box, Text } from "ink";
import type { Snapshot } from "../../core/market-data";
import { mutedProps } from "../../core/theme";
import { useTheme } from "../theme/ThemeContext";

/**
 * The watchlist ranked by absolute move today (pre-sorted by the caller).
 *
 * When focused via Tab, ↑↓ move a cursor and `o` orders the highlighted name.
 */
export function Watchlist({
  movers,
  rows = 12,
  cursor = 0,
  focused = false,
}: {
  movers: Snapshot[];
  rows?: number;
  cursor?: number;
  focused?: boolean;
}) {
  const t = useTheme();
  const cur = Math.min(cursor, Math.max(0, movers.length - 1));
  // The window follows the cursor when focused; otherwise it shows from the top.
  const start = focused
    ? Math.max(0, Math.min(cur - Math.floor(rows / 2), Math.max(0, movers.length - rows)))
    : 0;
  const view = movers.slice(start, start + rows);
  const below = movers.length - (start + rows);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? t.accent : t.border}
      paddingX={1}
    >
      <Text bold>
        Watchlist <Text {...mutedProps(t)}>Δ today{focused ? " · ↑↓ · o order" : ""}</Text>
      </Text>

      {movers.length === 0 ? (
        <Text {...mutedProps(t)}>loading…</Text>
      ) : (
        <>
          <Text {...mutedProps(t)}>{start > 0 ? " ↑ more…" : " "}</Text>
          {view.map((m, i) => {
            const sel = focused && start + i === cur;
            const up = m.changePct >= 0;
            const chg = `${up ? "▲" : "▼"} ${up ? "+" : ""}${m.changePct.toFixed(2)}%`;
            return (
              <Box key={m.symbol}>
                <Text color={sel ? t.accent : undefined} bold={sel}>
                  {sel ? "›" : " "}
                  {m.symbol.padEnd(5)}
                </Text>
                <Text color={up ? t.positive : t.negative}>{chg.padEnd(10)}</Text>
                <Text {...mutedProps(t)}>{`$${m.price.toFixed(2)}`.padStart(9)}</Text>
              </Box>
            );
          })}
          <Text {...mutedProps(t)}>{below > 0 ? ` ↓ ${below} more…` : " "}</Text>
        </>
      )}
    </Box>
  );
}
