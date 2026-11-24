import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_RISK_RULES,
  describeRuleChanges,
  hasOverride,
  lapsedReason,
  loadRiskRules,
  maxWeightFor,
  type RiskRules,
  type StopBasis,
  type StopOverride,
  belowAnchorPct,
  isPastStop,
  parseStopSizing,
  sizedStopPct,
  stopLevel,
  stopFor,
} from "./risk";
import { configDir, configFile, defaultConfigFile } from "./paths";

const rules: RiskRules = {
  stopLossPct: -7,
  defaultMaxWeight: 0.25,
  trimProfitPct: 25,
  overrides: {
    MSFT: { maxWeight: 0.4, decided: "2026-01-15", reason: "long-term holding" },
  },
  stopOverrides: {},
  stopSizing: null,
  coreSymbols: [],
};

test("an unlisted symbol gets the default ceiling", () => {
  assert.equal(maxWeightFor("NVDA", rules), 0.25);
});

test("an overridden symbol gets its own ceiling", () => {
  assert.equal(maxWeightFor("MSFT", rules), 0.4);
  assert.equal(hasOverride("MSFT", rules), true);
  assert.equal(hasOverride("NVDA", rules), false);
});

test("symbol lookup is case-insensitive", () => {
  assert.equal(maxWeightFor("msft", rules), 0.4);
  assert.equal(hasOverride("msft", rules), true);
});

test("the shipped defaults carry no personal overrides", () => {
  // The whole point of the port: this file must never inherit anyone's
  // position-sizing decisions.
  const shipped = JSON.parse(readFileSync(defaultConfigFile("risk.json"), "utf8")) as {
    overrides: Record<string, unknown>;
    stopOverrides: Record<string, unknown>;
  };
  assert.deepEqual(shipped.overrides, {});
  assert.deepEqual(shipped.stopOverrides, {});
});

test("the shipped defaults match the built-in constants", () => {
  const shipped = JSON.parse(readFileSync(defaultConfigFile("risk.json"), "utf8")) as RiskRules;
  assert.equal(shipped.stopLossPct, DEFAULT_RISK_RULES.stopLossPct);
  assert.equal(shipped.defaultMaxWeight, DEFAULT_RISK_RULES.defaultMaxWeight);
  assert.equal(shipped.trimProfitPct, DEFAULT_RISK_RULES.trimProfitPct);
});

