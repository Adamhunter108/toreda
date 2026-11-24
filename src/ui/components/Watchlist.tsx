import * as React from "react";
import { Box, Text } from "ink";
import { mutedProps } from "../../core/theme";
import { humanNum } from "../format";
import { useTheme } from "../theme/ThemeContext";
import type { WatchRow } from "../watch-rows";

/**
 * The move column. With no previous close (a stock's first day) the move is
 * since today's open, and reads "open -4.1%" so it is never taken for a day's
 * change.
 */
function moveText(m: WatchRow): string {
  const up = m.changePct >= 0;
  if (m.sinceOpen) return `open ${up ? "+" : ""}${m.changePct.toFixed(1)}%`;
  return `${up ? "▲" : "▼"} ${up ? "+" : ""}${m.changePct.toFixed(2)}%`;
}

/**
 * The watchlist with today's move, in whichever order `sortLabel` names; the
 * caller sorts (see ../watchlist-sort.ts).
 *
 * Every watchlist symbol has a row: one the feed returned nothing for says
 * "no data" (see ../watch-rows.ts) rather than disappearing.
 *
 * When focused via Tab, ↑↓ move a cursor, `s` changes the sort and `o` orders
 * the highlighted name. Zoomed (space), it has the width for `detail`: what you
 * hold, the previous close, volume against the last full session, and the sector.
 */
export function Watchlist({
  movers,
  sortLabel,
  rows = 12,
  cursor = 0,
  focused = false,
  detail,
}: {
  movers: WatchRow[];
  sortLabel: string;
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
          shifted every time Tab landed here. Key hints live in the status bar.
          The longest title, "Watchlist Δ today · your order", is exactly 30. */}
      <Text bold wrap="truncate-end">
        Watchlist <Text {...mutedProps(t)}>Δ today · {sortLabel}</Text>
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
            const chg = m.noData ? "no data" : moveText(m);
            const chgProps = m.noData ? mutedProps(t) : { color: up ? t.positive : t.negative };
            if (!detail) {
              return (
                <Box key={m.symbol}>
                  <Text color={sel ? t.accent : undefined} bold={sel}>
                    {sel ? "›" : " "}
                    {m.symbol.padEnd(6) /* 6: a five-letter ticker ran into the arrow */}
                  </Text>
                  <Text {...chgProps}>{chg.padEnd(10)}</Text>
                  <Text {...mutedProps(t)}>{(m.noData ? "" : `$${m.price.toFixed(2)}`).padStart(9)}</Text>
                </Box>
              );
            }
            const held = detail.held.has(m.symbol);
            // No previous session (or no data at all): nothing to show, not $0.00.
            const noPrev = m.noData || m.sinceOpen;
            return (
              <Box key={m.symbol}>
                <Text color={sel ? t.accent : undefined} bold={sel}>
                  {sel ? "›" : " "}
                  {m.symbol.padEnd(6)}
                </Text>
                <Text color={t.info}>{held ? "● " : "  "}</Text>
                <Text {...chgProps}>{chg.padEnd(10)}</Text>
                <Text>{(m.noData ? "" : `$${m.price.toFixed(2)}`).padStart(10)}</Text>
                <Text {...mutedProps(t)}>{(noPrev ? "—" : `$${m.prevClose.toFixed(2)}`).padStart(10)}</Text>
                <Text>{(m.noData ? "" : humanNum(m.dailyVolume)).padStart(9)}</Text>
                <Text {...mutedProps(t)}>{(noPrev ? "—" : humanNum(m.prevVolume)).padStart(10)}</Text>
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
              {" ● you hold it · " +
                (view.some((m) => m.sinceOpen) ? "open: since today's open, no previous session · " : "") +
                "VOL is today so far, PREV VOL the last full session · IEX feed: a slice of all trading"}
            </Text>
          ) : null}
        </>
      )}
    </Box>
  );
}
