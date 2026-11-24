import { test } from "node:test";
import assert from "node:assert/strict";
import type { Snapshot } from "../core/market-data";
import { watchRows } from "./watch-rows";
import { sortWatchlist } from "./watchlist-sort";

const snap = (symbol: string, changePct: number, over: Partial<Snapshot> = {}): Snapshot => ({
  symbol,
  price: 100,
  changePct,
  prevClose: 100,
  prevVolume: 1_000,
  dailyVolume: 500,
  barDate: "2026-01-06",
  ...over,
});

// The panel used to list only what the feed returned, so a symbol with no
// data looked exactly like one that was never on the watchlist.
test("a watchlist symbol with no snapshot gets a no-data row instead of vanishing", () => {
  const rows = watchRows([snap("AAA", 1)], ["AAA", "ZZZ"]);
  assert.deepEqual(rows.map((r) => [r.symbol, r.noData ?? false]), [["AAA", false], ["ZZZ", true]]);
});

test("before any snapshot arrives there are no rows, so the panel says loading", () => {
  assert.deepEqual(watchRows([], ["AAA", "ZZZ"]), []);
});

test("by move, a no-data row goes last, below even a flat one", () => {
  const rows = watchRows([snap("AAA", 0), snap("BBB", -2)], ["AAA", "BBB", "ZZZ"]);
  assert.deepEqual(sortWatchlist(rows, "move", []).map((r) => r.symbol), ["BBB", "AAA", "ZZZ"]);
});

// In your own order a gap where you expect a name is the thing to notice.
test("in your order, a no-data row keeps its place", () => {
  const rows = watchRows([snap("AAA", 1), snap("BBB", 2)], ["AAA", "BBB", "ZZZ"]);
  assert.deepEqual(sortWatchlist(rows, "custom", ["ZZZ", "AAA", "BBB"]).map((r) => r.symbol), ["ZZZ", "AAA", "BBB"]);
});

test("a since-open row ranks by its move like any other", () => {
  const rows = watchRows([snap("AAA", 1), snap("NEWCO", -9, { sinceOpen: true, prevClose: 0 })], ["AAA", "NEWCO"]);
  assert.deepEqual(sortWatchlist(rows, "move", []).map((r) => r.symbol), ["NEWCO", "AAA"]);
});
