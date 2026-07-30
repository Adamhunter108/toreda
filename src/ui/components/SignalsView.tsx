import * as React from "react";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { actionColor, confColor, mutedProps, plColor } from "../../core/theme";
import type { ScanResult } from "../../scanner/types";
import { useTheme } from "../theme/ThemeContext";

/** Opportunities shown per screen — each occupies roughly three lines. */
const VISIBLE = 4;

function bar(confidence: number): string {
  const n = Math.max(0, Math.min(10, Math.round(confidence)));
  return "▉".repeat(n) + "░".repeat(10 - n);
}

/**
 * Full-screen scrollable signals view, opened with `g`.
 *
 * ↑↓ scrolls the ranked opportunities; position alerts sit ABOVE them and
 * discovery below, mirroring the CLI report's ordering — rule breaches outrank
 * any opportunity, and unvetted discovery names never mix into the ranked list.
 */
export function SignalsView({
  result,
  scanning,
  error,
  lastRun,
  minConf,
  armed,
  onOrder,
  onRefresh,
  onClose,
}: {
  result: ScanResult | null;
  scanning: boolean;
  error: string | null;
  lastRun: Date | null;
  minConf: number;
  armed: boolean;
  onOrder: (symbol: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [cursor, setCursor] = useState(0);
  const opps = result
    ? [...result.opportunities].sort((a, b) => b.confidence - a.confidence)
    : [];
  const cur = Math.min(cursor, Math.max(0, opps.length - 1));

  useInput(
    (input, key) => {
      if (key.escape || input === "q") onClose();
      else if (input === "r") onRefresh();
      else if (input === "o" && armed && opps[cur]) onOrder(opps[cur]!.symbol);
      else if (key.downArrow) setCursor((c) => Math.min(opps.length - 1, c + 1));
      else if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    },
    { isActive: process.stdin.isTTY === true },
  );

  const start = Math.max(
    0,
    Math.min(cur - Math.floor(VISIBLE / 2), Math.max(0, opps.length - VISIBLE)),
  );
  const view = opps.slice(start, start + VISIBLE);
  const when = lastRun
    ? lastRun.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "never";

  const alerts = result?.positionAlerts ?? [];
  const discovery = result?.discovery;
  const degraded = result?.degraded ?? [];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.border} paddingX={1}>
      <Text bold>
        Market signals{" "}
        <Text {...mutedProps(t)}>
          {result ? `${opps.length} ranked · line ≥${minConf}/10 · scanned ${when}` : ""}
        </Text>
      </Text>

      {scanning ? (
        <Text color={t.warning}>scanning… (runs the full opportunity scan)</Text>
      ) : null}
      {error ? <Text color={t.negative}>scan failed: {error}</Text> : null}
      {!result && !scanning ? (
        <Text {...mutedProps(t)}>No scan yet — press r to run the opportunity scan.</Text>
      ) : null}

      {/* A scan missing a source looks identical to a quiet day unless it says
          so. State the degradation before anything derived from it. */}
      {degraded.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={t.warning}>⚠ Partial scan — some sources were unavailable:</Text>
          {degraded.map((reason) => (
            <Text key={reason} {...mutedProps(t)}>
              {"    • "}
              {reason}
            </Text>
          ))}
        </Box>
      ) : null}

      {alerts.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={t.negative}>
            ⚠ Position alerts
          </Text>
          {alerts.map((a) => (
            <Text key={a.symbol + a.rule} color={t.negative}>
              {"  "}
              {a.symbol} — {a.rule} {a.action}: {a.detail.split("\n")[0]}
            </Text>
          ))}
        </Box>
      ) : null}

      {opps.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text {...mutedProps(t)}>{start > 0 ? " ↑ more…" : " "}</Text>
          {view.map((o, i) => {
            const sel = start + i === cur;
            return (
              <Box key={o.symbol} flexDirection="column">
                <Box>
                  <Text bold color={sel ? t.accent : undefined}>
                    {sel ? "› " : "  "}
                    {o.symbol.padEnd(6)}
                  </Text>
                  <Text color={confColor(t, o.confidence)}>
                    {bar(o.confidence)} {o.confidence}/10
                  </Text>
                  <Text>
                    {"  "}
                    {o.opportunityType.replace(/_/g, " ")} ·{" "}
                  </Text>
                  <Text color={actionColor(t, o.action)}>{o.action.toUpperCase()}</Text>
                  <Text {...mutedProps(t)}>
                    {" "}
                    · {o.timeframe.replace(/_/g, " ")} · {o.sector}
                  </Text>
                </Box>
                <Text>
                  {"    "}
                  {o.reasoning}
                </Text>
                <Text {...mutedProps(t)}>
                  {"    score: "}
                  {o.scoreBreakdown.join(", ")}
                </Text>
              </Box>
            );
          })}
          <Text {...mutedProps(t)}>
            {start + VISIBLE < opps.length ? ` ↓ ${opps.length - start - VISIBLE} more…` : " "}
          </Text>
        </Box>
      ) : null}

      {discovery ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            Discovery{" "}
            <Text {...mutedProps(t)}>(untracked · {discovery.considered} screened)</Text>
          </Text>
          {discovery.candidates.length === 0 ? (
            <Text {...mutedProps(t)}> nothing cleared the quality gates</Text>
          ) : (
            discovery.candidates.slice(0, 5).map((cand) => (
              <Box key={cand.symbol}>
                <Text>{cand.symbol.padEnd(6)}</Text>
                <Text color={plColor(t, cand.pctChange)}>
                  {`${cand.pctChange >= 0 ? "+" : ""}${cand.pctChange.toFixed(1)}%`.padStart(8)}
                </Text>
                <Text {...mutedProps(t)}>
                  {"  "}
                  {cand.name.slice(0, 24)} · {cand.sources.join("/")}
                </Text>
              </Box>
            ))
          )}
          <Text color={t.warning}> UNVETTED — surfaced by screens, not analysed.</Text>
        </Box>
      ) : null}

      <Text {...mutedProps(t)}>
        {"\n"}↑↓ scroll · r rescan{armed ? " · o order" : ""} · esc back
      </Text>
    </Box>
  );
}
