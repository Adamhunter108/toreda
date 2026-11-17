import * as React from "react";
import { Box, Text, useStdout } from "ink";
import type { Realized } from "../../core/activities";
import { plColor } from "../../core/theme";
import { describeFlows } from "../../core/transfers";
import type { Book } from "../book";
import { signedPct, signedUsd } from "../format";
import { useTheme } from "../theme/ThemeContext";

// Heads-up totals across the whole book.
//
//   Unrealized — paper gain on OPEN positions, live from streamed prices.
//   Today      — today's change in account equity, live. The ONE day figure on
//                the dashboard: the header used to show a second, polled one
//                that disagreed with this by a few dollars on every tick.
//                Account-level, so a position closed today still counts.
//                Net of deposits and withdrawals — "excl. +$1,000 deposited"
//                where it fits. When those could not be checked the label is
//                "Today?", because the figure may contain one.
//   Realized   — locked-in gain from CLOSED trades, FIFO from fill history.
//                A "*" means some sells had no cost basis in the history, so
//                the figure is a floor rather than a total.

export interface Stat {
  key: string;
  label: string;
  /** The figure, with its percentage when there is one. */
  value: string;
  /** The figure alone — the fallback when the percentage does not fit. */
  short: string;
  amount: number;
  /** A caveat shown after the figure when there is room for it. */
  note?: string;
  /** Show the note as a warning rather than a footnote. */
  noteWarn?: boolean;
}

/** Rendered width of one stat: label, space, figure, and its note if shown. */
function statWidth(s: Stat, short: boolean, notes: boolean): number {
  return s.label.length + 1 + (short ? s.short : s.value).length + (notes && s.note ? 1 + s.note.length : 0);
}

/**
 * Which stats to show, and how far apart, so the line fits `available`.
 *
 * This bar overflowed at 80 columns by two characters, and Ink "fit" it by
 * deleting the spaces between labels and figures and wrapping onto a second
 * line. Larger numbers would have cost digits. So it degrades on purpose:
 * notes first, then tighter spacing, then Realized goes, then the percentages
 * — Today's figure last of all.
 */
export function fitStats(
  stats: Stat[],
  available: number,
): { stats: Stat[]; gap: number; short: boolean; notes: boolean } {
  const width = (list: Stat[], gap: number, short: boolean, notes: boolean): number =>
    list.reduce((w, s) => w + statWidth(s, short, notes), 0) + gap * Math.max(0, list.length - 1);
  const withoutRealized = stats.filter((s) => s.key !== "realized");
  const todayOnly = stats.filter((s) => s.key === "today");
  const candidates: Array<[Stat[], number, boolean, boolean]> = [
    [stats, 3, false, true],
    [stats, 3, false, false],
    [stats, 2, false, false],
    [withoutRealized, 3, false, false],
    [withoutRealized, 2, true, false],
    [todayOnly, 0, true, false],
  ];
  for (const [list, gap, short, notes] of candidates) {
    if (width(list, gap, short, notes) <= available) return { stats: list, gap, short, notes };
  }
  return { stats: todayOnly, gap: 0, short: true, notes: false };
}

export function StatBar({ book, realized }: { book: Book; realized: Realized | null }) {
  const t = useTheme();
  const { stdout } = useStdout();
  const cols = Number(process.env.DASH_COLS) || stdout?.columns || 80;
  const unrealPct = book.costBasis ? (book.unrealized / book.costBasis) * 100 : 0;

  const all: Stat[] = [
    {
      key: "unrealized",
      label: "Unrealized",
      value: `${signedUsd(book.unrealized)} (${signedPct(unrealPct)})`,
      short: signedUsd(book.unrealized),
      amount: book.unrealized,
    },
  ];
  if (book.known) {
    const note = describeFlows(book.transfers);
    all.push({
      key: "today",
      // Unchecked transfers: the figure may contain a deposit, and says so
      // even when there is no room for the note.
      label: book.transfers ? "Today" : "Today?",
      value: `${signedUsd(book.dayPl)} (${signedPct(book.dayPct)})`,
      short: signedUsd(book.dayPl),
      amount: book.dayPl,
      ...(note ? { note, noteWarn: book.transfers === null } : {}),
    });
  }
  if (realized) {
    all.push({
      key: "realized",
      label: realized.unmatchedSells > 0 ? "Realized*" : "Realized",
      value: signedUsd(realized.total),
      short: signedUsd(realized.total),
      amount: realized.total,
    });
  }

  const fit = fitStats(all, cols - 2); // paddingX on both sides

  return (
    <Box paddingX={1}>
      {fit.stats.map((s, i) => (
        <Box key={s.key} marginLeft={i === 0 ? 0 : fit.gap}>
          <Text>{s.label} </Text>
          <Text bold color={plColor(t, s.amount)}>
            {fit.short ? s.short : s.value}
          </Text>
          {fit.notes && s.note ? (
            <Text color={s.noteWarn ? t.warning : t.muted}> {s.note}</Text>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}
