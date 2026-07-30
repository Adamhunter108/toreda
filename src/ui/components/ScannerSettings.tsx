import * as React from "react";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ScannerConfig } from "../../core/scanner-config";
import { mutedProps } from "../../core/theme";
import { useTheme } from "../theme/ThemeContext";
import { DataSources } from "./DataSources";

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round = (n: number, dp = 2): number => Math.round(n * 10 ** dp) / 10 ** dp;
const VISIBLE = 16;

interface Row {
  kind: "header" | "toggle" | "number" | "sector";
  label: string;
  value: string;
  on?: boolean;
  onToggle?: () => void;
  onAdjust?: (dir: number) => void;
}

/**
 * Edit config/scanner.json in the TUI, opened with `c`.
 *
 * Saves on every change, and the next scan reads the same file — so tuning a
 * threshold and pressing `r` shows the effect immediately.
 */
export function ScannerSettings({
  config,
  sectors,
  update,
  onClose,
}: {
  config: ScannerConfig;
  sectors: string[];
  update: (mutate: (c: ScannerConfig) => ScannerConfig) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [cursor, setCursor] = useState(1);

  const toggleType = (k: keyof ScannerConfig["signalTypes"]) => () =>
    update((c) => ({ ...c, signalTypes: { ...c.signalTypes, [k]: !c.signalTypes[k] } }));

  const num =
    (
      get: (c: ScannerConfig) => number,
      set: (c: ScannerConfig, v: number) => ScannerConfig,
      stepSize: number,
      lo: number,
      hi: number,
      dp = 2,
    ) =>
    (dir: number) =>
      update((c) => set(c, clamp(round(get(c) + dir * stepSize, dp), lo, hi)));

  const rows: Row[] = [
    { kind: "header", label: "Signal types", value: "" },
    { kind: "toggle", label: "Momentum", value: "", on: config.signalTypes.momentum, onToggle: toggleType("momentum") },
    { kind: "toggle", label: "Value play", value: "", on: config.signalTypes.value_play, onToggle: toggleType("value_play") },
    { kind: "toggle", label: "News catalyst", value: "", on: config.signalTypes.news_catalyst, onToggle: toggleType("news_catalyst") },
    { kind: "toggle", label: "Social buzz", value: "", on: config.signalTypes.social_buzz, onToggle: toggleType("social_buzz") },
    { kind: "toggle", label: "Discovery (untracked movers)", value: "", on: config.discovery.enabled, onToggle: () => update((c) => ({ ...c, discovery: { ...c.discovery, enabled: !c.discovery.enabled } })) },

    { kind: "header", label: "Data sources", value: "" },
    // Exposed as a toggle because StockTwits is an unofficial API: when it is
    // rate-limiting or down, turning it off is faster than waiting out the
    // per-scan degradation notice.
    { kind: "toggle", label: "Use StockTwits (unofficial)", value: "", on: config.useStockTwits, onToggle: () => update((c) => ({ ...c, useStockTwits: !c.useStockTwits })) },

    { kind: "header", label: "Thresholds  (←/→ to adjust)", value: "" },
    { kind: "number", label: "Min confidence", value: `${config.minConfidence}/10`, onAdjust: num((c) => c.minConfidence, (c, v) => ({ ...c, minConfidence: v }), 1, 1, 9, 0) },
    { kind: "number", label: "Max signals", value: `${config.maxSignals}`, onAdjust: num((c) => c.maxSignals, (c, v) => ({ ...c, maxSignals: v }), 1, 1, 25, 0) },
    { kind: "number", label: "Lookback window", value: `${config.lookbackDays}d`, onAdjust: num((c) => c.lookbackDays, (c, v) => ({ ...c, lookbackDays: v }), 1, 5, 90, 0) },
    { kind: "number", label: "Momentum move ≥", value: `${config.thresholds.momentumPct}%`, onAdjust: num((c) => c.thresholds.momentumPct, (c, v) => ({ ...c, thresholds: { ...c.thresholds, momentumPct: v } }), 1, 1, 30, 0) },
    { kind: "number", label: "Volume confirm ≥", value: `${config.thresholds.momentumVolumeMult}x`, onAdjust: num((c) => c.thresholds.momentumVolumeMult, (c, v) => ({ ...c, thresholds: { ...c.thresholds, momentumVolumeMult: v } }), 0.1, 1, 5, 1) },
    { kind: "number", label: "Value pullback ≤", value: `${config.thresholds.valuePullbackPct}%`, onAdjust: num((c) => c.thresholds.valuePullbackPct, (c, v) => ({ ...c, thresholds: { ...c.thresholds, valuePullbackPct: v } }), 1, -40, -1, 0) },
    { kind: "number", label: "Social bull share ≥", value: `${(config.thresholds.socialBullShare * 100).toFixed(0)}%`, onAdjust: num((c) => c.thresholds.socialBullShare, (c, v) => ({ ...c, thresholds: { ...c.thresholds, socialBullShare: v } }), 0.05, 0.5, 0.95, 2) },
    // How far price must move before it confirms a news tone, in multiples of
    // the symbol's OWN window volatility. Lower means news directs trades more
    // often — which is exactly how a quiet fortnight once ratified a headline.
    { kind: "number", label: "News price confirm ≥", value: `${config.thresholds.newsPriceAgreeSigma.toFixed(2)}σ`, onAdjust: num((c) => c.thresholds.newsPriceAgreeSigma, (c, v) => ({ ...c, thresholds: { ...c.thresholds, newsPriceAgreeSigma: v } }), 0.25, 0.25, 3, 2) },

    {
      kind: "header",
      label: `Sector focus  ${config.sectorFocus.length === 0 ? "(all sectors)" : `(${config.sectorFocus.length} selected)`}`,
      value: "",
    },
    ...sectors.map(
      (sec): Row => ({
        kind: "sector",
        label: sec,
        value: "",
        on: config.sectorFocus.includes(sec),
        onToggle: () =>
          update((c) => ({
            ...c,
            sectorFocus: c.sectorFocus.includes(sec)
              ? c.sectorFocus.filter((x) => x !== sec)
              : [...c.sectorFocus, sec],
          })),
      }),
    ),
  ];

  const nextSelectable = (from: number, dir: number): number => {
    let i = from + dir;
    while (i >= 0 && i < rows.length && rows[i]?.kind === "header") i += dir;
    return i >= 0 && i < rows.length ? i : from;
  };

  useInput(
    (input, key) => {
      if (key.escape || input === "q") onClose();
      else if (key.downArrow) setCursor((c) => nextSelectable(c, 1));
      else if (key.upArrow) setCursor((c) => nextSelectable(c, -1));
      else if (input === " " || key.return) rows[cursor]?.onToggle?.();
      else if (key.leftArrow) rows[cursor]?.onAdjust?.(-1);
      else if (key.rightArrow) rows[cursor]?.onAdjust?.(1);
    },
    { isActive: process.stdin.isTTY === true },
  );

  const start = Math.max(
    0,
    Math.min(cursor - Math.floor(VISIBLE / 2), Math.max(0, rows.length - VISIBLE)),
  );
  const view = rows.slice(start, start + VISIBLE);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.border} paddingX={1}>
      <Text bold>
        Scanner settings <Text {...mutedProps(t)}>· config/scanner.json</Text>
      </Text>
      <DataSources config={config} />
      <Text> </Text>
      {start > 0 ? <Text {...mutedProps(t)}> ↑ more…</Text> : null}
      {view.map((r, i) => {
        const idx = start + i;
        if (r.kind === "header") {
          return (
            <Text key={idx} bold {...mutedProps(t)}>
              {"\n"}
              {r.label}
            </Text>
          );
        }
        const sel = idx === cursor;
        const state =
          r.kind === "number" ? (
            <Text color={t.info}>{r.value}</Text>
          ) : (
            <Text color={r.on ? t.positive : t.muted}>{r.on ? "● on" : "○ off"}</Text>
          );
        return (
          <Box key={idx}>
            <Text color={sel ? t.accent : undefined} bold={sel}>
              {sel ? "› " : "  "}
              {r.label.padEnd(33)}
            </Text>
            {state}
          </Box>
        );
      })}
      {start + VISIBLE < rows.length ? <Text {...mutedProps(t)}> ↓ more…</Text> : null}
      <Text {...mutedProps(t)}>{"\n"}↑↓ move · space toggle · ←/→ adjust · esc back</Text>
    </Box>
  );
}
