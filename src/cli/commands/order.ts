// `toreda order` — the only command that can change your account.
//
//   toreda order NVDA buy 5                    PREVIEW — sends nothing
//   toreda order NVDA buy 5 --confirm          actually places it
//   toreda order NVDA sell 5 limit 180.00 --confirm
//
// Preview is the default and confirmation is a separate, explicit act. That
// asymmetry is the whole safety model: the dangerous thing requires typing
// something extra, and the safe thing is what happens when you are unsure.

import { getAccount, getPositions } from "../../core/alpaca";
import { loadConfig } from "../../core/config";
import { getLatestPrice } from "../../core/market-data";
import {
  assessOrder,
  logOrder,
  placeOrder,
  type OrderRequest,
  type OrderType,
  type Side,
} from "../../core/orders";
import { loadRiskRules, maxWeightFor } from "../../core/risk";
import { hasFlag, type ParsedArgs } from "../args";
import { banner } from "../banner";
import { c, fail, out, qty as fmtQty, usd, warn } from "../format";

const USAGE =
  "Usage: toreda order SYMBOL buy|sell QTY [market|limit PRICE] [--confirm]\n" +
  "     toreda order NVDA buy 5                  preview a market buy\n" +
  "     toreda order NVDA buy 5 --confirm        place it\n" +
  "     toreda order NVDA sell 5 limit 180.00 --confirm";

interface ParsedOrder {
  request: OrderRequest;
  confirm: boolean;
  allowShort: boolean;
}

/**
 * Validate the order arguments, returning either a request or an error string.
 *
 * Exported and pure so the safety rules below are testable without a network,
 * an account, or any risk of placing something.
 */
export function parseOrderArgs(args: ParsedArgs): ParsedOrder | string {
  const [symbol, side, quantity, typeArg, priceArg] = args.positionals;
  if (!symbol || !side || !quantity) return USAGE;

  if (side !== "buy" && side !== "sell") {
    return `Side must be 'buy' or 'sell' (got '${side}').\n\n${USAGE}`;
  }
  if (!(Number(quantity) > 0)) {
    return `Quantity must be a positive number (got '${quantity}').`;
  }

  const type: OrderType = typeArg === "limit" ? "limit" : "market";
  if (typeArg && typeArg !== "limit" && typeArg !== "market") {
    return `Order type must be 'market' or 'limit' (got '${typeArg}').\n\n${USAGE}`;
  }
  if (type === "limit" && !(Number(priceArg) > 0)) {
    return "A limit order needs a price: toreda order NVDA buy 5 limit 180.00";
  }

  return {
    request: {
      symbol: symbol.toUpperCase(),
      side: side as Side,
      qty: quantity,
      type,
      ...(type === "limit" ? { limitPrice: priceArg } : {}),
    },
    confirm: hasFlag(args, "confirm"),
    allowShort: hasFlag(args, "allow-short"),
  };
}

export async function run(args: ParsedArgs): Promise<number> {
  const parsed = parseOrderArgs(args);
  if (typeof parsed === "string") {
    fail(parsed);
    return 1;
  }
  const { request, confirm, allowShort } = parsed;

  const cfg = loadConfig();
  const [account, positions] = await Promise.all([getAccount(), getPositions()]);
  const held = positions.find((p) => p.symbol === request.symbol);

  // Price the order. A held position already knows its price; anything else
  // needs a lookup, because a buy must never be placed blind.
  const price = held?.currentPrice || (await getLatestPrice(request.symbol));
  const risk = loadRiskRules();

  const assessment = assessOrder(request, {
    equity: account.equity,
    buyingPower: account.buyingPower,
    heldQty: held?.qty ?? 0,
    heldValue: held?.marketValue ?? 0,
    price,
    maxWeight: maxWeightFor(request.symbol, risk),
  });

  // --allow-short exists because shorting is legitimate on a margin account,
  // but it must be asked for. The default protects the far more common case:
  // fat-fingering a sell quantity larger than the position.
  const blocks = allowShort
    ? assessment.blocks.filter((b) => !b.includes("open a short"))
    : assessment.blocks;

  const limitSuffix = request.type === "limit" ? ` @ ${usd(Number(request.limitPrice))}` : "";
  const action = `${request.side.toUpperCase()} ${fmtQty(Number(request.qty))} ${request.symbol}`;

  out("");
  out(banner(cfg.mode));
  out(c.bold("Order preview"));
  out(`  ${c.bold(action)}  (${request.type}${limitSuffix})`);
  out(
    `  ${c.dim("last")} ${price > 0 ? usd(price) : c.dim("unknown")}` +
      `   ${c.dim(request.side === "buy" ? "est. cost" : "est. proceeds")} ` +
      `${price > 0 || request.type === "limit" ? usd(assessment.estCost) : c.dim("—")}` +
      `   ${c.dim("buying power")} ${usd(account.buyingPower)}`,
  );
  if (held) out(`  ${c.dim("you hold")} ${fmtQty(held.qty)} ${request.symbol}`);
  out(`  ${c.dim("endpoint")} ${cfg.tradeHost}`);

  for (const w of assessment.warnings) warn(w);
  for (const b of blocks) out(`  ${c.red("✗")} ${b}`);

  if (blocks.length > 0) {
    out("", c.red("  Blocked — nothing was sent."), "");
    return 1;
  }

  if (!confirm) {
    out("", c.yellow("  Preview only — nothing sent."));
    out(c.dim(`  Re-run with --confirm to place this order.`), "");
    return 0;
  }

  out("", c.dim("  Placing order…"));
  const result = await placeOrder(request);
  logOrder(request, result, cfg.mode);

  if (result.ok) {
    out(`  ${c.green("✓")} Order accepted — ${result.status}`);
    out(c.dim(`    id ${result.id}`));
    out(c.dim("    logged to journal/orders.log"), "");
    return 0;
  }

  // A failed order is logged too — a rejection is exactly what you want to find
  // when reconstructing a bad morning.
  fail(`Order failed: ${result.message}`);
  out(c.dim("  Logged to journal/orders.log. Nothing was filled."), "");
  return 1;
}
