// Turning raw market data into ranked, position-aware signals.

import type { NewsItem } from "../core/market-data";
import type { RiskRules } from "../core/risk";
import { maxWeightFor, stopFor } from "../core/risk";
import type { ScannerConfig } from "../core/scanner-config";
import { score } from "./score";
import type { SocialPost } from "./sources/stocktwits";
import { aggregateTone } from "./tone";
import type {
  AccountState,
  OpportunitySignal,
  SymbolBars,
  Universe,
} from "./types";
import { confirmationThresholdPct, pctChange, sessionFraction } from "./volatility";

/** Minimum tagged posts before a social lean means anything. */
const MIN_SOCIAL_SAMPLE = 8;

function sectorFor(universe: Universe, symbol: string): string {
  return universe.sectorOf[symbol] ?? "Unclassified";
}

// ── Price ───────────────────────────────────────────────────────────────────

/**
 * Momentum and pullbacks, with volume and news corroboration.
 *
 * Volume is compared against the window average EXCLUDING the final bar, which
 * is partial intraday, and then scaled by how much of the session has elapsed.
 * Without that scaling a 10am scan compares two hours of volume against full
 * prior days and concludes every move is unconfirmed.
 */
export function derivePriceSignals(
  bars: Record<string, SymbolBars>,
  news: NewsItem[],
  universe: Universe,
  cfg: ScannerConfig,
  now = new Date(),
): OpportunitySignal[] {
  const signals: OpportunitySignal[] = [];
  const newsSymbols = new Set(news.flatMap((n) => n.symbols));
  const fraction = sessionFraction(now);

  for (const [symbol, data] of Object.entries(bars)) {
    if (data.closes.length < 3) continue;

    const pct = pctChange(data);
    const tradingDays = data.closes.length;

    const volHistory = data.volumes.slice(0, -1);
    const avgVol = volHistory.reduce((a, b) => a + b, 0) / Math.max(volHistory.length, 1);
    const latestVol = data.volumes[data.volumes.length - 1] ?? 0;
    const volRatio = latestVol / (avgVol || 1) / fraction;
    const volConfirmed = volRatio >= cfg.thresholds.momentumVolumeMult;
    const volNote = volConfirmed
      ? `volume ${volRatio.toFixed(1)}x average`
      : "volume below average";

    if (cfg.signalTypes.momentum && pct >= cfg.thresholds.momentumPct) {
      const { confidence, breakdown } = score([
        ["momentum base", 5],
        ["move size", Math.min(2, Math.floor(pct / 5))],
        [volConfirmed ? "volume confirms" : "volume does not confirm", volConfirmed ? 1 : -1],
        ["news corroboration", newsSymbols.has(symbol) ? 1 : 0],
      ]);
      signals.push({
        symbol,
        opportunityType: "momentum",
        confidence,
        scoreBreakdown: breakdown,
        reasoning: `+${pct.toFixed(1)}% over ${tradingDays} trading days (${volNote})`,
        sector: sectorFor(universe, symbol),
        action: "buy",
        timeframe: "immediate",
        price: data.latest,
        pctChange: pct,
        catalysts: [`Price momentum: +${pct.toFixed(1)}%`, `Volume: ${volNote}`],
      });
    }

    if (cfg.signalTypes.value_play && pct <= cfg.thresholds.valuePullbackPct) {
      const { confidence, breakdown } = score([
        ["pullback base", 6],
        ["depth of pullback", pct <= -20 ? 2 : 1],
        ["news corroboration", newsSymbols.has(symbol) ? 1 : 0],
      ]);
      signals.push({
        symbol,
        opportunityType: "value_play",
        confidence,
        scoreBreakdown: breakdown,
        // Action is `watch`, never `buy`. A falling knife and a bargain look
        // identical until after the fact.
        reasoning: `${pct.toFixed(1)}% over ${tradingDays} trading days — possible oversold entry`,
        sector: sectorFor(universe, symbol),
        action: "watch",
        timeframe: "short_term",
        price: data.latest,
        pctChange: pct,
        catalysts: [
          `Pullback: ${pct.toFixed(1)}%`,
          "Wait for reversal confirmation before entry",
        ],
      });
    }
  }
  return signals;
}

// ── News ────────────────────────────────────────────────────────────────────

/**
 * Headline catalysts. Symbols come from the API's own tagging, never from text.
 *
 * Keyword tone over a pile of headlines is weak evidence alone — a mega-cap
 * always has stories. So news never directs a trade by itself: the action stays
 * `watch` unless price action over the same window agrees with the tone.
 *
 * That corroboration is only meaningful because the two channels are
 * independent, which is why aggregateTone drops price-report headlines.
 * "Nvidia Stock Falls 5%" scored as bearish tone AND confirmed by a -5% move is
 * one fact counted twice, and it used to be enough to turn a quiet position
 * into a SELL at confidence 9.
 */
