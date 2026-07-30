// StockTwits: crowd sentiment and trending symbols.
//
// An undocumented public API with no stability guarantee, no versioning, and no
// contract with us. In the source project that was survivable — one user, one
// caller. Shared with others it is a liability, so this module is built to
// DEGRADE rather than break: every function returns empty on failure and
// records why, and the scan continues without social signals instead of dying.
//
// Set `useStockTwits: false` in config/scanner.json to skip it entirely.

import { getJson } from "../../core/http";

const BASE = "https://api.stocktwits.com/api/2";

export interface SocialPost {
  body: string;
  /** Tickers StockTwits itself attached to the post — never regex-derived. */
  symbols: string[];
  /** StockTwits' own author-declared tag. Null when the author set none. */
  sentiment: "Bullish" | "Bearish" | null;
}

/** Collects the reasons a source degraded, for the scan to report honestly. */
export class SourceHealth {
  private readonly failures = new Set<string>();

  record(reason: string): void {
    this.failures.add(reason);
  }

  get degraded(): string[] {
    return [...this.failures];
  }

  get healthy(): boolean {
    return this.failures.size === 0;
  }
}

interface RawMessage {
  body?: string;
  symbols?: Array<{ symbol?: string }>;
  entities?: { sentiment?: { basic?: string } | null };
}

export async function fetchSymbolStream(
  symbol: string,
  health: SourceHealth,
  limit = 30,
): Promise<SocialPost[]> {
  try {
    const data = await getJson<{ messages?: RawMessage[]; errors?: unknown }>(
      `${BASE}/streams/symbol/${encodeURIComponent(symbol)}.json?limit=${limit}`,
      { retries: 1, timeoutMs: 15_000 },
    );
    if (data.errors) {
      health.record(`StockTwits returned an error for ${symbol}`);
      return [];
    }
    return (data.messages ?? []).map((m) => {
      const basic = m.entities?.sentiment?.basic;
      return {
        body: String(m.body ?? ""),
        symbols: (m.symbols ?? []).map((s) => String(s.symbol ?? "")).filter(Boolean),
        sentiment: basic === "Bullish" || basic === "Bearish" ? basic : null,
      };
    });
  } catch (err) {
    health.record(
      `StockTwits unreachable (${err instanceof Error ? err.message.slice(0, 60) : "unknown"})`,
    );
    return [];
  }
}

/**
 * Everything StockTwits is trending, unfiltered.
 *
 * Callers narrow this themselves. An earlier version filtered to the watchlist
 * internally, which silently discarded ~26 of 30 symbols and made the discovery
 * pass structurally impossible.
 */
export async function fetchTrending(health: SourceHealth): Promise<string[]> {
  try {
    const data = await getJson<{ symbols?: Array<{ symbol?: string }> }>(
      `${BASE}/trending/symbols.json`,
      { retries: 1, timeoutMs: 15_000 },
    );
    return (data.symbols ?? []).map((s) => String(s.symbol ?? "")).filter(Boolean);
  } catch (err) {
    health.record(
      `StockTwits trending unavailable (${err instanceof Error ? err.message.slice(0, 60) : "unknown"})`,
    );
    return [];
  }
}

/**
 * Cache trending for the life of one scan.
 *
 * Both the signal path and the discovery path want it, and one failed run
 * should not become two failed requests — the cache is populated even on
 * failure for exactly that reason.
 */
export function createTrendingCache(): (health: SourceHealth) => Promise<string[]> {
  let cached: string[] | null = null;
  return async (health: SourceHealth) => {
    if (cached !== null) return cached;
    cached = await fetchTrending(health);
    return cached;
  };
}
