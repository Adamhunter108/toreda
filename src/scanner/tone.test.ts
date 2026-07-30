import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateTone } from "./tone";

const tone = (...headlines: string[]) => aggregateTone(headlines).tone;

// ── Whole-word matching ─────────────────────────────────────────────────────
// Each substring below appears inside an ordinary word. Under the earlier
// `includes()` matching, every one of them scored bearish.

test('"Missing" does not match `miss`', () => {
  assert.equal(
    tone(
      "QUICK SPARK: Nvidia Backed Nebius Could Be The AI Stock Investors Are Missing, This ETF CEO Says",
      "Analysts Are Missing The Real Story On AI Infrastructure",
    ),
    "neutral",
  );
});

test('"shortfall" does not match `fall`', () => {
  assert.equal(tone("Memory Shortfall Persists", "Supply Shortfall Continues Into Q3"), "neutral");
});

test('"commission" and "missile" do not match `miss`', () => {
  assert.equal(
    tone("Commission Opens Review Of Chip Exports", "Missile Defense Contract Awarded"),
    "neutral",
  );
});

test('"executing" does not match `cut`', () => {
  assert.equal(
    tone("Nvidia Executing Well On Data Center Roadmap", "Team Executing Against Plan"),
    "neutral",
  );
});

test('"recording" does not match `record`', () => {
  assert.equal(
    tone("Studio Recording Software Adds AI Features", "Recording Sessions Move To Cloud"),
    "neutral",
  );
});

// Real hits must still land, including plurals and past tense.

test("`misses` still matches", () => {
  assert.equal(tone("Chipmaker Misses Q2 Estimates", "Supplier Misses Delivery Targets"), "bearish");
});

test("`falls` and `fell` still match", () => {
  assert.equal(tone("Chip Sector Falls On Export News", "Orders Fell Sharply In June"), "bearish");
});

test("`upgraded` and `raises` still match", () => {
  assert.equal(
    tone("Nvidia Upgraded At Morgan Stanley", "Mizuho Raises Price Target To $625"),
    "bullish",
  );
});

// ── Per-headline scoring, not one concatenated blob ─────────────────────────

test("one stray bear word among neutral headlines is not a tone", () => {
  assert.equal(
    tone(
      "Nvidia Announces New Data Center Partnership",
      "Nvidia CEO Speaks At Developer Conference",
      "Analyst Note Recaps Nvidia Roadmap",
      "Nvidia Supplier Misses Delivery Window",
    ),
    "neutral",
  );
});

test("a lean that actually recurs is a tone", () => {
  assert.equal(
    tone(
      "Nvidia Announces New Data Center Partnership",
      "Nvidia Misses Q2 Estimates",
      "Regulators Probe Nvidia Export Practices",
    ),
    "bearish",
  );
});

test("a single bearish headline is an anecdote, not a tone", () => {
  assert.equal(tone("Regulators Probe Nvidia Export Practices"), "neutral");
});

test("equal bull and bear counts are neutral, not whichever came last", () => {
  assert.equal(
    tone(
      "Nvidia Upgraded At Morgan Stanley",
      "Nvidia Beats On Revenue",
      "Nvidia Misses Margin Guidance",
      "Regulators Probe Nvidia",
    ),
    "neutral",
  );
});

// ── Price reports carry no tone ─────────────────────────────────────────────

test("a price-report headline is excluded from tone", () => {
  assert.equal(
    tone("Nvidia Stock Falls 5%: How Credit Risk Sharing Is Impacting the AI Trade"),
    "neutral",
  );
});

test("price reports are excluded, not merely outvoted", () => {
  assert.equal(
    aggregateTone([
      "Nvidia Stock Falls 5%: How Credit Risk Sharing Is Impacting the AI Trade",
      "Nvidia Drops 3% In Premarket Trading",
      "Nvidia Announces New Data Center Partnership",
    ]).priceReports,
    2,
  );
});

test("a percent-first price report is caught too", () => {
  assert.equal(tone("Nvidia 6% Lower As Traders Book Profits"), "neutral");
});

test("a percentage that is NOT a price move still carries tone", () => {
  assert.equal(
    tone("Nvidia Misses On 40% Margin Target", "Supplier Misses 20% Yield Goal"),
    "bearish",
  );
});

// ── The regression this layer exists for ────────────────────────────────────

test("the 2026-07-27 NVDA batch no longer reads bearish", () => {
  assert.equal(
    tone(
      "Nvidia Stock Falls 5%: How Credit Risk Sharing Is Impacting the AI Trade",
      "QUICK SPARK: Nvidia Backed Nebius Could Be The AI Stock Investors Are Missing, This ETF CEO Says",
      "Aggressive Buying On Nvidia Backing Massive OpenAI Data Center And Trump Pausing Iran Attack",
      "China's $500B Memory Giant Isn't Chasing Nvidia. It's Betting on Intel and AMD",
      "EXCLUSIVE: Anthropic Is a Generational Company, Tema CEO Says",
    ),
    "neutral",
  );
});

test("no headlines at all is neutral", () => {
  assert.equal(tone(), "neutral");
});

// ── Drivers: the headlines a signal was actually scored on ──────────────────

const DRIVER_BATCH = [
  "Nvidia CEO Speaks At Developer Conference",
  "Analyst Note Recaps Nvidia Roadmap",
  "Nvidia Misses Q2 Estimates",
  "Regulators Probe Nvidia Export Practices",
];

test("drivers are the toned headlines, not the first ones in the feed", () => {
  assert.deepEqual(aggregateTone(DRIVER_BATCH).drivers, [
    "Nvidia Misses Q2 Estimates",
    "Regulators Probe Nvidia Export Practices",
  ]);
});

test("drivers exclude headlines leaning the other way", () => {
  const drivers = aggregateTone([...DRIVER_BATCH, "Nvidia Upgraded At Morgan Stanley"]).drivers;
  assert.ok(drivers.every((h) => !h.includes("Upgraded")));
});

test("a neutral batch has no drivers", () => {
  assert.equal(aggregateTone(DRIVER_BATCH.slice(0, 2)).drivers.length, 0);
});

test("the scored count excludes price reports but counts everything else", () => {
  const t = aggregateTone([
    "Nvidia Stock Falls 5%: Something",
    "Nvidia Misses Q2 Estimates",
    "Regulators Probe Nvidia",
    "Nvidia CEO Speaks At Conference",
  ]);
  assert.equal(t.priceReports, 1);
  assert.equal(t.scored, 3);
  assert.equal(t.bear, 2);
});
