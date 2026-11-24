import { test } from "node:test";
import assert from "node:assert/strict";
import type { Fill } from "../core/activities";
import type { Bar } from "../core/market-data";
import { holdingStarts, MIN_SIZING_DAYS, stopBasisFrom } from "./stops";

// Made-up fills and prices throughout.

let n = 0;
const fill = (symbol: string, side: "buy" | "sell", qty: number, time: string): Fill => ({
  symbol,
  side,
  qty,
  price: 100,
  time,
  id: String(n++),
});

test("a holding starts at the buy that took it up from nothing", () => {
  const fills = [
    fill("AAA", "buy", 2, "2026-03-02T15:00:00Z"),
    fill("AAA", "buy", 1, "2026-04-01T15:00:00Z"),
    fill("AAA", "sell", 1, "2026-05-01T15:00:00Z"),
  ];
  assert.deepEqual(holdingStarts(fills, { AAA: 2 }), { AAA: "2026-03-02" });
});

test("selling out and buying back starts a new holding", () => {
  const fills = [
    fill("AAA", "buy", 2, "2026-03-02T15:00:00Z"),
    fill("AAA", "sell", 2, "2026-04-01T15:00:00Z"),
    fill("AAA", "buy", 1, "2026-05-04T15:00:00Z"),
  ];
  assert.deepEqual(holdingStarts(fills, { AAA: 1 }), { AAA: "2026-05-04" });
});

test("fills in any order are read oldest first", () => {
  const fills = [
    fill("AAA", "buy", 1, "2026-05-04T15:00:00Z"),
    fill("AAA", "sell", 2, "2026-04-01T15:00:00Z"),
    fill("AAA", "buy", 2, "2026-03-02T15:00:00Z"),
  ];
  assert.deepEqual(holdingStarts(fills, { AAA: 1 }), { AAA: "2026-05-04" });
});

// A history that does not reach back to the purchase, or a split, leaves the
// share count unexplained. Guessing a start date from it would be worse than
// falling back and saying so.
test("a holding the fills cannot account for has no known start", () => {
  const fills = [fill("AAA", "buy", 1, "2026-03-02T15:00:00Z")];
  assert.deepEqual(holdingStarts(fills, { AAA: 4, BBB: 1 }), { AAA: null, BBB: null });
});

test("fractional shares that sum with rounding error still match", () => {
  const fills = [
    fill("AAA", "buy", 0.1, "2026-03-02T15:00:00Z"),
    fill("AAA", "buy", 0.2, "2026-03-03T15:00:00Z"),
  ];
  assert.deepEqual(holdingStarts(fills, { AAA: 0.3 }), { AAA: "2026-03-02" });
});

test("a buy after the close is dated in New York, not UTC", () => {
  // 01:30 UTC on the 3rd is 20:30 on the 2nd in New York.
  const fills = [fill("AAA", "buy", 1, "2026-03-03T01:30:00Z")];
  assert.deepEqual(holdingStarts(fills, { AAA: 1 }), { AAA: "2026-03-02" });
});

/** One bar per weekday from `start`, closing at each price in turn. */
function bars(start: string, closes: number[]): Bar[] {
  const out: Bar[] = [];
  const d = new Date(`${start}T05:00:00Z`);
  for (const close of closes) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    out.push({ close, volume: 1, time: d.toISOString() });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Closes alternating by `step` percent: a stock that swings that much daily. */
const swinging = (count: number, step: number, from = 100): number[] =>
  Array.from({ length: count }, (_, i) => from * (i % 2 ? 1 + step / 100 : 1));

// The width is fixed at purchase. A crash afterwards raises the stock's
// volatility, and a width recomputed from it would widen the stop exactly when
// it should fire.
test("the stop width comes from the trading days before the purchase only", () => {
  const calm = bars("2026-01-05", [...swinging(61, 1), ...swinging(30, 8)]);
  const since = calm[61]!.time.slice(0, 10);
  const basis = stopBasisFrom(calm, since, "2026-12-31");
  const calmOnly = stopBasisFrom(calm.slice(0, 61), since, "2026-12-31");
  assert.ok(basis.twoWeekMovePct !== null);
  assert.equal(basis.twoWeekMovePct, calmOnly.twoWeekMovePct);
  assert.ok(basis.twoWeekMovePct < 5, `a 1% swinger, got ${basis.twoWeekMovePct}`);
});

test("the high counts closes from the purchase day up to yesterday", () => {
  const series = bars("2026-03-02", [100, 140, 120, 130, 200]);
  const since = series[1]!.time.slice(0, 10);
  const today = series[4]!.time.slice(0, 10);
  const basis = stopBasisFrom(series, since, today);
  assert.equal(basis.high, 140, "today's 200 is still moving, and the 100 was before the purchase");
  assert.equal(basis.highDate, since);
});

test("too little history before the purchase leaves the stop unsized, with a reason", () => {
  const series = bars("2026-03-02", swinging(MIN_SIZING_DAYS + 5, 2));
  const since = series[MIN_SIZING_DAYS - 1]!.time.slice(0, 10);
  const basis = stopBasisFrom(series, since, "2026-12-31");
  assert.equal(basis.twoWeekMovePct, null);
  assert.match(basis.note ?? "", /fewer than 20 trading days/);
  assert.ok(basis.high !== null, "the high is still known");
});

test("a holding with no known start has no basis", () => {
  const basis = stopBasisFrom(bars("2026-03-02", [100, 110]), null, "2026-12-31");
  assert.equal(basis.twoWeekMovePct, null);
  assert.equal(basis.high, null);
  assert.match(basis.note ?? "", /not in your fill history/);
});
