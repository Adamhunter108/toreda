import * as React from "react";
import { Box, Text } from "ink";
import { mutedProps } from "../../core/theme";
import type { Book } from "../book";
import { usd } from "../format";
import { useTheme } from "../theme/ThemeContext";

/**
 * Portfolio value (live), market status, buying power.
 *
 * Today's change lives in the stat bar directly below — once. This header used
 * to carry a second day figure, from the 20-second account poll, which never
 * quite matched the live one beneath it.
 */
export function Header({
  book,
  buyingPower,
  marketOpen,
}: {
  book: Book;
  buyingPower: number | null;
  marketOpen: boolean | null;
}) {
  const t = useTheme();
  if (!book.known) return <Text {...mutedProps(t)}>Loading account…</Text>;

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
      <Text>BP {usd(buyingPower ?? 0)}</Text>
    </Box>
  );
}
