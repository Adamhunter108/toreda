// Scan orchestration.
//
// Replaces the source project's `execSync(curl …)` throughout. That worked, but
// it shelled out for every request — an injection surface that needed a
// hand-rolled `shellQuote` to defend, a hard dependency on curl being present,
// and fully synchronous, so a thirty-symbol scan waited on each call in turn.
// Everything here uses fetch and runs the independent fetches concurrently.

import { getAccount, getPositions } from "../core/alpaca";
import { loadConfig } from "../core/config";
import { demoScanResult, isDemoMode } from "../core/demo";
import { getDailyBars, getNews, type NewsItem } from "../core/market-data";
import { loadRiskRules, type RiskRules } from "../core/risk";
import { loadScannerConfig, type ScannerConfig } from "../core/scanner-config";
import { loadWatchlist } from "../core/watchlist";
import { discoverCandidates } from "./discovery";
import { reviewPositions } from "./review";
import {
  deriveNewsSignals,
  derivePriceSignals,
  deriveSocialSignals,
  rankSignals,
} from "./signals";
import {
  createTrendingCache,
  fetchSymbolStream,
  SourceHealth,
  type SocialPost,
} from "./sources/stocktwits";
import type { AccountState, ScanResult, SymbolBars, Universe } from "./types";
import { pctChange } from "./volatility";

export interface ScanOptions {
  discovery?: boolean;
  config?: ScannerConfig;
  risk?: RiskRules;
  /** Called with progress notes. Defaults to silence. */
  onProgress?: (message: string) => void;
}

/** What you actually hold — turns a stock screener into an advisor. */
async function fetchAccountState(health: SourceHealth): Promise<AccountState> {
  try {
    const [account, positions] = await Promise.all([getAccount(), getPositions()]);
    const state: AccountState = {
      positions: {},
      buyingPower: account.buyingPower,
      portfolioValue: account.portfolioValue,
    };
    for (const p of positions) {
      state.positions[p.symbol] = {
        qty: p.qty,
        marketValue: p.marketValue,
        unrealizedPl: p.unrealizedPl,
        unrealizedPlPct: p.unrealizedPlPct,
        weight: account.portfolioValue ? p.marketValue / account.portfolioValue : 0,
      };
    }
    return state;
  } catch {
    // Scanning without position context is degraded but still useful; failing
    // the whole scan because the account endpoint blipped is not.
    health.record("account unavailable — scanning without position context");
    return { positions: {}, buyingPower: 0, portfolioValue: 0 };
  }
}

/** Convert core's bar series into the shape the scoring functions expect. */
function toSymbolBars(raw: Record<string, Array<{ close: number; volume: number }>>): Record<
  string,
  SymbolBars
> {
  const out: Record<string, SymbolBars> = {};
  for (const [symbol, bars] of Object.entries(raw)) {
    // Fewer than two bars cannot express a change.
    if (bars.length < 2) continue;
    const closes = bars.map((b) => b.close);
    out[symbol] = {
      closes,
      volumes: bars.map((b) => b.volume),
      latest: closes[closes.length - 1] ?? 0,
    };
  }
  return out;
}

/** Pull StockTwits streams for held names, trending names, and movers. */
async function gatherSocialPosts(
  bars: Record<string, SymbolBars>,
  universe: Universe,
  account: AccountState,
  health: SourceHealth,
): Promise<SocialPost[]> {
  const trending = createTrendingCache();
  const trendingSymbols = (await trending(health)).filter((s) => universe.symbols.includes(s));
  const movers = Object.entries(bars)
    .filter(([, b]) => Math.abs(pctChange(b)) >= 3)
    .map(([symbol]) => symbol);
  // Held names always get checked: sentiment turning on a position matters more
  // than sentiment on something you do not own.
  const held = Object.keys(account.positions);
  const toCheck = [...new Set([...held, ...trendingSymbols, ...movers])].slice(0, 10);

  const streams = await Promise.all(
    toCheck.map((symbol) => fetchSymbolStream(symbol, health, 30)),
  );
  return streams.flat();
}

export async function runScan(options: ScanOptions = {}): Promise<ScanResult> {
  // Demo mode returns a fixed result rather than reaching StockTwits and the
  // news API — no keys, no network, and the same output every run.
  if (isDemoMode()) {
    options.onProgress?.("Scanning (demo data)…");
    return demoScanResult() as ScanResult;
  }

  const cfg = options.config ?? loadScannerConfig();
  const risk = options.risk ?? loadRiskRules();
  const progress = options.onProgress ?? (() => {});
  const health = new SourceHealth();
  const { mode } = loadConfig();

  const watchlist = loadWatchlist();
  const account = await fetchAccountState(health);

  // The universe is the watchlist PLUS anything held. You cannot stop watching
  // something you own by deleting a line from a config file.
  const universe: Universe = {
    symbols: [...new Set([...watchlist.symbols, ...Object.keys(account.positions)])].sort(),
    sectorOf: watchlist.sectorOf,
  };

  progress(`Scanning ${universe.symbols.length} symbols…`);

  const rawBars = await getDailyBars(universe.symbols, cfg.lookbackDays).catch(() => {
    health.record("price bars unavailable — price signals skipped");
    return {};
  });
  const bars = toSymbolBars(rawBars);

  let news: NewsItem[] = [];
  if (cfg.signalTypes.news_catalyst) {
    progress("Fetching news…");
    news = await getNews(universe.symbols).catch(() => {
      health.record("news unavailable — news signals skipped");
      return [];
    });
  }

  let posts: SocialPost[] = [];
  if (cfg.signalTypes.social_buzz && cfg.useStockTwits) {
    progress("Fetching social sentiment…");
    posts = await gatherSocialPosts(bars, universe, account, health);
  }

  const raw = [
    ...derivePriceSignals(bars, news, universe, cfg),
    ...deriveNewsSignals(news, bars, universe, cfg),
    ...deriveSocialSignals(posts, bars, universe, cfg),
  ];
  const opportunities = rankSignals(raw, account, risk, cfg);
  const positionAlerts = reviewPositions(account, risk);

  let discovery = null;
  if ((options.discovery ?? true) && cfg.discovery.enabled) {
    progress("Screening for names outside the watchlist…");
    const tracked = new Set(universe.symbols);
    discovery = await discoverCandidates(tracked, cfg, health);
  }

  return {
    opportunities,
    positionAlerts,
    discovery,
    minConfidence: cfg.minConfidence,
    mode,
    degraded: health.degraded,
    scannedAt: new Date().toISOString(),
  };
}