export function deriveNewsSignals(
  news: NewsItem[],
  bars: Record<string, SymbolBars>,
  universe: Universe,
  cfg: ScannerConfig,
): OpportunitySignal[] {
  const tracked = new Set(universe.symbols);
  const bySymbol: Record<string, string[]> = {};
  for (const item of news) {
    for (const symbol of item.symbols) {
      if (!tracked.has(symbol)) continue;
      (bySymbol[symbol] ??= []).push(item.headline);
    }
  }

  const signals: OpportunitySignal[] = [];
  for (const [symbol, headlines] of Object.entries(bySymbol)) {
    const t = aggregateTone(headlines);
    // Neutral coverage is noise — a company always has headlines.
    if (t.tone === "neutral") continue;

    const bar = bars[symbol];
    const pct = bar ? pctChange(bar) : 0;
    const needed = bar
      ? confirmationThresholdPct(
          bar,
          cfg.thresholds.newsPriceAgreePct,
          cfg.thresholds.newsPriceAgreeSigma,
        )
      : cfg.thresholds.newsPriceAgreePct;
    const corroborated =
      (t.tone === "bullish" && pct >= needed) || (t.tone === "bearish" && pct <= -needed);

    const lean = t.tone === "bullish" ? t.bull : t.bear;
    const { confidence, breakdown } = score([
      ["news base", 5],
      [`${t.tone} tone in ${lean}/${t.scored} headlines`, 1],
      ["sustained coverage", t.scored >= 3 ? 1 : 0],
      ["price action agrees", corroborated ? 2 : 0],
    ]);

    const tally =
      `${t.bull} bullish / ${t.bear} bearish of ${t.scored} scored` +
      (t.priceReports
        ? ` (${t.priceReports} price-report headline${t.priceReports > 1 ? "s" : ""} excluded)`
        : "");
    const move = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
    // Drivers first: these are the headlines the tone was actually scored on.
    const evidence = [...t.drivers, ...headlines.filter((h) => !t.drivers.includes(h))];

    signals.push({
      symbol,
      opportunityType: "news_catalyst",
      confidence,
      scoreBreakdown: breakdown,
      reasoning: corroborated
        ? `${tally}, price ${move} agrees (needed ${needed.toFixed(1)}%)`
        : `${tally} — price ${move} is inside this symbol's noise (needed ${needed.toFixed(1)}%)`,
      sector: sectorFor(universe, symbol),
      action: corroborated ? (t.tone === "bullish" ? "buy" : "sell") : "watch",
      timeframe: "immediate",
      ...(bar ? { price: bar.latest, pctChange: pct } : {}),
      catalysts: evidence.slice(0, 3).map((h) => h.slice(0, 90)),
    });
  }
  return signals;
}

// ── Social ──────────────────────────────────────────────────────────────────

/**
 * Crowd sentiment, using StockTwits' author-declared Bullish/Bearish tags.
 *
 * Untagged posts are skipped rather than guessed at from keywords. Note that
 * social never produces a `sell`: crowd tags are a crowding indicator, not an
 * edge, and a bearish crowd is at least as often a bottom as a top.
 */
export function deriveSocialSignals(
  posts: SocialPost[],
  bars: Record<string, SymbolBars>,
  universe: Universe,
  cfg: ScannerConfig,
): OpportunitySignal[] {
  const tracked = new Set(universe.symbols);
  const tally: Record<string, { bull: number; bear: number; samples: string[] }> = {};

  for (const post of posts) {
    if (!post.sentiment) continue;
    for (const symbol of post.symbols) {
      if (!tracked.has(symbol)) continue;
      const t = (tally[symbol] ??= { bull: 0, bear: 0, samples: [] });
      if (post.sentiment === "Bullish") t.bull++;
      else t.bear++;
      if (t.samples.length < 2 && post.body.trim()) {
        t.samples.push(post.body.trim().slice(0, 90));
      }
    }
  }

  const signals: OpportunitySignal[] = [];
  for (const [symbol, t] of Object.entries(tally)) {
    const total = t.bull + t.bear;
    // Needs a real sample, not one loud poster.
    if (total < MIN_SOCIAL_SAMPLE) continue;

    const bullShare = t.bull / total;
    const lean =
      bullShare >= cfg.thresholds.socialBullShare
        ? "bullish"
        : bullShare <= 1 - cfg.thresholds.socialBullShare
          ? "bearish"
          : null;
    if (!lean) continue;

    const { confidence, breakdown } = score([
      ["social base", 5],
      ["sample size", total >= 20 ? 2 : 1],
      ["one-sided lean", bullShare >= 0.8 || bullShare <= 0.2 ? 1 : 0],
    ]);

    signals.push({
      symbol,
      opportunityType: "social_buzz",
      confidence,
      scoreBreakdown: breakdown,
      reasoning: `${t.bull} bullish / ${t.bear} bearish across ${total} tagged posts (${lean})`,
      sector: sectorFor(universe, symbol),
      action: lean === "bullish" ? "buy" : "watch",
      timeframe: "short_term",
      ...(bars[symbol] ? { price: bars[symbol]!.latest } : {}),
      catalysts: t.samples,
    });
  }
  return signals;
}

