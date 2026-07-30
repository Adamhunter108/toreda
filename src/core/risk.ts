// Your risk rules, from config/risk.json.
//
// These do not block anything — `toreda order` places whatever you confirm.
// They decide when the scanner taps you on the shoulder. Set them where you
// would ACTUALLY want warning: a threshold you intend to ignore is worse than
// none, because it trains you to skim the block where real breaches appear.

import { loadJsonConfig, pickNumber, pickObject, saveJsonConfig } from "./json-config";

/**
 * A deliberate, dated exception to the default ceiling.
 *
 * The date and reason are required by convention rather than by the type, but
 * they are the entire point: an override without a recorded rationale is
 * indistinguishable from drift when you review it six months later.
 */
export interface RiskOverride {
  maxWeight: number;
  decided: string;
  reason: string;
}

export interface RiskRules {
  /** Negative percent, e.g. -7 means "sell at 7% below entry". */
  stopLossPct: number;
  /** Fraction of the portfolio, e.g. 0.25 for 25%. */
  defaultMaxWeight: number;
  /** Gain at which a position past its ceiling becomes a trim candidate. */
  trimProfitPct: number;
  overrides: Record<string, RiskOverride>;
}

export const DEFAULT_RISK_RULES: RiskRules = {
  stopLossPct: -7,
  defaultMaxWeight: 0.25,
  trimProfitPct: 25,
  overrides: {},
};

function parseOverrides(raw: Record<string, unknown>): Record<string, RiskOverride> {
  const out: Record<string, RiskOverride> = {};
  for (const [symbol, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const o = value as Record<string, unknown>;
    if (typeof o.maxWeight !== "number" || !Number.isFinite(o.maxWeight)) continue;
    out[symbol.toUpperCase()] = {
      maxWeight: o.maxWeight,
      decided: String(o.decided ?? ""),
      reason: String(o.reason ?? ""),
    };
  }
  return out;
}

export function loadRiskRules(): RiskRules {
  return loadJsonConfig<RiskRules>("risk.json", DEFAULT_RISK_RULES, (raw, defaults) => ({
    stopLossPct: pickNumber(raw, "stopLossPct", defaults.stopLossPct),
    defaultMaxWeight: pickNumber(raw, "defaultMaxWeight", defaults.defaultMaxWeight),
    trimProfitPct: pickNumber(raw, "trimProfitPct", defaults.trimProfitPct),
    overrides: parseOverrides(pickObject(raw, "overrides")),
  })).value;
}

export function saveRiskRules(rules: RiskRules): void {
  saveJsonConfig("risk.json", rules);
}

/** This symbol's concentration ceiling: its override, or the default. */
export function maxWeightFor(symbol: string, rules: RiskRules): number {
  return rules.overrides[symbol.toUpperCase()]?.maxWeight ?? rules.defaultMaxWeight;
}

/** True when this symbol's ceiling was deliberately raised or lowered. */
export function hasOverride(symbol: string, rules: RiskRules): boolean {
  return rules.overrides[symbol.toUpperCase()] !== undefined;
}
