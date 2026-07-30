// Discovery: liquid, investable names that are MOVING but not tracked yet.
//
// Raw screener output is roughly 90% noise for a personal account — sub-dollar
// tickers, SPAC warrants, 3x leveraged ETFs. Everything here is about reaching
// the few real businesses without hand-maintaining yet another list.
//
// Nothing this returns is a recommendation. It is a prompt to go and look.

import { getAsset } from "../core/alpaca";
import { getMostActives, getMovers, getSnapshots } from "../core/market-data";
import type { ScannerConfig } from "../core/scanner-config";
import { createTrendingCache, SourceHealth } from "./sources/stocktwits";
import type { Candidate, DiscoveryResult } from "./types";

export const DISCOVERY_LIMITS = {
  /** A daily bar older than this means the ticker is effectively dead. */
  maxBarAgeDays: 5,
  /** Gate survivors, ranked, that reach the report. */
  maxReported: 8,
  /** How many survivors to spend asset-metadata lookups on. */
  maxMetadataLookups: 20,
};

/**
 * Name fragments marking a listing as something a personal account should not
 * be discovering: derivatives of a listing rather than a business, and
 * leveraged or inverse products whose decay makes them unsuitable to hold.
 *
 * Matched as substrings, so each must be anchored enough not to catch real
 * companies: a bare 'unit' hits "United Airlines", and 'depositary' would
 * exclude every ADR — including TSM and ASML, which are wanted.
 *
 * The leading spaces on ' bull ', ' bear ' and ' ultra ' matter. Without them
 * these patterns match a name that BEGINS with the word, which is how "Bear
 * Stearns Companies" and — still listed today — "Ultra Clean Holdings", a real
 * semiconductor supplier, were being silently discarded. Leveraged funds always
 * carry the word mid-name ("Direxion Daily Semiconductor Bear 3X Shares"), so
 * requiring the leading space loses nothing and stops eating real businesses.
 * 'ultrapro' and 'ultrashort' stay unanchored: they are single words that no
 * operating company is named.
 */
export const EXCLUDED_NAME_PATTERNS = [
  "warrant",
  " units",
  " rights",
  "2x",
  "3x",
  "-1x",
  "ultrapro",
  "ultrashort",
  " ultra ",
  " bull ",
  " bear ",
  "inverse",
  "leveraged",
  "daily short",
];

/** Warrants, units and rights are 5-letter tickers with a class suffix. */
export function looksLikeDerivative(symbol: string): boolean {
  return symbol.length === 5 && /[WURP]$/.test(symbol);
}

export function excludedByName(name: string): boolean {
  const n = name.toLowerCase();
  return EXCLUDED_NAME_PATTERNS.some((p) => n.includes(p));
}

export async function discoverCandidates(
  exclude: Set<string>,
  cfg: ScannerConfig,
  health: SourceHealth,
  now = Date.now(),
): Promise<DiscoveryResult> {
  const trending = createTrendingCache();

  // Each screen is independent: one failing must not take the pass down, so
  // they settle rather than race to the first rejection.
  const [trendingSyms, mostActives, movers] = await Promise.all([
    cfg.useStockTwits ? trending(health) : Promise.resolve<string[]>([]),
    getMostActives().catch(() => {
      health.record("Alpaca most-actives screener unavailable");
      return [] as string[];
    }),
    getMovers().catch(() => {
      health.record("Alpaca movers screener unavailable");
      return { gainers: [] as string[], losers: [] as string[] };
    }),
  ]);

  const sources: Record<string, string[]> = {
    trending: trendingSyms,
    "most-active": mostActives,
    gainer: movers.gainers,
    loser: movers.losers,
  };

  // Union, tracking which screens each symbol came from. Appearing in several
  // is the ranking signal — one screen is a fluke, three is a story.
  const bySymbol: Record<string, Set<string>> = {};
  for (const [source, symbols] of Object.entries(sources)) {
    for (const symbol of symbols) {
      if (!symbol || exclude.has(symbol)) continue; // already tracked or held
      (bySymbol[symbol] ??= new Set()).add(source);
    }
  }

  const rejected: Record<string, number> = {};
  const reject = (reason: string): void => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };

  const considered = Object.keys(bySymbol).length;

  // Cheap structural gate before spending any network calls.
  let symbols = Object.keys(bySymbol).filter((s) => {
    if (looksLikeDerivative(s)) {
      reject("warrant/unit/right");
      return false;
    }
    return true;
  });

  // Price and liquidity gates, one batched request.
  const snapshots = await getSnapshots(symbols).catch(() => {
    health.record("snapshot lookup failed — discovery skipped");
    return [];
  });
  const bySnapshot = new Map(snapshots.map((s) => [s.symbol, s]));
  const cutoff = now - DISCOVERY_LIMITS.maxBarAgeDays * 86_400_000;

  symbols = symbols.filter((s) => {
    const snap = bySnapshot.get(s);
    if (!snap) {
      reject("no market data");
      return false;
    }
    if (snap.price < cfg.discovery.minPrice) {
      reject(`under $${cfg.discovery.minPrice}`);
      return false;
    }
    if (snap.barDate && Date.parse(snap.barDate) < cutoff) {
      reject("stale/dead ticker");
      return false;
    }
    if (snap.prevVolume * snap.prevClose < cfg.discovery.minDollarVolume) {
      reject("illiquid");
      return false;
    }
    return true;
  });

  // Rank BEFORE metadata lookups, so we only pay for names we might report.
  symbols.sort((a, b) => {
    const bySource = (bySymbol[b]?.size ?? 0) - (bySymbol[a]?.size ?? 0);
    if (bySource !== 0) return bySource;
    return Math.abs(bySnapshot.get(b)?.changePct ?? 0) - Math.abs(bySnapshot.get(a)?.changePct ?? 0);
  });

  const candidates: Candidate[] = [];
  let notShown = 0;

  for (const symbol of symbols.slice(0, DISCOVERY_LIMITS.maxMetadataLookups)) {
    // Cap reached: count the remainder rather than dropping it silently, so the
    // report can never imply it showed everything that passed.
    if (candidates.length >= DISCOVERY_LIMITS.maxReported) {
      notShown++;
      continue;
    }
    const info = await getAsset(symbol);
    if (!info) {
      reject("no asset record");
      continue;
    }
    if (!info.tradable) {
      reject("not tradable on Alpaca");
      continue;
    }
    if (excludedByName(info.name)) {
      reject("leveraged ETF / derivative");
      continue;
    }
    const snap = bySnapshot.get(symbol);
    if (!snap) continue;
    candidates.push({
      symbol,
      name: info.name,
      price: snap.price,
      pctChange: snap.changePct,
      dollarVolume: snap.prevVolume * snap.prevClose,
      fractionable: info.fractionable,
      sources: [...(bySymbol[symbol] ?? [])].sort(),
    });
  }

  notShown += Math.max(0, symbols.length - DISCOVERY_LIMITS.maxMetadataLookups);
  return { candidates, rejected, considered, notShown };
}