test("loading with no user config falls back to the shipped defaults", () => {
  // Point the data home at an empty directory. Without this the test read the
  // developer's own config/risk.json, and failed for anyone who had tuned their
  // stop — testing their settings rather than the fallback.
  const home = mkdtempSync(join(tmpdir(), "toreda-risk-"));
  const prev = process.env.TOREDA_HOME;
  process.env.TOREDA_HOME = home;
  try {
    const loaded = loadRiskRules();
    assert.equal(loaded.stopLossPct, DEFAULT_RISK_RULES.stopLossPct);
    assert.equal(typeof loaded.defaultMaxWeight, "number");
    assert.equal(typeof loaded.overrides, "object");
  } finally {
    if (prev === undefined) delete process.env.TOREDA_HOME;
    else process.env.TOREDA_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

test("rule changes are described in words, one line each", () => {
  const after: RiskRules = {
    stopLossPct: -10,
    defaultMaxWeight: 0.3,
    trimProfitPct: 25,
    overrides: { SHOP: { maxWeight: 0.35, decided: "2026-01-20", reason: "conviction" } },
    stopOverrides: {},
    stopSizing: null,
    coreSymbols: [],
  };
  assert.deepEqual(describeRuleChanges(rules, after), [
    "stop loss −7% → −10%",
    "default ceiling 25% → 30%",
    "MSFT override removed — back to the 30% default",
    "SHOP ceiling set to 35% (override: conviction)",
  ]);
});

test("an unchanged rule set describes no changes", () => {
  assert.deepEqual(describeRuleChanges(rules, structuredClone(rules)), []);
});

// ── Stop exceptions ─────────────────────────────────────────────────────────

const withStop = (o: Partial<StopOverride>): RiskRules => ({
  ...rules,
  stopOverrides: {
    XYZ: { stopLossPct: -30, decided: "2026-02-02", until: "2026-02-06", reason: "earnings", ...o },
  },
});

test("a dated exception sets the symbol's stop through its end date", () => {
  const r = withStop({});
  assert.equal(stopFor("XYZ", r, "2026-02-02").pct, -30);
  assert.equal(stopFor("xyz", r, "2026-02-06").pct, -30, "inclusive, and case-insensitive");
  assert.equal(stopFor("XYZ", r, "2026-02-06").exception?.reason, "earnings");
  assert.equal(stopFor("AMD", r, "2026-02-02").pct, -7, "other symbols keep the default");
});

test("after its end date the exception lapses and the default is back", () => {
  const stop = stopFor("XYZ", withStop({}), "2026-02-07");
  assert.equal(stop.pct, -7);
  assert.equal(stop.exception, null);
  assert.equal(stop.lapsed?.until, "2026-02-06");
  assert.equal(lapsedReason(stop.lapsed!), "ran out on 2026-02-06");
});

test("a looser stop needs an end date; a tighter one does not", () => {
  const open = stopFor("XYZ", withStop({ until: "" }), "2026-02-02");
  assert.equal(open.pct, -7, "an open-ended loosening does not apply");
  assert.match(lapsedReason(open.lapsed!), /no end date/);
  assert.equal(stopFor("XYZ", withStop({ until: "someday" }), "2026-02-02").pct, -7);
  assert.equal(stopFor("XYZ", withStop({ stopLossPct: -4, until: "" }), "2030-01-01").pct, -4);
});

test("stop exceptions load from the file, and a non-loss stop is dropped", () => {
  const home = mkdtempSync(join(tmpdir(), "toreda-risk-"));
  const prev = process.env.TOREDA_HOME;
  process.env.TOREDA_HOME = home;
  try {
    mkdirSync(configDir(), { recursive: true });
    writeFileSync(
      configFile("risk.json"),
      JSON.stringify({
        stopLossPct: -10,
        stopOverrides: {
          xyz: { stopLossPct: -30, decided: "2026-02-02", until: "2026-02-06", reason: "earnings" },
          AMD: { stopLossPct: 5, decided: "2026-02-02", until: "2026-02-06", reason: "typo" },
          NET: { decided: "2026-02-02" },
        },
      }),
    );
    const loaded = loadRiskRules();
    assert.deepEqual(Object.keys(loaded.stopOverrides), ["XYZ"]);
    assert.deepEqual(loaded.stopOverrides.XYZ, {
      stopLossPct: -30,
      decided: "2026-02-02",
      until: "2026-02-06",
      reason: "earnings",
    });
  } finally {
    if (prev === undefined) delete process.env.TOREDA_HOME;
    else process.env.TOREDA_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

test("stop exception changes are described in words, with their end dates", () => {
  const added = withStop({});
  assert.deepEqual(describeRuleChanges(rules, added), [
    "XYZ stop set to −30% until 2026-02-06 (exception: earnings)",
  ]);
  assert.deepEqual(describeRuleChanges(added, withStop({ until: "2026-02-10" })), [
    "XYZ stop −30% until 2026-02-06 → −30% until 2026-02-10 (exception: earnings)",
  ]);
  assert.deepEqual(describeRuleChanges(added, rules), [
    "XYZ stop exception removed — back to the −7% default",
  ]);
});

test("a stop loss is expressed as a negative percent", () => {
  // Guards against a future edit flipping the sign, which would make every
  // position look like it had breached the stop.
  assert.ok(DEFAULT_RISK_RULES.stopLossPct < 0);
});

// ── Stops sized to the stock, measured from the high ────────────────────────
// Figures are made up. The point of each test is the rule, not the numbers.

const SIZING = { volMultiple: 2, narrowestPct: -8, widestPct: -30, trailing: true };
const SIZED: RiskRules = { ...DEFAULT_RISK_RULES, stopLossPct: -10, stopSizing: SIZING };

const basis = (twoWeekMovePct: number | null, high: number | null = null): StopBasis => ({
  since: "2026-03-02",
  twoWeekMovePct,
  high,
  highDate: high === null ? null : "2026-06-01",
  note: twoWeekMovePct === null ? "too little history" : null,
});

test("a sized stop is twice the stock's two-week move", () => {
  assert.equal(sizedStopPct(basis(6), SIZING), -12);
});

test("a sized stop is never tighter than the narrowest or wider than the widest", () => {
  assert.equal(sizedStopPct(basis(2), SIZING), -8);
  assert.equal(sizedStopPct(basis(20), SIZING), -30);
});

test("with no history, or sizing off, there is no sized stop", () => {
  assert.equal(sizedStopPct(basis(null), SIZING), null);
  assert.equal(sizedStopPct(undefined, SIZING), null);
  assert.equal(sizedStopPct(basis(6), null), null);
  assert.equal(sizedStopPct(basis(6), { ...SIZING, volMultiple: 0 }), null);
});

// The reason for measuring from the high: from entry, a position up 80% has
// its stop half the price away, and nothing watches it give the gain back.
test("a winner's stop follows it up from the highest close", () => {
  const level = stopLevel("AAA", 100, basis(10, 200), SIZED)!;
  assert.equal(level.pct, -20);
  assert.equal(level.fromHigh, true);
  assert.equal(level.anchor, 200);
  assert.ok(Math.abs(level.price - 160) < 1e-9);
});

test("a high below entry leaves the stop measured from entry", () => {
  const level = stopLevel("AAA", 100, basis(10, 95), SIZED)!;
  assert.equal(level.fromHigh, false);
  assert.ok(Math.abs(level.price - 80) < 1e-9);
});

test("with trailing off, the sized stop is measured from entry", () => {
  const rules = { ...SIZED, stopSizing: { ...SIZING, trailing: false } };
  const level = stopLevel("AAA", 100, basis(10, 200), rules)!;
  assert.equal(level.fromHigh, false);
  assert.ok(Math.abs(level.price - 80) < 1e-9);
});

test("a stock with too little history falls back to the default, and says why", () => {
  const level = stopLevel("AAA", 100, basis(null, 120), SIZED)!;
  assert.equal(level.sized, false);
  assert.equal(level.pct, -10);
  assert.equal(level.note, "too little history");
  // It still follows the high: only the width falls back.
  assert.ok(Math.abs(level.price - 108) < 1e-9);
});

test("without sizing, the stop is the old one: the default, from entry", () => {
  const rules = { ...DEFAULT_RISK_RULES, stopLossPct: -7 };
  const level = stopLevel("AAA", 100, basis(10, 200), rules)!;
  assert.equal(level.pct, -7);
  assert.equal(level.fromHigh, false);
  assert.equal(level.note, null);
});

test("a core fund has no stop", () => {
  const rules = { ...SIZED, coreSymbols: ["IDXF"] };
  assert.equal(stopLevel("IDXF", 100, basis(3, 120), rules), null);
  assert.equal(stopLevel("idxf", 100, undefined, { ...DEFAULT_RISK_RULES, coreSymbols: ["IDXF"] }), null);
});

// An exception is looser or tighter than the stop it replaces: the stock's own.
test("an exception is judged against the stock's sized stop, not the default", () => {
  const today = "2026-06-10";
  const tighter: StopOverride = { stopLossPct: -15, decided: "2026-06-01", until: "", reason: "r" };
  const rules = { ...SIZED, stopOverrides: { AAA: tighter } };
  // −15% is looser than the −10% default but tighter than the −20% sized stop.
  const level = stopLevel("AAA", 100, basis(10, 200), rules, today)!;
  assert.equal(level.pct, -15);
  assert.ok(level.exception);

  const looser: StopOverride = { ...tighter, stopLossPct: -25 };
  const open = stopLevel("AAA", 100, basis(10, 200), { ...SIZED, stopOverrides: { AAA: looser } }, today)!;
  assert.equal(open.pct, -20, "a looser stop with no end date does not apply");
  assert.ok(open.lapsed);
});

test("the stop is reached at exactly its price, from the high", () => {
  const level = stopLevel("AAA", 100, basis(10, 200), SIZED)!;
  assert.equal(isPastStop(level, 160, 60), true);
  assert.equal(isPastStop(level, 160.01, 60), false);
  assert.ok(Math.abs(belowAnchorPct(level, 150, 50) - -25) < 1e-9);
});

test("a malformed sizing block is ignored rather than half-read", () => {
  assert.deepEqual(parseStopSizing(SIZING), SIZING);
  assert.equal(parseStopSizing({ ...SIZING, trailing: undefined })?.trailing, true);
  assert.equal(parseStopSizing({ ...SIZING, narrowestPct: 8 }), null);
  assert.equal(parseStopSizing({ ...SIZING, widestPct: -5 }), null);
  assert.equal(parseStopSizing({ volMultiple: 2 }), null);
  assert.equal(parseStopSizing(null), null);
});

test("turning sizing on and naming core funds are described as rule changes", () => {
  const after = { ...DEFAULT_RISK_RULES, stopSizing: SIZING, coreSymbols: ["IDXF", "DIVF"] };
  const lines = describeRuleChanges(DEFAULT_RISK_RULES, after);
  assert.ok(lines.includes("stops: one stop from entry → 2× the stock's two-week move, −8% to −30%, from the high"));
  assert.ok(lines.includes("core funds (no stop): none → IDXF, DIVF"));
});
