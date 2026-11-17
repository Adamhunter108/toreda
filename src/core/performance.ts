// The equity curve with deposits and withdrawals taken out.
//
// Alpaca's portfolio history is the account's equity, so money moved in shows up
// as a gain: a deposit draws a cliff in the 1-day chart, and would put the whole
// deposit into every period's Δ from the next day on. Its own `profit_loss`
// field does not help — it is not net of transfers either (a day that took a
// deposit reports the deposit as profit).
//
// What it does provide, when asked with `cashflow_types`, is each transfer at the
// point it landed. With that, each step's return can be measured on the money
// that was actually invested — (equity − cash moved in) ÷ previous equity — and
// chained. That is the time-weighted return, the standard way to report
// performance independently of when money was added.
//
// Pure, so it can be tested on hand-built series without the network.

import { type CashActivity, type CashFlows, signedAmount } from "./transfers";

/** Account equity over a period, with the cash moved in (+) or out (−) at each point. */
export interface EquityHistory {
  equity: number[];
  /** Same length as `equity`; 0 where nothing moved. */
  flows: number[];
}

export const EMPTY_HISTORY: EquityHistory = { equity: [], flows: [] };

export interface Performance {
  /**
   * The curve to draw: the period's starting equity grown by each step's
   * return, so a deposit moves nothing. Identical to the equity when no money
   * moved during the period.
   */
  values: number[];
  /** Gain or loss over the period in dollars, transfers excluded. */
  pl: number;
  /** Time-weighted return over the period: 0.032 is +3.2%. */
  pct: number;
  /** Money moved in or out after the period's first point. */
  flows: CashFlows;
}

const NONE: Performance = { values: [], pl: 0, pct: 0, flows: { deposits: 0, withdrawals: 0, net: 0 } };

export function performance(h: EquityHistory): Performance {
  const { equity, flows } = h;
  // An account opened during the period reports zeros until it was funded.
  // Those points are not a value of zero; they are no account yet.
  const start = equity.findIndex((v) => v > 0);
  if (start < 0) return NONE;

  const base = equity[start]!;
  const values = [base];
  let growth = 1;
  let pl = 0;
  let deposits = 0;
  let withdrawals = 0;

  for (let i = start + 1; i < equity.length; i++) {
    const prev = equity[i - 1]!;
    const flow = flows[i] ?? 0;
    const invested = equity[i]! - flow; // what the previous equity became on its own
    pl += invested - prev;
    // An emptied account has no return to measure until money comes back.
    if (prev > 0) growth *= invested / prev;
    if (flow > 0) deposits += flow;
    else withdrawals -= flow;
    values.push(base * growth);
  }

  const moved = deposits >= 0.005 || withdrawals >= 0.005;
  return {
    // Nothing moved: draw the equity itself, without the float noise of the chain.
    values: moved ? values : equity.slice(start),
    pl: Math.abs(pl) < 0.005 ? 0 : pl,
    pct: growth - 1,
    flows: { deposits, withdrawals, net: deposits - withdrawals },
  };
}

/**
 * Parse `/v2/account/portfolio/history?…&cashflow_types=…`.
 *
 * `cashflow` maps an activity type to an array aligned with `timestamp`; it is
 * absent when nothing moved in the period. Deposits and withdrawals are signed
 * by type, whatever sign the feed uses, by the same rule as the day change.
 * A point with no equity is dropped, and any cash on it carried to the next one
 * so it is not lost.
 */
export function parseEquityHistory(raw: unknown): EquityHistory {
  const d = (raw ?? {}) as { equity?: unknown; cashflow?: unknown };
  if (!Array.isArray(d.equity)) return EMPTY_HISTORY;
  const byType =
    d.cashflow && typeof d.cashflow === "object" ? (d.cashflow as Record<string, unknown>) : {};

  const flowAt = (i: number): number => {
    let sum = 0;
    for (const [type, series] of Object.entries(byType)) {
      if (!Array.isArray(series)) continue;
      const amount = Number(series[i]);
      if (!Number.isFinite(amount) || amount === 0) continue;
      sum += signedAmount({ type, amount } as CashActivity);
    }
    return sum;
  };

  const equity: number[] = [];
  const flows: number[] = [];
  let carried = 0;
  d.equity.forEach((v, i) => {
    carried += flowAt(i);
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    equity.push(v);
    flows.push(carried);
    carried = 0;
  });
  return { equity, flows };
}
