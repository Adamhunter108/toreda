// Demo mode: a complete, fake account.
//
// Set TOREDA_DEMO=1 and every data call returns a fixture instead of reaching
// Alpaca. Nothing touches the network, no keys are needed, and no order can be
// placed. It exists so somebody can see what this is before signing up for a
// brokerage account — and so screenshots are reproducible.
//
// The numbers are deterministic on purpose. A demo that looks different every
// run makes for confusing documentation.

import type { Account, Asset, Clock, Position, Quote } from "./types";
import type { Snapshot, SymbolStats } from "./market-data";
import type { OrderRecord } from "./orders";
import type { Realized } from "./activities";

export function isDemoMode(): boolean {
  const v = process.env.TOREDA_DEMO?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Thrown when something that cannot be faked is attempted in demo mode. */
export class DemoModeError extends Error {
  constructor(what: string) {
    super(
      `${what} is not available in demo mode.\n` +
        `  Demo mode uses fake data and never touches a real account.\n` +
        `  Run \`npm run setup\` to connect your own Alpaca account.`,
    );
    this.name = "DemoModeError";
  }
}

// ── The book ────────────────────────────────────────────────────────────────
// A believable small portfolio: a couple of winners, a loser near its stop, and
// one position deliberately oversized so the risk rules have something to say.

interface Holding {
  symbol: string;
  qty: number;
  avgEntry: number;
  price: number;
  prevClose: number;
}

const HOLDINGS: Holding[] = [
  // Deliberately oversized: the demo should show the concentration rule firing.
  { symbol: "NVDA", qty: 55, avgEntry: 142.8, price: 191.85, prevClose: 197.05 },
  { symbol: "AAPL", qty: 22, avgEntry: 296.4, price: 341.23, prevClose: 338.9 },
  { symbol: "MSFT", qty: 12, avgEntry: 371.5, price: 397.24, prevClose: 392.11 },
  { symbol: "COST", qty: 4, avgEntry: 903.15, price: 971.38, prevClose: 963.4 },
  { symbol: "AMD", qty: 18, avgEntry: 466.2, price: 434.13, prevClose: 454.55 },
];

function toPosition(h: Holding): Position {
  const marketValue = h.qty * h.price;
  const costBasis = h.qty * h.avgEntry;
  return {
    symbol: h.symbol,
    qty: h.qty,
    avgEntry: h.avgEntry,
    costBasis,
    marketValue,
    unrealizedPl: marketValue - costBasis,
    unrealizedPlPct: (marketValue - costBasis) / costBasis,
    // Every demo holding was held overnight, so its day is the stock's move.
    dayPl: h.qty * (h.price - h.prevClose),
    changeToday: (h.price - h.prevClose) / h.prevClose,
    prevClose: h.prevClose,
    currentPrice: h.price,
  };
}

export function demoPositions(): Position[] {
  return HOLDINGS.map(toPosition);
}

export function demoAccount(): Account {
  const positions = demoPositions();
  const invested = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const cash = 4_182.55;
  const equity = invested + cash;
  const yesterday = positions.reduce((sum, p) => sum + p.qty * p.prevClose, 0) + cash;
  return {
    equity,
    lastEquity: yesterday,
    buyingPower: cash * 2,
    cash,
    portfolioValue: equity,
    accountNumber: "DEMO1234",
    status: "ACTIVE",
    patternDayTrader: false,
    daytradingBuyingPower: cash * 4,
  };
}

export function demoClock(): Clock {
  return {
    isOpen: true,
    nextOpen: "2026-07-30T13:30:00Z",
    nextClose: "2026-07-29T20:00:00Z",
  };
}

export function demoRealized(): Realized {
  return { total: 1_284.4, unmatchedSells: 0, bySymbol: { TSM: 812.3, KO: 472.1 } };
}

// ── Market data ─────────────────────────────────────────────────────────────

/** symbol → [price, previous close] */
const MARKET: Record<string, [number, number]> = {
  NVDA: [191.85, 197.05],
  AAPL: [341.23, 338.9],
  MSFT: [397.24, 392.11],
  GOOGL: [334.98, 326.4],
  AMZN: [227.73, 230.72],
  META: [592.54, 601.3],
  AMD: [434.13, 454.55],
  AVGO: [374.87, 380.47],
  TSM: [380.39, 392.15],
  JPM: [350.19, 357.4],
  BAC: [52.14, 51.6],
  V: [369.8, 362.1],
  UNH: [428.77, 417.63],
  JNJ: [267.1, 264.9],
  LLY: [1219.02, 1197.5],
  COST: [971.38, 963.4],
  KO: [90.61, 88.29],
  PG: [145.0, 148.81],
  CAT: [800.2, 841.6],
  HON: [242.91, 246.94],
  RTX: [215.94, 218.34],
  XOM: [158.71, 153.21],
  NEE: [78.44, 77.9],
  SPY: [740.63, 745.2],
  QQQ: [666.57, 675.4],
};

export function demoQuotes(symbols: string[]): Quote[] {
  return symbols
    .map((s) => s.toUpperCase())
    .filter((s) => MARKET[s])
    .map((symbol) => {
      const price = MARKET[symbol]![0];
      const spread = Math.max(0.01, price * 0.0004);
      const bid = price - spread / 2;
      const ask = price + spread / 2;
      return { symbol, bid, ask, mid: price, spread };
    });
}

export function demoSnapshots(symbols: string[]): Snapshot[] {
  return symbols
    .map((s) => s.toUpperCase())
    .filter((s) => MARKET[s])
    .map((symbol) => {
      const [price, prevClose] = MARKET[symbol]!;
      return {
        symbol,
        price,
        changePct: ((price - prevClose) / prevClose) * 100,
        prevClose,
        prevVolume: 18_400_000,
        dailyVolume: 12_900_000,
        barDate: "2026-07-29T00:00:00Z",
      };
    });
}

export function demoSymbolStats(symbol: string): SymbolStats | null {
  const entry = MARKET[symbol.toUpperCase()];
  if (!entry) return null;
  const [price, prevClose] = entry;
  return {
    open: prevClose * 1.002,
    high: Math.max(price, prevClose) * 1.008,
    low: Math.min(price, prevClose) * 0.994,
    close: price,
    volume: 12_900_000,
    prevClose,
  };
}

/**
 * A deterministic price history that ends at today's price.
 *
 * Built from a fixed shape rather than random noise so the equity chart and the
 * sparklines look the same in every screenshot.
 */
function series(end: number, days: number, drift: number, seed: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < days; i++) {
    const t = i / (days - 1);
    // A smooth trend plus two out-of-phase waves — reads as a plausible chart
    // without ever being the same twice across symbols.
    const wobble =
      Math.sin(t * 7 + seed) * 0.018 + Math.sin(t * 17 + seed * 2) * 0.009;
    out.push(end * (1 - drift * (1 - t)) * (1 + wobble));
  }
  out[out.length - 1] = end;
  return out.map((n) => Math.round(n * 100) / 100);
}

