import { test } from "node:test";
import assert from "node:assert/strict";
import type { RiskRules } from "../core/risk";
import { heldUnderExceptions, reviewPositions } from "./review";
import type { AccountState, PositionInfo } from "./types";

// These rules are the part of the scanner that protects money, and they break
// silently: an over-permissive ceiling produces no alert and looks identical to
// a healthy portfolio. So they get asserted rather than eyeballed in a scan.

const PORTFOLIO = 1000;

/** A position at a given weight and P&L, with consistent derived fields. */
function position(weight: number, plPct: number): PositionInfo {
  const marketValue = PORTFOLIO * weight;
  return {
    qty: 1,
    marketValue,
    unrealizedPl: marketValue * (plPct / 100),
    unrealizedPlPct: plPct / 100,
    weight,
  };
}

const RULES: RiskRules = {
  stopLossPct: -7,
  defaultMaxWeight: 0.25,
  trimProfitPct: 25,
  overrides: {
    MSFT: { maxWeight: 0.6, decided: "2026-01-15", reason: "long-term holding" },
    SHOP: { maxWeight: 0.3, decided: "2026-01-15", reason: "building a position" },
  },
  stopOverrides: {},
};

function review(positions: Record<string, PositionInfo>) {
  const account: AccountState = { positions, cash: 0, portfolioValue: PORTFOLIO };
  return reviewPositions(account, RULES);
}

// ── Concentration, with and without an override ─────────────────────────────

test("a symbol inside its raised ceiling is silent", () => {
  assert.equal(review({ MSFT: position(0.5, 26) }).length, 0);
});

test("a symbol past its OWN ceiling alerts, not the default", () => {
  assert.ok(review({ MSFT: position(0.65, 26) }).some((a) => a.rule === "CONCENTRATION"));
});

test("a second override is honoured independently", () => {
  assert.equal(review({ SHOP: position(0.2, 5) }).length, 0);
  assert.ok(review({ SHOP: position(0.35, 5) }).some((a) => a.rule === "CONCENTRATION"));
});

test("a symbol with no override uses the default ceiling", () => {
  assert.ok(review({ AMD: position(0.3, 100) }).some((a) => a.rule === "CONCENTRATION"));
  assert.equal(review({ AMD: position(0.2, 100) }).length, 0);
});

test("a concentration alert explains the raised ceiling and when it was decided", () => {
  const alert = review({ MSFT: position(0.65, 26) }).find((a) => a.rule === "CONCENTRATION");
  assert.ok(alert);
  assert.match(alert.detail, /2026-01-15/);
  assert.match(alert.detail, /long-term holding/);
});

// ── Stop loss ───────────────────────────────────────────────────────────────

test("a position past the stop trips it", () => {
  assert.ok(review({ NET: position(0.1, -8) }).some((a) => a.rule === "STOP LOSS"));
});

test("a position exactly at the stop trips it — the boundary is inclusive", () => {
  assert.ok(review({ NET: position(0.1, -7) }).some((a) => a.rule === "STOP LOSS"));
});

test("a position above the stop does not trip it", () => {
  assert.equal(review({ NET: position(0.1, -6) }).length, 0);
});

// A ceiling override raises the SIZE ceiling only. Conviction about a company
// is not a reason to tolerate an open loss.
test("the stop applies to overridden symbols too", () => {
  assert.ok(review({ MSFT: position(0.5, -10) }).some((a) => a.rule === "STOP LOSS"));
});

// ── Stop exceptions: dated, and time-boxed when they loosen the stop ────────

const TODAY = "2026-02-03";

function withStops(stopOverrides: RiskRules["stopOverrides"]): RiskRules {
  return { ...RULES, stopOverrides };
}

function reviewWith(rules: RiskRules, positions: Record<string, PositionInfo>, today = TODAY) {
  const account: AccountState = { positions, cash: 0, portfolioValue: PORTFOLIO };
  return reviewPositions(account, rules, today);
}

function heldWith(rules: RiskRules, positions: Record<string, PositionInfo>, today = TODAY) {
  const account: AccountState = { positions, cash: 0, portfolioValue: PORTFOLIO };
  return heldUnderExceptions(account, rules, today);
}

const THROUGH_EARNINGS = withStops({
  XYZ: { stopLossPct: -30, decided: "2026-02-02", until: "2026-02-06", reason: "through earnings" },
});

