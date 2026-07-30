import * as React from "react";
import { Box, Text } from "ink";
import { mutedProps, plColor } from "../../core/theme";
import type { Account } from "../../core/types";
import { snap0, usd } from "../format";
import { useTheme } from "../theme/ThemeContext";

export function Header({
  account,
  marketOpen,
}: {
  account: Account | null;
  marketOpen: boolean | null;
}) {
  const t = useTheme();
  if (!account) return <Text {...mutedProps(t)}>Loading account…</Text>;

  const day = snap0(account.equity - account.lastEquity);
  const pct = account.lastEquity ? (day / account.lastEquity) * 100 : 0;
  const dayStr = `${day >= 0 ? "+" : "-"}$${Math.abs(day).toFixed(2)}`;
  const pctStr = `${pct >= 0 ? "+" : "-"}${Math.abs(pct).toFixed(2)}%`;

  return (
    <Box flexGrow={1} justifyContent="space-between">
      <Text bold>Portfolio {usd(account.equity)}</Text>
      {marketOpen === false ? (
        <Text {...mutedProps(t)}>● Markets closed</Text>
      ) : (
        <Text color={plColor(t, day)}>
          Day {dayStr} ({pctStr})
        </Text>
      )}
      <Text>BP {usd(account.buyingPower)}</Text>
    </Box>
  );
}
