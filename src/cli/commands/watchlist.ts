// `toreda watchlist` — quotes across the whole watchlist, plus add/remove.
//
// Symbols come from config/watchlist.json, which is the single source of truth
// shared with the scanner and the dashboard. Edit that file, or use the
// subcommands here; never keep a second list somewhere else.

import { getAsset } from "../../core/alpaca";
import { getSnapshots } from "../../core/market-data";
import {
  addWatchlistSymbol,
  loadWatchlist,
  removeWatchlistSymbol,
} from "../../core/watchlist";
import { hasFlag, type ParsedArgs } from "../args";
import { c, fail, heading, ok, out, pctRaw, pl, table, usd, warn } from "../format";

async function add(symbol: string): Promise<number> {
  const s = symbol.trim().toUpperCase();
  if (!s) {
    fail("Usage: toreda watchlist add SYMBOL");
    return 1;
  }

  // Validate before writing. A typo'd ticker in the watchlist is silent — it
  // simply never produces a signal, and you assume the market was quiet.
  const asset = await getAsset(s);
  if (!asset) {
    fail(`${s} is not a symbol Alpaca recognises. Nothing was added.`);
    return 1;
  }
  if (!asset.tradable) {
    fail(`${s} (${asset.name}) exists but is not tradable on Alpaca. Nothing was added.`);
    return 1;
  }

  if (addWatchlistSymbol(s)) {
    ok(`Added ${c.bold(s)} — ${asset.name}`);
    if (!asset.fractionable) {
      warn(`${s} is whole-shares only — no fractional orders.`);
    }
  } else {
    out(`  ${s} is already on the watchlist.`);
  }
  return 0;
}

function remove(symbol: string): number {
  const s = symbol.trim().toUpperCase();
  if (!s) {
    fail("Usage: toreda watchlist remove SYMBOL");
    return 1;
  }
  if (removeWatchlistSymbol(s)) {
    ok(`Removed ${c.bold(s)}`);
    out(c.dim("  Positions you hold are still scanned, whether listed or not."));
  } else {
    out(`  ${s} was not on the watchlist.`);
  }
  return 0;
}

async function show(json: boolean): Promise<number> {
  const watchlist = loadWatchlist();
  if (watchlist.symbols.length === 0) {
    fail(
      "Your watchlist is empty.\n" +
        "     Add one with: toreda watchlist add NVDA\n" +
        "     Or run `npm run setup` to start from a preset.",
    );
    return 1;
  }

  const snapshots = await getSnapshots(watchlist.symbols);
  const bySymbol = new Map(snapshots.map((s) => [s.symbol, s]));

  // Symbols the feed returned nothing for. Named, so a gap is never mistaken
  // for a symbol that is not on the list.
  const missing = watchlist.symbols.filter((s) => !bySymbol.has(s));

  if (json) {
    process.stdout.write(
      JSON.stringify({
        symbols: watchlist.symbols,
        sectors: watchlist.sectorOf,
        // A snapshot with `sinceOpen: true` had no previous session, so its
        // changePct is the move since today's open, not since yesterday's close.
        snapshots,
        missing,
      }),
    );
    return 0;
  }

  // Biggest movers first, in either direction — that is what you scan for.
  const sorted = [...watchlist.symbols].sort((a, b) => {
    const av = Math.abs(bySymbol.get(a)?.changePct ?? -Infinity);
    const bv = Math.abs(bySymbol.get(b)?.changePct ?? -Infinity);
    return bv - av;
  });

  const rows = sorted.map((symbol) => {
    const snap = bySymbol.get(symbol);
    const sector = watchlist.sectorOf[symbol] ?? "";
    if (!snap) return [c.bold(symbol), c.dim("no data"), "", c.dim(sector)];
    return [
      c.bold(symbol),
      usd(snap.price),
      // No previous close: the move is since today's open, and says so.
      (snap.sinceOpen ? c.dim("since open ") : "") + pl(snap.changePct, pctRaw(snap.changePct)),
      c.dim(sector),
    ];
  });

  out(heading(`Watchlist — ${watchlist.symbols.length} symbols`), "");
  out(
    table(
      [
        { header: "SYMBOL" },
        { header: "PRICE", align: "right" },
        { header: "TODAY", align: "right" },
        { header: "SECTOR" },
      ],
      rows,
    ),
    "",
  );
  if (snapshots.some((s) => s.sinceOpen)) {
    out(c.dim("  since open: no previous session to compare with, usually a stock's first day."));
  }
  if (missing.length > 0) {
    out(c.dim(`  no data: the market data feed returned nothing for ${missing.join(", ")}.`));
  }
  if (missing.length > 0 || snapshots.some((s) => s.sinceOpen)) out("");
  return 0;
}

export async function run(args: ParsedArgs): Promise<number> {
  const [subcommand, symbol] = args.positionals;
  switch (subcommand) {
    case undefined:
      return show(hasFlag(args, "json"));
    case "add":
      return add(symbol ?? "");
    case "remove":
    case "rm":
      return remove(symbol ?? "");
    default:
      fail(
        `Unknown watchlist subcommand: ${subcommand}\n` +
          "     Usage: toreda watchlist [add SYMBOL | remove SYMBOL]",
      );
      return 1;
  }
}