export function demoCloses(symbols: string[], days = 45): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  symbols.forEach((symbol, i) => {
    const entry = MARKET[symbol.toUpperCase()];
    if (entry) out[symbol.toUpperCase()] = series(entry[0], days, 0.16, i * 1.7);
  });
  return out;
}

export function demoEquityHistory(period = "1M"): number[] {
  const equity = demoAccount().equity;
  const points = period === "1D" ? 78 : period === "3M" ? 63 : period === "1A" ? 252 : 21;
  return series(equity, points, 0.09, 3.1);
}

export function demoOrders(): OrderRecord[] {
  return [
    {
      id: "demo-6f2a91c4",
      symbol: "AMD",
      side: "buy",
      qty: "18",
      filledQty: "18",
      type: "market",
      status: "filled",
      filledAvgPrice: "466.20",
      submittedAt: "2026-07-24T14:12:08Z",
    },
    {
      id: "demo-b71e33af",
      symbol: "KO",
      side: "sell",
      qty: "40",
      filledQty: "40",
      type: "limit",
      status: "filled",
      limitPrice: "90.00",
      filledAvgPrice: "90.04",
      submittedAt: "2026-07-22T15:44:51Z",
    },
    {
      id: "demo-0c8d5e12",
      symbol: "NVDA",
      side: "buy",
      qty: "10",
      filledQty: "10",
      type: "market",
      status: "filled",
      filledAvgPrice: "188.42",
      submittedAt: "2026-07-21T13:31:02Z",
    },
    {
      id: "demo-44a9b7d0",
      symbol: "META",
      side: "buy",
      qty: "3",
      filledQty: "0",
      type: "limit",
      status: "canceled",
      limitPrice: "560.00",
      submittedAt: "2026-07-20T18:03:37Z",
    },
  ];
}

export function demoAsset(symbol: string): Asset | null {
  const s = symbol.toUpperCase();
  if (!MARKET[s]) return null;
  return { symbol: s, name: `${s} (demo)`, tradable: true, fractionable: true };
}

/** Current demo price for a symbol, for the live-tick simulator. */
export function demoPrice(symbol: string): number | undefined {
  return MARKET[symbol.toUpperCase()]?.[0];
}

export function demoSymbols(): string[] {
  return Object.keys(MARKET);
}

// ── Scanner ─────────────────────────────────────────────────────────────────

/**
 * A fixed scan result.
 *
 * Chosen to show the full range the scanner produces: a rule breach, all four
 * signal types, a `trim` from position reconciliation, and discovery output —
 * rather than five near-identical momentum hits.
 */
