import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSnapshot, type RawSnapshot } from "./market-data";

// Shaped like Alpaca's /v2/stocks/snapshots entries, with made-up figures.
const ordinary: RawSnapshot = {
  latestTrade: { p: 105 },
  dailyBar: { o: 101, c: 104.5, v: 9_000, t: "2026-01-06T05:00:00Z" },
  prevDailyBar: { c: 100, v: 20_000 },
};

// A stock's first day: today's bar, and no prevDailyBar at all.
const firstDay: RawSnapshot = {
  latestTrade: { p: 45 },
  dailyBar: { o: 50, c: 45.5, v: 3_000, t: "2026-01-06T05:00:00Z" },
};

test("an ordinary snapshot measures today's move from the previous close", () => {
  const s = parseSnapshot("AAA", ordinary)!;
  assert.equal(s.changePct, 5);
  assert.equal(s.prevClose, 100);
  assert.equal(s.prevVolume, 20_000);
  assert.equal(s.sinceOpen, undefined);
});

// It used to be dropped, which hid a new listing from the watchlist on its
// first day as completely as if it had never been added.
test("with no previous session, the move is measured from today's open, and flagged", () => {
  const s = parseSnapshot("NEWCO", firstDay)!;
  assert.equal(s.sinceOpen, true);
  assert.equal(s.changePct, -10);
  assert.equal(s.price, 45);
  assert.equal(s.prevClose, 0);
  assert.equal(s.prevVolume, 0);
  assert.equal(s.dailyVolume, 3_000);
});

test("with no price at all there is no snapshot", () => {
  assert.equal(parseSnapshot("AAA", { prevDailyBar: { c: 100 } }), null);
});

test("with neither a previous close nor an open there is nothing to measure from", () => {
  assert.equal(parseSnapshot("AAA", { latestTrade: { p: 45 } }), null);
});

test("the last trade is preferred over the daily bar's close", () => {
  assert.equal(parseSnapshot("AAA", ordinary)!.price, 105);
  assert.equal(parseSnapshot("AAA", { ...ordinary, latestTrade: {} })!.price, 104.5);
});
