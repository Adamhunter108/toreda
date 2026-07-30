// Price-window maths: how far did it move, and is that far FOR THIS SYMBOL?

import type { SymbolBars } from "./types";

/** Percent change across the whole window, first close to last. */
export function pctChange(bar: SymbolBars): number {
  const first = bar.closes[0];
  const last = bar.closes[bar.closes.length - 1];
  if (first === undefined || last === undefined || first === 0) return 0;
  return ((last - first) / first) * 100;
}

/**
 * Standard deviation of daily percentage returns.
 *
 * Null when there are too few bars to estimate one honestly — a two-day sample
 * produces a number, but not one worth scaling a trading threshold by.
 */
export function dailyVolPct(bar: SymbolBars): number | null {
  const returns: number[] = [];
  for (let i = 1; i < bar.closes.length; i++) {
    const prev = bar.closes[i - 1];
    const cur = bar.closes[i];
    if (prev !== undefined && cur !== undefined && prev > 0) {
      returns.push(((cur - prev) / prev) * 100);
    }
  }
  if (returns.length < 5) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

/**
 * How far a symbol must move over the lookback window before price counts as
 * confirming a news tone.
 *
 * A single flat number cannot do this job. `pctChange` measures the WHOLE
 * window (~11 trading days), so a flat 2% floor asked NVDA — which moves ~3% on
 * a quiet day — to drift 2% over eleven sessions before its news "confirmed".
 * That is far inside noise, and it is what let a nothing-happened fortnight
 * ratify a bearish headline into a SELL at confidence 9.
 *
 * Scaling by the symbol's own realized volatility asks the question that
 * actually matters: is this move large FOR THIS STOCK? sqrt(days) is the
 * standard random-walk scaling of daily vol to a multi-day window. The
 * configured floor stays on so a very quiet name still has to do something.
 */
export function confirmationThresholdPct(
  bar: SymbolBars,
  floorPct: number,
  sigmaMultiple: number,
): number {
  const vol = dailyVolPct(bar);
  if (vol === null) return floorPct;
  const days = Math.max(1, bar.closes.length - 1);
  return Math.max(floorPct, sigmaMultiple * vol * Math.sqrt(days));
}

/** Minutes since midnight in US Eastern, wherever this machine actually is. */
export function easternMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  // Intl can render midnight as hour 24 in the h23/h24 boundary case.
  return (hour % 24) * 60 + minute;
}

/**
 * Fraction of the regular session elapsed, 0.1–1.
 *
 * The most recent daily bar is partial while the market is open, so its raw
 * volume compares unfairly against complete prior days; this scales it up.
 * Clamped at the bottom so a 09:31 scan does not produce an absurd multiplier
 * off two minutes of trading.
 */
export function sessionFraction(now = new Date()): number {
  const OPEN = 9 * 60 + 30;
  const CLOSE = 16 * 60;
  const minutes = easternMinutes(now);
  if (minutes >= CLOSE) return 1;
  return Math.min(1, Math.max(0.1, (minutes - OPEN) / (CLOSE - OPEN)));
}
