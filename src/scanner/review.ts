// Position review: every open position checked against your own risk rules.
//
// This exists because the rules used to be applied ONLY as a modifier on market
// signals. A position breaching its concentration cap while trading quietly
// produced no signal, so it was never mentioned — and the largest risk in a
// portfolio is rarely the noisiest name. Here the check is unconditional: it
// runs on every position on every scan, whether or not the market said anything
// about that symbol today.

import type { RiskRules } from "../core/risk";
import { maxWeightFor } from "../core/risk";
import type { AccountState, PositionAlert } from "./types";

export function reviewPositions(account: AccountState, risk: RiskRules): PositionAlert[] {
  const alerts: PositionAlert[] = [];

  for (const [symbol, position] of Object.entries(account.positions)) {
    const plPct = position.unrealizedPlPct * 100;
    const weightPct = position.weight * 100;

    // Boundary is inclusive: at exactly the stop, the rule has been reached.
    if (plPct <= risk.stopLossPct) {
      alerts.push({
        symbol,
        rule: "STOP LOSS",
        action: "SELL",
        detail:
          `${plPct.toFixed(1)}% from entry — at or past the ${risk.stopLossPct}% stop. ` +
          `The rule says sell, not reassess.`,
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
