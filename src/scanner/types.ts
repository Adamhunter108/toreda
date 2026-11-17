// Scanner data shapes.

export type Action = "buy" | "sell" | "trim" | "watch";

export type OpportunityType = "momentum" | "value_play" | "news_catalyst" | "social_buzz";

export type Timeframe = "immediate" | "short_term" | "medium_term";

/** A held position, as the scanner sees it. */
export interface PositionInfo {
  qty: number;
  marketValue: number;
  unrealizedPl: number;
  /** Fraction: 0.28 means +28%. */
  unrealizedPlPct: number;
  /** Share of total portfolio value, 0–1. */
  weight: number;
}

export interface OpportunitySignal {
  symbol: string;
  opportunityType: OpportunityType;
  /** 1–9. A ranking aid, NOT a probability. */
  confidence: number;
  /** The named components that summed to `confidence`, so it is auditable. */
  scoreBreakdown: string[];
  reasoning: string;
  sector: string;
  action: Action;
  timeframe: Timeframe;
  catalysts: string[];
  price?: number;
  pctChange?: number;
  /** Present when this symbol is an open position. */
  position?: PositionInfo;
}

export interface PositionAlert {
  symbol: string;
  rule: "STOP LOSS" | "CONCENTRATION";
  action: "SELL" | "TRIM";
  detail: string;
}

/**
 * A position past the default stop but held under a dated exception. Not a
 * breach, since the human decided it, but never silent: it is shown with its
 * reason and its end date until the date passes and the alert returns.
 */
export interface StopException {
  symbol: string;
  /** Unrealized P&L since entry, percent (−22.2 means −22.2%). */
  plPct: number;
  /** The default stop it is past. */
  defaultPct: number;
  /** The exception's stop, which it is not yet past. */
  stopPct: number;
  until: string;
  decided: string;
  reason: string;
}

export interface Candidate {
  symbol: string;
  name: string;
  price: number;
  pctChange: number;
  dollarVolume: number;
  fractionable: boolean;
  /** Which screens surfaced it. Appearing in several is the ranking signal. */
  sources: string[];
}

export interface DiscoveryResult {
  candidates: Candidate[];
  /** What each gate removed, so over-aggressive filtering stays visible. */
  rejected: Record<string, number>;
  considered: number;
  /** Passed the gates but exceeded the display cap — never dropped silently. */
  notShown: number;
}

export interface ScanResult {
  opportunities: OpportunitySignal[];
  positionAlerts: PositionAlert[];
  /** Positions held past the default stop under a dated exception. */
  stopExceptions: StopException[];
  discovery: DiscoveryResult | null;
  minConfidence: number;
  mode: string;
  /** Sources that failed and were skipped, so a degraded scan says so. */
  degraded: string[];
  scannedAt: string;
}

/** Price history for one symbol, in the shape the scoring functions want. */
export interface SymbolBars {
  closes: number[];
  volumes: number[];
  latest: number;
}

export interface AccountState {
  positions: Record<string, PositionInfo>;
  buyingPower: number;
  portfolioValue: number;
}

export interface Universe {
  symbols: string[];
  sectorOf: Record<string, string>;
}
