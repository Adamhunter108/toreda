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
  return arr.map((raw): Position => {
    const p = raw as Record<string, unknown>;
    return {
      symbol: String(p.symbol),
      qty: num(p.qty),
      avgEntry: num(p.avg_entry_price),
      costBasis: num(p.cost_basis),
      marketValue: num(p.market_value),
      unrealizedPl: num(p.unrealized_pl),
      unrealizedPlPct: num(p.unrealized_plpc),
      changeToday: num(p.change_today),
      prevClose: num(p.lastday_price),
      currentPrice: num(p.current_price),
    };
  });
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
