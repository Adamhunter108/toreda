import { test } from "node:test";
import assert from "node:assert/strict";
import type { AlertStop, PositionAlert, StopException } from "../scanner/types";
import { RULE_COLUMN_MIN_WIDTH, ruleColumns, ruleRows, ruleSummary, shortDate } from "./rule-rows";

// Made-up figures throughout.

const STOP: AlertStop = {
  belowPct: -21.4,
  from: "high",
  anchor: 140,
  highDate: "2026-03-02",
  pct: -18,
  price: 114.8,
  exceptionUntil: null,
  lapsedUntil: null,
};

const stopAlert = (symbol: string, stop: Partial<AlertStop> = {}): PositionAlert => ({
  symbol,
  rule: "STOP LOSS",
  action: "SELL",
  detail: "the long sentence",
  stop: { ...STOP, ...stop },
});

const sizeAlert = (symbol: string, override = false): PositionAlert => ({
  symbol,
  rule: "CONCENTRATION",
  action: "TRIM",
  detail: "the long sentence",
  size: { weight: 0.312, ceiling: 0.25, overUsd: 61.6, override },
});

const HELD: StopException = {
  symbol: "QQQX",
  plPct: -12,
  defaultPct: -10,
  stopPct: -20,
  from: "entry",
  belowPct: -12,
  until: "2026-04-03",
  decided: "2026-03-30",
  reason: "holding through the report",
};

test("dates read as a month and day", () => {
  assert.equal(shortDate("2026-03-02"), "Mar 2");
  assert.equal(shortDate("2026-12-31"), "Dec 31");
  assert.equal(shortDate("soon"), "soon");
});

test("a stop from the high says how far below it, and where the stop is", () => {
  const [row] = ruleRows([stopAlert("AAA")], []);
  assert.equal(row?.tag, "SELL");
  assert.equal(row?.tone, "negative");
  assert.equal(row?.rule, "stop-loss");
  assert.equal(row?.where, "21.4% below its $140.00 high (Mar 2)");
  assert.equal(row?.line, "stop $114.80 (-18%)");
});

test("a stop from entry is measured from what you paid", () => {
  const [row] = ruleRows([stopAlert("AAA", { from: "entry", anchor: 50, highDate: null, belowPct: -8 })], []);
  assert.equal(row?.where, "8.0% below what you paid ($50.00)");
});

test("a stop set by your exception says so, with its end date", () => {
  const [row] = ruleRows([stopAlert("AAA", { exceptionUntil: "2026-04-03" })], []);
  assert.equal(row?.line, "stop $114.80 (-18%) · your exception until Apr 3");
  const [open] = ruleRows([stopAlert("AAA", { exceptionUntil: "" })], []);
  assert.equal(open?.line, "stop $114.80 (-18%) · your exception");
});

test("an exception that no longer applies is named on the stop it gave back", () => {
  const [ended] = ruleRows([stopAlert("AAA", { lapsedUntil: "2026-04-03" })], []);
  assert.equal(ended?.line, "stop $114.80 (-18%) · your exception ended Apr 3");
  const [undated] = ruleRows([stopAlert("AAA", { lapsedUntil: "" })], []);
  assert.match(undated?.line ?? "", /no end date, so it doesn't apply/);
});

test("too large is gold, with the limit and the dollars over", () => {
  const [row] = ruleRows([sizeAlert("BBB")], []);
  assert.equal(row?.tag, "TRIM");
  assert.equal(row?.tone, "warning");
  assert.equal(row?.where, "31.2% of your account");
  assert.equal(row?.line, "limit 25% · about $62 over");
  assert.match(ruleRows([sizeAlert("BBB", true)], [])[0]?.line ?? "", /\(your override\)/);
});

test("a position your exception is holding gets a gold HELD row after the breaches", () => {
  const rows = ruleRows([sizeAlert("BBB")], [HELD]);
  assert.deepEqual(rows.map((r) => r.tag), ["TRIM", "HELD"]);
  assert.equal(rows[1]?.tone, "warning");
  assert.equal(rows[1]?.where, "12.0% below what you paid");
  assert.equal(rows[1]?.line, "past its -10% stop · you're holding to -20% until Apr 3: holding through the report");
});

test("an alert without figures still gets a row, in its own words", () => {
  const bare: PositionAlert = { symbol: "CCC", rule: "STOP LOSS", action: "SELL", detail: "first line\nsecond" };
  const [row] = ruleRows([bare], []);
  assert.equal(row?.where, "first line");
  assert.equal(row?.tone, "negative");
});

test("the title counts each kind of rule", () => {
  assert.equal(
    ruleSummary([stopAlert("AAA"), stopAlert("BBB"), sizeAlert("CCC")], [HELD]),
    "2 past their stop · 1 over its size limit · 1 held by your exception",
  );
  assert.equal(ruleSummary([stopAlert("AAA")], []), "1 past its stop");
});

test("columns line up, and the rule words drop out on a narrow terminal", () => {
  const rows = ruleRows([stopAlert("AAA"), sizeAlert("BBBBB")], []);
  const wide = ruleColumns(rows, RULE_COLUMN_MIN_WIDTH);
  assert.equal(wide.symbol, 5);
  assert.equal(wide.rule, "size limit".length);
  assert.equal(wide.where, "21.4% below its $140.00 high (Mar 2)".length);
  assert.equal(ruleColumns(rows, RULE_COLUMN_MIN_WIDTH - 1).rule, 0);
});
