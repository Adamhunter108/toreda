import * as React from "react";
import { Box, Text } from "ink";
import type { RiskRules } from "../../core/risk";
import { mutedProps } from "../../core/theme";
import type { PositionAlert, StopException } from "../../scanner/types";
import { padR } from "../format";
import { ruleColumns, ruleRows, ruleSummary } from "../rule-rows";
import { useTheme } from "../theme/ThemeContext";

/** Cut to `n` characters, marking the cut. */
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + "…" : s);

/**
 * Your risk rules, checked live against the book, above everything else.
 *
 * The book outranks the market, so breaches sit above every panel — the same
 * ordering `toreda scan` uses. The check needs nothing but the account and
 * positions the dashboard already polls, so it runs on every tick.
 *
 * Three states, kept visibly distinct, because they are different claims:
 * "not checked yet", "checked and within your rules" (one line each), and
 * breaches, which get a panel of their own with one short row per rule.
 *
 * Only the tag carries colour: SELL is red, because the rule says sell; TRIM
 * is gold, because a position that grew too large is not failing. A position
 * past its stop but held by your dated exception gets a gold HELD row, so an
 * exception can never quietly replace the alert. The full sentence for each
 * rule is in the detail pane and the `l` rules view.
 */
export function RulesPanel({
  alerts,
  held = [],
  rules,
  positionCount,
  width,
  maxRows,
  boxed,
}: {
  /** Null when the account has not loaded and nothing could be checked. */
  alerts: PositionAlert[] | null;
  /** Positions held past their stop under an exception. */
  held?: StopException[];
  rules: RiskRules;
  positionCount: number;
  /** Terminal columns. */
  width: number;
  /** Most rule rows to show; the rest are counted in the title. */
  maxRows: number;
  /** Draw the border; a short terminal goes without. */
  boxed: boolean;
}) {
  const t = useTheme();

  if (alerts === null) {
    return (
      <Box paddingX={1}>
        <Text {...mutedProps(t)} wrap="truncate-end">
          ◌ Rules not checked yet — loading the account{rules.stopSizing ? " and stop history" : ""}
        </Text>
      </Box>
    );
  }

  if (alerts.length === 0 && held.length === 0) {
    const nOverrides = Object.keys(rules.overrides).length;
    const nStops = Object.keys(rules.stopOverrides).length;
    const sizing = rules.stopSizing;
    const stop = sizing
      ? `stops ${sizing.volMultiple}× swings, ${sizing.narrowestPct}% to ${sizing.widestPct}%` +
        (sizing.trailing ? " from high" : "")
      : `stop ${rules.stopLossPct}%`;
    const summary =
      `${stop} · ceiling ${Math.round(rules.defaultMaxWeight * 100)}%` +
      (nOverrides ? ` · ${nOverrides} override${nOverrides === 1 ? "" : "s"}` : "") +
      (nStops ? ` · ${nStops} stop exception${nStops === 1 ? "" : "s"}` : "") +
      " · l rules";
    return (
      <Box paddingX={1}>
        <Text wrap="truncate-end">
          <Text color={t.positive}>✓ </Text>
          <Text {...mutedProps(t)}>
            {positionCount === 0 ? "No open positions" : `Within your rules`} · {summary}
          </Text>
        </Text>
      </Box>
    );
  }

  const rows = ruleRows(alerts, held);
  const shown = rows.slice(0, Math.max(1, maxRows));
  const more = rows.length - shown.length;
  const cols = ruleColumns(shown, width - (boxed ? 4 : 2));

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      {...(boxed ? { borderStyle: "round" as const, borderColor: t.border } : {})}
    >
      <Box justifyContent="space-between">
        <Text wrap="truncate-end">
          <Text bold>Rules</Text>
          <Text {...mutedProps(t)}> · {ruleSummary(alerts, held)}</Text>
        </Text>
        <Text {...mutedProps(t)}>{`${more > 0 ? `+${more} more · ` : ""}l rules`}</Text>
      </Box>
      {shown.map((r) => (
        // One line each, cut at the end rather than wrapped: the panel's height
        // is budgeted, and the figures come first so they survive the cut.
        <Text key={r.key} wrap="truncate-end">
          <Text bold color={r.tone === "negative" ? t.negative : t.warning}>
            {padR(r.tag, 4)}
          </Text>
          {"  "}
          <Text bold>{padR(r.symbol, cols.symbol)}</Text>
          {"  "}
          {cols.rule ? <Text {...mutedProps(t)}>{padR(r.rule, cols.rule) + "  "}</Text> : null}
          {padR(clip(r.where, cols.where), cols.where)}
          {r.line ? "   " + r.line : ""}
        </Text>
      ))}
    </Box>
  );
}
