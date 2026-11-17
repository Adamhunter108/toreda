import * as React from "react";
import { Box, Text } from "ink";
import type { RiskRules } from "../../core/risk";
import { mutedProps } from "../../core/theme";
import type { PositionAlert, StopException } from "../../scanner/types";
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
 * breaches, "checked and within your rules", and "not checked yet". Positions
 * held past the default stop under a dated exception are a fourth line kind:
 * not a breach, because you decided it, but shown in the warning colour with
 * the end date, so an exception can never quietly replace the alert.
 */
export function RulesStrip({
  alerts,
  held = [],
  rules,
  positionCount,
}: {
  /** Null when the account has not loaded and nothing could be checked. */
  alerts: PositionAlert[] | null;
  /** Positions held past the default stop under an exception. */
  held?: StopException[];
  rules: RiskRules;
  positionCount: number;
}) {
  const t = useTheme();
  const nOverrides = Object.keys(rules.overrides).length;
  const nStops = Object.keys(rules.stopOverrides).length;
  const summary =
    `stop ${rules.stopLossPct}% · ceiling ${Math.round(rules.defaultMaxWeight * 100)}%` +
    (nOverrides ? ` · ${nOverrides} override${nOverrides === 1 ? "" : "s"}` : "") +
    (nStops ? ` · ${nStops} stop exception${nStops === 1 ? "" : "s"}` : "") +
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

  if (alerts.length === 0 && held.length === 0) {
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

  // Breaches first, then exceptions; the strip's height is budgeted for both.
  const lines = [
    ...alerts.map((a) => ({ kind: "alert" as const, a })),
    ...held.map((h) => ({ kind: "held" as const, h })),
  ];
  const shown = lines.slice(0, STRIP_MAX_ALERTS);
  const more = lines.length - shown.length;
  return (
    <Box flexDirection="column" paddingX={1}>
      {shown.map((line) =>
        // One line each, truncated rather than wrapped: the strip's height is
        // budgeted, and the figures lead each line so they survive the cut.
        line.kind === "alert" ? (
          <Text key={line.a.symbol + line.a.rule} color={t.negative} wrap="truncate-end">
            <Text bold>
              ⚠ {line.a.symbol} {line.a.rule} → {line.a.action}
            </Text>
            {"  "}
            {line.a.detail.split("\n")[0]}
          </Text>
        ) : (
          <Text key={line.h.symbol + " held"} color={t.warning} wrap="truncate-end">
            <Text bold>◆ {line.h.symbol} held past your {line.h.defaultPct}% stop</Text>
            {"  "}
            {`${line.h.plPct.toFixed(1)}% from entry · exception to ${line.h.stopPct}%` +
              `${line.h.until ? ` until ${line.h.until}` : ""}: ${line.h.reason}`}
          </Text>
        ),
      )}
      {more > 0 ? (
        <Text color={alerts.length > 0 ? t.negative : t.warning} wrap="truncate-end">
          {`  …and ${more} more — l rules`}
        </Text>
      ) : null}
    </Box>
  );
}
