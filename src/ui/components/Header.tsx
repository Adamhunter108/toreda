import * as React from "react";
import { Box, Text } from "ink";
import { fundsOf } from "../../core/funds";
import { mutedProps } from "../../core/theme";
import type { Book } from "../book";
import { usd } from "../format";
import { useTheme } from "../theme/ThemeContext";

/**
 * Portfolio value (live), market status, cash.
 *
 * Cash, not buying power. On a margin account buying power includes what
 * Alpaca would lend, roughly doubling the figure, and a header reading
 * "BP $2,500" over $500 of real cash reads as money you have.
 *
 * Today's change lives in the stat bar directly below — once. This header used
 * to carry a second day figure, from the 20-second account poll, which never
 * quite matched the live one beneath it.
 */
export function Header({
  book,
  account,
  marketOpen,
}: {
  book: Book;
  account: { cash: number; buyingPower: number } | null;
  marketOpen: boolean | null;
}) {
  const t = useTheme();
  if (!book.known) return <Text {...mutedProps(t)}>Loading account…</Text>;
  const funds = account ? fundsOf(account) : null;

  return (
    <Box flexGrow={1} justifyContent="space-between">
      <Text bold>Portfolio {usd(book.equity)}</Text>
      {marketOpen === null ? (
        <Text> </Text>
      ) : marketOpen ? (
        <Text color={t.positive}>● Market open</Text>
      ) : (
        <Text {...mutedProps(t)}>● Markets closed</Text>
      )}
      {funds && funds.loan > 0 ? (
        <Text color={t.warning}>Margin loan {usd(funds.loan)}</Text>
      ) : (
        <Text>Cash {usd(funds?.cash ?? 0)}</Text>
      )}
    </Box>
  );
}
