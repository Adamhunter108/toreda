// `toreda quote NVDA AMD` — live quotes for one or more symbols.

import { getQuotes } from "../../core/market-data";
import { hasFlag, type ParsedArgs } from "../args";
import { c, fail, heading, out, table, usd } from "../format";

export async function run(args: ParsedArgs): Promise<number> {
  const symbols = args.positionals;
  if (symbols.length === 0) {
    fail("Usage: toreda quote SYMBOL [SYMBOL...]\n     Example: toreda quote NVDA MSFT AAPL");
    return 1;
  }

  const wanted = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
  const quotes = await getQuotes(wanted);

  if (hasFlag(args, "json")) {
    // Requested symbols with no data are listed explicitly rather than omitted,
    // so a caller can tell "unknown ticker" from "we forgot to ask".
    const found = new Set(quotes.map((q) => q.symbol));
    process.stdout.write(
      JSON.stringify({ quotes, missing: wanted.filter((s) => !found.has(s)) }),
    );
    return 0;
  }

  if (quotes.length === 0) {
    fail(`No quote data returned for ${wanted.join(", ")}. Check the symbols are valid.`);
    return 1;
  }

  const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
  const rows = wanted.map((symbol) => {
    const q = bySymbol.get(symbol);
    // A symbol Alpaca does not recognise comes back missing, not zeroed. Say
    // "no data" rather than printing $0.00, which reads as a real price.
    if (!q || (!q.bid && !q.ask)) return [c.bold(symbol), c.dim("no data"), "", "", ""];
    return [
      c.bold(q.symbol),
      usd(q.bid),
      usd(q.ask),
      usd(q.mid),
      q.spread ? usd(q.spread) : c.dim("—"),
    ];
  });

  out(heading("Quotes"), "");
  out(
    table(
      [
        { header: "SYMBOL" },
        { header: "BID", align: "right" },
        { header: "ASK", align: "right" },
        { header: "MID", align: "right" },
        { header: "SPREAD", align: "right" },
      ],
      rows,
    ),
    "",
  );
  return 0;
}
