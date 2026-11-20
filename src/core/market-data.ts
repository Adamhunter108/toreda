// Alpaca's market data API: quotes, bars, snapshots, screeners, news.
//
// All read-only and polled on lazy timers (minutes), so this stays far under
// the rate limit. Live prices come from the stream, not from here.
//
// A note on `feed=iex`: the free plan serves IEX, a partial slice of
// consolidated volume. Fine for liquid names, sparse on thin ones, and the last
// price can differ slightly from the SIP last. Paid plans get `feed=sip`.

import { authHeaders, DATA_HOST, loadConfig } from "./config";
import {
  demoCloses,
  demoEquityHistory,
  demoPrice,
  demoQuotes,
  demoSnapshots,
  demoSymbolStats,
  isDemoMode,
} from "./demo";
import { getJson } from "./http";
import { type EquityHistory, parseEquityHistory } from "./performance";
import { FLOW_TYPES } from "./transfers";
import type { Quote } from "./types";

export type Feed = "iex" | "sip";

/** The free tier only serves IEX; this is where a paid upgrade would switch. */
export function defaultFeed(): Feed {
  return "iex";
}

function dataUrl(path: string): string {
  return DATA_HOST + path;
}

const num = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

export interface RawSnapshot {
  latestTrade?: { p?: number };
  minuteBar?: { c?: number };
  dailyBar?: { o?: number; h?: number; l?: number; c?: number; v?: number; t?: string };
  prevDailyBar?: { c?: number; v?: number };
}

// ── Quotes ──────────────────────────────────────────────────────────────────

export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  if (isDemoMode()) return demoQuotes(symbols);
  if (symbols.length === 0) return [];
  const url = dataUrl(`/v2/stocks/quotes/latest?symbols=${symbols.join(",")}`);
  const data = await getJson<{ quotes?: Record<string, { bp?: number; ap?: number } | null> }>(
    url,
    { headers: authHeaders() },
  );
  const quotes = data.quotes ?? {};
  return Object.keys(quotes)
    .sort()
    .map((symbol): Quote => {
      const q = quotes[symbol];
      const bid = num(q?.bp);
      const ask = num(q?.ap);
      return {
        symbol,
        bid,
        ask,
        mid: bid && ask ? (bid + ask) / 2 : ask || bid,
        spread: bid && ask ? ask - bid : 0,
      };
    });
}

// ── Snapshots ───────────────────────────────────────────────────────────────

export interface Snapshot {
  symbol: string;
  price: number;
  changePct: number;
  /** 0 when `sinceOpen`: there was no previous session. */
  prevClose: number;
  /** Previous COMPLETE session's volume. The intraday bar is partial. */
  prevVolume: number;
  dailyVolume: number;
  barDate: string;
  /**
   * No previous session to compare with: a stock's first day of trading, or
   * one the IEX feed saw no trades in last session. `changePct` is then the
   * move since today's open, and must be labelled that way, not as today's
   * change.
   */
  sinceOpen?: true;
}

/**
 * One symbol's snapshot, or null when there is nothing to price it from.
 *
 * Without a previous close the move is measured from today's open, not
 * dropped. Dropping it hid a new listing from the watchlist on its first
 * day, which looks exactly like a symbol that was never added.
 */
export function parseSnapshot(symbol: string, snap: RawSnapshot): Snapshot | null {
  const daily = snap.dailyBar ?? {};
  const prev = snap.prevDailyBar ?? {};
  const price = num(snap.latestTrade?.p) || num(daily.c) || num(snap.minuteBar?.c);
  if (!price) return null;
  const today = { symbol, price, dailyVolume: num(daily.v), barDate: String(daily.t ?? "") };

  const prevClose = num(prev.c);
  if (prevClose) {
    return {
      ...today,
      changePct: ((price - prevClose) / prevClose) * 100,
      prevClose,
      prevVolume: num(prev.v),
    };
  }
  const open = num(daily.o);
  if (!open) return null;
  return {
    ...today,
    changePct: ((price - open) / open) * 100,
    prevClose: 0,
    prevVolume: 0,
    sinceOpen: true,
  };
}

export async function getSnapshots(
  symbols: string[],
  feed: Feed = defaultFeed(),
): Promise<Snapshot[]> {
  if (isDemoMode()) return demoSnapshots(symbols);
  if (symbols.length === 0) return [];
  const url = dataUrl(`/v2/stocks/snapshots?symbols=${symbols.join(",")}&feed=${feed}`);
  const data = await getJson<Record<string, RawSnapshot>>(url, { headers: authHeaders() });

  const out: Snapshot[] = [];
  for (const symbol of Object.keys(data)) {
    const snap = data[symbol];
    if (!snap || typeof snap !== "object") continue;
    const parsed = parseSnapshot(symbol, snap);
    if (parsed) out.push(parsed);
  }
  return out;
}

export interface SymbolStats {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  prevClose: number;
}

export async function getSymbolStats(
  symbol: string,
  feed: Feed = defaultFeed(),
): Promise<SymbolStats | null> {
  if (isDemoMode()) return demoSymbolStats(symbol);
  const url = dataUrl(`/v2/stocks/snapshots?symbols=${symbol}&feed=${feed}`);
  const data = await getJson<Record<string, RawSnapshot>>(url, { headers: authHeaders() });
  const s = data[symbol];
  if (!s) return null;
  const daily = s.dailyBar ?? {};
  return {
    open: num(daily.o),
    high: num(daily.h),
    low: num(daily.l),
    close: num(daily.c),
    volume: num(daily.v),
    prevClose: num(s.prevDailyBar?.c),
  };
}

