// `toreda portfolio` — open positions with profit and loss.
//
// Two different numbers get shown per position and the distinction is
// load-bearing: DAY is today's move, P&L is lifetime unrealized since entry.
// Conflating them is how a flat day gets written up as a triple-digit gain.

import { getAccount, getPositions } from "../../core/alpaca";
import { loadConfig } from "../../core/config";
import { fundsOf } from "../../core/funds";
import { loadRiskRules, maxWeightFor, type RiskRules, stopLevel } from "../../core/risk";
import type { Position } from "../../core/types";
import { loadStopBases } from "../../scanner/stops";
import { dayChange, describeFlows, tryCashFlowsToday } from "../../core/transfers";
import { hasFlag, type ParsedArgs } from "../args";
import { printBanner } from "../banner";
import { c, heading, out, pctRaw, pl, qty, table, usd, usdSigned } from "../format";

/**
 * Each position's stop, keyed by symbol: null for a core fund. With sized
 * stops this reads purchase history and price bars, so it can fail on its own;
 * `problem` says so rather than letting stops quietly fall back.
 */
async function stopsFor(positions: Position[], risk: RiskRules) {
  const { bases, problem } = await loadStopBases(positions, risk);
  const levels = Object.fromEntries(
    positions.map((p) => [p.symbol, stopLevel(p.symbol, p.avgEntry, bases[p.symbol], risk)]),
  );
  return { levels, problem };
}

export async function run(args: ParsedArgs): Promise<number> {
  if (hasFlag(args, "json")) {
    const [positions, account, flows] = await Promise.all([
      getPositions(),
      getAccount(),
      tryCashFlowsToday(),
    ]);
    const risk = loadRiskRules();
    const stops = await stopsFor(positions, risk);
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
          // Null for a core fund. `price` is where the rule is reached; `from`
          // says whether it is measured from entry or the high since you bought.
          stop: stopJson(stops.levels[p.symbol] ?? null),
        })),
        // Set when purchase or price history could not be read, so stops fell
        // back to the default from entry.
        stopProblem: stops.problem,
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

  const risk = loadRiskRules();
  const stops = await stopsFor(positions, risk);

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
    stopCell(stops.levels[p.symbol] ?? null, p.currentPrice),
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
    "",
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
        { header: "STOP", align: "right" },
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
    c.dim(
      risk.stopSizing
        ? "  STOP is where your stop is, sized to each stock" +
            (risk.stopSizing.trailing ? " and measured from its high since you bought" : "") +
            ". — means a core fund, which has none."
        : `  STOP is where your ${risk.stopLossPct}% stop from entry is.`,
    ),
    ...(stops.problem ? [c.yellow(`  ⚠ ${stops.problem}`)] : []),
    "",
  );
  return 0;
}

type Level = ReturnType<typeof stopLevel>;

function stopJson(level: Level) {
  if (!level) return null;
  return {
    price: level.price,
    pct: level.pct,
    from: level.fromHigh ? "high" : "entry",
    anchor: level.anchor,
    highDate: level.highDate,
    sized: level.sized,
    note: level.note,
    exception: level.exception,
  };
}

/** The stop price, red at or past it, with a marker when measured from the high. */
function stopCell(level: Level, price: number): string {
  if (!level) return c.dim("—");
  const text = usd(level.price) + (level.fromHigh ? c.dim(" ↑") : "");
  return price <= level.price ? c.red(text) : text;
}