// ── Reconciliation with the actual book ─────────────────────────────────────

/**
 * Reconcile a raw signal with what you actually hold.
 *
 * Without this the scanner happily recommends buying something you already hold
 * at +100% with no buying power left. A screener describes the market; an
 * advisor describes the market AS IT RELATES TO YOUR BOOK.
 */
export function applyPositionContext(
  signal: OpportunitySignal,
  account: AccountState,
  risk: RiskRules,
): OpportunitySignal {
  const position = account.positions[signal.symbol];

  if (!position) {
    // Can we even act on a buy? Flag it rather than pitching the unactionable.
    if (signal.action === "buy" && account.buyingPower < 25) {
      return {
        ...signal,
        catalysts: [
          ...signal.catalysts,
          `⚠️ Buying power $${account.buyingPower.toFixed(2)} — would need to free up cash`,
        ],
      };
    }
    return signal;
  }

  const out: OpportunitySignal = { ...signal, position };
  const plPct = position.unrealizedPlPct * 100;
  const weightPct = position.weight * 100;
  const cap = maxWeightFor(signal.symbol, risk);
  const capPct = cap * 100;

  out.catalysts = [
    ...signal.catalysts,
    `Held: ${position.qty} sh, $${position.marketValue.toFixed(2)} ` +
      `(${weightPct.toFixed(0)}% of portfolio), P&L ${plPct >= 0 ? "+" : ""}${plPct.toFixed(1)}%`,
  ];

  // A buy signal on a position already past its ceiling is really a trim
  // candidate — adding would push it further out of your own policy. This is
  // precisely the situation where momentum is most tempting and most dangerous.
  if (signal.action === "buy" && plPct >= risk.trimProfitPct && position.weight >= cap) {
    out.action = "trim";
    out.catalysts.push(
      `Position is ${weightPct.toFixed(0)}% of the book at +${plPct.toFixed(0)}%, ` +
        `past its ${capPct.toFixed(0)}% ceiling — scale out rather than add`,
    );
    return out;
  }

  // Approaching the ceiling: note it, but do not override the action. This is
  // information, not an instruction.
  if (signal.action === "buy" && position.weight >= cap * 0.8) {
    out.catalysts.push(
      `Nearing its ceiling: ${weightPct.toFixed(0)}% of ${capPct.toFixed(0)}% allowance`,
    );
  }

  if (signal.action === "buy" && account.buyingPower < 25) {
    out.catalysts.push(
      `⚠️ Buying power $${account.buyingPower.toFixed(2)} — cannot add without selling`,
    );
  }

  // The stop rule. Note this only fires for symbols that produced a signal;
  // reviewPositions() is what guarantees EVERY position gets checked.
  const stop = stopFor(signal.symbol, risk).pct;
  if (plPct <= stop) {
    out.action = "sell";
    out.catalysts.push(
      `Position is ${plPct.toFixed(1)}% — at or past the ${stop}% stop-loss rule`,
    );
  }
  return out;
}

/** Collapse to one signal per symbol (strongest wins), rank, and cap. */
export function rankSignals(
  signals: OpportunitySignal[],
  account: AccountState,
  risk: RiskRules,
  cfg: ScannerConfig,
): OpportunitySignal[] {
  const bySymbol: Record<string, OpportunitySignal> = {};
  for (const signal of signals) {
    const existing = bySymbol[signal.symbol];
    if (!existing || signal.confidence > existing.confidence) {
      bySymbol[signal.symbol] = signal;
    }
  }
  return Object.values(bySymbol)
    .map((s) => applyPositionContext(s, account, risk))
    .filter((s) => cfg.sectorFocus.length === 0 || cfg.sectorFocus.includes(s.sector))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, cfg.maxSignals);
}
