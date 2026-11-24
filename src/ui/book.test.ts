import { test } from "node:test";
import assert from "node:assert/strict";
import type { RiskRules } from "../core/risk";
import { NO_FLOWS } from "../core/transfers";
import type { Account, Position } from "../core/types";
import { bookAlerts, breachesBySymbol, markBook, sortBook } from "./book";

const rules: RiskRules = {
  stopLossPct: -7,
  defaultMaxWeight: 0.25,
  trimProfitPct: 25,
  overrides: { CCC: { maxWeight: 0.5, decided: "2026-01-02", reason: "core holding" } },
  stopOverrides: {},
  stopSizing: null,
  coreSymbols: [],
};

function position(symbol: string, qty: number, avgEntry: number, price: number): Position {
  return {
    symbol,
    qty,
    avgEntry,
    costBasis: qty * avgEntry,
    marketValue: qty * price,
    unrealizedPl: qty * (price - avgEntry),
    unrealizedPlPct: (price - avgEntry) / avgEntry,
    dayPl: 0,
    changeToday: 0,
    prevClose: price,
    currentPrice: price,
  };
}

// $10,000 book: $2,000 cash, AAA at 30% (over the 25% default), BBB 8% under
// entry (past the −7% stop), CCC at 40.7% (under its 50% override).
const positions = [
  position("AAA", 10, 100, 300),
  position("BBB", 10, 100, 92),
  position("CCC", 37, 100, 110),
];
const invested = 3000 + 920 + 4070;
const account: Account = {
  equity: 2000 + invested,
  lastEquity: 2000 + invested,
  buyingPower: 4000,
  cash: 2000,
  portfolioValue: 2000 + invested,
  accountNumber: "T",
  status: "ACTIVE",
  patternDayTrader: false,
  daytradingBuyingPower: null,
};

