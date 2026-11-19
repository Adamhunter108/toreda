// The book, marked to live prices — one set of numbers for the whole dashboard.
//
// Before this module, four panels each derived their own figures from the same
// inputs, and they disagreed: the Allocation panel divided by the sum of the
// positions while the risk rules and the detail pane divided by the portfolio
// including cash, so one holding showed two weights; and the header's day
// change came from the 20-second account poll while the stat bar's came from
// live ticks. Every panel now reads from here, so a number means the same thing
// wherever it appears.
//
// Weight is a fraction of TOTAL portfolio value, cash included — the same
// definition `reviewPositions`, `toreda portfolio --json` and the scanner use.

import { positionDay } from "../core/alpaca";
import {
  hasOverride,
  maxWeightFor,
  type RiskRules,
  type StopOverride,
  stopFor,
} from "../core/risk";
import { type CashFlows, dayChange } from "../core/transfers";
import type { Account, Position } from "../core/types";
import { heldUnderExceptions, reviewPositions } from "../scanner/review";
import type { AccountState, PositionAlert, StopException } from "../scanner/types";

export interface BookRow {
  symbol: string;
  qty: number;
  avgEntry: number;
  prevClose: number;
  costBasis: number;
  /** Last price: the streamed tick when there is one, else the polled price. */
  price: number;
  live: boolean;
  /** qty × price. */
  value: number;
  /** Unrealized P&L since entry, dollars. */
  pl: number;
  /** Unrealized P&L since entry, percent (−6.9 means −6.9%). */
  plPct: number;
  /**
   * Today's move on this position, dollars, live. Shares bought today count
   * from their fill, not the previous close (see `positionDay`), so the rows
   * add up to the account's day.
   */
  dayPl: number;
  /** Today's move, percent, on the same basis. */
  dayPct: number;
  /** Fraction of total portfolio value. Null until the account has loaded. */
  weight: number | null;
  /** This symbol's concentration ceiling, as a fraction. */
  ceiling: number;
  /** True when the ceiling is a dated override rather than the default. */
  override: boolean;
  /** The price at which the stop-loss rule is reached. */
  stopPrice: number;
  /** This symbol's stop today: the default, or a dated exception's. */
  stopPct: number;
  /** The exception in force, if any. */
  stopException: StopOverride | null;
}

export interface Book {
  rows: BookRow[];
  /** False until the account has loaded. Weights and rule checks need it. */
  known: boolean;
  /** Account equity, re-marked to live prices. */
  equity: number;
  /** Equity at the previous close — the basis for today's change. */
  lastEquity: number;
  cash: number;
  /** Market value of all open positions. */
  invested: number;
  /** Total paid for the open positions. */
  costBasis: number;
  /** Unrealized P&L across open positions. */
  unrealized: number;
  /**
   * Today's change in ACCOUNT equity, live, net of deposits and withdrawals.
   * Unlike summing each position's day move, this includes positions opened or
   * closed today — which matters for anyone who trades intraday. Money moved
   * in or out since the previous close is taken out (see core/transfers.ts):
   * a deposit once showed here as a day up by nearly the amount deposited.
   */
  dayPl: number;
  dayPct: number;
  /** What was taken out of `dayPl`; null when it could not be checked. */
  transfers: CashFlows | null;
}

/** Sub-cent noise to zero, so a flat figure never picks up a minus sign. */
const snap0 = (n: number): number => (Math.abs(n) < 0.005 ? 0 : n);

