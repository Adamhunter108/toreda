import * as React from "react";
import { Box, Text } from "ink";
import type { ScannerConfig } from "../../core/scanner-config";
import { mutedProps } from "../../core/theme";
import { useTheme } from "../theme/ThemeContext";

/**
 * Read-only transparency: exactly where each signal type's data comes from, and
 * whether it is currently active.
 *
 * Worth showing plainly. "The scanner said BUY" and "a free public API with no
 * stability guarantee said BUY" are different claims, and a user should be able
 * to tell which one they are looking at without reading the source.
 */
export function DataSources({ config }: { config: ScannerConfig }) {
  const t = useTheme();

  const rows: Array<{ cap: string; source: string; note: string; active: boolean }> = [
    {
      cap: "Prices / bars",
      source: "Alpaca Market Data",
      note: "your key",
      active: config.signalTypes.momentum || config.signalTypes.value_play,
    },
    {
      cap: "News",
      source: "Alpaca Market Data",
      note: "your key",
      active: config.signalTypes.news_catalyst,
    },
    {
      cap: "Social sentiment",
      source: "StockTwits",
      note: "free · unofficial",
      active: config.signalTypes.social_buzz && config.useStockTwits,
    },
    {
      cap: "Movers / trending",
      source: "Alpaca + StockTwits",
      note: "discovery",
      active: config.discovery.enabled,
    },
    {
      cap: "Account / assets",
      source: "Alpaca Trading",
      note: "your key",
      active: true,
    },
  ];

  return (
    <Box flexDirection="column">
      <Text bold {...mutedProps(t)}>
        Data sources
      </Text>
      {rows.map((r) => (
        <Box key={r.cap}>
          <Text {...mutedProps(t)}>{("  " + r.cap).padEnd(20)}</Text>
          <Text>{r.source.padEnd(21)}</Text>
          <Text {...mutedProps(t)}>{r.note.padEnd(17)}</Text>
          <Text color={r.active ? t.positive : t.muted}>{r.active ? "● active" : "○ off"}</Text>
        </Box>
      ))}
    </Box>
  );
}
