import * as React from "react";
import { Box, Text } from "ink";
import type { SymbolStats } from "../../core/market-data";
import { mutedProps, plColor } from "../../core/theme";
import type { Position } from "../../core/types";
import { brailleChart } from "../charts";
import { fmtQty, humanNum, signedUsd, snap0, usd } from "../format";
import { useTheme } from "../theme/ThemeContext";

/**
 * Opened with Enter or Space on a selected position. Shows cost detail, live
 * P&L, allocation, today's session stats for the stock, and a trend chart.
 */
export function DetailPane({
  position: p,
  price,
  closes,
  stats,
  bookValue,
  availCols,
}: {
  position: Position;
  price?: number;
  closes: number[];
  stats: SymbolStats | null;
  bookValue: number;
  availCols: number;
}) {
  const t = useTheme();
  const live = price !== undefined;
  const px = price ?? p.currentPrice;
  const value = p.qty * px;
  const pl = value - p.costBasis;
  const plPct = p.costBasis ? (pl / p.costBasis) * 100 : 0;
  const dayPl = snap0(p.qty * (px - p.prevClose));
  const dayPct = p.prevClose ? ((px - p.prevClose) / p.prevClose) * 100 : 0;
  const plCol = plColor(t, pl);
  const alloc = bookValue ? (value / bookValue) * 100 : 0;
  const width = Math.max(24, Math.min(availCols - 12, 72));
  const chart = closes.length >= 2 ? brailleChart(closes, width, 5) : [];
  const lo = closes.length ? Math.min(...closes) : 0;
  const hi = closes.length ? Math.max(...closes) : 0;

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <Box>
      <Text {...mutedProps(t)}>{label.padEnd(18)}</Text>
      {children}
    </Box>
  );

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.border} paddingX={1}>
      <Text bold>
        {p.symbol} <Text {...mutedProps(t)}>— position detail</Text>
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text {...mutedProps(t)}>your holding</Text>
        <Row label="Shares">
          <Text>{fmtQty(p.qty)}</Text>
        </Row>
        <Row label="Avg entry (paid)">
          <Text>{usd(p.avgEntry)}/sh</Text>
        </Row>
        <Row label="Allocation">
          <Text>{alloc.toFixed(1)}% of book</Text>
        </Row>
        <Row label="Last">
          <Text>{usd(px)} </Text>
          <Text color={live ? t.positive : t.muted}>{live ? "● live" : "○ rest"}</Text>
        </Row>
        <Row label="Market value">
          <Text>{usd(value)}</Text>
        </Row>
        <Row label="Cost basis">
          <Text>{usd(p.costBasis)}</Text>
        </Row>
        <Row label="Unrealized P&L">
          <Text color={plCol}>
            {`${signedUsd(pl)} (${plPct >= 0 ? "+" : ""}${plPct.toFixed(2)}%)`}
          </Text>
        </Row>
        <Row label="Today">
          <Text color={plColor(t, dayPl)}>
            {`${signedUsd(dayPl)} (${dayPct >= 0 ? "+" : ""}${dayPct.toFixed(2)}%)`}
          </Text>
        </Row>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text {...mutedProps(t)}>the stock</Text>
        {stats ? (
          <>
            <Row label="Open / High / Low">
              <Text>{`${usd(stats.open)}  ${usd(stats.high)}  ${usd(stats.low)}`}</Text>
            </Row>
            <Row label="Prev close">
              <Text>{usd(stats.prevClose)}</Text>
            </Row>
            <Row label="Volume">
              <Text>{humanNum(stats.volume)}</Text>
            </Row>
          </>
        ) : (
          <Text {...mutedProps(t)}>loading session…</Text>
        )}
        <Row label="Range (~45d)">
          <Text>{`${usd(lo)} – ${usd(hi)}`}</Text>
        </Row>
      </Box>

      {chart.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text {...mutedProps(t)}>Trend (~45d daily close)</Text>
          {chart.map((row, i) => (
            <Text key={i} color={plCol}>
              {row}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
