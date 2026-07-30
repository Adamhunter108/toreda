import * as React from "react";
import { Box, Text } from "ink";
import { mutedProps, plColor } from "../../core/theme";
import type { Position } from "../../core/types";
import { sparkline } from "../charts";
import { fmtQty, padL, padR, signedUsd, snap0 } from "../format";
import { useTheme } from "../theme/ThemeContext";

export function Positions({
  positions,
  prices,
  closes,
  selected,
  showSpark,
  sortLabel,
  focused,
}: {
  positions: Position[];
  prices: Record<string, number>;
  closes: Record<string, number[]>;
  selected: number;
  showSpark: boolean;
  sortLabel: string;
  focused: boolean;
}) {
  const t = useTheme();

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? t.accent : t.border}
      paddingX={1}
    >
      <Text bold>
        Positions <Text {...mutedProps(t)}>(by {sortLabel} · s to sort)</Text>
      </Text>

      {positions.length === 0 ? (
        <Text {...mutedProps(t)}>No open positions.</Text>
      ) : (
        <>
          <Text {...mutedProps(t)}>
            {"  "}
            {padR("SYM", 6)}
            {padL("SHARES", 9)}
            {padL("VALUE", 11)}
            {padL("DAY", 11)}
            {padL("P&L", 11)}
            {padL("P&L%", 8)}
            {showSpark ? "  TREND" : ""}
          </Text>

          {positions.map((p, i) => {
            const live = prices[p.symbol];
            const price = live ?? p.currentPrice;
            const value = p.qty * price;
            const day = snap0(p.qty * (price - p.prevClose)); // today's dollars
            const pl = value - p.costBasis; // total since entry
            const plPct = p.costBasis ? (pl / p.costBasis) * 100 : 0;
            const plCol = plColor(t, pl);
            const plPctStr = `${plPct >= 0 ? "+" : "-"}${Math.abs(plPct).toFixed(1)}%`;
            const isSel = i === selected;

            return (
              <Box key={p.symbol}>
                <Text bold={isSel} color={isSel ? t.accent : undefined}>
                  {isSel ? "› " : "  "}
                </Text>
                <Text bold={isSel}>{padR(p.symbol, 6)}</Text>
                <Text {...mutedProps(t)}>{padL(fmtQty(p.qty), 9)}</Text>
                <Text>{padL(`$${value.toFixed(2)}`, 11)}</Text>
                <Text color={plColor(t, day)}>{padL(signedUsd(day), 11)}</Text>
                <Text color={plCol}>{padL(signedUsd(pl), 11)}</Text>
                <Text color={plCol}>{padL(plPctStr, 8)}</Text>
                {/* ● a live streamed tick, ○ the REST fallback (market closed,
                    thin name, or the free tier's one connection held elsewhere) */}
                <Text color={live !== undefined ? t.positive : t.muted}>
                  {live !== undefined ? "  ●" : "  ○"}
                </Text>
                {showSpark ? (
                  <Text color={plCol}>{"  " + sparkline(closes[p.symbol] ?? [], 16)}</Text>
                ) : null}
              </Box>
            );
          })}
        </>
      )}
    </Box>
  );
}