export function markBook(
  account: Account | null,
  positions: Position[],
  prices: Record<string, number>,
  risk: RiskRules,
  /** Deposits and withdrawals since the previous close; null if unchecked. */
  transfers: CashFlows | null,
): Book {
  // Re-mark the polled equity to live prices: the account figure already
  // includes each position at its polled price, so add the difference.
  let drift = 0;
  for (const p of positions) {
    const live = prices[p.symbol];
    if (live !== undefined) drift += p.qty * (live - p.currentPrice);
  }
  const known = account !== null;
  const equity = known ? account.equity + drift : 0;
  const lastEquity = known ? account.lastEquity : 0;

  const rows = positions.map((p): BookRow => {
    const streamed = prices[p.symbol];
    const price = streamed ?? p.currentPrice;
    const value = p.qty * price;
    const pl = value - p.costBasis;
    const day = positionDay(p, price);
    const stop = stopFor(p.symbol, risk);
    return {
      symbol: p.symbol,
      qty: p.qty,
      avgEntry: p.avgEntry,
      prevClose: p.prevClose,
      costBasis: p.costBasis,
      price,
      live: streamed !== undefined,
      value,
      pl,
      plPct: p.costBasis ? (pl / p.costBasis) * 100 : 0,
      dayPl: snap0(day.amount),
      dayPct: day.pct * 100,
      weight: known && equity > 0 ? value / equity : null,
      ceiling: maxWeightFor(p.symbol, risk),
      override: hasOverride(p.symbol, risk),
      stopPrice: p.avgEntry * (1 + stop.pct / 100),
      stopPct: stop.pct,
      stopException: stop.exception,
    };
  });

  const invested = rows.reduce((s, r) => s + r.value, 0);
  const costBasis = rows.reduce((s, r) => s + r.costBasis, 0);
  const day = dayChange(equity, lastEquity, transfers);
  const dayPl = known ? day.amount : 0;

  return {
    rows,
    known,
    equity,
    lastEquity,
    cash: known ? account.cash : 0,
    invested,
    costBasis,
    unrealized: snap0(invested - costBasis),
    dayPl,
    dayPct: known ? day.pct * 100 : 0,
    transfers,
  };
}

/** The book in the scanner's shape, so rule checks run through the same code. */
export function bookAccountState(book: Book): AccountState | null {
  if (!book.known) return null;
  const state: AccountState = { positions: {}, cash: 0, portfolioValue: book.equity };
  for (const r of book.rows) {
    state.positions[r.symbol] = {
      qty: r.qty,
      marketValue: r.value,
      unrealizedPl: r.pl,
      unrealizedPlPct: r.plPct / 100,
      weight: r.weight ?? 0,
    };
  }
  return state;
}

/**
 * Every rule breach in the book, live — the same check `toreda scan` runs, on
 * the same definitions. Null means it could not be checked (no account yet),
 * which is a different claim from "no breaches" and must be shown as one.
 */
export function bookAlerts(book: Book, risk: RiskRules): PositionAlert[] | null {
  const state = bookAccountState(book);
  return state ? reviewPositions(state, risk) : null;
}

/** Positions held past the default stop under a dated exception, live. */
export function bookExceptions(book: Book, risk: RiskRules): StopException[] {
  const state = bookAccountState(book);
  return state ? heldUnderExceptions(state, risk) : [];
}

/** symbol → which rules it breaches, for highlighting cells. */
export function breachesBySymbol(
  alerts: PositionAlert[] | null,
): Record<string, { stop: boolean; ceiling: boolean }> {
  const out: Record<string, { stop: boolean; ceiling: boolean }> = {};
  for (const a of alerts ?? []) {
    const entry = (out[a.symbol] ??= { stop: false, ceiling: false });
    if (a.rule === "STOP LOSS") entry.stop = true;
    else entry.ceiling = true;
  }
  return out;
}

/** Sort orders for the positions table, on live figures. */
export function sortBook(rows: BookRow[], key: string): BookRow[] {
  const arr = [...rows];
  arr.sort((a, b) => {
    if (key === "symbol") return a.symbol.localeCompare(b.symbol);
    if (key === "pl") return b.pl - a.pl;
    if (key === "day") return b.dayPl - a.dayPl;
    return b.value - a.value;
  });
  return arr;
}
