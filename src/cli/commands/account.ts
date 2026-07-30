// `toreda account` — buying power, cash, portfolio value.

import { getAccount } from "../../core/alpaca";
import { loadConfig } from "../../core/config";
import { hasFlag, type ParsedArgs } from "../args";
import { printBanner } from "../banner";
import { c, heading, out, padEnd, pl, usd, usdSigned } from "../format";

export async function run(args: ParsedArgs): Promise<number> {
  // --json before anything is printed, so stdout stays parseable.
  if (hasFlag(args, "json")) {
    const account = await getAccount();
    process.stdout.write(JSON.stringify({ mode: loadConfig().mode, account }));
    return 0;
  }

  const mode = printBanner();
  const account = await getAccount();

  const dayChange = account.equity - account.lastEquity;
  const dayPct = account.lastEquity ? dayChange / account.lastEquity : 0;

  const rows: Array<[string, string]> = [
    ["Account", account.accountNumber],
    ["Status", account.status],
    ["Portfolio", usd(account.portfolioValue)],
    [
      "Today",
      pl(dayChange, `${usdSigned(dayChange)} (${dayPct >= 0 ? "+" : ""}${(dayPct * 100).toFixed(2)}%)`),
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
