import * as React from "react";
import { Box, Text } from "ink";
import type { SymbolStats } from "../../core/market-data";
import { mutedProps, plColor } from "../../core/theme";
import type { BookRow } from "../book";
import { brailleChart } from "../charts";
import { fmtQty, humanNum, signedUsd, usd } from "../format";
import { useTheme } from "../theme/ThemeContext";

/**
 * Opened with Enter on a selected position. Shows cost detail, live P&L, where
 * the position stands against YOUR rules (weight vs ceiling, price vs stop),
 * today's session stats for the stock, and a trend chart.
 */
export function DetailPane({
  row: r,
  closes,
  stats,
  stopLossPct,
  breach,
  availCols,
}: {
  row: BookRow;
  closes: number[];
  stats: SymbolStats | null;
  /** The DEFAULT stop; the row carries this symbol's own (`r.stopPct`). */
  stopLossPct: number;
  breach: { stop: boolean; ceiling: boolean } | undefined;
  availCols: number;
}) {
  const t = useTheme();
  const plCol = plColor(t, r.pl);
  const width = Math.max(24, Math.min(availCols - 12, 72));
  const chart = closes.length >= 2 ? brailleChart(closes, width, 5) : [];
  const lo = closes.length ? Math.min(...closes) : 0;
  const hi = closes.length ? Math.max(...closes) : 0;
  const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <Box>
      <Text {...mutedProps(t)}>{label.padEnd(18)}</Text>
      {children}
    </Box>
  );

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.border} paddingX={1}>
      <Text bold>
        {r.symbol} <Text {...mutedProps(t)}>— position detail</Text>
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text {...mutedProps(t)}>your holding</Text>
        <Row label="Shares">
          <Text>{fmtQty(r.qty)}</Text>
        </Row>
        <Row label="Avg entry (paid)">
          <Text>{usd(r.avgEntry)}/sh</Text>
        </Row>
        <Row label="Last">
          <Text>{usd(r.price)} </Text>
          <Text color={r.live ? t.positive : t.muted}>{r.live ? "● live" : "○ rest"}</Text>
        </Row>
        <Row label="Market value">
          <Text>{usd(r.value)}</Text>
        </Row>
        <Row label="Cost basis">
          <Text>{usd(r.costBasis)}</Text>
        </Row>
        <Row label="Unrealized P&L">
          <Text color={plCol}>
            {`${signedUsd(r.pl)} (${r.plPct >= 0 ? "+" : ""}${r.plPct.toFixed(2)}%)`}
          </Text>
        </Row>
        <Row label="Today">
          <Text color={plColor(t, r.dayPl)}>
            {`${signedUsd(r.dayPl)} (${r.dayPct >= 0 ? "+" : ""}${r.dayPct.toFixed(2)}%)`}
          </Text>
        </Row>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text {...mutedProps(t)}>your rules</Text>
        <Row label="Weight">
          <Text color={breach?.ceiling ? t.negative : undefined} bold={breach?.ceiling}>
            {r.weight === null ? "—" : `${pct(r.weight)} of portfolio`}
          </Text>
          <Text {...mutedProps(t)}>
            {` · ceiling ${pct(r.ceiling)}${r.override ? " (dated override)" : ""}`}
          </Text>
        </Row>
        <Row label="Stop">
          <Text color={breach?.stop ? t.negative : undefined} bold={breach?.stop}>
            {usd(r.stopPrice)}/sh
          </Text>
          <Text {...mutedProps(t)}>
            {` · ${r.stopPct}% from entry`}
            {r.stopException
              ? ` (exception${r.stopException.until ? ` until ${r.stopException.until}` : ""})`
              : ""}
          </Text>
          {breach?.stop ? (
            <Text color={t.negative} bold>
              {"  at or past it — the rule says sell"}
            </Text>
          ) : r.stopException && r.plPct <= stopLossPct ? (
            <Text color={t.warning}>{`  past your ${stopLossPct}% default — held by the exception`}</Text>
          ) : null}
        </Row>
        {r.stopException ? (
          <Row label="Why">
            <Text {...mutedProps(t)} wrap="truncate-end">
              {`decided ${r.stopException.decided || "undated"} · ${r.stopException.reason || "no reason recorded"}`}
            </Text>
          </Row>
        ) : null}
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
