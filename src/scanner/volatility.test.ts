import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confirmationThresholdPct,
  dailyVolPct,
  pctChange,
  sessionFraction,
  windowMoves,
} from "./volatility";
import type { SymbolBars } from "./types";

/** A bar whose closes walk by `step` percent, alternating direction. */
function bar(step: number, days = 11, drift = 0): SymbolBars {
  const closes = [100];
  for (let i = 1; i < days; i++) {
    closes.push(closes[i - 1]! * (1 + ((i % 2 ? step : -step) + drift) / 100));
  }
  return { closes, volumes: closes.map(() => 1e6), latest: closes[closes.length - 1]! };
}

const FLOOR = 2;
const SIGMA = 1;

test("percent change measures the whole window, first close to last", () => {
  const b: SymbolBars = { closes: [100, 90, 110], volumes: [1, 1, 1], latest: 110 };
  assert.equal(pctChange(b), 10);
});

test("a zero or missing first close does not produce Infinity", () => {
  assert.equal(pctChange({ closes: [0, 50], volumes: [1, 1], latest: 50 }), 0);
  assert.equal(pctChange({ closes: [], volumes: [], latest: 0 }), 0);
});

test("window moves are measured from each of the first three closes to the last", () => {
  const b: SymbolBars = { closes: [80, 100, 125, 110, 120], volumes: [1, 1, 1, 1, 1], latest: 120 };
  assert.deepEqual(windowMoves(b), [
    { pct: 50, days: 5 },
    { pct: 20, days: 4 },
    { pct: -4, days: 3 },
  ]);
});

test("a short window always leaves at least one day of move", () => {
  const b: SymbolBars = { closes: [100, 110, 121], volumes: [1, 1, 1], latest: 121 };
  assert.deepEqual(windowMoves(b).map((m) => m.days), [3, 2]);
  assert.deepEqual(windowMoves({ closes: [100], volumes: [1], latest: 100 }), []);
});

test("a zero close is skipped as a start rather than producing Infinity", () => {
  const b: SymbolBars = { closes: [0, 100, 110], volumes: [1, 1, 1], latest: 110 };
  assert.deepEqual(windowMoves(b), [{ pct: 10, days: 2 }]);
});

test("too few bars to estimate volatility returns null", () => {
  assert.equal(dailyVolPct(bar(3, 4)), null);
});

test("a volatile symbol reads as more volatile than a calm one", () => {
  assert.ok((dailyVolPct(bar(3)) ?? 0) > (dailyVolPct(bar(0.3)) ?? 0));
});

// The heart of it: a threshold that is not scaled to the symbol asks NVDA,
// which moves ~3% on a quiet day, to drift 2% over eleven sessions before its
// news "confirms" — far inside noise, and enough to ratify a nothing-happened
// fortnight into a SELL.
test("a volatile symbol must move further to confirm than a calm one", () => {
  assert.ok(
    confirmationThresholdPct(bar(3), FLOOR, SIGMA) >
      confirmationThresholdPct(bar(0.3), FLOOR, SIGMA),
  );
});

test("the configured floor still applies to a nearly flat symbol", () => {
  assert.ok(confirmationThresholdPct(bar(0.01), FLOOR, SIGMA) >= FLOOR);
});

test("an NVDA-like symbol is not confirmed by a 2.8% drift over 11 days", () => {
  assert.ok(confirmationThresholdPct(bar(3), FLOOR, SIGMA) > 2.8);
});

test("the threshold scales with the window, not just the daily move", () => {
  assert.ok(
    confirmationThresholdPct(bar(3, 21), FLOOR, SIGMA) >
      confirmationThresholdPct(bar(3, 11), FLOOR, SIGMA),
  );
});

test("too few bars falls back to the floor rather than throwing", () => {
  assert.equal(confirmationThresholdPct(bar(3, 3), FLOOR, SIGMA), FLOOR);
});

test("a larger sigma multiple demands a larger move", () => {
  assert.ok(confirmationThresholdPct(bar(3), FLOOR, 2) > confirmationThresholdPct(bar(3), FLOOR, 1));
});

// ── Session fraction ────────────────────────────────────────────────────────
// Times below are constructed in UTC and land on a July date, so US Eastern is
// UTC-4. 13:30 UTC is 09:30 ET, the open.

test("the fraction is clamped at the open so a 09:31 scan is not absurd", () => {
  assert.equal(sessionFraction(new Date("2026-07-15T13:31:00Z")), 0.1);
});

test("midday is roughly half the session", () => {
  const f = sessionFraction(new Date("2026-07-15T16:45:00Z")); // 12:45 ET
  assert.ok(f > 0.45 && f < 0.55, `expected ~0.5, got ${f}`);
});

test("after the close the session is complete", () => {
  assert.equal(sessionFraction(new Date("2026-07-15T20:30:00Z")), 1); // 16:30 ET
});

test("before the open the fraction is clamped, never negative", () => {
  assert.equal(sessionFraction(new Date("2026-07-15T12:00:00Z")), 0.1); // 08:00 ET
});

// The whole point of running this in Eastern rather than local time: a user in
// London must get the same answer as a user in New York.
test("the session is measured in Eastern time regardless of machine timezone", () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = "Europe/London";
    const london = sessionFraction(new Date("2026-07-15T16:45:00Z"));
    process.env.TZ = "America/Los_Angeles";
    const la = sessionFraction(new Date("2026-07-15T16:45:00Z"));
    assert.equal(london, la);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