/** Latest price for one symbol. 0 means unknown — never guess. */
export async function getLatestPrice(
  symbol: string,
  feed: Feed = defaultFeed(),
): Promise<number> {
  if (isDemoMode()) return demoPrice(symbol) ?? 0;
  const url = dataUrl(`/v2/stocks/snapshots?symbols=${symbol}&feed=${feed}`);
  const data = await getJson<Record<string, RawSnapshot>>(url, { headers: authHeaders() });
  const s = data[symbol];
  if (!s) return 0;
  return num(s.latestTrade?.p) || num(s.minuteBar?.c) || num(s.dailyBar?.c);
}

// ── Bars ────────────────────────────────────────────────────────────────────

export interface Bar {
  close: number;
  volume: number;
  time: string;
}

/**
 * Daily bars per symbol.
 *
 * Pages until exhausted. The v2 bars endpoint caps rows per response, so with a
 * 30-symbol watchlist a single page silently drops symbols — the scanner used
 * to score whichever names happened to survive the cut.
 */
export async function getDailyBars(
  symbols: string[],
  lookbackDays = 45,
  feed: Feed = defaultFeed(),
): Promise<Record<string, Bar[]>> {
  if (symbols.length === 0) return {};
  const start = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10);
  const collected: Record<string, Bar[]> = {};
  let pageToken = "";

  for (let page = 0; page < 10; page++) {
    const url = dataUrl(
      `/v2/stocks/bars?symbols=${symbols.join(",")}&timeframe=1Day` +
        `&start=${start}&limit=10000&feed=${feed}` +
        (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""),
    );
    const data = await getJson<{
      bars?: Record<string, Array<{ c?: number; v?: number; t?: string }>>;
      next_page_token?: string | null;
    }>(url, { headers: authHeaders() });

    for (const [symbol, bars] of Object.entries(data.bars ?? {})) {
      const mapped = (bars ?? []).map((b) => ({
        close: num(b.c),
        volume: num(b.v),
        time: String(b.t ?? ""),
      }));
      collected[symbol] = (collected[symbol] ?? []).concat(mapped);
    }
    if (!data.next_page_token) break;
    pageToken = data.next_page_token;
  }
  return collected;
}

/** Closing prices only — for sparklines. */
export async function getCloses(
  symbols: string[],
  lookbackDays = 45,
): Promise<Record<string, number[]>> {
  if (isDemoMode()) return demoCloses(symbols, lookbackDays);
  const bars = await getDailyBars(symbols, lookbackDays);
  const out: Record<string, number[]> = {};
  for (const [symbol, series] of Object.entries(bars)) {
    out[symbol] = series.map((b) => b.close);
  }
  return out;
}

/**
 * Portfolio equity over a period, with each deposit and withdrawal at the point
 * it landed — for the dashboard's equity chart, which takes them out (see
 * `performance`).
 */
export async function getEquityHistory(period = "1M", timeframe = "1D"): Promise<EquityHistory> {
  if (isDemoMode()) {
    const equity = demoEquityHistory(period);
    return { equity, flows: equity.map(() => 0) };
  }
  const cfg = loadConfig();
  const url =
    `${cfg.tradeHost}/v2/account/portfolio/history?period=${period}&timeframe=${timeframe}` +
    `&cashflow_types=${FLOW_TYPES.join(",")}`;
  return parseEquityHistory(await getJson<unknown>(url, { headers: authHeaders() }));
}

// ── News ────────────────────────────────────────────────────────────────────

export interface NewsItem {
  headline: string;
  /** Tickers the API itself tagged. Trusted over any text matching. */
  symbols: string[];
  createdAt: string;
}

export async function getNews(symbols: string[], limit = 50): Promise<NewsItem[]> {
  if (symbols.length === 0) return [];
  const url = dataUrl(`/v1beta1/news?symbols=${symbols.join(",")}&limit=${limit}`);
  const data = await getJson<{
    news?: Array<{ headline?: string; symbols?: string[]; created_at?: string }>;
  }>(url, { headers: authHeaders() });
  return (data.news ?? []).map((n) => ({
    headline: String(n.headline ?? ""),
    symbols: Array.isArray(n.symbols) ? n.symbols : [],
    createdAt: String(n.created_at ?? ""),
  }));
}

// ── Screeners ───────────────────────────────────────────────────────────────

export interface Movers {
  gainers: string[];
  losers: string[];
}

export async function getMovers(top = 25): Promise<Movers> {
  const url = dataUrl(`/v1beta1/screener/stocks/movers?top=${top}`);
  const data = await getJson<{
    gainers?: Array<{ symbol?: string }>;
    losers?: Array<{ symbol?: string }>;
  }>(url, { headers: authHeaders() });
  const pick = (arr: Array<{ symbol?: string }> | undefined): string[] =>
    (arr ?? []).map((m) => String(m.symbol ?? "")).filter(Boolean);
  return { gainers: pick(data.gainers), losers: pick(data.losers) };
}

export async function getMostActives(top = 25): Promise<string[]> {
  const url = dataUrl(`/v1beta1/screener/stocks/most-actives?top=${top}`);
  const data = await getJson<{ most_actives?: Array<{ symbol?: string }> }>(url, {
    headers: authHeaders(),
  });
  return (data.most_actives ?? []).map((m) => String(m.symbol ?? "")).filter(Boolean);
}
