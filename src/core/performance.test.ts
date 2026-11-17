import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEquityHistory, performance } from "./performance";

const near = (a: number, b: number, msg?: string): void =>
  assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ""} ${a} ≠ ${b}`);

test("with no money moved, the curve is the equity itself", () => {
  const p = performance({ equity: [1000, 1010, 990, 1020], flows: [0, 0, 0, 0] });
  assert.deepEqual(p.values, [1000, 1010, 990, 1020]);
  near(p.pl, 20);
  near(p.pct, 0.02);
  assert.equal(p.flows.net, 0);
});

// A 1-day series with a $2,000 instant deposit midway, on a day the
// positions lost $20.
test("a deposit draws no cliff and is not counted as a gain", () => {
  const p = performance({
    equity: [1000, 990, 2985, 2980],
    flows: [0, 0, 2000, 0],
  });
  near(p.pl, 2980 - 1000 - 2000, "pl");
  assert.ok(p.pl < 0, "the day was a loss");
  near(p.values[2]!, 985, "the step the deposit landed on moves only by the market");
  assert.ok(Math.max(...p.values) < 1100, "no point anywhere near the deposited total");
  assert.equal(p.flows.deposits, 2000);
});

// Alpaca's own profit_loss is not net of transfers: a day that took a $500
// deposit and gained $10 comes back as $510 of "profit".
test("a deposit on a day with a gain keeps only the gain", () => {
  const p = performance({ equity: [1000, 1510], flows: [0, 500] });
  near(p.pl, 10);
  near(p.pct, 0.01);
  near(p.values[1]!, 1010);
});

test("a withdrawal is not counted as a loss", () => {
  const p = performance({ equity: [1000, 1010, 510], flows: [0, 0, -500] });
  near(p.pl, 10);
  near(p.values[2]!, 1010);
  assert.equal(p.flows.withdrawals, 500);
  assert.equal(p.flows.net, -500);
});

test("the return is time-weighted: money added late does not dilute it", () => {
  // +10% on $1,000, then $9,000 added, then flat. The return was 10%,
  // not the ~1% that dividing $100 by $10,000 would suggest.
  const p = performance({ equity: [1000, 1100, 10100, 10100], flows: [0, 0, 9000, 0] });
  near(p.pct, 0.1);
  near(p.pl, 100);
});

test("the zeros before an account was funded are not part of the curve", () => {
  // The 1-year view of an account opened in February: Alpaca reports 0 for
  // every day before the first deposit.
  const p = performance({ equity: [0, 0, 0, 500, 510], flows: [0, 0, 0, 500, 0] });
  assert.deepEqual(p.values, [500, 510]);
  near(p.pl, 10);
  assert.equal(p.flows.deposits, 0, "the opening deposit is the starting point, not a flow");
});

test("an empty or never-funded history has nothing to draw", () => {
  assert.deepEqual(performance({ equity: [], flows: [] }).values, []);
  assert.deepEqual(performance({ equity: [0, 0], flows: [0, 0] }).values, []);
});

test("an emptied account has no return until money comes back", () => {
  const p = performance({ equity: [100, 0, 300, 330], flows: [0, -100, 300, 0] });
  near(p.pct, 0.1);
  near(p.pl, 30);
});

// ── Parsing ─────────────────────────────────────────────────────────────────

test("parses equity and aligns cash flows by type", () => {
  const h = parseEquityHistory({
    timestamp: [1, 2, 3],
    equity: [1000, 2000, 1500],
    cashflow: { CSD: [0, 1000, 0], CSW: [0, 0, 500] },
  });
  assert.deepEqual(h.equity, [1000, 2000, 1500]);
  assert.deepEqual(h.flows, [0, 1000, -500]);
});

test("a withdrawal is money out whichever sign the feed gives it", () => {
  const pos = parseEquityHistory({ equity: [1, 2], cashflow: { CSW: [0, 500] } });
  const neg = parseEquityHistory({ equity: [1, 2], cashflow: { CSW: [0, -500] } });
  assert.deepEqual(pos.flows, [0, -500]);
  assert.deepEqual(neg.flows, [0, -500]);
});

test("a cash journal carries its own sign", () => {
  const h = parseEquityHistory({ equity: [1, 2, 3], cashflow: { JNLC: [0, 25, -10] } });
  assert.deepEqual(h.flows, [0, 25, -10]);
});

test("no cashflow key means nothing moved", () => {
  assert.deepEqual(parseEquityHistory({ equity: [5, 6] }).flows, [0, 0]);
});

test("a point with no equity is dropped, and its cash carried forward", () => {
  const h = parseEquityHistory({ equity: [1000, null, 2005], cashflow: { CSD: [0, 1000, 0] } });
  assert.deepEqual(h.equity, [1000, 2005]);
  assert.deepEqual(h.flows, [0, 1000]);
});

test("an error payload parses as an empty history", () => {
  assert.deepEqual(parseEquityHistory({ message: "forbidden" }), { equity: [], flows: [] });
  assert.deepEqual(parseEquityHistory(null), { equity: [], flows: [] });
});
