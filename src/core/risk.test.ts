import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_RISK_RULES,
  describeRuleChanges,
  hasOverride,
  loadRiskRules,
  maxWeightFor,
  type RiskRules,
} from "./risk";
import { defaultConfigFile } from "./paths";

const rules: RiskRules = {
  stopLossPct: -7,
  defaultMaxWeight: 0.25,
  trimProfitPct: 25,
  overrides: {
    MSFT: { maxWeight: 0.4, decided: "2026-01-15", reason: "long-term holding" },
  },
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
  };
  assert.deepEqual(shipped.overrides, {});
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

test("a stop loss is expressed as a negative percent", () => {
  // Guards against a future edit flipping the sign, which would make every
  // position look like it had breached the stop.
  assert.ok(DEFAULT_RISK_RULES.stopLossPct < 0);
});
