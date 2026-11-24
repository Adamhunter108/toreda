// The watchlist panel's rows: one per watchlist symbol, priced or not.

import type { Snapshot } from "../core/market-data";

/** A snapshot, or a placeholder for a symbol the feed returned nothing for. */
export type WatchRow = Snapshot & { noData?: true };

/**
 * One row for every watchlist symbol.
 *
 * A symbol with no snapshot gets a "no data" row rather than vanishing. A
 * missing row reads exactly like a symbol that was never added, which is how
 * a stock on its first day of trading went unseen in this panel.
 *
 * Until the first snapshots arrive there are no rows at all, so the panel
 * says "loading…" rather than calling everything missing.
 */
export function watchRows(snapshots: readonly Snapshot[], symbols: readonly string[]): WatchRow[] {
  if (snapshots.length === 0) return [];
  const have = new Set(snapshots.map((s) => s.symbol));
  const missing: WatchRow[] = symbols
    .filter((s) => !have.has(s))
    .map((symbol) => ({
      symbol,
      price: 0,
      changePct: 0,
      prevClose: 0,
      prevVolume: 0,
      dailyVolume: 0,
      barDate: "",
      noData: true,
    }));
  return [...snapshots, ...missing];
}
