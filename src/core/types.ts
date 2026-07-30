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
  /** Today's move as a fraction. */
  changeToday: number;
  /** Previous trading day's close — for computing live daily P&L. */
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
