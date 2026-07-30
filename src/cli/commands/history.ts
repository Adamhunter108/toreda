// `toreda history` — recent orders and how they resolved.

import { getOrders } from "../../core/orders";
import { hasFlag, type ParsedArgs } from "../args";
import { printBanner } from "../banner";
import { c, heading, out, qty as fmtQty, table, usd } from "../format";

function statusColor(status: string): (s: string) => string {
  const s = status.toLowerCase();
  if (s === "filled") return c.green;
  if (s.includes("cancel") || s.includes("reject") || s.includes("expired")) return c.red;
  return c.yellow; // new, accepted, pending_new, partially_filled
}

/** "2026-07-28 14:00" in local time — the timezone the trader was sitting in. */
function shortTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace("T", " ");
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export async function run(args: ParsedArgs): Promise<number> {
  const limitArg = args.positionals.find((a) => /^\d+$/.test(a));
  const limit = Math.min(500, Math.max(1, Number(limitArg) || 25));

  if (hasFlag(args, "json")) {
    process.stdout.write(JSON.stringify({ orders: await getOrders(limit) }));
    return 0;
  }

  printBanner();
  const orders = await getOrders(limit);
  if (orders.length === 0) {
    out(heading("Order history"), "", "  No orders on this account yet.", "");
    return 0;
  }

  const rows = orders.map((o) => {
    const filled = Number(o.filledQty) || 0;
    const requested = Number(o.qty) || 0;
    // Show the fill fraction only when it differs — a partial fill is
    // materially different from what you asked for and should stand out.
    const qtyCell =
      filled > 0 && Math.abs(filled - requested) > 1e-9
        ? `${fmtQty(filled)}/${fmtQty(requested)}`
        : fmtQty(requested);
    const price = Number(o.filledAvgPrice) || Number(o.limitPrice) || 0;
    return [
      c.dim(shortTime(o.submittedAt)),
      c.bold(o.symbol),
      o.side === "buy" ? c.green("buy") : c.red("sell"),
      qtyCell,
      o.type,
      price ? usd(price) : c.dim("—"),
      statusColor(o.status)(o.status),
    ];
  });

  out(heading(`Order history — last ${orders.length}`), "");
  out(
    table(
      [
        { header: "WHEN" },
        { header: "SYMBOL" },
        { header: "SIDE" },
        { header: "QTY", align: "right" },
        { header: "TYPE" },
        { header: "PRICE", align: "right" },
        { header: "STATUS" },
      ],
      rows,
    ),
    "",
  );

  if (!limitArg && orders.length === limit) {
    out(c.dim(`  Showing ${limit}. Pass a number for more: toreda history 100`), "");
  }
  return 0;
}
