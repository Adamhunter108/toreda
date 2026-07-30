import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRealized, type Fill } from "./activities";

let seq = 0;
const fill = (
  side: "buy" | "sell",
  qty: number,
  price: number,
  symbol = "NVDA",
  time = `2026-07-${String(++seq).padStart(2, "0")}T10:00:00Z`,
): Fill => ({ symbol, side, qty, price, time, id: `id-${seq}` });

test("no fills means no realized P&L", () => {
  const r = computeRealized([]);
  assert.equal(r.total, 0);
  assert.equal(r.unmatchedSells, 0);
});

test("buys alone realize nothing", () => {
  seq = 0;
  const r = computeRealized([fill("buy", 10, 100)]);
  assert.equal(r.total, 0);
});

test("a simple round trip realizes the difference", () => {
  seq = 0;
  const r = computeRealized([fill("buy", 10, 100), fill("sell", 10, 110)]);
  assert.equal(r.total, 100);
  assert.equal(r.unmatchedSells, 0);
});

test("a loss is realized as a negative", () => {
  seq = 0;
  const r = computeRealized([fill("buy", 10, 100), fill("sell", 10, 90)]);
  assert.equal(r.total, -100);
});

// The whole reason for FIFO. With two lots at different prices, selling must
// consume the OLDEST first — matching against the newest, or against an
// average, gives a different and non-standard answer.
test("sells consume the oldest lot first", () => {
  seq = 0;
  const r = computeRealized([
    fill("buy", 10, 100), // oldest
    fill("buy", 10, 200),
    fill("sell", 10, 150),
  ]);
  // FIFO: 10 × (150 − 100) = +500. LIFO would have given −500.
  assert.equal(r.total, 500);
});

test("a sell spanning two lots splits across both", () => {
  seq = 0;
  const r = computeRealized([
    fill("buy", 10, 100),
    fill("buy", 10, 200),
    fill("sell", 15, 150),
  ]);
  // 10 × (150−100) = +500, then 5 × (150−200) = −250.
  assert.equal(r.total, 250);
});

test("fills are matched in time order regardless of input order", () => {
  const out = computeRealized([
    { symbol: "X", side: "sell", qty: 10, price: 150, time: "2026-07-02T10:00:00Z", id: "b" },
    { symbol: "X", side: "buy", qty: 10, price: 100, time: "2026-07-01T10:00:00Z", id: "a" },
  ]);
  assert.equal(out.total, 500);
});

test("symbols are accounted separately", () => {
  seq = 0;
  const r = computeRealized([
    fill("buy", 10, 100, "AAA"),
    fill("buy", 10, 500, "BBB"),
    fill("sell", 10, 110, "AAA"),
    fill("sell", 10, 450, "BBB"),
  ]);
  assert.equal(r.bySymbol.AAA, 100);
  assert.equal(r.bySymbol.BBB, -500);
  assert.equal(r.total, -400);
});

// The honesty case: history that does not reach back to the original buy must
// report the gap rather than invent a cost basis of zero, which would show a
// spectacular fictional profit.
test("a sell with no matching buy is reported as unmatched, not as pure profit", () => {
  seq = 0;
  const r = computeRealized([fill("sell", 5, 100)]);
  assert.equal(r.total, 0);
  assert.equal(r.unmatchedSells, 5);
});

test("a partially covered sell reports only the uncovered remainder", () => {
  seq = 0;
  const r = computeRealized([fill("buy", 2, 100), fill("sell", 5, 110)]);
  assert.equal(r.total, 20); // only the 2 matched shares
  assert.equal(r.unmatchedSells, 3);
});

test("fractional share quantities do not leave float residue", () => {
  seq = 0;
  const r = computeRealized([fill("buy", 0.377, 100), fill("sell", 0.377, 200)]);
  assert.ok(Math.abs(r.total - 37.7) < 1e-9);
  assert.equal(r.unmatchedSells, 0);
});

test("non-buy, non-sell activity rows are ignored", () => {
  seq = 0;
  const odd: Fill = { ...fill("buy", 1, 1), side: "transfer" };
  const r = computeRealized([odd]);
  assert.equal(r.total, 0);
});
