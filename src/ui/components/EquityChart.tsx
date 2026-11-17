import * as React from "react";
import { Box, Text } from "ink";
import { type EquityHistory, performance } from "../../core/performance";
import { mutedProps, plColor } from "../../core/theme";
import { describeFlows } from "../../core/transfers";
import { brailleChart, lerpHex } from "../charts";
import { useTheme } from "../theme/ThemeContext";

/**
 * `availCols` is the width of the panel this chart lives in — App computes it
 * from the layout, so the curve fits whether it is full-width or in a column.
 */
export function EquityChart({
  history,
  availCols,
  periodLabel,
  height = 6,
  maxWidth = 80,
  focused = false,
  caveat = false,
}: {
  history: EquityHistory;
  availCols: number;
  periodLabel: string;
  height?: number;
  /** Cap on the curve's width in the grid; zoomed, it takes the terminal. */
  maxWidth?: number;
  focused?: boolean;
  /** Spell out what Δ means. Shown when zoomed, where there is the room. */
  caveat?: boolean;
}) {
  const t = useTheme();
  const width = Math.max(24, Math.min(availCols - 12, maxWidth));

  // Deposits and withdrawals are taken out of both the curve and Δ: money you
  // moved in is not a gain. See core/performance.ts.
  const perf = performance(history);
  const { values } = perf;
  const note = describeFlows(perf.flows); // null when nothing moved
  const sign = perf.pl > 0 ? "+" : perf.pl < 0 ? "-" : "";
  const deltaStr =
    `Δ ${sign}$${Math.abs(Math.round(perf.pl)).toLocaleString("en-US")} ` +
    `(${sign}${Math.abs(perf.pct * 100).toFixed(1)}%)`;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? t.accent : t.border}
      paddingX={1}
    >
      <Text bold wrap="truncate-end">
        Portfolio equity <Text {...mutedProps(t)}>{periodLabel}</Text>
        {values.length >= 2 ? <Text color={plColor(t, perf.pl)}>{` · ${deltaStr}`}</Text> : null}
        {values.length >= 2 && note ? <Text {...mutedProps(t)}>{` ${note}`}</Text> : null}
        <Text {...mutedProps(t)}> · p period</Text>
      </Text>
      {values.length < 2 ? (
        <Text {...mutedProps(t)}>loading…</Text>
      ) : (
        <Chart values={values} width={width} height={height} percentAxis={note !== null} />
      )}
      {caveat && values.length >= 2 ? (
        <Text {...mutedProps(t)} wrap="truncate-end">
          {note
            ? "Deposits and withdrawals are taken out; the axis is % from the start of the period, not dollars."
            : "Δ is the gain or loss over the period. Deposits and withdrawals are taken out of it."}
        </Text>
      ) : null}
    </Box>
  );
}

/** "+4.2%" / "-3.1%" / "0.0%" — the axis label for a performance curve. */
function pctLabel(v: number, base: number): string {
  const pct = base ? (v / base - 1) * 100 : 0;
  const r = Math.abs(pct) < 0.05 ? 0 : pct;
  return `${r > 0 ? "+" : ""}${r.toFixed(1)}%`;
}

function Chart({
  values,
  width,
  height,
  percentAxis,
}: {
  values: number[];
  width: number;
  height: number;
  /**
   * Label the axis as % from the start. Used once money has moved: the curve is
   * then performance, not the account's dollar value at each point, and a
   * dollar label would show balances that never existed.
   */
  percentAxis: boolean;
}) {
  const t = useTheme();
  const equity = values;
  const rows = brailleChart(equity, width, height, true); // filled area
  const min = Math.min(...equity);
  const max = Math.max(...equity);
  const base = equity[0] ?? 0;
  const label = (v: number): string => (percentAxis ? pctLabel(v, base) : `$${v.toFixed(0)}`);
  const up = (equity[equity.length - 1] ?? 0) >= (equity[0] ?? 0);
  // Vertical gradient: the bright trend colour at the top row, fading to dark at
  // the bottom, interpolated per row across the fill.
  const [top, bottom] = up ? t.graph.up : t.graph.down;
  const denom = Math.max(1, rows.length - 1);

  return (
    <Box>
      {/* y-axis: max at the top, min at the bottom */}
      <Box flexDirection="column" marginRight={1} alignItems="flex-end">
        <Text {...mutedProps(t)}>{label(max)}</Text>
        <Box flexGrow={1} />
        <Text {...mutedProps(t)}>{label(min)}</Text>
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
