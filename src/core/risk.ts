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

/** A signed percent with a real minus sign: −7%, +25%, 30%. */
function pct(n: number, signed = false): string {
  const r = Math.round(n * 100) / 100;
  if (r < 0) return `−${Math.abs(r)}%`;
  return `${signed && r > 0 ? "+" : ""}${r}%`;
}

/** A weight fraction as a percent: 0.25 → "25%". */
function weightPct(w: number): string {
  return pct(w * 100);
}

/**
 * What changed between two rule sets, one line per change, in words a
 * journal reader six months from now can follow without opening the JSON.
 */
export function describeRuleChanges(before: RiskRules, after: RiskRules): string[] {
  const out: string[] = [];
  if (before.stopLossPct !== after.stopLossPct) {
    out.push(`stop loss ${pct(before.stopLossPct)} → ${pct(after.stopLossPct)}`);
  }
  if (before.defaultMaxWeight !== after.defaultMaxWeight) {
    out.push(
      `default ceiling ${weightPct(before.defaultMaxWeight)} → ${weightPct(after.defaultMaxWeight)}`,
    );
  }
  if (before.trimProfitPct !== after.trimProfitPct) {
    out.push(
      `trim trigger ${pct(before.trimProfitPct, true)} → ${pct(after.trimProfitPct, true)}`,
    );
  }

  const symbols = [...new Set([...Object.keys(before.overrides), ...Object.keys(after.overrides)])];
  for (const sym of symbols.sort()) {
    const a = before.overrides[sym];
    const b = after.overrides[sym];
    if (a && !b) {
      out.push(`${sym} override removed — back to the ${weightPct(after.defaultMaxWeight)} default`);
    } else if (!a && b) {
      out.push(`${sym} ceiling set to ${weightPct(b.maxWeight)} (override: ${b.reason})`);
    } else if (a && b && (a.maxWeight !== b.maxWeight || a.reason !== b.reason)) {
      out.push(
        `${sym} ceiling ${weightPct(a.maxWeight)} → ${weightPct(b.maxWeight)} (override: ${b.reason})`,
      );
    }
  }
  return out;
}
