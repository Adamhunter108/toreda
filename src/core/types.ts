// Shared data shapes. UI-agnostic on purpose: no React here, so the CLI, the
// scanner, and the dashboard all import from one place and mean the same thing.

export interface Account {
  equity: number;
  /** Yesterday's closing equity — the basis for today's change. */
  lastEquity: number;
  buyingPower: number;
  cash: number;
  portfolioValue: number;
  accountNumber: string;
  status: string;
  patternDayTrader: boolean;
  daytradingBuyingPower: number | null;
}

export interface Position {
  symbol: string;
  qty: number;
  /** Average price paid per share. */
  avgEntry: number;
  /** Total paid: qty × avgEntry. */
  costBasis: number;
  marketValue: number;
  unrealizedPl: number;
  /** Fraction, not percent: 0.0132 means +1.32%. */
  unrealizedPlPct: number;
  /**
   * Today's gain or loss on this position, in dollars. Shares held at the
   * previous close count from that close; shares bought today count from
   * their fill, so a new position is not charged for a drop that happened
   * before it was bought.
   */
  dayPl: number;
  /**
   * Today's move on this position as a fraction: `dayPl` over what the
   * position stood at when your day began (see `positionDay`). For a
   * position held overnight this is the stock's own move.
   */
  changeToday: number;
  /** Previous trading day's close. Not the day basis for shares bought today. */
  prevClose: number;
  currentPrice: number;
}

export interface Asset {
  symbol: string;
  name: string;
  tradable: boolean;
  fractionable: boolean;
}

export interface Clock {
  isOpen: boolean;
  nextOpen: string;
  nextClose: string;
}

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  /** Midpoint, or whichever side exists when only one does. */
  mid: number;
  spread: number;
}

/** A single last-trade print from the live price stream. */
export interface PriceTick {
  symbol: string;
  price: number;
  /** Epoch milliseconds. */
  at: number;
}

export type StreamStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  /** Alpaca's free tier permits one connection; another client holds it. */
  | "limited"
  | "closed";
