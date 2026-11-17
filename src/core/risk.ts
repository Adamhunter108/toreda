// Your risk rules, from config/risk.json.
//
// These do not block anything — `toreda order` places whatever you confirm.
// They decide when the scanner taps you on the shoulder. Set them where you
// would ACTUALLY want warning: a threshold you intend to ignore is worse than
// none, because it trains you to skim the block where real breaches appear.

import { loadJsonConfig, pickNumber, pickObject, saveJsonConfig } from "./json-config";
import { easternDate } from "./transfers";

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

/**
 * A dated exception to the stop loss for one symbol.
 *
 * Time-boxed by design. The stop once applied "without exception — conviction
 * about a company is not a reason to tolerate an open loss", and that still
 * holds for an open-ended loosening. Holding through a known event, such as
 * earnings, is a decision with a horizon, so it gets one: an exception that
 * LOOSENS the stop applies only with an end date, and only through it. After
 * that the default stop is back, and so is the SELL alert.
 *
 * A TIGHTER stop needs no end date: it can only make the rule stricter.
 */
export interface StopOverride {
  /** Negative percent from entry, like `stopLossPct`. */
  stopLossPct: number;
  decided: string;
  /** Last day it applies, YYYY-MM-DD in New York. Required for a looser stop. */
  until: string;
  reason: string;
}

export interface RiskRules {
  /** Negative percent, e.g. -7 means "sell at 7% below entry". */
  stopLossPct: number;
  /** Fraction of the portfolio, e.g. 0.25 for 25%. */
  defaultMaxWeight: number;
  /** Gain at which a position past its ceiling becomes a trim candidate. */
  trimProfitPct: number;
  /** Per-symbol ceilings. */
  overrides: Record<string, RiskOverride>;
  /** Per-symbol stops, time-boxed when looser than the default. */
  stopOverrides: Record<string, StopOverride>;
}

export const DEFAULT_RISK_RULES: RiskRules = {
  stopLossPct: -7,
  defaultMaxWeight: 0.25,
  trimProfitPct: 25,
  overrides: {},
  stopOverrides: {},
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

function parseStopOverrides(raw: Record<string, unknown>): Record<string, StopOverride> {
  const out: Record<string, StopOverride> = {};
  for (const [symbol, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const o = value as Record<string, unknown>;
    // A stop is a loss: zero or above is a typo, not a rule.
    if (typeof o.stopLossPct !== "number" || !Number.isFinite(o.stopLossPct) || o.stopLossPct >= 0) {
      continue;
    }
    out[symbol.toUpperCase()] = {
      stopLossPct: o.stopLossPct,
      decided: String(o.decided ?? ""),
      until: String(o.until ?? ""),
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
    stopOverrides: parseStopOverrides(pickObject(raw, "stopOverrides")),
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

export interface StopRule {
  /** The stop that applies to this symbol today, negative percent from entry. */
  pct: number;
  /** The exception in force, or null when the default applies. */
  exception: StopOverride | null;
  /**
   * An exception on file that does NOT apply: past its end date, or a looser
   * stop with no end date. The default applies, and alerts should say why.
   */
  lapsed: StopOverride | null;
}

/** True when a stop exception would loosen the default rather than tighten it. */
export function isLooser(o: StopOverride, rules: RiskRules): boolean {
  return o.stopLossPct < rules.stopLossPct;
}

/**
 * This symbol's stop today: its exception while one is in force, else the
 * default. `today` is a New York date, YYYY-MM-DD; `until` is inclusive.
 */
export function stopFor(
  symbol: string,
  rules: RiskRules,
  today: string = easternDate(new Date()),
): StopRule {
  const o = rules.stopOverrides[symbol.toUpperCase()];
  const fallback: StopRule = { pct: rules.stopLossPct, exception: null, lapsed: null };
  if (!o) return fallback;
  const dated = ISO_DATE.test(o.until);
  if ((dated && today > o.until) || (!dated && isLooser(o, rules))) {
    return { ...fallback, lapsed: o };
  }
  return { pct: o.stopLossPct, exception: o, lapsed: null };
}

/** Why an exception on file does not apply, for an alert: "ran out on …". */
export function lapsedReason(o: StopOverride): string {
  return ISO_DATE.test(o.until)
    ? `ran out on ${o.until}`
    : "has no end date, so it does not apply";
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

  const stopSymbols = [
    ...new Set([...Object.keys(before.stopOverrides), ...Object.keys(after.stopOverrides)]),
  ];
  const ends = (o: StopOverride): string => (o.until ? ` until ${o.until}` : "");
  for (const sym of stopSymbols.sort()) {
    const a = before.stopOverrides[sym];
    const b = after.stopOverrides[sym];
    if (a && !b) {
      out.push(`${sym} stop exception removed — back to the ${pct(after.stopLossPct)} default`);
    } else if (!a && b) {
      out.push(`${sym} stop set to ${pct(b.stopLossPct)}${ends(b)} (exception: ${b.reason})`);
    } else if (
      a &&
      b &&
      (a.stopLossPct !== b.stopLossPct || a.until !== b.until || a.reason !== b.reason)
    ) {
      out.push(
        `${sym} stop ${pct(a.stopLossPct)}${ends(a)} → ${pct(b.stopLossPct)}${ends(b)} ` +
          `(exception: ${b.reason})`,
      );
    }
  }
  return out;
}
