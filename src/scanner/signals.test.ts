import { test } from "node:test";
import assert from "node:assert/strict";
import type { RiskRules } from "../core/risk";
import { DEFAULT_SCANNER_CONFIG, type ScannerConfig } from "../core/scanner-config";
import { applyPositionContext, derivePriceSignals, deriveSocialSignals } from "./signals";
import { score } from "./score";
import type { AccountState, OpportunitySignal, PositionInfo, SymbolBars, Universe } from "./types";

const CFG: ScannerConfig = DEFAULT_SCANNER_CONFIG;
const UNIVERSE: Universe = { symbols: ["NVDA"], sectorOf: { NVDA: "Semiconductors" } };

const RULES: RiskRules = {
  stopLossPct: -7,
  defaultMaxWeight: 0.25,
  trimProfitPct: 25,
  overrides: {},
  stopOverrides: {},
  stopSizing: null,
  coreSymbols: [],
};

/** Bars rising steadily by `totalPct` across `days`, with flat volume. */
function rising(totalPct: number, days = 10, lastVolumeMult = 1): SymbolBars {
  const closes: number[] = [];
  for (let i = 0; i < days; i++) {
    closes.push(100 * (1 + (totalPct / 100) * (i / (days - 1))));
  }
  const volumes = closes.map(() => 1_000_000);
  volumes[volumes.length - 1] = 1_000_000 * lastVolumeMult;
  return { closes, volumes, latest: closes[closes.length - 1]! };
}

// Fixed at the close so sessionFraction is 1 and volume maths is deterministic.
const AFTER_CLOSE = new Date("2026-07-15T20:30:00Z");

// ── Scoring ─────────────────────────────────────────────────────────────────

test("confidence is the sum of its components", () => {
  assert.equal(score([["a", 5], ["b", 2]]).confidence, 7);
});

test("confidence is clamped to 1–9", () => {
  assert.equal(score([["a", 50]]).confidence, 9);
  assert.equal(score([["a", -50]]).confidence, 1);
});

test("the breakdown omits zero components but keeps negatives", () => {
  const s = score([["kept", 5], ["dropped", 0], ["negative", -1]]);
  assert.deepEqual(s.breakdown, ["+5 kept", "-1 negative"]);
});

// ── Price signals ───────────────────────────────────────────────────────────

test("a move past the momentum threshold produces a buy signal", () => {
  const signals = derivePriceSignals({ NVDA: rising(10) }, [], UNIVERSE, CFG, AFTER_CLOSE);
  const momentum = signals.find((s) => s.opportunityType === "momentum");
  assert.ok(momentum);
  assert.equal(momentum.action, "buy");
  assert.equal(momentum.sector, "Semiconductors");
});

test("a move below the threshold produces nothing", () => {
  const signals = derivePriceSignals({ NVDA: rising(1) }, [], UNIVERSE, CFG, AFTER_CLOSE);
  assert.equal(signals.length, 0);
});

test("volume confirmation raises confidence, and its absence lowers it", () => {
  const confirmed = derivePriceSignals(
    { NVDA: rising(10, 10, 3) },
    [],
    UNIVERSE,
    CFG,
    AFTER_CLOSE,
  )[0];
  const unconfirmed = derivePriceSignals({ NVDA: rising(10) }, [], UNIVERSE, CFG, AFTER_CLOSE)[0];
  assert.ok(confirmed && unconfirmed);
  assert.ok(confirmed.confidence > unconfirmed.confidence);
  assert.match(confirmed.reasoning, /volume .*x average/);
  assert.match(unconfirmed.reasoning, /volume below average/);
});

// Heavy volume on a down day is selling. It once confirmed a "momentum buy" on
// a stock falling 8% that day.
test("heavy volume on a down day does not confirm a rise", () => {
  const bars = rising(15, 10, 3);
  bars.closes[bars.closes.length - 1] = bars.closes[bars.closes.length - 2]! * 0.97;
  const momentum = derivePriceSignals({ NVDA: bars }, [], UNIVERSE, CFG, AFTER_CLOSE).find(
    (s) => s.opportunityType === "momentum",
  );
  assert.ok(momentum, "still a rise over the window");
  assert.ok(momentum.scoreBreakdown.includes("-1 heavy volume on a down day"), momentum.scoreBreakdown.join(", "));
  assert.match(momentum.reasoning, /3\.0x average, on a down day/);
});

// The window opens wherever the calendar puts it. Opening on a one-day crash
// made a rebound from that single day read as a trend.
test("a window that opens on a one-day crash does not read the rebound as momentum", () => {
  const crash: SymbolBars = {
    closes: [80, 96, 100, 99, 101, 100, 102, 101, 100, 101],
    volumes: Array(10).fill(1_000_000),
    latest: 101,
  };
  const signals = derivePriceSignals({ NVDA: crash }, [], UNIVERSE, CFG, AFTER_CLOSE);
  assert.equal(signals.filter((s) => s.opportunityType === "momentum").length, 0);
});

