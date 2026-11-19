// `toreda portfolio` — open positions with profit and loss.
//
// Two different numbers get shown per position and the distinction is
// load-bearing: DAY is today's move, P&L is lifetime unrealized since entry.
// Conflating them is how a flat day gets written up as a triple-digit gain.

import { getAccount, getPositions } from "../../core/alpaca";
import { loadConfig } from "../../core/config";
import { fundsOf } from "../../core/funds";
import { loadRiskRules, maxWeightFor } from "../../core/risk";
import { dayChange, describeFlows, tryCashFlowsToday } from "../../core/transfers";
import { hasFlag, type ParsedArgs } from "../args";
import { printBanner } from "../banner";
import { c, heading, out, pctRaw, pl, qty, table, usd, usdSigned } from "../format";

export async function run(args: ParsedArgs): Promise<number> {
  if (hasFlag(args, "json")) {
    const [positions, account, flows] = await Promise.all([
      getPositions(),
      getAccount(),
      tryCashFlowsToday(),
    ]);
    const risk = loadRiskRules();
    const today = dayChange(account.equity, account.lastEquity, flows);
    process.stdout.write(
      JSON.stringify({
        mode: loadConfig().mode,
        account,
        // `buyingPower` includes margin; `funds.cash` is the money available.
        funds: fundsOf(account),
        // Net of deposits and withdrawals; `transfers` null means unchecked.
        today: { change: today.amount, pct: today.pct, transfers: today.flows },
        // Weight and its ceiling are included because every question worth
        // asking about a position ("is this too big?") needs both, and deriving
        // them separately is how two answers end up disagreeing.
        positions: positions.map((p) => ({
          ...p,
          weight: account.portfolioValue ? p.marketValue / account.portfolioValue : 0,
          maxWeight: maxWeightFor(p.symbol, risk),
        })),
        risk,
      }),
    );
    return 0;
  }

  printBanner();
  const [positions, account, flows] = await Promise.all([
    getPositions(),
    getAccount(),
    tryCashFlowsToday(),
  ]);

  out(heading("Positions"));

  if (positions.length === 0) {
    // Say it outright. An empty table is indistinguishable from a failed fetch
    // by the time a human (or a model) reads it.
    out("", "  No open positions — the account is genuinely flat.", "");
    return 0;
  }

  const sorted = [...positions].sort((a, b) => b.marketValue - a.marketValue);
  const rows = sorted.map((p) => [
    c.bold(p.symbol),
    qty(p.qty),
    usd(p.currentPrice),
    usd(p.marketValue),
    pl(p.changeToday, pctRaw(p.changeToday * 100)),
    pl(p.unrealizedPl, usdSigned(p.unrealizedPl)),
    pl(p.unrealizedPlPct, pctRaw(p.unrealizedPlPct * 100, 1)),
  ]);

  const totalValue = sorted.reduce((sum, p) => sum + p.marketValue, 0);
  const totalPl = sorted.reduce((sum, p) => sum + p.unrealizedPl, 0);
  const totalCost = sorted.reduce((sum, p) => sum + p.costBasis, 0);
  const totalPlPct = totalCost ? totalPl / totalCost : 0;

  rows.push([
    c.bold("TOTAL"),
    "",
    "",
    c.bold(usd(totalValue)),
    "",
    pl(totalPl, c.bold(usdSigned(totalPl))),
    pl(totalPlPct, pctRaw(totalPlPct * 100, 1)),
  ]);

  out(
    "",
    table(
      [
        { header: "SYMBOL" },
        { header: "QTY", align: "right" },
        { header: "PRICE", align: "right" },
        { header: "VALUE", align: "right" },
        { header: "DAY", align: "right" },
        { header: "P&L", align: "right" },
        { header: "P&L %", align: "right" },
      ],
      rows,
    ),
  );

  // Net of any deposit or withdrawal since the previous close.
  const today = dayChange(account.equity, account.lastEquity, flows);
  const note = describeFlows(today.flows);
  const funds = fundsOf(account);
  out(
    "",
    `  ${c.dim("Equity")} ${usd(account.equity)}   ` +
      `${c.dim("Today")} ${pl(today.amount, usdSigned(today.amount))}` +
      (note ? ` ${today.flows ? c.dim(`(${note})`) : c.yellow(`(${note})`)}` : "") +
      "   " +
      `${c.dim("Cash")} ${usd(funds.cash)}` +
      (funds.margin > 0 ? c.dim(` (+${usd(funds.margin)} margin)`) : "") +
      (funds.loan > 0 ? "   " + c.yellow(`Margin loan ${usd(funds.loan)}`) : ""),
    "",
    c.dim(
      "  DAY is today's move (from your fill on shares bought today). " +
        "P&L is lifetime unrealized since entry.",
    ),
    "",
  );
  return 0;
}
