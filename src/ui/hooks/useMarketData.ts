// Lazily-polled market data for charts and panels. Minutes-scale intervals;
// live prices come from the stream, not from here.
import { useEffect, useState } from "react";
import { getClock } from "../../core/alpaca";
import { getRealized, type Realized } from "../../core/activities";
import {
  getCloses,
  getEquityHistory,
  getSnapshots,
  getSymbolStats,
  type Snapshot,
  type SymbolStats,
} from "../../core/market-data";
import { EMPTY_HISTORY, type EquityHistory } from "../../core/performance";
import type { RiskRules } from "../../core/risk";
import { loadStopBases, type StopBases } from "../../scanner/stops";

/**
 * Run `fetcher` now and on an interval, keeping the last good value.
 *
 * Errors are swallowed on purpose: these feed decorative panels, and a blipped
 * sparkline fetch must not blank a dashboard the trader is reading. The account
 * poll (useAlpaca) is where errors DO surface, because that one is load-bearing.
 */
function usePolled<T>(
  fetcher: () => Promise<T>,
  initial: T,
  pollMs: number,
  deps: unknown[],
  enabled = true,
): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = (): void => {
      fetcher()
        .then((v) => {
          if (alive) setValue(v);
        })
        .catch(() => {
          /* keep the last good value */
        });
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/** Realized P&L from fill history — slow, since it only changes when you trade. */
export function useRealized(pollMs = 300_000): Realized | null {
  return usePolled<Realized | null>(getRealized, null, pollMs, [pollMs]);
}

/** Whether the US market is open. Null means not yet known. */
export function useClock(pollMs = 60_000): boolean | null {
  return usePolled<boolean | null>(
    () => getClock().then((c) => c.isOpen),
    null,
    pollMs,
    [pollMs],
  );
}

export function useEquityHistory(
  period = "1M",
  timeframe = "1D",
  pollMs = 300_000,
): EquityHistory {
  return usePolled<EquityHistory>(
    () => getEquityHistory(period, timeframe),
    EMPTY_HISTORY,
    pollMs,
    [period, timeframe, pollMs],
  );
}

/** Today's session stats for one symbol — only while a detail pane is open. */
export function useSymbolStats(symbol: string | null, pollMs = 60_000): SymbolStats | null {
  const [stats, setStats] = useState<SymbolStats | null>(null);
  useEffect(() => {
    if (!symbol) {
      setStats(null);
      return;
    }
    let alive = true;
    const tick = (): void => {
      getSymbolStats(symbol)
        .then((s) => {
          if (alive) setStats(s);
        })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [symbol, pollMs]);
  return stats;
}

/** Daily closes per symbol — for the position sparklines. */
export function useCloses(symbols: string[], pollMs = 300_000): Record<string, number[]> {
  const key = [...symbols].sort().join(",");
  return usePolled<Record<string, number[]>>(
    () => getCloses(symbols),
    {},
    pollMs,
    [key, pollMs],
    symbols.length > 0,
  );
}

/** Latest snapshot per watchlist symbol — for the movers panel. */
export function useSnapshots(symbols: string[], pollMs = 60_000): Snapshot[] {
  const key = [...symbols].sort().join(",");
  return usePolled<Snapshot[]>(
    () => getSnapshots(symbols),
    [],
    pollMs,
    [key, pollMs],
    symbols.length > 0,
  );
}

/**
 * What each held stop is measured from: purchase dates and price history.
 * Slow, since highs move once a day and purchase dates only when you trade.
 * Null until the first load, or when stops are not sized.
 */
export function useStopBases(
  positions: Array<{ symbol: string; qty: number }>,
  risk: RiskRules,
  pollMs = 1_800_000,
): StopBases | null {
  const key = positions.map((p) => `${p.symbol}:${p.qty}`).sort().join(",");
  const rulesKey = JSON.stringify([risk.stopSizing, risk.coreSymbols]);
  return usePolled<StopBases | null>(
    () => loadStopBases(positions, risk),
    null,
    pollMs,
    [key, rulesKey, pollMs],
    risk.stopSizing !== null && positions.length > 0,
  );
}
