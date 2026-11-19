import { test } from "node:test";
import assert from "node:assert/strict";
import type { Snapshot } from "../core/market-data";
import { WATCHLIST_SORTS, type WatchlistSort } from "../core/ui-config";
import { nextWatchlistSort, sortWatchlist, WATCHLIST_SORT_LABELS } from "./watchlist-sort";

const snap = (symbol: string, changePct: number): Snapshot => ({
  symbol,
  price: 100,
  changePct,
  prevClose: 100,
  prevVolume: 1_000,
  dailyVolume: 500,
  barDate: "2026-01-02",
});

const MOVERS = [snap("BBB", 1), snap("AAA", -3), snap("DDD", 0.5), snap("CCC", 2)];
const syms = (rows: Snapshot[]): string[] => rows.map((r) => r.symbol);

test("by move ranks the biggest move first, up or down", () => {
  assert.deepEqual(syms(sortWatchlist(MOVERS, "move", [])), ["AAA", "CCC", "BBB", "DDD"]);
});

test("A–Z is alphabetical", () => {
  assert.deepEqual(syms(sortWatchlist(MOVERS, "symbol", [])), ["AAA", "BBB", "CCC", "DDD"]);
});

test("your order follows the list, with anything it does not name last", () => {
  assert.deepEqual(syms(sortWatchlist(MOVERS, "custom", ["DDD", "BBB"])), ["DDD", "BBB", "AAA", "CCC"]);
});

test("sorting does not reorder the caller's array", () => {
  const before = syms(MOVERS);
  sortWatchlist(MOVERS, "symbol", []);
  assert.deepEqual(syms(MOVERS), before);
});

test("s cycles through every sort and back", () => {
  let s: WatchlistSort = WATCHLIST_SORTS[0];
  const seen = new Set<WatchlistSort>([s]);
  for (let i = 0; i < WATCHLIST_SORTS.length; i++) {
    s = nextWatchlistSort(s, WATCHLIST_SORTS);
    seen.add(s);
  }
  assert.equal(s, WATCHLIST_SORTS[0]);
  assert.equal(seen.size, WATCHLIST_SORTS.length);
});

test("every title fits the 30 columns inside the narrow watchlist panel", () => {
  for (const label of Object.values(WATCHLIST_SORT_LABELS)) {
    const title = `Watchlist Δ today · ${label}`;
    assert.ok(title.length <= 30, `"${title}" is ${title.length} columns`);
  }
});
