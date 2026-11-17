// Alpaca's trading API: account, positions, assets, clock.
//
// The SLOW path. These change only when you trade, so callers poll them lazily
// (20-30s in the dashboard) — nowhere near the ~200 req/min rate limit. Live
// prices come from the WebSocket stream instead; see price-stream.ts.
//
// Every host map that used to be copy-pasted into four modules now comes from
// config.ts, so "which endpoint does paper use" has exactly one answer.

import { authHeaders, loadConfig } from "./config";
import { demoAccount, demoAsset, demoClock, demoPositions, isDemoMode } from "./demo";
import { getJson } from "./http";
import type { Account, Asset, Clock, Position } from "./types";

/** Alpaca sends numbers as strings; a missing or unparseable one is 0. */
function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function tradeUrl(path: string): string {
  return loadConfig().tradeHost + path;
}

export async function getAccount(): Promise<Account> {
  if (isDemoMode()) return demoAccount();
  const a = await getJson<Record<string, unknown>>(tradeUrl("/v2/account"), {
    headers: authHeaders(),
  });
  // A response without an account number is not an account, whatever else it
  // contains. Fail here rather than render a portfolio of zeroes.
  if (typeof a.account_number !== "string") {
    throw new Error(`Alpaca /v2/account returned no account_number: ${JSON.stringify(a).slice(0, 200)}`);
  }
  return {
    equity: num(a.equity),
    lastEquity: num(a.last_equity),
    buyingPower: num(a.buying_power),
    cash: num(a.cash),
    portfolioValue: num(a.portfolio_value),
    accountNumber: a.account_number,
    status: String(a.status ?? ""),
    patternDayTrader: Boolean(a.pattern_day_trader),
    daytradingBuyingPower:
      a.daytrading_buying_power == null ? null : num(a.daytrading_buying_power),
  };
}

export async function getPositions(): Promise<Position[]> {
  if (isDemoMode()) return demoPositions();
  const arr = await getJson<unknown>(tradeUrl("/v2/positions"), { headers: authHeaders() });
  // A genuinely flat account is `[]`, which is fine. Anything that is not an
  // array is an error payload wearing a different shape — say so.
  if (!Array.isArray(arr)) {
    throw new Error(`Alpaca /v2/positions did not return a list: ${JSON.stringify(arr).slice(0, 200)}`);
  }
  return arr.map((raw) => parsePosition(raw as Record<string, unknown>));
}

/**
 * Today's gain or loss on a position, optionally re-marked to a live price.
 *
 * The basis is what the position stood at when your day began: shares held
 * overnight at the previous close, plus what you paid for shares bought today.
 * That is `value − dayPl`, whichever way the position was built.
 */
export function positionDay(
  p: Position,
  price = p.currentPrice,
): { amount: number; pct: number } {
  const amount = p.dayPl + p.qty * (price - p.currentPrice);
  const basis = p.qty * p.currentPrice - p.dayPl;
  return { amount, pct: basis ? amount / Math.abs(basis) : 0 };
}

/**
 * One entry of `/v2/positions`.
 *
 * Today's figures come from `unrealized_intraday_pl`, not `change_today`.
 * `change_today` is the stock's move since the previous close; on a position
 * opened today it charges you for a drop that happened before you bought.
 * Shares bought at $95 after a $100 close, now at $96, would show DAY −4%
 * while up 1% on what was paid.
 */
export function parsePosition(p: Record<string, unknown>): Position {
  const qty = num(p.qty);
  const currentPrice = num(p.current_price);
  const prevClose = num(p.lastday_price);
  const intraday = Number(p.unrealized_intraday_pl);
  const hasIntraday = p.unrealized_intraday_pl != null && p.unrealized_intraday_pl !== "";
  const position: Position = {
    symbol: String(p.symbol),
    qty,
    avgEntry: num(p.avg_entry_price),
    costBasis: num(p.cost_basis),
    marketValue: num(p.market_value),
    unrealizedPl: num(p.unrealized_pl),
    unrealizedPlPct: num(p.unrealized_plpc),
    // Without Alpaca's figure, fall back to the stock's move: right for shares
    // held overnight, which is every share on any day you did not buy.
    dayPl:
      hasIntraday && Number.isFinite(intraday) ? intraday : qty * (currentPrice - prevClose),
    changeToday: 0,
    prevClose,
    currentPrice,
  };
  position.changeToday = positionDay(position).pct;
  return position;
}

/** Look up a symbol. Returns null when Alpaca has no such asset. */
export async function getAsset(symbol: string): Promise<Asset | null> {
  if (isDemoMode()) return demoAsset(symbol);
  try {
    const a = await getJson<Record<string, unknown>>(
      tradeUrl(`/v2/assets/${encodeURIComponent(symbol.toUpperCase())}`),
      { headers: authHeaders() },
    );
    if (!a.symbol) return null;
    return {
      symbol: String(a.symbol),
      name: String(a.name ?? ""),
      tradable: Boolean(a.tradable),
      fractionable: Boolean(a.fractionable),
    };
  } catch {
    // A 404 is the expected answer for an unknown ticker, not a fault.
    return null;
  }
}

export async function getClock(): Promise<Clock> {
  if (isDemoMode()) return demoClock();
  const c = await getJson<Record<string, unknown>>(tradeUrl("/v2/clock"), {
    headers: authHeaders(),
  });
  return {
    isOpen: Boolean(c.is_open),
    nextOpen: String(c.next_open ?? ""),
    nextClose: String(c.next_close ?? ""),
  };
}
