// Position review: every open position checked against your own risk rules.
//
// This exists because the rules used to be applied ONLY as a modifier on market
// signals. A position breaching its concentration cap while trading quietly
// produced no signal, so it was never mentioned — and the largest risk in a
// portfolio is rarely the noisiest name. Here the check is unconditional: it
// runs on every position on every scan, whether or not the market said anything
// about that symbol today.

import type { RiskRules, StopLevel } from "../core/risk";
import { belowAnchorPct, isPastStop, lapsedReason, maxWeightFor, stopLevel } from "../core/risk";
import { easternDate } from "../core/transfers";
import type { AccountState, PositionAlert, PositionInfo, StopException } from "./types";

/** The position's last price, derived from entry and P&L when not given. */
export function priceOf(position: PositionInfo): number | undefined {
  if (position.price !== undefined) return position.price;
  return position.avgEntry ? position.avgEntry * (1 + position.unrealizedPlPct) : undefined;
}

/** This position's stop today, or null for a core fund. */
export function positionStop(
  symbol: string,
  position: PositionInfo,
  risk: RiskRules,
  today: string = easternDate(new Date()),
): StopLevel | null {
  return stopLevel(symbol, position.avgEntry ?? 0, position.stopBasis, risk, today);
}

const money = (n: number): string => `$${n.toFixed(2)}`;

/** "−18.2% from its $649.53 high (2026-10-06)" or "−25.6% from entry". */
export function describeDrop(level: StopLevel, below: number): string {
  return level.fromHigh
    ? `${below.toFixed(1)}% from its ${money(level.anchor)} high` +
        (level.highDate ? ` (${level.highDate})` : "")
    : `${below.toFixed(1)}% from entry`;
}

/** `today` is a New York date (YYYY-MM-DD), for stop exceptions' end dates. */
export function reviewPositions(
  account: AccountState,
  risk: RiskRules,
  today: string = easternDate(new Date()),
): PositionAlert[] {
  const alerts: PositionAlert[] = [];

  for (const [symbol, position] of Object.entries(account.positions)) {
    const plPct = position.unrealizedPlPct * 100;
    const weightPct = position.weight * 100;

    // Boundary is inclusive: at exactly the stop, the rule has been reached.
    // The stop is this symbol's own while a dated exception is in force, and
    // core funds have none.
    const level = positionStop(symbol, position, risk, today);
    const price = priceOf(position);
    if (level && isPastStop(level, price, plPct)) {
      const { exception, lapsed } = level;
      const below = belowAnchorPct(level, price, plPct);
      alerts.push({
        symbol,
        rule: "STOP LOSS",
        action: "SELL",
        detail:
          `${describeDrop(level, below)} — at or past ` +
          (exception || !level.sized ? `the ${level.pct}% stop` : `its ${level.pct}% stop`) +
          (exception ? ` you set for ${symbol}${exception.until ? ` until ${exception.until}` : ""}` : "") +
          (level.fromHigh ? ` (${money(level.price)})` : "") +
          (lapsed ? `; your ${lapsed.stopLossPct}% exception ${lapsedReason(lapsed)}` : "") +
          `. The rule says sell, not reassess.` +
          (exception ? `\n  (Exception decided ${exception.decided || "undated"}: ${exception.reason})` : "") +
          (lapsed ? `\n  (It was decided ${lapsed.decided || "undated"}: ${lapsed.reason})` : ""),
      });
    }

    const cap = maxWeightFor(symbol, risk);
    const override = risk.overrides[symbol.toUpperCase()];
    if (position.weight > cap) {
      const excess = position.marketValue - account.portfolioValue * cap;
      alerts.push({
        symbol,
        rule: "CONCENTRATION",
        action: "TRIM",
        detail:
          `${weightPct.toFixed(0)}% of portfolio vs ${(cap * 100).toFixed(0)}% ceiling — ` +
          `$${excess.toFixed(2)} over. Trimming to the ceiling frees that as cash.` +
          (override
            ? `\n  (Ceiling raised from the ${(risk.defaultMaxWeight * 100).toFixed(0)}% ` +
              `default on ${override.decided}: ${override.reason})`
            : ""),
      });
    }
  }

  // Worst breach first: an open loss outranks being too big in a winner.
  return alerts.sort((a, b) => rank(a) - rank(b));
}

function rank(alert: PositionAlert): number {
  return alert.rule === "STOP LOSS" ? 0 : 1;
}

/**
 * Positions past the default stop that a dated exception is holding open.
 *
 * Without this list an exception would be invisible: the breach disappears
 * and nothing replaces it. A decision to hold through a loss stays on screen,
 * with its reason and end date, for as long as it is doing any work.
 */
export function heldUnderExceptions(
  account: AccountState,
  risk: RiskRules,
  today: string = easternDate(new Date()),
): StopException[] {
  const held: StopException[] = [];
  for (const [symbol, position] of Object.entries(account.positions)) {
    const plPct = position.unrealizedPlPct * 100;
    const level = positionStop(symbol, position, risk, today);
    if (!level?.exception) continue;
    const price = priceOf(position);
    if (!isPastStop(level, price, plPct, "base") || isPastStop(level, price, plPct)) continue;
    const { exception } = level;
    held.push({
      symbol,
      plPct,
      defaultPct: level.basePct,
      stopPct: level.pct,
      from: level.fromHigh ? "high" : "entry",
      belowPct: belowAnchorPct(level, price, plPct),
      until: exception.until,
      decided: exception.decided,
      reason: exception.reason,
    });
  }
  return held.sort((a, b) => a.plPct - b.plPct);
}
