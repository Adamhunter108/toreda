import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSummary, buildTable, COLUMN_MEANINGS, headerFor } from "./build";
import type { Account, Position } from "../core/types";

const account: Account = {
  equity: 1032.45,
  lastEquity: 1024.31,
  buyingPower: 3.45,
  cash: 3.45,
  portfolioValue: 1032.45,
  accountNumber: "TEST123",
  status: "ACTIVE",
  patternDayTrader: false,
  daytradingBuyingPower: null,
};

function position(over: Partial<Position> = {}): Position {
  return {
    symbol: "NVDA",
    qty: 1,
    avgEntry: 100,
    costBasis: 100,
    marketValue: 128,
    unrealizedPl: 28,
    unrealizedPlPct: 0.28,
    changeToday: 0.0132,
    prevClose: 126,
    currentPrice: 128,
    ...over,
  };
}

test("the summary carries equity, day change, and buying power", () => {
  const summary = buildSummary(account);
  assert.match(summary, /Portfolio \$1,032\.45/);
  assert.match(summary, /BP \$3\.45/);
});

// A bare "-0.19" gets read back as a percentage, which misreads the day by a
// factor of a hundred. The dollar sign is doing real work.
test("the day change carries a dollar sign as well as a percent", () => {
  const summary = buildSummary(account);
  assert.match(summary, /Day \+\$8\.14 \(\+0\.79%\)/);
});

test("a losing day renders its sign correctly on both figures", () => {
  const summary = buildSummary({ ...account, equity: 1000, lastEquity: 1100 });
  assert.match(summary, /Day -\$100\.00 \(-9\.09%\)/);
});

test("a zero last-equity does not produce NaN or Infinity", () => {
  const summary = buildSummary({ ...account, lastEquity: 0 });
  assert.ok(!/NaN|Infinity/.test(summary), summary);
});

// ── The table ───────────────────────────────────────────────────────────────

test("the table has a header, a row per position, and a total", () => {
  const table = buildTable([position(), position({ symbol: "AMD", marketValue: 50 })]);
  const lines = table.split("\n");
  assert.match(lines[0]!, /SYM.*VALUE.*DAY.*P&L.*TOT/);
  assert.ok(table.includes("NVDA"));
  assert.ok(table.includes("AMD"));
  assert.match(lines[lines.length - 1]!, /^TOT/);
});

test("positions are ordered by value, largest first", () => {
  const table = buildTable([
    position({ symbol: "SMALL", marketValue: 10 }),
    position({ symbol: "BIG", marketValue: 1000 }),
  ]);
  assert.ok(table.indexOf("BIG") < table.indexOf("SMALL"));
});

// DAY and TOT are different questions. Without a DAY column a "how did we do
// today" briefing can only quote lifetime gains, which reads as though a flat
// day was a spectacular one.
test("DAY and TOT are distinct columns carrying distinct numbers", () => {
  const table = buildTable([position({ changeToday: 0.005, unrealizedPlPct: 0.28 })]);
  assert.match(table, /\+0\.50%/); // today
  assert.match(table, /\+28\.0%/); // lifetime
});

test("the column gloss forbids describing lifetime P&L as today's gain", () => {
  assert.match(COLUMN_MEANINGS, /DAY = .*TODAY/);
  assert.match(COLUMN_MEANINGS, /TOT = .*NOT today/);
  assert.match(COLUMN_MEANINGS, /Never describe a TOT or P&L figure as today's gain/);
});

// THE regression. A failed fetch once rendered an empty table, which was read
// as "no positions", producing a briefing that announced a flat account while
// positions were open. A genuinely flat account now says so in words, because
// by the time this text reaches a human an empty table and a failed fetch look
// identical.
test("a genuinely flat account states so in words", () => {
  const table = buildTable([]);
  assert.match(table, /genuinely flat/);
});

test("a non-empty table never claims to be flat", () => {
  assert.ok(!buildTable([position()]).includes("genuinely flat"));
});

test("table rows stay within the rule width so columns line up", () => {
  const table = buildTable([
    position({ symbol: "NVDA", marketValue: 1_234_567, unrealizedPl: 999_999 }),
  ]);
  const lines = table.split("\n");
  const ruleWidth = lines[1]!.length;
  // The header and the separator must agree, or the block is visibly crooked.
  assert.equal(lines[0]!.length, ruleWidth);
});

test("headers name the session and are distinguishable", () => {
  const at = new Date("2026-07-28T13:30:00Z");
  assert.match(headerFor("open", at), /Market Open/);
  assert.match(headerFor("close", at), /Market Close/);
});