test("a window that opens on a one-day spike does not read the drop back as a pullback", () => {
  const spike: SymbolBars = {
    closes: [120, 100, 99, 100, 98, 99, 100, 99, 98, 99],
    volumes: Array(10).fill(1_000_000),
    latest: 99,
  };
  const signals = derivePriceSignals({ NVDA: spike }, [], UNIVERSE, CFG, AFTER_CLOSE);
  assert.equal(signals.filter((s) => s.opportunityType === "value_play").length, 0);
});

test("momentum reports the most conservative reading of the window", () => {
  const momentum = derivePriceSignals({ NVDA: rising(10) }, [], UNIVERSE, CFG, AFTER_CLOSE)[0];
  assert.ok(momentum);
  // From the third close (about 102.2) to 110, over 8 closes, not +10% over 10.
  assert.match(momentum.reasoning, /^\+7\.6% over 8 trading days/);
});

// A falling knife and a bargain look identical until afterwards, so a pullback
// never says buy.
test("a pullback produces `watch`, never `buy`", () => {
  const signals = derivePriceSignals({ NVDA: rising(-15) }, [], UNIVERSE, CFG, AFTER_CLOSE);
  const value = signals.find((s) => s.opportunityType === "value_play");
  assert.ok(value);
  assert.equal(value.action, "watch");
});

test("too few bars are skipped rather than scored on noise", () => {
  const thin: SymbolBars = { closes: [100, 130], volumes: [1, 1], latest: 130 };
  assert.equal(derivePriceSignals({ NVDA: thin }, [], UNIVERSE, CFG, AFTER_CLOSE).length, 0);
});

test("a disabled signal type produces nothing", () => {
  const off: ScannerConfig = { ...CFG, signalTypes: { ...CFG.signalTypes, momentum: false } };
  const signals = derivePriceSignals({ NVDA: rising(10) }, [], UNIVERSE, off, AFTER_CLOSE);
  assert.equal(signals.filter((s) => s.opportunityType === "momentum").length, 0);
});

// ── Social signals ──────────────────────────────────────────────────────────

const post = (sentiment: "Bullish" | "Bearish" | null) => ({
  body: "some post",
  symbols: ["NVDA"],
  sentiment,
});

test("a one-sided crowd below the sample floor produces nothing", () => {
  const posts = Array.from({ length: 7 }, () => post("Bullish"));
  assert.equal(deriveSocialSignals(posts, {}, UNIVERSE, CFG).length, 0);
});

test("a one-sided crowd above the sample floor produces a signal", () => {
  const posts = Array.from({ length: 10 }, () => post("Bullish"));
  const signals = deriveSocialSignals(posts, {}, UNIVERSE, CFG);
  assert.equal(signals.length, 1);
  // With no price history there is nothing to confirm it.
  assert.equal(signals[0]?.action, "watch");
  assert.match(signals[0]!.reasoning, /no price history/);
});

