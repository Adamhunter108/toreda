import { test } from "node:test";
import assert from "node:assert/strict";
import { assessOrder, formatOrderLogLine, type OrderContext, type OrderRequest } from "./orders";

const ctx = (over: Partial<OrderContext> = {}): OrderContext => ({
  equity: 10_000,
  buyingPower: 5_000,
  heldQty: 0,
  heldValue: 0,
  price: 100,
  maxWeight: 0.25,
  ...over,
});

const buy = (over: Partial<OrderRequest> = {}): OrderRequest => ({
  symbol: "NVDA",
  side: "buy",
  qty: "5",
  type: "market",
  ...over,
});

test("a clean buy has no blocks", () => {
  const a = assessOrder(buy(), ctx());
  assert.deepEqual(a.blocks, []);
  assert.equal(a.estCost, 500);
});

// The single most important block. A market buy with no known price is an
// order for an unknown amount of money, which is not a decision anyone made.
test("a buy is blocked when the price is unknown", () => {
  const a = assessOrder(buy(), ctx({ price: 0 }));
  assert.equal(a.blocks.length, 1);
  assert.match(a.blocks[0]!, /price unavailable/);
});

test("a buy is blocked when it exceeds buying power", () => {
  const a = assessOrder(buy({ qty: "100" }), ctx({ buyingPower: 500 }));
  assert.match(a.blocks.join(" "), /exceeds buying power/);
});

// Selling more than you hold opens a short. Alpaca would allow it; almost
// nobody means it, and it is not reversible by simply cancelling.
test("selling more than held is blocked as a short", () => {
  const a = assessOrder(buy({ side: "sell", qty: "10" }), ctx({ heldQty: 3 }));
  assert.match(a.blocks.join(" "), /would open a short/);
});

test("selling exactly what is held is allowed", () => {
  const a = assessOrder(buy({ side: "sell", qty: "3" }), ctx({ heldQty: 3 }));
  assert.deepEqual(a.blocks, []);
});

// Fractional shares must not trip the short check through float error.
test("selling a fractional holding in full is allowed", () => {
  const a = assessOrder(buy({ side: "sell", qty: "0.377" }), ctx({ heldQty: 0.377 }));
  assert.deepEqual(a.blocks, []);
});

test("a sell does not require a known price", () => {
  const a = assessOrder(buy({ side: "sell", qty: "1" }), ctx({ heldQty: 5, price: 0 }));
  assert.deepEqual(a.blocks, []);
});

test("zero and negative quantities are blocked", () => {
  assert.match(assessOrder(buy({ qty: "0" }), ctx()).blocks.join(" "), /greater than 0/);
  assert.match(assessOrder(buy({ qty: "-5" }), ctx()).blocks.join(" "), /greater than 0/);
});

test("a limit order without a price is blocked", () => {
  const a = assessOrder(buy({ type: "limit" }), ctx());
  assert.match(a.blocks.join(" "), /need a limit price/);
});

test("a limit order prices its cost off the limit, not the last trade", () => {
  const a = assessOrder(buy({ type: "limit", limitPrice: "90", qty: "10" }), ctx({ price: 100 }));
  assert.equal(a.estCost, 900);
});

// Concentration is the user's own policy, so it warns and lets them through.
// A tool that refuses your own judgment gets worked around, not heeded.
test("breaching the concentration ceiling warns but does not block", () => {
  const a = assessOrder(buy({ qty: "30" }), ctx({ price: 100, buyingPower: 9_000 }));
  assert.deepEqual(a.blocks, []);
  assert.match(a.warnings.join(" "), /30% of your book/);
});

test("existing holdings count toward the post-trade weight", () => {
  const a = assessOrder(buy({ qty: "1" }), ctx({ heldValue: 2_450, price: 100 }));
  assert.match(a.warnings.join(" "), /26% of your book/);
});

test("an empty symbol is blocked", () => {
  assert.match(assessOrder(buy({ symbol: "  " }), ctx()).blocks.join(" "), /symbol is required/);
});

test("the log line records a failure as loudly as a success", () => {
  const line = formatOrderLogLine(
    buy(),
    { ok: false, message: "insufficient buying power" },
    "live",
    "2026-07-28 09:31:00",
  );
  assert.match(line, /\[live\]/);
  assert.match(line, /BUY 5 NVDA market/);
  assert.match(line, /FAILED: insufficient buying power/);
});

test("the log line records limit prices", () => {
  const line = formatOrderLogLine(
    buy({ type: "limit", limitPrice: "180.00" }),
    { ok: true, id: "abc123", status: "accepted" },
    "paper",
    "2026-07-28 09:31:00",
  );
  assert.match(line, /limit @ \$180\.00/);
  assert.match(line, /accepted \(accepted\) id=abc123/);
});