test("weight is a share of the whole portfolio, cash included", () => {
  const book = markBook(account, positions, {}, rules, NO_FLOWS);
  const aaa = book.rows.find((r) => r.symbol === "AAA")!;
  assert.equal(aaa.weight, 3000 / account.equity);
  // Positions plus cash account for the whole book — which is why the
  // positions panel shows the cash share beside the weights.
  const total = book.rows.reduce((s, r) => s + (r.weight ?? 0), 0) + book.cash / book.equity;
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("a live tick re-marks equity and today's change by exactly the price move", () => {
  const book = markBook(account, positions, { AAA: 301 }, rules, NO_FLOWS);
  assert.equal(book.equity, account.equity + 10);
  assert.equal(book.dayPl, 10);
  const aaa = book.rows.find((r) => r.symbol === "AAA")!;
  assert.equal(aaa.live, true);
  assert.equal(aaa.value, 3010);
});

// A deposit since the previous close once showed on the stat bar as a day up
// by nearly the amount deposited.
test("a deposit since the previous close is not today's gain", () => {
  const deposited = { ...account, equity: account.equity + 1000, cash: account.cash + 1000 };
  const book = markBook(deposited, positions, { AAA: 301 }, rules, {
    deposits: 1000,
    withdrawals: 0,
    net: 1000,
  });
  assert.equal(book.dayPl, 10, "only the price move");
  assert.ok(Math.abs(book.dayPct - (10 / account.lastEquity) * 100) < 1e-9);
  assert.equal(book.transfers?.deposits, 1000);
  // The deposit is still cash, and still dilutes every weight.
  assert.equal(book.equity, account.equity + 1010);
});

// Shares bought after the stock had already fallen showed a red DAY beside a
// green P&L, and the column no longer added up to the day.
test("a position bought today counts from its fill, and the rows add up to the day", () => {
  // Yesterday: $2,000 cash and AAA closing at $300. Today: $1,000 deposited,
  // 2 NEW bought at $100 after it closed yesterday at $110; it is now $101.
  const held = { ...position("AAA", 10, 100, 295), prevClose: 300, dayPl: -50 };
  const bought = { ...position("NEW", 2, 100, 101), prevClose: 110, dayPl: 2 };
  const today: Account = {
    ...account,
    cash: 2800,
    equity: 2800 + 2950 + 202,
    lastEquity: 2000 + 3000,
  };
  const book = markBook(today, [held, bought], {}, rules, { deposits: 1000, withdrawals: 0, net: 1000 });
  const neu = book.rows.find((r) => r.symbol === "NEW")!;
  assert.equal(neu.dayPl, 2, "from the $100 fill, not the $110 close");
  assert.ok(Math.abs(neu.dayPct - 1) < 1e-9, "+1% on the $200 paid");
  const rowsTotal = book.rows.reduce((s, r) => s + r.dayPl, 0);
  assert.equal(book.dayPl, -48);
  assert.ok(Math.abs(rowsTotal - book.dayPl) < 1e-9, `rows ${rowsTotal} vs day ${book.dayPl}`);
});

test("unchecked transfers leave the raw change, marked as unchecked", () => {
  const deposited = { ...account, equity: account.equity + 1000 };
  const book = markBook(deposited, positions, {}, rules, null);
  assert.equal(book.dayPl, 1000);
  assert.equal(book.transfers, null);
});

test("without an account the rules are unchecked, not passed", () => {
  const book = markBook(null, positions, {}, rules, NO_FLOWS);
  assert.equal(book.known, false);
  assert.equal(bookAlerts(book, rules), null);
  assert.ok(book.rows.every((r) => r.weight === null));
});

test("live alerts flag the stop breach and the concentration breach, stop first", () => {
  const alerts = bookAlerts(markBook(account, positions, {}, rules, NO_FLOWS), rules)!;
  assert.deepEqual(
    alerts.map((a) => `${a.symbol} ${a.rule}`),
    ["BBB STOP LOSS", "AAA CONCENTRATION"],
  );
});

test("a dated override raises that symbol's ceiling and nothing else", () => {
  const book = markBook(account, positions, {}, rules, NO_FLOWS);
  const ccc = book.rows.find((r) => r.symbol === "CCC")!;
  assert.equal(ccc.ceiling, 0.5);
  assert.equal(ccc.override, true);
  const flags = breachesBySymbol(bookAlerts(book, rules));
  assert.equal(flags.CCC, undefined);
  assert.deepEqual(flags.AAA, { stop: false, ceiling: true });
});

test("a live price can trip the stop before the next account poll", () => {
  // CCC is +10% on the poll; a crash to $92 is −8% from entry.
  const alerts = bookAlerts(markBook(account, positions, { CCC: 92 }, rules, NO_FLOWS), rules)!;
  assert.ok(alerts.some((a) => a.symbol === "CCC" && a.rule === "STOP LOSS"));
});

test("the stop price is the entry less the stop percentage", () => {
  const bbb = markBook(account, positions, {}, rules, NO_FLOWS).rows.find((r) => r.symbol === "BBB")!;
  assert.ok(Math.abs(bbb.stop!.price - 93) < 1e-9);
});

test("sorting by value uses live prices", () => {
  const sorted = sortBook(markBook(account, positions, { AAA: 500 }, rules, NO_FLOWS).rows, "value");
  assert.equal(sorted[0]!.symbol, "AAA");
});

test("with sized stops, the book measures a winner's stop from its high", () => {
  const sized: RiskRules = {
    ...rules,
    stopSizing: { volMultiple: 2, narrowestPct: -8, widestPct: -30, trailing: true },
    coreSymbols: ["BBB"],
  };
  const bases = {
    AAA: { since: "2026-01-05", twoWeekMovePct: 10, high: 400, highDate: "2026-01-20", note: null },
  };
  const book = markBook(account, positions, {}, sized, NO_FLOWS, bases);
  const aaa = book.rows.find((r) => r.symbol === "AAA")!;
  assert.ok(Math.abs(aaa.stop!.price - 320) < 1e-9);
  assert.equal(book.rows.find((r) => r.symbol === "BBB")!.stop, null, "a core fund has no stop");
  // AAA at $300 is 25% below its $400 high, past its −20% stop.
  const alerts = bookAlerts(book, sized)!;
  assert.ok(alerts.some((a) => a.symbol === "AAA" && a.rule === "STOP LOSS"));
  assert.ok(!alerts.some((a) => a.symbol === "BBB" && a.rule === "STOP LOSS"));
});
