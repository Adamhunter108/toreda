// Your risk rules, from config/risk.json.
//
// These do not block anything — `toreda order` places whatever you confirm.
// They decide when the scanner taps you on the shoulder. Set them where you
// would ACTUALLY want warning: a threshold you intend to ignore is worse than
// none, because it trains you to skim the block where real breaches appear.

import {
  loadJsonConfig,
  pickNumber,
  pickObject,
  pickStringArray,
  saveJsonConfig,
} from "./json-config";
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

/**
 * Stops sized to each stock and measured from its high.
 *
 * One percentage cannot fit everything: −10% is a market correction for an
 * index fund and two ordinary days for a volatile chip stock. And measured from
 * entry, a stop says nothing while a winner gives back most of its gain: a
 * position up 80% has its stop half the price away.
 */
export interface StopSizing {
  /** The stop is this many times the stock's typical two-week move. 0 turns sizing off. */
  volMultiple: number;
  /** The tightest a sized stop may be, negative percent (−8). */
  narrowestPct: number;
  /** The widest a sized stop may be, negative percent (−30). */
  widestPct: number;
  /** Measure from the highest close since you bought, when above your entry. */
  trailing: boolean;
}

export interface RiskRules {
  /**
   * Negative percent, e.g. -7 means "sell at 7% below entry". With `stopSizing`
   * on, this is the stop for a stock with too little history to size one.
   */
  stopLossPct: number;
  /** Fraction of the portfolio, e.g. 0.25 for 25%. */
  defaultMaxWeight: number;
  /** Gain at which a position past its ceiling becomes a trim candidate. */
  trimProfitPct: number;
  /** Per-symbol ceilings. */
  overrides: Record<string, RiskOverride>;
  /** Per-symbol stops, time-boxed when looser than the default. */
  stopOverrides: Record<string, StopOverride>;
  /** Null keeps the single `stopLossPct`, measured from entry. */
  stopSizing: StopSizing | null;
  /**
   * Broad funds held as the core of the account. They have no stop: selling an
   * index fund into a correction is the opposite of why it is held.
   */
  coreSymbols: string[];
}

export const DEFAULT_RISK_RULES: RiskRules = {
  stopLossPct: -7,
  defaultMaxWeight: 0.25,
  trimProfitPct: 25,
  overrides: {},
  stopOverrides: {},
  stopSizing: null,
  coreSymbols: [],
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

/**
 * Null when absent or unusable. A malformed block falls back to the plain stop
 * rather than to a half-read one: a stop sized from a guessed number is worse
 * than the one the file plainly states.
 */
export function parseStopSizing(raw: unknown): StopSizing | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const volMultiple = n(o.volMultiple);
  const narrowestPct = n(o.narrowestPct);
  const widestPct = n(o.widestPct);
  if (volMultiple === null || narrowestPct === null || widestPct === null) return null;
  // Stops are losses, and the widest cannot be tighter than the narrowest.
  if (volMultiple < 0 || narrowestPct >= 0 || widestPct > narrowestPct) return null;
  return { volMultiple, narrowestPct, widestPct, trailing: o.trailing !== false };
}

