import * as React from "react";
import { Box, Text } from "ink";
import { mutedProps, plColor, type Theme } from "../../core/theme";
import type { BookRow } from "../book";
import { sparkline } from "../charts";
import { fmtQty, padL, padR, signedUsd, usd } from "../format";
import { ALLOC_BAR_CELLS, type PositionColumns, WEIGHT_WIDTH } from "../layout";
import { useTheme } from "../theme/ThemeContext";

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

/**
 * A position's share of the portfolio as a bar, with its ceiling marked.
 *
 * This replaces the separate Allocation panel, which spent a full-width box —
 * and, on a short terminal, most of the positions panel's rows — drawing five
 * short bars of information the weight column already carried. Here the bar
 * sits on the row it describes, and the ceiling mark shows how much room the
 * position has left under your own rule.
 */
function AllocBar({ weight, ceiling, over, t }: {
  weight: number;
  ceiling: number;
  over: boolean;
  t: Theme;
}) {
  const cells = Math.max(0, Math.min(ALLOC_BAR_CELLS, weight * ALLOC_BAR_CELLS));
  const full = Math.floor(cells);
  const part = EIGHTHS[Math.min(7, Math.round((cells - full) * 8))] ?? "";
  const fill = "█".repeat(full) + (full < ALLOC_BAR_CELLS ? part : "");
  const used = full + (part && full < ALLOC_BAR_CELLS ? 1 : 0);
  // The ceiling mark: the cell holding the ceiling's boundary, unless the fill
  // already covers it (an over-ceiling bar is coloured instead).
  const mark = ceiling < 1 ? Math.min(ALLOC_BAR_CELLS - 1, Math.floor(ceiling * ALLOC_BAR_CELLS)) : -1;
  let track = "";
  for (let i = used; i < ALLOC_BAR_CELLS; i++) track += i === mark ? "│" : "░";
  return (
    <Text>
      {"  "}
      <Text color={over ? t.negative : t.info}>{fill}</Text>
      <Text {...mutedProps(t)}>{track}</Text>
    </Text>
  );
}

/**
 * The open book — the primary view. Every figure comes from `markBook`, so the
 * value, weight and P&L here are the same numbers the rules, the stat bar and
 * the detail pane use.
 *
 * A cell that breaches one of your rules is drawn inverse: P&L% at or past the
 * stop, weight over the ceiling. The rules strip above says which rule, in
 * words; the highlight says where.
 */
export function Positions({
  rows,
  closes,
  selected,
  columns,
  breaches,
  sortLabel,
  focused,
  maxRows,
  cash,
}: {
  rows: BookRow[];
  closes: Record<string, number[]>;
  selected: number;
  columns: PositionColumns;
  breaches: Record<string, { stop: boolean; ceiling: boolean }>;
  sortLabel: string;
  focused: boolean;
  /** Most rows to draw; the window follows the cursor beyond that. */
  maxRows?: number;
  /** Cash and its share of the portfolio; null until the account loads. */
  cash: { amount: number; share: number } | null;
}) {
  const t = useTheme();
  const n = rows.length;
  const limit = Math.max(1, maxRows ?? n);
  const windowed = n > limit;
  const start = windowed
    ? Math.max(0, Math.min(selected - Math.floor(limit / 2), n - limit))
    : 0;
  const view = rows.slice(start, start + limit);
  const above = start;
  const below = n - (start + view.length);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={focused ? t.accent : t.border}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold wrap="truncate-end">
          Positions <Text {...mutedProps(t)}>(by {sortLabel} · s to sort)</Text>
        </Text>
        {cash ? (
          // Negative cash is margin borrowing — named as such, never shown as
          // a small negative holding.
          <Text {...mutedProps(t)}>
            {cash.amount < 0 ? "margin " : "cash "}
            {usd(Math.abs(cash.amount))} · {(Math.abs(cash.share) * 100).toFixed(1)}%
          </Text>
        ) : null}
      </Box>

      {n === 0 ? (
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
            {"   "}
            {columns.weight ? padL("WT", WEIGHT_WIDTH) : ""}
            {columns.alloc ? "  " + padR("ALLOCATION", ALLOC_BAR_CELLS) : ""}
            {columns.spark ? "  TREND" : ""}
          </Text>

          {view.map((r, i) => {
            const plCol = plColor(t, r.pl);
            const plPctStr = `${r.plPct >= 0 ? "+" : "-"}${Math.abs(r.plPct).toFixed(1)}%`;
            const isSel = start + i === selected;
            const flags = breaches[r.symbol];
            const wt = r.weight === null ? "—" : `${(r.weight * 100).toFixed(1)}%`;

            return (
              <Box key={r.symbol}>
                <Text bold={isSel} color={isSel ? t.accent : undefined}>
                  {isSel ? "› " : "  "}
                </Text>
                <Text bold={isSel}>{padR(r.symbol, 6)}</Text>
                <Text {...mutedProps(t)}>{padL(fmtQty(r.qty), 9)}</Text>
                <Text>{padL(`$${r.value.toFixed(2)}`, 11)}</Text>
                <Text color={plColor(t, r.dayPl)}>{padL(signedUsd(r.dayPl), 11)}</Text>
                <Text color={plCol}>{padL(signedUsd(r.pl), 11)}</Text>
                <Text color={plCol} inverse={flags?.stop} bold={flags?.stop}>
                  {padL(plPctStr, 8)}
                </Text>
                {/* ● a live streamed tick, ○ the REST fallback (market closed,
                    thin name, or the free tier's one connection held elsewhere) */}
                <Text color={r.live ? t.positive : t.muted}>{r.live ? "  ●" : "  ○"}</Text>
                {columns.weight ? (
                  <Text
                    color={flags?.ceiling ? t.negative : undefined}
                    inverse={flags?.ceiling}
                    bold={flags?.ceiling}
                    {...(flags?.ceiling ? {} : mutedProps(t))}
                  >
                    {padL(wt, WEIGHT_WIDTH)}
                  </Text>
                ) : null}
                {columns.alloc ? (
                  r.weight === null ? (
                    <Text {...mutedProps(t)}>{"  " + "░".repeat(ALLOC_BAR_CELLS)}</Text>
                  ) : (
                    <AllocBar weight={r.weight} ceiling={r.ceiling} over={!!flags?.ceiling} t={t} />
                  )
                ) : null}
                {columns.spark ? (
                  <Text color={plCol}>
                    {"  " + sparkline(closes[r.symbol] ?? [], columns.spark)}
                  </Text>
                ) : null}
              </Box>
            );
          })}

          {windowed ? (
            <Text {...mutedProps(t)}>
              {"  "}
              {above > 0 ? `↑ ${above} above` : ""}
              {above > 0 && below > 0 ? " · " : ""}
              {below > 0 ? `↓ ${below} below` : ""}
              {` · ${n} positions · ↑↓ to scroll`}
            </Text>
          ) : null}
        </>
      )}
    </Box>
  );
}
