// How the watchlist panel orders its rows. Pure, so it can be tested without a
// terminal; App.tsx owns which sort is active and persists it to config/ui.json.

import type { Snapshot } from "../core/market-data";
import type { WatchlistSort } from "../core/ui-config";

/** Title-bar label for each sort. Short: the panel is 30 columns inside. */
export const WATCHLIST_SORT_LABELS: Record<WatchlistSort, string> = {
  move: "by move",
  custom: "your order",
  symbol: "A–Z",
};

/**
 * Order the panel's rows.
 *
 * - `move`: largest absolute move today first, up or down, so the cursor
 *   lands on something worth looking at rather than whatever is first
 *   alphabetically.
 * - `custom`: the order from config/watchlist.json (`ordered`). A symbol it
 *   does not list (a held position, say) goes last rather than vanishing.
 * - `symbol`: A–Z.
 */
export function sortWatchlist(
  movers: readonly Snapshot[],
  sort: WatchlistSort,
  ordered: readonly string[],
): Snapshot[] {
  const rows = [...movers];
  if (sort === "symbol") return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  if (sort === "custom") {
    const rank = new Map(ordered.map((s, i) => [s, i]));
    const at = (s: string): number => rank.get(s) ?? Number.MAX_SAFE_INTEGER;
    return rows.sort((a, b) => at(a.symbol) - at(b.symbol) || a.symbol.localeCompare(b.symbol));
  }
  return rows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

/** The sort after `current`, for the `s` key. */
export function nextWatchlistSort(current: WatchlistSort, sorts: readonly WatchlistSort[]): WatchlistSort {
  return sorts[(sorts.indexOf(current) + 1) % sorts.length]!;
}