export function loadRiskRules(): RiskRules {
  return loadJsonConfig<RiskRules>("risk.json", DEFAULT_RISK_RULES, (raw, defaults) => ({
    stopLossPct: pickNumber(raw, "stopLossPct", defaults.stopLossPct),
    defaultMaxWeight: pickNumber(raw, "defaultMaxWeight", defaults.defaultMaxWeight),
    trimProfitPct: pickNumber(raw, "trimProfitPct", defaults.trimProfitPct),
    overrides: parseOverrides(pickObject(raw, "overrides")),
    stopOverrides: parseStopOverrides(pickObject(raw, "stopOverrides")),
    stopSizing: parseStopSizing(raw.stopSizing),
    coreSymbols: pickStringArray(raw, "coreSymbols", defaults.coreSymbols).map((s) =>
      s.toUpperCase(),
    ),
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
  /** The stop that applies to this symbol today, negative percent. */
  pct: number;
  /** The exception in force, or null when the default applies. */
  exception: StopOverride | null;
  /**
   * An exception on file that does NOT apply: past its end date, or a looser
   * stop with no end date. The default applies, and alerts should say why.
   */
  lapsed: StopOverride | null;
}

/**
 * True when a stop exception would loosen the stop it replaces rather than
 * tighten it. `basePct` is that stop: the symbol's sized stop, or the default.
 */
export function isLooser(o: StopOverride, basePct: number): boolean {
  return o.stopLossPct < basePct;
}

/**
 * This symbol's stop today: its exception while one is in force, else
 * `basePct`, which is the default unless the stop is sized to the stock.
 * `today` is a New York date, YYYY-MM-DD; `until` is inclusive.
 */
export function stopFor(
  symbol: string,
  rules: RiskRules,
  today: string = easternDate(new Date()),
  basePct: number = rules.stopLossPct,
): StopRule {
  const o = rules.stopOverrides[symbol.toUpperCase()];
  const fallback: StopRule = { pct: basePct, exception: null, lapsed: null };
  if (!o) return fallback;
  const dated = ISO_DATE.test(o.until);
  if ((dated && today > o.until) || (!dated && isLooser(o, basePct))) {
    return { ...fallback, lapsed: o };
  }
  return { pct: o.stopLossPct, exception: o, lapsed: null };
}

/** True for a core fund, which has no stop. */
export function isCore(symbol: string, rules: RiskRules): boolean {
  return rules.coreSymbols.includes(symbol.toUpperCase());
}

/**
 * What a stop is measured from, worked out from fills and price history (see
 * scanner/stops.ts). Facts only: the rules turn them into a stop.
 */
export interface StopBasis {
  /** First day of the current holding, New York date. Null when unknown. */
  since: string | null;
  /**
   * The stock's typical two-week move, percent, from the trading days before
   * `since`. Fixed when you bought: a crash raises a stock's volatility, and a
   * width recomputed afterwards would widen exactly when it should fire.
   */
  twoWeekMovePct: number | null;
  /** Highest close from `since` up to yesterday, and its date. */
  high: number | null;
  highDate: string | null;
  /** Why the stop could not be sized, when it could not. */
  note: string | null;
}

export interface StopLevel {
  /** The stop in force, negative percent below `anchor`. */
  pct: number;
  /** The stop without any exception: sized to the stock, or the default. */
  basePct: number;
  /** True when `basePct` was sized to the stock rather than the default. */
  sized: boolean;
  /** What the stop is measured from: your entry, or the high when above it. */
  anchor: number;
  fromHigh: boolean;
  highDate: string | null;
  /** The price at which the rule is reached. */
  price: number;
  /** Where the stop would be without the exception. */
  basePrice: number;
  exception: StopOverride | null;
  lapsed: StopOverride | null;
  /** Why the stop is the default rather than sized, when sizing is on. */
  note: string | null;
}

/** The stop sized to this stock, or null when sizing is off or impossible. */
export function sizedStopPct(basis: StopBasis | undefined, sizing: StopSizing | null): number | null {
  if (!sizing || sizing.volMultiple <= 0 || !basis || basis.twoWeekMovePct === null) return null;
  const width = sizing.volMultiple * basis.twoWeekMovePct;
  const clamped = Math.min(Math.abs(sizing.widestPct), Math.max(Math.abs(sizing.narrowestPct), width));
  return -Math.round(clamped * 10) / 10;
}

/**
 * Where this position's stop is today. Null for a core fund, which has none.
 *
 * Without a basis (sizing off, or history unavailable) this is exactly the old
 * rule: the default or the exception, measured from entry.
 */
export function stopLevel(
  symbol: string,
  avgEntry: number,
  basis: StopBasis | undefined,
  rules: RiskRules,
  today: string = easternDate(new Date()),
): StopLevel | null {
  if (isCore(symbol, rules)) return null;
  const sized = sizedStopPct(basis, rules.stopSizing);
  const basePct = sized ?? rules.stopLossPct;
  const rule = stopFor(symbol, rules, today, basePct);
  const high = rules.stopSizing?.trailing ? (basis?.high ?? null) : null;
  const fromHigh = high !== null && high > avgEntry;
  const anchor = fromHigh ? high : avgEntry;
  return {
    pct: rule.pct,
    basePct,
    sized: sized !== null,
    anchor,
    fromHigh,
    highDate: fromHigh ? (basis?.highDate ?? null) : null,
    price: anchor * (1 + rule.pct / 100),
    basePrice: anchor * (1 + basePct / 100),
    exception: rule.exception,
    lapsed: rule.lapsed,
    note: rules.stopSizing && sized === null ? (basis?.note ?? "no price history yet") : null,
  };
}

/**
 * How far the position is below what its stop is measured from, percent
 * (−18.2 means 18.2% below). From entry this is the P&L itself.
 */
export function belowAnchorPct(level: StopLevel, price: number | undefined, plPct: number): number {
  if (!level.fromHigh || price === undefined) return plPct;
  return (price / level.anchor - 1) * 100;
}

/**
 * True at or past the stop. Boundary inclusive: at exactly the stop, the rule
 * has been reached. `basePct` checks the stop without its exception.
 */
export function isPastStop(
  level: StopLevel,
  price: number | undefined,
  plPct: number,
  which: "inForce" | "base" = "inForce",
): boolean {
  const pct = which === "base" ? level.basePct : level.pct;
  return belowAnchorPct(level, price, plPct) <= pct + 1e-9;
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
  const sizing = (s: StopSizing | null): string =>
    s
      ? `${s.volMultiple}× the stock's two-week move, ${pct(s.narrowestPct)} to ${pct(s.widestPct)}` +
        (s.trailing ? ", from the high" : ", from entry")
      : `one stop from entry`;
  if (JSON.stringify(before.stopSizing) !== JSON.stringify(after.stopSizing)) {
    out.push(`stops: ${sizing(before.stopSizing)} → ${sizing(after.stopSizing)}`);
  }
  const core = (list: string[]): string => (list.length ? list.join(", ") : "none");
  if (core(before.coreSymbols) !== core(after.coreSymbols)) {
    out.push(`core funds (no stop): ${core(before.coreSymbols)} → ${core(after.coreSymbols)}`);
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
      out.push(
        after.stopSizing
          ? `${sym} stop exception removed — back to its own sized stop`
          : `${sym} stop exception removed — back to the ${pct(after.stopLossPct)} default`,
      );
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