test("a dated exception holds a position past the default stop, and says so", () => {
  const book = { XYZ: position(0.04, -18) };
  assert.equal(reviewWith(THROUGH_EARNINGS, book).length, 0, "no SELL while the exception holds");
  const held = heldWith(THROUGH_EARNINGS, book);
  assert.equal(held.length, 1, "but it is never silent");
  assert.equal(held[0]!.symbol, "XYZ");
  assert.equal(held[0]!.stopPct, -30);
  assert.equal(held[0]!.until, "2026-02-06");
  assert.equal(held[0]!.reason, "through earnings");
});

test("past the exception's own stop, the alert fires and names the exception", () => {
  const alert = reviewWith(THROUGH_EARNINGS, { XYZ: position(0.04, -31) })[0];
  assert.equal(alert?.rule, "STOP LOSS");
  assert.match(alert!.detail, /-30% stop you set for XYZ until 2026-02-06/);
  assert.match(alert!.detail, /through earnings/);
  assert.equal(heldWith(THROUGH_EARNINGS, { XYZ: position(0.04, -31) }).length, 0);
});

test("the end date is inclusive, and the day after it the SELL alert is back", () => {
  const book = { XYZ: position(0.04, -18) };
  assert.equal(reviewWith(THROUGH_EARNINGS, book, "2026-02-06").length, 0);
  const alert = reviewWith(THROUGH_EARNINGS, book, "2026-02-07")[0];
  assert.equal(alert?.rule, "STOP LOSS");
  assert.match(alert!.detail, /-7% stop/);
  assert.match(alert!.detail, /exception ran out on 2026-02-06/);
  assert.equal(heldWith(THROUGH_EARNINGS, book, "2026-02-07").length, 0);
});

test("a looser stop with no end date does not apply", () => {
  const open = withStops({
    XYZ: { stopLossPct: -30, decided: "2026-02-02", until: "", reason: "conviction" },
  });
  const alert = reviewWith(open, { XYZ: position(0.04, -18) })[0];
  assert.equal(alert?.rule, "STOP LOSS");
  assert.match(alert!.detail, /has no end date, so it does not apply/);
});

test("a tighter stop needs no end date, and fires before the default would", () => {
  const tight = withStops({
    SPEC: { stopLossPct: -4, decided: "2026-02-02", until: "", reason: "speculative" },
  });
  assert.equal(reviewWith(tight, { SPEC: position(0.05, -5) })[0]?.rule, "STOP LOSS");
  assert.equal(reviewWith(RULES, { SPEC: position(0.05, -5) }).length, 0);
  assert.equal(heldWith(tight, { SPEC: position(0.05, -5) }).length, 0);
});

test("an exception on a position not past the default stop is quiet", () => {
  assert.equal(heldWith(THROUGH_EARNINGS, { XYZ: position(0.04, -3) }).length, 0);
  assert.equal(reviewWith(THROUGH_EARNINGS, { XYZ: position(0.04, -3) }).length, 0);
});

test("an exception covers its own symbol only", () => {
  assert.equal(reviewWith(THROUGH_EARNINGS, { NET: position(0.1, -8) })[0]?.rule, "STOP LOSS");
});

// ── The bug this whole layer exists to fix ──────────────────────────────────

test("a QUIET position breaching its ceiling is still reported", () => {
  // No market signal, no news, no volume — and it must still be flagged. The
  // largest risk in a portfolio is rarely the noisiest name.
  assert.ok(review({ AMD: position(0.4, 1) }).length > 0);
});

test("both rules can fire on one position", () => {
  assert.equal(review({ AMD: position(0.4, -10) }).length, 2);
});

test("stop-loss alerts sort before concentration alerts", () => {
  assert.equal(review({ AMD: position(0.4, -10) })[0]?.rule, "STOP LOSS");
});

test("stop-loss sorts first across multiple positions too", () => {
  const alerts = review({ AMD: position(0.4, 1), NET: position(0.1, -9) });
  assert.equal(alerts[0]?.rule, "STOP LOSS");
});

test("an empty portfolio produces no alerts", () => {
  assert.equal(review({}).length, 0);
});

test("a healthy portfolio produces no alerts", () => {
  assert.equal(review({ AMD: position(0.1, 5), NET: position(0.15, -2) }).length, 0);
});
