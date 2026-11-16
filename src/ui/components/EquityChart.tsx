import * as React from "react";
import { Box, Text } from "ink";
import { mutedProps } from "../../core/theme";
import { brailleChart, lerpHex } from "../charts";
import { useTheme } from "../theme/ThemeContext";

/**
 * `availCols` is the width of the panel this chart lives in — App computes it
 * from the layout, so the curve fits whether it is full-width or in a column.
 */
export function EquityChart({
  equity,
  availCols,
  periodLabel,
  height = 6,
  maxWidth = 80,
  focused = false,
}: {
  equity: number[];
  availCols: number;
  periodLabel: string;
  height?: number;
  /** Cap on the curve's width in the grid; zoomed, it takes the terminal. */
  maxWidth?: number;
  focused?: boolean;
}) {
  const t = useTheme();
  const width = Math.max(24, Math.min(availCols - 12, maxWidth));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? t.accent : t.border}
      paddingX={1}
    >
      <Text bold>
        Portfolio equity{" "}
        <Text {...mutedProps(t)}>
          ({equity.length} pts · {periodLabel}) · p to change
        </Text>
      </Text>
      {equity.length < 2 ? (
        <Text {...mutedProps(t)}>loading…</Text>
      ) : (
        <Chart equity={equity} width={width} height={height} />
      )}
    </Box>
  );
}

function Chart({
  equity,
  width,
  height,
}: {
  equity: number[];
  width: number;
  height: number;
}) {
  const t = useTheme();
  const rows = brailleChart(equity, width, height, true); // filled area
  const min = Math.min(...equity);
  const max = Math.max(...equity);
  const up = (equity[equity.length - 1] ?? 0) >= (equity[0] ?? 0);
  // Vertical gradient: the bright trend colour at the top row, fading to dark at
  // the bottom, interpolated per row across the fill.
  const [top, bottom] = up ? t.graph.up : t.graph.down;
  const denom = Math.max(1, rows.length - 1);

  return (
    <Box>
      {/* y-axis: max at the top, min at the bottom */}
      <Box flexDirection="column" marginRight={1} alignItems="flex-end">
        <Text {...mutedProps(t)}>${max.toFixed(0)}</Text>
        <Box flexGrow={1} />
        <Text {...mutedProps(t)}>${min.toFixed(0)}</Text>
      </Box>
      <Box flexDirection="column">
        {rows.map((row, i) => (
          <Text key={i} color={lerpHex(top, bottom, i / denom)}>
            {row}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
