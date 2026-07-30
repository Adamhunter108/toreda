// Subscribe to the live price stream — the FAST path — and expose a
// symbol → price map plus the connection status.
//
// Keyed on the SORTED symbol list so it reconnects only when the set of symbols
// actually changes, not on every render that hands over a new array identity.
import { useEffect, useState } from "react";
import { createPriceStream } from "../../core/price-stream";
import type { StreamStatus } from "../../core/types";

export function usePrices(symbols: string[]) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const key = [...symbols].sort().join(",");

  useEffect(() => {
    // DASH_NOSTREAM skips the WebSocket entirely, so a render test does not
    // compete with a running dashboard for the single free-tier connection.
    if (symbols.length === 0 || process.env.DASH_NOSTREAM) return;

    const stream = createPriceStream({
      symbols,
      onTick: (tick) =>
        setPrices((prev) =>
          prev[tick.symbol] === tick.price ? prev : { ...prev, [tick.symbol]: tick.price },
        ),
      onStatus: setStatus,
    });
    return () => stream.close();
    // `symbols` is captured through `key`; reconnecting on identity churn would
    // drop and re-establish the one connection the free tier allows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { prices, status };
}
