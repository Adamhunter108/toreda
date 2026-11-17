// Position review: every open position checked against your own risk rules.
//
// This exists because the rules used to be applied ONLY as a modifier on market
// signals. A position breaching its concentration cap while trading quietly
// produced no signal, so it was never mentioned — and the largest risk in a
// portfolio is rarely the noisiest name. Here the check is unconditional: it
// runs on every position on every scan, whether or not the market said anything
// about that symbol today.

import type { RiskRules } from "../core/risk";
import { lapsedReason, maxWeightFor, stopFor } from "../core/risk";
import { easternDate } from "../core/transfers";
import type { AccountState, PositionAlert, StopException } from "./types";

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
    // The stop is this symbol's own while a dated exception is in force.
    const stop = stopFor(symbol, risk, today);
    if (plPct <= stop.pct) {
      const { exception, lapsed } = stop;
      alerts.push({
        symbol,
        rule: "STOP LOSS",
        action: "SELL",
        detail:
          `${plPct.toFixed(1)}% from entry — at or past the ${stop.pct}% stop` +
          (exception ? ` you set for ${symbol}${exception.until ? ` until ${exception.until}` : ""}` : "") +
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
          `$${excess.toFixed(2)} over. Trimming to the ceiling frees that as buying power.` +
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
    const { pct, exception } = stopFor(symbol, risk, today);
    if (!exception || plPct > risk.stopLossPct || plPct <= pct) continue;
    held.push({
      symbol,
      plPct,
      defaultPct: risk.stopLossPct,
      stopPct: pct,
      until: exception.until,
      decided: exception.decided,
      reason: exception.reason,
    });
  }
  return held.sort((a, b) => a.plPct - b.plPct);
}
