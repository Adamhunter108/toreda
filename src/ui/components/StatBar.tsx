import * as React from "react";
import { Box, Text } from "ink";
import type { Realized } from "../../core/activities";
import { plColor } from "../../core/theme";
import type { Position } from "../../core/types";
import { signedPct, signedUsd, snap0 } from "../format";
import { useTheme } from "../theme/ThemeContext";

// Heads-up totals across the whole book.
//
//   Unrealized — paper gain on OPEN positions, live from streamed prices.
//   Today      — today's move across the book.
//   Realized   — locked-in gain from CLOSED trades, FIFO from fill history.
//                A "*" means some sells had no cost basis in the history, so
//                the figure is a floor rather than a total.
export function StatBar({
  positions,
  prices,
  realized,
}: {
  positions: Position[];
  prices: Record<string, number>;
  realized: Realized | null;
}) {
  const t = useTheme();

  let invested = 0;
  let value = 0;
  let day = 0;
  for (const p of positions) {
    const price = prices[p.symbol] ?? p.currentPrice;
    invested += p.costBasis;
    value += p.qty * price;
    day += p.qty * (price - p.prevClose);
  }

  const unreal = snap0(value - invested);
  const unrealPct = invested ? (unreal / invested) * 100 : 0;
  const today = snap0(day);
  const prevValue = value - today;
  const dayPct = prevValue ? (today / prevValue) * 100 : 0;

  const Stat = ({
    label,
    amount,
    pct,
  }: {
    label: string;
    amount: number;
    pct?: number;
  }) => (
    <Box marginRight={3}>
      <Text>{label} </Text>
      <Text bold color={plColor(t, amount)}>
        {signedUsd(amount)}
        {pct !== undefined ? ` (${signedPct(pct)})` : ""}
      </Text>
    </Box>
  );

  return (
    <Box paddingX={1}>
      <Stat label="Unrealized" amount={unreal} pct={unrealPct} />
      <Stat label="Today" amount={today} pct={dayPct} />
      {realized ? (
        <Stat
          label={realized.unmatchedSells > 0 ? "Realized*" : "Realized"}
          amount={realized.total}
        />
      ) : null}
    </Box>
  );
}