export function demoScanResult(): unknown {
  // Derived from the holdings above, never hardcoded — a fixture whose totals
  // contradict its own position data teaches the reader that the numbers are
  // decorative.
  const account = demoAccount();
  const nvda = demoPositions().find((p) => p.symbol === "NVDA")!;
  const weight = nvda.marketValue / account.portfolioValue;
  const ceiling = 0.25;
  const excess = nvda.marketValue - account.portfolioValue * ceiling;
  const pct = (n: number): string => `${Math.round(n * 100)}%`;
  const usd = (n: number): string => `$${n.toFixed(2)}`;

  return {
    opportunities: [
      {
        symbol: "KO",
        opportunityType: "momentum",
        confidence: 8,
        scoreBreakdown: ["+5 momentum base", "+1 move size", "+1 volume confirms", "+1 news corroboration"],
        reasoning: "+5.7% over 11 trading days (volume 2.5x average)",
        sector: "Consumer",
        action: "buy",
        timeframe: "immediate",
        price: 90.61,
        pctChange: 5.7,
        catalysts: ["Price momentum: +5.7%", "Volume: volume 2.5x average"],
      },
      {
        symbol: "NVDA",
        opportunityType: "momentum",
        confidence: 8,
        scoreBreakdown: ["+5 momentum base", "+2 move size", "+1 volume confirms"],
        reasoning: "+11.4% over 11 trading days (volume 1.8x average)",
        sector: "Semiconductors",
        action: "trim",
        timeframe: "immediate",
        price: 191.85,
        pctChange: 11.4,
        catalysts: [
          "Price momentum: +11.4%",
          `Held: ${nvda.qty} sh, ${usd(nvda.marketValue)} (${pct(weight)} of portfolio), ` +
            `P&L +${(nvda.unrealizedPlPct * 100).toFixed(1)}%`,
          `Position is ${pct(weight)} of the book at +${(nvda.unrealizedPlPct * 100).toFixed(0)}%, ` +
            `past its ${pct(ceiling)} ceiling — scale out rather than add`,
        ],
        position: {
          qty: nvda.qty,
          marketValue: nvda.marketValue,
          unrealizedPl: nvda.unrealizedPl,
          unrealizedPlPct: nvda.unrealizedPlPct,
          weight,
        },
      },
      {
        symbol: "AMD",
        opportunityType: "value_play",
        confidence: 8,
        scoreBreakdown: ["+6 pullback base", "+1 depth of pullback", "+1 news corroboration"],
        reasoning: "-16.8% over 11 trading days — possible oversold entry",
        sector: "Semiconductors",
        action: "watch",
        timeframe: "short_term",
        price: 434.13,
        pctChange: -16.8,
        catalysts: ["Pullback: -16.8%", "Wait for reversal confirmation before entry"],
      },
      {
        symbol: "LLY",
        opportunityType: "social_buzz",
        confidence: 8,
        scoreBreakdown: ["+5 social base", "+2 sample size", "+1 one-sided lean"],
        reasoning: "21 bullish / 1 bearish across 22 tagged posts (bullish)",
        sector: "Healthcare",
        action: "buy",
        timeframe: "short_term",
        price: 1219.02,
        catalysts: ["$LLY breaking out of the range here", "$LLY strongest chart in pharma"],
      },
      {
        symbol: "CAT",
        opportunityType: "news_catalyst",
        confidence: 7,
        scoreBreakdown: ["+5 news base", "+1 bearish tone in 3/12 headlines", "+1 sustained coverage"],
        reasoning: "1 bullish / 3 bearish of 12 scored — price -4.9% is inside this symbol's noise (needed 6.2%)",
        sector: "Industrials",
        action: "watch",
        timeframe: "immediate",
        price: 800.2,
        pctChange: -4.9,
        catalysts: [
          "Caterpillar Cuts Full-Year Machinery Outlook",
          "Analysts Trim Targets After Equipment Demand Warning",
        ],
      },
    ],
    positionAlerts: [
      {
        symbol: "NVDA",
        rule: "CONCENTRATION",
        action: "TRIM",
        detail:
          `${pct(weight)} of portfolio vs ${pct(ceiling)} ceiling — ${usd(excess)} over. ` +
          `Trimming to the ceiling frees that as buying power.`,
      },
    ],
    stopExceptions: [],
    discovery: {
      candidates: [
        {
          symbol: "SNDK",
          name: "Sandisk Corporation Common Stock",
          price: 1074.34,
          pctChange: -15.9,
          dollarVolume: 739_000_000,
          fractionable: true,
          sources: ["most-active", "trending"],
        },
        {
          symbol: "GLW",
          name: "Corning Incorporated",
          price: 121.84,
          pctChange: -14.9,
          dollarVolume: 106_000_000,
          fractionable: true,
          sources: ["trending"],
        },
        {
          symbol: "CLS",
          name: "Celestica, Inc.",
          price: 340.6,
          pctChange: 7.2,
          dollarVolume: 65_000_000,
          fractionable: true,
          sources: ["gainer", "trending"],
        },
      ],
      rejected: { "under $10": 41, "warrant/unit/right": 19, illiquid: 15 },
      considered: 88,
      notShown: 4,
    },
    minConfidence: 7,
    mode: "demo",
    degraded: [],
    scannedAt: "2026-07-29T14:31:00.000Z",
  };
}
