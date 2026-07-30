import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  demoAccount,
  demoCloses,
  demoEquityHistory,
  demoPositions,
  demoQuotes,
  demoScanResult,
  demoSnapshots,
  isDemoMode,
} from "./demo";

const original = process.env.TOREDA_DEMO;
afterEach(() => {
  if (original === undefined) delete process.env.TOREDA_DEMO;
  else process.env.TOREDA_DEMO = original;
});

// Demo mode reaches no network and touches no account, but it MUST be
// unambiguously opt-in — a user who thinks they are looking at their real
// portfolio and is not has been misled about their own money.
test("demo mode is off unless explicitly requested", () => {
  for (const value of [undefined, "", "  ", "0", "false", "no", "off", "demo"]) {
    if (value === undefined) delete process.env.TOREDA_DEMO;
    else process.env.TOREDA_DEMO = value;
    assert.equal(isDemoMode(), false, `expected off for ${JSON.stringify(value)}`);
  }
});

test("demo mode turns on for the documented values", () => {
  for (const value of ["1", "true", "yes", "TRUE", " 1 "]) {
    process.env.TOREDA_DEMO = value;
    assert.equal(isDemoMode(), true, `expected on for ${JSON.stringify(value)}`);
  }
});

// ── The fixtures have to be internally consistent ───────────────────────────
// A demo whose totals do not add up teaches the reader that the numbers are
// decorative, which undermines every real number the tool shows.

test("account equity equals holdings plus cash", () => {
  const account = demoAccount();
  const invested = demoPositions().reduce((sum, p) => sum + p.marketValue, 0);
  assert.ok(Math.abs(account.equity - (invested + account.cash)) < 0.01);
  assert.equal(account.portfolioValue, account.equity);
});

test("every position's derived fields agree with its own inputs", () => {
  for (const p of demoPositions()) {
    assert.ok(Math.abs(p.marketValue - p.qty * p.currentPrice) < 0.01, p.symbol);
    assert.ok(Math.abs(p.costBasis - p.qty * p.avgEntry) < 0.01, p.symbol);
    assert.ok(Math.abs(p.unrealizedPl - (p.marketValue - p.costBasis)) < 0.01, p.symbol);
    assert.ok(
      Math.abs(p.unrealizedPlPct - p.unrealizedPl / p.costBasis) < 1e-9,
      `${p.symbol} P&L percent`,
    );
  }
});

test("the demo book contains both a winner and a loser", () => {
  const positions = demoPositions();
  assert.ok(positions.some((p) => p.unrealizedPl > 0), "no winners");
  assert.ok(positions.some((p) => p.unrealizedPl < 0), "no losers");
});

// The demo exists partly to show what the risk rules DO. A book where nothing
// breaches anything demonstrates nothing.
test("one holding is oversized, so the rules have something to say", () => {
  const account = demoAccount();
  const weights = demoPositions().map((p) => p.marketValue / account.portfolioValue);
  assert.ok(Math.max(...weights) > 0.25, "no position exceeds the default 25% ceiling");
});

test("quotes are internally consistent", () => {
  for (const q of demoQuotes(["NVDA", "AAPL", "KO"])) {
    assert.ok(q.bid < q.ask, q.symbol);
    assert.ok(Math.abs(q.mid - (q.bid + q.ask) / 2) < 0.01, q.symbol);
    assert.ok(q.spread > 0, q.symbol);
  }
});

test("unknown symbols are omitted rather than invented", () => {
  assert.deepEqual(demoQuotes(["NOTREAL"]), []);
  assert.deepEqual(demoSnapshots(["NOTREAL"]), []);
});

test("snapshot percentage changes match their own prices", () => {
  for (const s of demoSnapshots(["NVDA", "KO", "CAT"])) {
    const expected = ((s.price - s.prevClose) / s.prevClose) * 100;
    assert.ok(Math.abs(s.changePct - expected) < 1e-9, s.symbol);
  }
});

// Deterministic output is the whole reason the series are generated from a fixed
// shape rather than random noise — documentation screenshots have to reproduce.
test("price history is deterministic across calls", () => {
  assert.deepEqual(demoCloses(["NVDA"]), demoCloses(["NVDA"]));
  assert.deepEqual(demoEquityHistory("1M"), demoEquityHistory("1M"));
});

test("price history ends at the current price", () => {
  const closes = demoCloses(["NVDA"])["NVDA"]!;
  assert.equal(closes[closes.length - 1], 191.85);
});

test("equity history ends at the account's equity", () => {
  const history = demoEquityHistory("1M");
  assert.ok(Math.abs(history[history.length - 1]! - demoAccount().equity) < 0.02);
});

test("different periods return different resolutions", () => {
  assert.notEqual(demoEquityHistory("1D").length, demoEquityHistory("1M").length);
  assert.ok(demoEquityHistory("1A").length > demoEquityHistory("3M").length);
});

// ── Demo mode must not be able to place anything ────────────────────────────

test("placing an order in demo mode is refused, not faked", async () => {
  process.env.TOREDA_DEMO = "1";
  const { placeOrder } = await import("./orders");
  const result = await placeOrder({ symbol: "NVDA", side: "buy", qty: "5", type: "market" });

  assert.equal(result.ok, false);
  assert.match(result.message ?? "", /not available in demo mode/);
  // Crucially it must not return a plausible-looking success. A faked fill would
  // teach the user that an order went through when nothing happened, which is
  // the single worst thing a trading tool can be wrong about.
  assert.equal(result.id, undefined);
  assert.equal(result.status, undefined);
});

test("the refusal explains how to connect a real account", async () => {
  process.env.TOREDA_DEMO = "1";
  const { placeOrder } = await import("./orders");
  const result = await placeOrder({ symbol: "NVDA", side: "buy", qty: "5", type: "market" });
  assert.match(result.message ?? "", /npm run setup/);
});

// ── The scan fixture should exercise the whole report ────────────────────────

test("the demo scan covers every signal type the scanner can produce", () => {
  const result = demoScanResult() as {
    opportunities: Array<{ opportunityType: string; action: string }>;
    positionAlerts: unknown[];
    discovery: { candidates: unknown[] };
  };
  const types = new Set(result.opportunities.map((o) => o.opportunityType));
  for (const expected of ["momentum", "value_play", "news_catalyst", "social_buzz"]) {
    assert.ok(types.has(expected), `demo scan is missing a ${expected} signal`);
  }
  // And the parts that only appear when the book is reconciled against the rules.
  assert.ok(result.positionAlerts.length > 0, "no rule breach to demonstrate");
  assert.ok(
    result.opportunities.some((o) => o.action === "trim"),
    "no buy→trim reconciliation to demonstrate",
  );
  assert.ok(result.discovery.candidates.length > 0, "no discovery output");
});
