import * as React from "react";
import { Box, Text } from "ink";
import type { RiskRules } from "../../core/risk";
import { mutedProps } from "../../core/theme";
import type { PositionAlert } from "../../scanner/types";
import { STRIP_MAX_ALERTS } from "../layout";
import { useTheme } from "../theme/ThemeContext";

/**
 * Your risk rules, checked live against the book, above everything else.
 *
 * The book outranks the market, so breaches sit above every panel — the same
 * ordering `toreda scan` uses. This used to appear only after a manual scan;
 * the check needs nothing but the account and positions the dashboard already
 * polls, so it now runs on every tick.
 *
 * Three states, kept visibly distinct, because they are different claims:
 * breaches, "checked and within your rules", and "not checked yet".
 */
export function RulesStrip({
  alerts,
  rules,
  positionCount,
}: {
  /** Null when the account has not loaded and nothing could be checked. */
  alerts: PositionAlert[] | null;
  rules: RiskRules;
  positionCount: number;
}) {
  const t = useTheme();
  const nOverrides = Object.keys(rules.overrides).length;
  const summary =
    `stop ${rules.stopLossPct}% · ceiling ${Math.round(rules.defaultMaxWeight * 100)}%` +
    (nOverrides ? ` · ${nOverrides} override${nOverrides === 1 ? "" : "s"}` : "") +
    " · l rules";

  if (alerts === null) {
    return (
      <Box paddingX={1}>
        <Text {...mutedProps(t)} wrap="truncate-end">
          ◌ Rules not checked yet — waiting for the account
        </Text>
      </Box>
    );
  }

  if (alerts.length === 0) {
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

  const shown = alerts.slice(0, STRIP_MAX_ALERTS);
  const more = alerts.length - shown.length;
  return (
    <Box flexDirection="column" paddingX={1}>
      {shown.map((a) => (
        // One line each, truncated rather than wrapped: the strip's height is
        // budgeted, and the figures lead each line so they survive the cut.
        <Text key={a.symbol + a.rule} color={t.negative} wrap="truncate-end">
          <Text bold>
            ⚠ {a.symbol} {a.rule} → {a.action}
          </Text>
          {"  "}
          {a.detail.split("\n")[0]}
        </Text>
      ))}
      {more > 0 ? (
        <Text color={t.negative} wrap="truncate-end">
          {`  …and ${more} more breach${more === 1 ? "" : "es"} — highlighted in Positions · l rules`}
        </Text>
      ) : null}
    </Box>
  );
}
