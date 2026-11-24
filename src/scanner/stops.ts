// What each position's stop is measured from: when you bought, how much the
// stock moved before that, and its highest close since.
//
// Pure functions first, so the rules are testable on hand-built fills and bars;
// the one network function, `loadStopBases`, is last.

import { fetchFills, type Fill } from "../core/activities";
import { isDemoMode } from "../core/demo";
import { type Bar, getDailyBars } from "../core/market-data";
import { isCore, type RiskRules, type StopBasis } from "../core/risk";
import { easternDate } from "../core/transfers";
import { dailyVolPct } from "./volatility";

/** Trading days before a purchase that its stop is sized from. */
export const SIZING_DAYS = 60;
/** Fewer than this many returns is too few to size a stop on. */
export const MIN_SIZING_DAYS = 20;
/** Trading days in "two weeks", for scaling daily volatility. */
const TWO_WEEKS = 10;

const QTY_EPSILON = 1e-6;

/**
 * The first day of each symbol's current holding: the last buy that took it
 * up from nothing. Partial sells do not reset it; selling out does.
 *
 * Null when the fills cannot account for the shares held today, which means
 * the history does not reach back to the purchase, or a split or transfer
 * changed the share count. A stop measured from a guessed date would be worse
 * than one that says it fell back to the default.
 */
export function holdingStarts(
  fills: Fill[],
  held: Record<string, number>,
): Record<string, string | null> {
  const ascending = [...fills].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  const qty: Record<string, number> = {};
  const start: Record<string, string> = {};
  for (const f of ascending) {
    const before = qty[f.symbol] ?? 0;
    if (f.side === "buy") {
      if (before <= QTY_EPSILON) start[f.symbol] = easternDate(new Date(f.time));
      qty[f.symbol] = before + f.qty;
    } else if (f.side === "sell") {
      qty[f.symbol] = before - f.qty;
    }
  }
  const out: Record<string, string | null> = {};
  for (const [symbol, shares] of Object.entries(held)) {
    const fromFills = qty[symbol] ?? 0;
    out[symbol] = Math.abs(fromFills - shares) <= QTY_EPSILON ? (start[symbol] ?? null) : null;
  }
  return out;
}

const dateOf = (bar: Bar): string => bar.time.slice(0, 10);

/**
 * The stop basis for one holding, from its daily bars.
 *
 * The width comes from the trading days BEFORE the purchase, so it is fixed
 * when you buy. The high counts closes from the purchase day up to yesterday;
 * today's bar is still moving, and an intraday spike is not a close.
 */
export function stopBasisFrom(bars: Bar[], since: string | null, today: string): StopBasis {
  if (since === null) {
    return {
      since: null,
      twoWeekMovePct: null,
      high: null,
      highDate: null,
      note: "the purchase is not in your fill history",
    };
  }

  const before = bars.filter((b) => dateOf(b) < since).slice(-(SIZING_DAYS + 1));
  const vol =
    before.length > MIN_SIZING_DAYS
      ? dailyVolPct({ closes: before.map((b) => b.close), volumes: [], latest: 0 })
      : null;

  let high: number | null = null;
  let highDate: string | null = null;
  for (const b of bars) {
    const d = dateOf(b);
    if (d < since || d >= today) continue;
    if (high === null || b.close > high) {
      high = b.close;
      highDate = d;
    }
  }

  return {
    since,
    twoWeekMovePct: vol === null ? null : vol * Math.sqrt(TWO_WEEKS),
    high,
    highDate,
    note: vol === null ? `fewer than ${MIN_SIZING_DAYS} trading days of history before you bought` : null,
  };
}

export interface StopBases {
  bases: Record<string, StopBasis>;
  /** Set when history could not be fetched, for a degraded-scan notice. */
  problem: string | null;
}

/**
 * Stop bases for every held position that has a stop. Empty when sizing is off,
 * in demo mode, or when nothing is held.
 */
export async function loadStopBases(
  positions: Array<{ symbol: string; qty: number }>,
  rules: RiskRules,
  now = new Date(),
): Promise<StopBases> {
  if (!rules.stopSizing || isDemoMode()) return { bases: {}, problem: null };
  const held: Record<string, number> = {};
  for (const p of positions) if (!isCore(p.symbol, rules)) held[p.symbol] = p.qty;
  const symbols = Object.keys(held);
  if (symbols.length === 0) return { bases: {}, problem: null };

  let fills: Fill[];
  try {
    fills = await fetchFills();
  } catch {
    return {
      bases: {},
      problem: "purchase history unavailable — stops measured from entry at your default",
    };
  }
  const starts = holdingStarts(fills, held);
  const today = easternDate(now);

  const dated = Object.values(starts).filter((d): d is string => d !== null);
  const earliest = dated.length ? dated.sort()[0]! : today;
  // About 1.45 calendar days per trading day, plus a margin for holidays.
  const lookbackDays =
    Math.ceil((now.getTime() - Date.parse(earliest)) / 86_400_000) + Math.ceil(SIZING_DAYS * 1.5) + 10;

  let bars: Record<string, Bar[]>;
  try {
    bars = await getDailyBars(symbols, lookbackDays);
  } catch {
    return {
      bases: {},
      problem: "price history unavailable — stops measured from entry at your default",
    };
  }

  const bases: Record<string, StopBasis> = {};
  for (const symbol of symbols) {
    bases[symbol] = stopBasisFrom(bars[symbol] ?? [], starts[symbol] ?? null, today);
  }
  return { bases, problem: null };
}
