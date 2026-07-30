// Realized profit and loss, reconstructed from trade history.
//
// Alpaca has no "realized P&L" field, so sells are matched against prior buys
// FIFO — first in, first out — which is the standard cost-basis convention.
//
// Caveat, surfaced rather than hidden: if the activity history does not reach
// far enough back to include the buys behind an early sell, that sell has no
// known basis. Those shares are reported as `unmatchedSells` instead of being
// guessed at, because a confidently wrong P&L is worse than an incomplete one.

import { authHeaders, loadConfig } from "./config";
import { demoRealized, isDemoMode } from "./demo";
import { getJson } from "./http";

export interface Fill {
  symbol: string;
  side: string;
  qty: number;
  price: number;
  /** ISO timestamp. */
  time: string;
  id: string;
}

export interface Realized {
  /** Realized dollar P&L across all matched lots. */
  total: number;
  /** Shares sold with no known cost basis in the available history. */
  unmatchedSells: number;
  /** Per-symbol realized P&L, for a breakdown view. */
  bySymbol: Record<string, number>;
}

export async function fetchFills(maxPages = 50): Promise<Fill[]> {
  const cfg = loadConfig();
  const out: Fill[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    // Alpaca returns newest-first; page backwards using the last id as a token.
    const url =
      `${cfg.tradeHost}/v2/account/activities/FILL?page_size=100` +
      (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : "");
    const arr = await getJson<unknown>(url, { headers: authHeaders(cfg) });
    if (!Array.isArray(arr) || arr.length === 0) break;

    for (const raw of arr) {
      const f = raw as Record<string, unknown>;
      out.push({
        symbol: String(f.symbol),
        side: String(f.side),
        qty: Number(f.qty) || 0,
        price: Number(f.price) || 0,
        time: String(f.transaction_time ?? ""),
        id: String(f.id ?? ""),
      });
    }
    if (arr.length < 100) break;
    const last = arr[arr.length - 1] as Record<string, unknown>;
    pageToken = String(last.id ?? "");
    if (!pageToken) break;
  }
  return out;
}

/**
 * Match sells against buys FIFO and total the difference.
 *
 * Pure and exported separately from the fetch so it can be tested against
 * hand-built fill sequences without touching the network.
 */
export function computeRealized(fills: Fill[]): Realized {
  // Oldest first, so lots accumulate before sells consume them.
  const ascending = [...fills].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  const lots: Record<string, Array<{ qty: number; price: number }>> = {};
  const bySymbol: Record<string, number> = {};
  let total = 0;
  let unmatchedSells = 0;

  for (const fill of ascending) {
    const queue = (lots[fill.symbol] ??= []);

    if (fill.side === "buy") {
      queue.push({ qty: fill.qty, price: fill.price });
      continue;
    }
    if (fill.side !== "sell") continue;

    let remaining = fill.qty;
    while (remaining > 1e-9 && queue.length > 0) {
      const lot = queue[0]!;
      const take = Math.min(remaining, lot.qty);
      const gain = take * (fill.price - lot.price);
      total += gain;
      bySymbol[fill.symbol] = (bySymbol[fill.symbol] ?? 0) + gain;
      lot.qty -= take;
      remaining -= take;
      if (lot.qty <= 1e-9) queue.shift();
    }
    // History did not reach back far enough to cover this sell.
    if (remaining > 1e-9) unmatchedSells += remaining;
  }

  return { total, unmatchedSells, bySymbol };
}

export async function getRealized(): Promise<Realized> {
  if (isDemoMode()) return demoRealized();
  return computeRealized(await fetchFills());
}
