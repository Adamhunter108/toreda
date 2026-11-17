// `toreda account` — buying power, cash, portfolio value.

import { getAccount } from "../../core/alpaca";
import { loadConfig } from "../../core/config";
import { dayChange, describeFlows, tryCashFlowsToday } from "../../core/transfers";
import { hasFlag, type ParsedArgs } from "../args";
import { printBanner } from "../banner";
import { c, heading, out, padEnd, pl, usd, usdSigned } from "../format";

export async function run(args: ParsedArgs): Promise<number> {
  // --json before anything is printed, so stdout stays parseable.
  if (hasFlag(args, "json")) {
    const [account, flows] = await Promise.all([getAccount(), tryCashFlowsToday()]);
    // `today` is net of deposits and withdrawals. `transfers` null means they
    // could not be checked, so `change` may include them.
    const today = dayChange(account.equity, account.lastEquity, flows);
    process.stdout.write(
      JSON.stringify({
        mode: loadConfig().mode,
        account,
        today: { change: today.amount, pct: today.pct, transfers: today.flows },
      }),
    );
    return 0;
  }

  const mode = printBanner();
  const [account, flows] = await Promise.all([getAccount(), tryCashFlowsToday()]);

  // Net of any deposit or withdrawal since the previous close — money moved in
  // is not a gain. See core/transfers.ts.
  const today = dayChange(account.equity, account.lastEquity, flows);
  const note = describeFlows(today.flows);

  const rows: Array<[string, string]> = [
    ["Account", account.accountNumber],
    ["Status", account.status],
    ["Portfolio", usd(account.portfolioValue)],
    [
      "Today",
      pl(
        today.amount,
        `${usdSigned(today.amount)} (${today.pct >= 0 ? "+" : ""}${(today.pct * 100).toFixed(2)}%)`,
      ) + (note ? `  ${today.flows ? c.dim(note) : c.yellow(note)}` : ""),
    ],
    ["Cash", usd(account.cash)],
    ["Buying power", usd(account.buyingPower)],
  ];

  if (account.daytradingBuyingPower !== null) {
    rows.push(["Day-trade BP", usd(account.daytradingBuyingPower)]);
  }
  rows.push(["Pattern day trader", account.patternDayTrader ? c.yellow("yes") : "no"]);

  out(heading("Account"));
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    out(`  ${c.dim(padEnd(label, labelWidth))}  ${value}`);
  }

  if (mode === "paper") {
    out("", c.dim("  Paper account — none of this is real money."));
  }
  return 0;
}
