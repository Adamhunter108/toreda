// `toreda portfolio` — open positions with profit and loss.
//
// Two different numbers get shown per position and the distinction is
// load-bearing: DAY is today's move, P&L is lifetime unrealized since entry.
// Conflating them is how a flat day gets written up as a triple-digit gain.

import { getAccount, getPositions } from "../../core/alpaca";
import { loadConfig } from "../../core/config";
import { loadRiskRules, maxWeightFor } from "../../core/risk";
import { hasFlag, type ParsedArgs } from "../args";
import { printBanner } from "../banner";
import { c, heading, out, pctRaw, pl, qty, table, usd, usdSigned } from "../format";

export async function run(args: ParsedArgs): Promise<number> {
  if (hasFlag(args, "json")) {
    const [positions, account] = await Promise.all([getPositions(), getAccount()]);
    const risk = loadRiskRules();
    process.stdout.write(
      JSON.stringify({
        mode: loadConfig().mode,
        account,
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
  const [positions, account] = await Promise.all([getPositions(), getAccount()]);

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

  const dayChange = account.equity - account.lastEquity;
  out(
    "",
    `  ${c.dim("Equity")} ${usd(account.equity)}   ` +
      `${c.dim("Today")} ${pl(dayChange, usdSigned(dayChange))}   ` +
      `${c.dim("Buying power")} ${usd(account.buyingPower)}`,
    "",
    c.dim("  DAY is today's move. P&L is lifetime unrealized since entry."),
    "",
  );
  return 0;
}
