import * as React from "react";
import { Box, Text } from "ink";
import { mutedProps } from "../../core/theme";
import type { Position } from "../../core/types";
import { useTheme } from "../theme/ThemeContext";

/** Each holding's share of the book, biggest first. */
export function AllocationBar({
  positions,
  prices,
  barWidth = 16,
}: {
  positions: Position[];
  prices: Record<string, number>;
  barWidth?: number;
}) {
  const t = useTheme();

  const rows = positions.map((p) => ({
    symbol: p.symbol,
    value: p.qty * (prices[p.symbol] ?? p.currentPrice),
  }));
  const total = rows.reduce((sum, r) => sum + r.value, 0) || 1;
  rows.sort((a, b) => b.value - a.value);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.border} paddingX={1}>
      <Text bold>Allocation</Text>
      {/* Spacer so the first bar lines up with the first position row, which
          sits below both a title and a column-header line. */}
      <Text> </Text>
      {rows.length === 0 ? (
        <Text {...mutedProps(t)}>—</Text>
      ) : (
        rows.map((r) => {
          const pct = (r.value / total) * 100;
          const filled = Math.max(0, Math.min(barWidth, Math.round((pct / 100) * barWidth)));
          const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
          return (
            <Box key={r.symbol}>
              <Text>{r.symbol.padEnd(5)}</Text>
              <Text color={t.info}>{bar}</Text>
              <Text {...mutedProps(t)}>{` ${pct.toFixed(0)}%`.padStart(5)}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}
