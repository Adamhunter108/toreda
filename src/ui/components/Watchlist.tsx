import * as React from "react";
import { Box, Text } from "ink";
import type { Snapshot } from "../../core/market-data";
import { mutedProps } from "../../core/theme";
import { humanNum } from "../format";
import { useTheme } from "../theme/ThemeContext";

/**
 * The watchlist ranked by absolute move today (pre-sorted by the caller).
 *
 * When focused via Tab, ↑↓ move a cursor and `o` orders the highlighted name.
 * Zoomed (space), it has the width for `detail`: what you hold, the previous
 * close, volume against the last full session, and the sector.
 */
export function Watchlist({
  movers,
  rows = 12,
  cursor = 0,
  focused = false,
  detail,
}: {
  movers: Snapshot[];
  rows?: number;
  cursor?: number;
  focused?: boolean;
  detail?: { sectorOf: Record<string, string>; held: ReadonlySet<string> };
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
      {/* The title never changes with focus: in the 34-column right column a
          focus hint wrapped it onto a second line, and the whole column
          shifted every time Tab landed here. Key hints live in the status bar. */}
      <Text bold wrap="truncate-end">
        Watchlist <Text {...mutedProps(t)}>Δ today</Text>
      </Text>

      {movers.length === 0 ? (
        <Text {...mutedProps(t)}>loading…</Text>
      ) : (
        <>
          {detail ? (
            <Text {...mutedProps(t)}>
              {" "}
              {"SYM".padEnd(8)}
              {"Δ TODAY".padEnd(10)}
              {"PRICE".padStart(10)}
              {"PREV CL".padStart(10)}
              {"VOL".padStart(9)}
              {"PREV VOL".padStart(10)}
              {"  SECTOR"}
            </Text>
          ) : null}
          <Text {...mutedProps(t)}>{start > 0 ? " ↑ more…" : " "}</Text>
          {view.map((m, i) => {
            const sel = focused && start + i === cur;
            const up = m.changePct >= 0;
            const chg = `${up ? "▲" : "▼"} ${up ? "+" : ""}${m.changePct.toFixed(2)}%`;
            if (!detail) {
              return (
                <Box key={m.symbol}>
                  <Text color={sel ? t.accent : undefined} bold={sel}>
                    {sel ? "›" : " "}
                    {m.symbol.padEnd(6) /* 6: a five-letter ticker ran into the arrow */}
                  </Text>
                  <Text color={up ? t.positive : t.negative}>{chg.padEnd(10)}</Text>
                  <Text {...mutedProps(t)}>{`$${m.price.toFixed(2)}`.padStart(9)}</Text>
                </Box>
              );
            }
            const held = detail.held.has(m.symbol);
            return (
              <Box key={m.symbol}>
                <Text color={sel ? t.accent : undefined} bold={sel}>
                  {sel ? "›" : " "}
                  {m.symbol.padEnd(6)}
                </Text>
                <Text color={t.info}>{held ? "● " : "  "}</Text>
                <Text color={up ? t.positive : t.negative}>{chg.padEnd(10)}</Text>
                <Text>{`$${m.price.toFixed(2)}`.padStart(10)}</Text>
                <Text {...mutedProps(t)}>{`$${m.prevClose.toFixed(2)}`.padStart(10)}</Text>
                <Text>{humanNum(m.dailyVolume).padStart(9)}</Text>
                <Text {...mutedProps(t)}>{humanNum(m.prevVolume).padStart(10)}</Text>
                <Text {...mutedProps(t)}>{"  " + (detail.sectorOf[m.symbol] ?? "—").slice(0, 18)}</Text>
              </Box>
            );
          })}
          <Text {...mutedProps(t)}>{below > 0 ? ` ↓ ${below} more…` : " "}</Text>
          {detail ? (
            // Today's volume is partial until the close, and the free feed is
            // IEX — a slice of all trading. Comparing it raw to a full prior
            // session would make every morning look like a volume collapse.
            <Text {...mutedProps(t)} wrap="truncate-end">
              {" ● you hold it · VOL is today so far, PREV VOL the last full session · IEX feed: a slice of all trading"}
            </Text>
          ) : null}
        </>
      )}
    </Box>
  );
}