// The crowd alone is not a reason to buy: without a price check, ten bullish
// tags could make a `buy` at the confidence threshold with nothing behind them.
test("a bullish crowd is `watch` while price doesn't confirm it", () => {
  const posts = Array.from({ length: 10 }, () => post("Bullish"));
  const [flat] = deriveSocialSignals(posts, { NVDA: rising(0.5) }, UNIVERSE, CFG);
  assert.equal(flat?.action, "watch");
  assert.match(flat!.reasoning, /doesn't confirm it/);
  const [against] = deriveSocialSignals(posts, { NVDA: rising(-10) }, UNIVERSE, CFG);
  assert.equal(against?.action, "watch", "a crowd leaning against the price");
});

test("a bullish crowd becomes a `buy` when price agrees", () => {
  const posts = Array.from({ length: 10 }, () => post("Bullish"));
  const [signal] = deriveSocialSignals(posts, { NVDA: rising(15) }, UNIVERSE, CFG);
  assert.equal(signal?.action, "buy");
  assert.match(signal!.reasoning, /price \+15\.0% agrees/);
  assert.equal(signal?.pctChange?.toFixed(1), "15.0");
});

test("price agreeing doesn't change how the crowd is scored", () => {
  const posts = Array.from({ length: 10 }, () => post("Bullish"));
  const [alone] = deriveSocialSignals(posts, {}, UNIVERSE, CFG);
  const [agreed] = deriveSocialSignals(posts, { NVDA: rising(15) }, UNIVERSE, CFG);
  assert.equal(alone?.confidence, agreed?.confidence);
});

test("untagged posts are skipped, not guessed at", () => {
  const posts = Array.from({ length: 20 }, () => post(null));
  assert.equal(deriveSocialSignals(posts, {}, UNIVERSE, CFG).length, 0);
});

test("a split crowd is not a signal", () => {
  const posts = [
    ...Array.from({ length: 5 }, () => post("Bullish")),
    ...Array.from({ length: 5 }, () => post("Bearish")),
  ];
  assert.equal(deriveSocialSignals(posts, {}, UNIVERSE, CFG).length, 0);
});

// Crowd tags are a crowding indicator, not an edge. A bearish crowd is at least
// as often a bottom as a top, so social must never direct a sell.
test("a bearish crowd produces `watch`, never `sell`", () => {
  const posts = Array.from({ length: 10 }, () => post("Bearish"));
  const signals = deriveSocialSignals(posts, {}, UNIVERSE, CFG);
  assert.equal(signals[0]?.action, "watch");
  // Not even when the price is falling with it.
  const [falling] = deriveSocialSignals(posts, { NVDA: rising(-15) }, UNIVERSE, CFG);
  assert.equal(falling?.action, "watch");
});

test("posts about untracked symbols are ignored", () => {
  const posts = Array.from({ length: 20 }, () => ({ ...post("Bullish"), symbols: ["TSLA"] }));
  assert.equal(deriveSocialSignals(posts, {}, UNIVERSE, CFG).length, 0);
});

// ── Position context ────────────────────────────────────────────────────────

const buySignal: OpportunitySignal = {
  symbol: "NVDA",
  opportunityType: "momentum",
  confidence: 8,
  scoreBreakdown: [],
  reasoning: "",
  sector: "Semiconductors",
  action: "buy",
  timeframe: "immediate",
  catalysts: [],
};

function account(position?: PositionInfo, cash = 5_000): AccountState {
  return {
    positions: position ? { NVDA: position } : {},
    cash,
    portfolioValue: 10_000,
  };
}

const held = (weight: number, plPct: number): PositionInfo => ({
  qty: 10,
  marketValue: 10_000 * weight,
  unrealizedPl: 10_000 * weight * (plPct / 100),
  unrealizedPlPct: plPct / 100,
  weight,
});

test("a buy on an unheld symbol passes through unchanged", () => {
  assert.equal(applyPositionContext(buySignal, account(), RULES).action, "buy");
});

// The situation where a momentum signal is most tempting and most dangerous.
test("a buy on a profitable position past its ceiling becomes a trim", () => {
  const out = applyPositionContext(buySignal, account(held(0.3, 40)), RULES);
  assert.equal(out.action, "trim");
  assert.match(out.catalysts.join(" "), /scale out rather than add/);
});

test("a buy on a position past its ceiling but NOT profitable stays a buy", () => {
  // Below trimProfitPct: adding to a losing oversized position is a different
  // mistake, and not one the trim rule is about.
  assert.equal(applyPositionContext(buySignal, account(held(0.3, 5)), RULES).action, "buy");
});

test("nearing the ceiling notes it without overriding the action", () => {
  const out = applyPositionContext(buySignal, account(held(0.22, 5)), RULES);
  assert.equal(out.action, "buy");
  assert.match(out.catalysts.join(" "), /Nearing its ceiling/);
});

test("a position past the stop turns any signal into a sell", () => {
  const out = applyPositionContext(buySignal, account(held(0.1, -10)), RULES);
  assert.equal(out.action, "sell");
  assert.match(out.catalysts.join(" "), /stop-loss rule/);
});

// The stop outranks the trim: a position can be both oversized and losing, and
// the loss is what matters.
test("the stop wins over the concentration trim", () => {
  const out = applyPositionContext(buySignal, account(held(0.4, -10)), RULES);
  assert.equal(out.action, "sell");
});

test("a buy with no cash is flagged rather than silently pitched", () => {
  const out = applyPositionContext(buySignal, account(undefined, 3), RULES);
  assert.match(out.catalysts.join(" "), /Only \$3\.00 in cash/);
});

test("adding to a held position with no cash is flagged too", () => {
  const out = applyPositionContext(buySignal, account(held(0.1, 5), 3), RULES);
  assert.match(out.catalysts.join(" "), /cannot add without selling or borrowing/);
});

test("held positions carry their size and P&L into the catalysts", () => {
  const out = applyPositionContext(buySignal, account(held(0.15, 12)), RULES);
  assert.match(out.catalysts.join(" "), /Held: 10 sh/);
  assert.match(out.catalysts.join(" "), /15% of portfolio/);
});

test("a buy on a winner past its sized stop from the high becomes a sell", () => {
  const rules: RiskRules = {
    ...RULES,
    stopSizing: { volMultiple: 2, narrowestPct: -8, widestPct: -30, trailing: true },
  };
  const winner: PositionInfo = {
    ...held(0.1, 55),
    price: 155,
    avgEntry: 100,
    stopBasis: { since: "2026-01-05", twoWeekMovePct: 10, high: 200, highDate: "2026-01-20", note: null },
  };
  const out = applyPositionContext(buySignal, account(winner), rules);
  assert.equal(out.action, "sell");
  assert.match(out.catalysts.join(" "), /from its \$200\.00 high .* -20% stop-loss rule/);
});
