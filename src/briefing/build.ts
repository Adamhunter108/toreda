// Building a briefing: gather, VALIDATE, then format.
//
// The validation is the point of this module, and it is written the way it is
// because of a specific failure. A hung request returned an empty body, every
// layer downstream failed open, and a morning briefing announced "Account is
// flat today — zero positions" while positions were open the whole time.
// Nothing was sold; the report was simply wrong.
//
// Two rules came out of that, and both live here:
//
//   1. A briefing built on missing data is worse than no briefing. A blank
//      positions table reads as "no positions" and gets acted on. So a fetch
//      failure ABORTS and says so, loudly.
//   2. A genuinely flat account must say so IN WORDS, because by the time the
//      text reaches a human — or a model writing commentary — an empty table
//      and a failed fetch are indistinguishable.

import { getAccount, getPositions } from "../core/alpaca";
import { type CashFlows, dayChange, describeFlows, tryCashFlowsToday } from "../core/transfers";
import type { Account, Position } from "../core/types";

export type BriefingKind = "open" | "close";

export interface BriefingData {
  account: Account;
  positions: Position[];
  /** Deposits and withdrawals since the previous close; null if unchecked. */
  flows: CashFlows | null;
}

export class BriefingAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BriefingAbort";
  }
}

export async function gather(): Promise<BriefingData> {
  try {
    // Transfers are a correction to the day figure, not the account itself:
    // failing to read them flags the figure rather than aborting the briefing.
    const [account, positions, flows] = await Promise.all([
      getAccount(),
      getPositions(),
      tryCashFlowsToday(),
    ]);
    return { account, positions, flows };
  } catch (err) {
    // The core layer already throws on an empty body, a missing account number,
    // or a positions payload that is not a list. Translate that into an abort
    // the delivery layer knows how to report.
    throw new BriefingAbort(
      `could not read your account from Alpaca — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * One-line portfolio summary.
 *
 * The day change is net of deposits and withdrawals (`flows`): a deposit is
 * not a gain. When they could not be checked (`null`), the line says the
 * figure may include them.
 */
export function buildSummary(account: Account, flows: CashFlows | null): string {
  const day = dayChange(account.equity, account.lastEquity, flows);
  const change = day.amount;
  const pct = day.pct * 100;
  const note = describeFlows(day.flows);
  const money = (n: number): string =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // The $ on the day change is load-bearing: a bare "-0.19" gets read back as a
  // percentage, which is a hundredfold misreading of the day.
  return (
    `Portfolio $${money(account.equity)} | ` +
    `Day ${change >= 0 ? "+" : "-"}$${money(Math.abs(change))} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)` +
    (note ? ` ${note}` : "") +
    ` | BP $${money(account.buyingPower)}`
  );
}

const TABLE_WIDTH = 35;

/**
 * A fixed-width positions table.
 *
 * Built deterministically so the columns line up inside a monospace block, and
 * carrying BOTH a DAY and a TOT column. Without DAY, a "how did we do today"
 * briefing has no choice but to quote lifetime gains — which reads as though a
 * flat day was a spectacular one.
 */
export function buildTable(positions: Position[]): string {
  const lines: string[] = [
    `${"SYM".padEnd(5)}${"VALUE".padStart(7)}${"DAY".padStart(8)}${"P&L".padStart(7)}${"TOT".padStart(8)}`,
    "-".repeat(TABLE_WIDTH),
  ];

  let totalValue = 0;
  let totalPl = 0;

  for (const p of [...positions].sort((a, b) => b.marketValue - a.marketValue)) {
    totalValue += p.marketValue;
    totalPl += p.unrealizedPl;
    const day = `${p.changeToday >= 0 ? "+" : ""}${(p.changeToday * 100).toFixed(2)}%`;
    const totPct = `${p.unrealizedPlPct >= 0 ? "+" : ""}${(p.unrealizedPlPct * 100).toFixed(1)}%`;
    lines.push(
      p.symbol.padEnd(5) +
        Math.round(p.marketValue).toLocaleString("en-US").padStart(7) +
        day.padStart(8) +
        `${p.unrealizedPl >= 0 ? "+" : "-"}${Math.abs(Math.round(p.unrealizedPl))}`.padStart(7) +
        totPct.padStart(8),
    );
  }

  lines.push("-".repeat(TABLE_WIDTH));
  lines.push(
    "TOT".padEnd(5) +
      Math.round(totalValue).toLocaleString("en-US").padStart(7) +
      "".padStart(8) +
      `${totalPl >= 0 ? "+" : "-"}${Math.abs(Math.round(totalPl))}`.padStart(7),
  );

  // Say it outright — see the note at the top of this file.
  if (positions.length === 0) {
    lines.push("(no open positions — account is genuinely flat)");
  }
  return lines.join("\n");
}

/**
 * Column gloss handed to the model alongside the data.
 *
 * Without this the model reads TOT as today's performance and reports a flat
 * day as a triple-digit gain. It is not decoration; it is the difference
 * between a correct briefing and a confidently wrong one.
 */
export const COLUMN_MEANINGS = `COLUMN MEANINGS — read carefully:
  DAY = that position's move TODAY. This is the ONLY column about today.
  TOT = lifetime unrealized P&L since entry. NOT today's move.
  P&L = lifetime unrealized profit in dollars. NOT today's move.
Never describe a TOT or P&L figure as today's gain or as 'a strong day'.`;

export function headerFor(kind: BriefingKind, at = new Date()): string {
  const stamp = at.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return kind === "open" ? `📊 Market Open — ${stamp}` : `🔔 Market Close — ${stamp}`;
}
