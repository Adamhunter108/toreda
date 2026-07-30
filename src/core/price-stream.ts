// The FAST path: one persistent WebSocket to Alpaca's IEX market-data stream.
//
// Push-based, so it never touches the REST rate limit. The auth handshake,
// subscription, frame parsing, and reconnection all hide behind a small
// interface — consumers just get onTick callbacks and a status signal.
//
// Free-tier realities, worth knowing when it misbehaves:
//   • IEX is a partial slice of consolidated volume. Fine for liquid names,
//     sparse on thin ones; the last price can differ slightly from the SIP last.
//   • ONE concurrent connection. If another client holds it, auth fails with
//     406 "connection limit exceeded" — surfaced as the `limited` status so it
//     reads as a real, explainable condition rather than endless "reconnecting".
//
// Uses Node's global WebSocket, which is why package.json requires Node >= 22.

import { loadConfig, STREAM_URL } from "./config";
import { demoPrice, isDemoMode } from "./demo";
import type { PriceTick, StreamStatus } from "./types";

export interface PriceStream {
  subscribe(symbols: string[]): void;
  close(): void;
}

export interface PriceStreamOptions {
  symbols: string[];
  onTick: (tick: PriceTick) => void;
  onStatus?: (status: StreamStatus) => void;
  onError?: (message: string) => void;
  url?: string;
}

interface StreamMessage {
  /** "success" | "error" | "subscription" | "t" (trade) | … */
  T: string;
  msg?: string;
  code?: number;
  /** Symbol, on a trade frame. */
  S?: string;
  /** Price, on a trade frame. */
  p?: number;
  /** RFC-3339 timestamp, on a trade frame. */
  t?: string;
}

const MAX_BACKOFF_MS = 30_000;

export function createPriceStream(options: PriceStreamOptions): PriceStream {
  if (isDemoMode()) return createDemoStream(options);

  const { keyId, secret } = loadConfig();
  const url = options.url ?? STREAM_URL;
  const subscribed = new Set(options.symbols.map((s) => s.toUpperCase()));

  let socket: WebSocket | null = null;
  let closedByUser = false;
  let backoff = 1_000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Tracked locally so a socket close cannot clobber the "limited" signal with
  // a misleading "reconnecting".
  let current: StreamStatus = "connecting";
  const setStatus = (s: StreamStatus): void => {
    current = s;
    options.onStatus?.(s);
  };

  function sendSubscribe(): void {
    if (socket?.readyState === WebSocket.OPEN && subscribed.size > 0) {
      socket.send(JSON.stringify({ action: "subscribe", trades: [...subscribed] }));
    }
  }

  function handle(m: StreamMessage): void {
    switch (m.T) {
      case "success":
        if (m.msg === "authenticated") {
          sendSubscribe();
          backoff = 1_000;
          setStatus("live");
        }
        break;
      case "error":
        if (m.code === 406 || /connection limit/i.test(m.msg ?? "")) {
          setStatus("limited");
        }
        options.onError?.(`stream error ${m.code ?? ""}: ${m.msg ?? "unknown"}`.trim());
        break;
      case "t":
        if (m.S && typeof m.p === "number") {
          options.onTick({
            symbol: m.S,
            price: m.p,
            at: m.t ? Date.parse(m.t) : Date.now(),
          });
        }
        break;
      default:
        // Subscription confirmations and other control frames: ignored.
        break;
    }
  }

  function connect(): void {
    if (closedByUser) return;
    reconnectTimer = null;
    if (!socket) setStatus("connecting");
    else if (current !== "limited") setStatus("reconnecting");

    const sock = new WebSocket(url);
    socket = sock;

    sock.onopen = () => {
      sock.send(JSON.stringify({ action: "auth", key: keyId, secret }));
    };
    sock.onmessage = (event: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof event.data === "string" ? event.data : "");
      } catch {
        return;
      }
      if (Array.isArray(parsed)) {
        for (const m of parsed) handle(m as StreamMessage);
      }
    };
    sock.onclose = () => {
      if (closedByUser) return;
      if (current !== "limited") setStatus("reconnecting");
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };
    sock.onerror = () => {
      // A close event always follows; reconnection is handled there.
    };
  }

  connect();

  return {
    subscribe(symbols: string[]) {
      for (const s of symbols) subscribed.add(s.toUpperCase());
      sendSubscribe();
    },
    close() {
      closedByUser = true;
      // Cancel any pending reconnect. Without this a closed stream can
      // resurrect itself into a zombie that keeps holding the single free-tier
      // connection slot — and then the NEXT dashboard launch gets "limited".
      if (reconnectTimer) clearTimeout(reconnectTimer);
      setStatus("closed");
      socket?.close();
    },
  };
}

/**
 * A simulated stream for demo mode.
 *
 * Walks each price by a fraction of a percent every second or so. Enough motion
 * that the dashboard visibly behaves like a live one — the ● indicator, ticking
 * P&L — without any network or credentials.
 */
function createDemoStream(options: PriceStreamOptions): PriceStream {
  const subscribed = new Set(options.symbols.map((s) => s.toUpperCase()));
  const last = new Map<string, number>();
  let closed = false;

  for (const symbol of subscribed) {
    const seed = demoPrice(symbol);
    if (seed !== undefined) last.set(symbol, seed);
  }

  options.onStatus?.("live");

  const timer = setInterval(() => {
    if (closed) return;
    for (const [symbol, price] of last) {
      // A small mean-reverting nudge, so prices drift without running away over
      // a long screenshot session.
      const anchor = demoPrice(symbol) ?? price;
      const drift = (anchor - price) * 0.15;
      const noise = (Math.random() - 0.5) * anchor * 0.0012;
      const next = Math.round((price + drift + noise) * 100) / 100;
      last.set(symbol, next);
      options.onTick({ symbol, price: next, at: Date.now() });
    }
  }, 1_200);

  return {
    subscribe(symbols: string[]) {
      for (const s of symbols) {
        const symbol = s.toUpperCase();
        subscribed.add(symbol);
        const seed = demoPrice(symbol);
        if (seed !== undefined && !last.has(symbol)) last.set(symbol, seed);
      }
    },
    close() {
      closed = true;
      clearInterval(timer);
      options.onStatus?.("closed");
    },
  };
}
