import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePosition, positionDay } from "./alpaca";

const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

// `/v2/positions` entries, trimmed to the fields that matter here. The figures
// are made up; the shape is what counts.

// Bought today at $95, after the stock closed yesterday at $100. Now $96.
const BOUGHT_TODAY = {
  symbol: "AAA",
  qty: "2",
  avg_entry_price: "95",
  cost_basis: "190",
  market_value: "192",
  current_price: "96",
  lastday_price: "100",
  change_today: "-0.04",
  unrealized_pl: "2",
  unrealized_plpc: "0.010526",
  unrealized_intraday_pl: "2",
};

// Held overnight, through yesterday's $52 close. Now $50.
const HELD = {
  symbol: "BBB",
  qty: "3",
  avg_entry_price: "40",
  cost_basis: "120",
  market_value: "150",
  current_price: "50",
  lastday_price: "52",
  change_today: "-0.038462",
  unrealized_pl: "30",
  unrealized_plpc: "0.25",
  unrealized_intraday_pl: "-6",
};

test("a position bought today counts its day from the fill, not yesterday's close", () => {
  const p = parsePosition(BOUGHT_TODAY);
  // The stock is down 4% on yesterday's close. The position is up $2 on the
  // $190 that was paid.
  assert.equal(p.dayPl, 2);
  assert.ok(close(p.changeToday, 2 / 190), `got ${p.changeToday}`);
  assert.ok(p.changeToday > 0);
});

test("a position held overnight still shows the stock's move", () => {
  const p = parsePosition(HELD);
  assert.equal(p.dayPl, -6);
  assert.ok(close(p.changeToday, (50 - 52) / 52), `got ${p.changeToday}`);
});

test("without Alpaca's intraday figure, the day falls back to the stock's move", () => {
  const { unrealized_intraday_pl: _, ...bare } = HELD;
  const p = parsePosition(bare);
  assert.ok(close(p.dayPl, 3 * (50 - 52)));
  assert.ok(close(p.changeToday, (50 - 52) / 52));
  // An empty string is a missing figure too, not a flat day.
  assert.ok(close(parsePosition({ ...HELD, unrealized_intraday_pl: "" }).dayPl, p.dayPl));
});

test("a position added to today is measured on both parts' own basis", () => {
  // 10 shares held from a $100 close, 10 more bought today at $90, now $95:
  // −$50 on the old shares, +$50 on the new. A flat day, not −5%.
  const p = parsePosition({
    symbol: "X",
    qty: "20",
    current_price: "95",
    lastday_price: "100",
    market_value: "1900",
    unrealized_intraday_pl: "0",
  });
  assert.equal(p.dayPl, 0);
  assert.equal(p.changeToday, 0);
  // A live tick moves both parts: $1 on 20 shares, against a $1,900 basis.
  const live = positionDay(p, 96);
  assert.ok(close(live.amount, 20));
  assert.ok(close(live.pct, 20 / 1900));
});

test("a live price re-marks today's change by exactly the price move", () => {
  const p = parsePosition(BOUGHT_TODAY);
  const live = positionDay(p, 97);
  assert.ok(close(live.amount, 2 + 2 * 1));
});
