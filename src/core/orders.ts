// The ONLY write path to your account.
//
// Everything else in toreda reads. This module is the single place that can
// move money, so it is deliberately careful: one attempt with no retry, a
// pre-trade assessment that can block, and an append-only log of every order
// whether it succeeded or not.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { authHeaders, loadConfig, type Mode } from "./config";
import { demoOrders, DemoModeError, isDemoMode } from "./demo";
import { getJson, postJson } from "./http";
import { ordersLogFile } from "./paths";

export type Side = "buy" | "sell";
export type OrderType = "market" | "limit";

export interface OrderRequest {
  symbol: string;
  side: Side;
  /** A string, to preserve fractional precision exactly as Alpaca expects. */
  qty: string;
  type: OrderType;
  limitPrice?: string;
}

export interface OrderResult {
  ok: boolean;
  id?: string;
  status?: string;
  message?: string;
}

// ── Pre-trade assessment ────────────────────────────────────────────────────

export interface OrderContext {
  equity: number;
  buyingPower: number;
  heldQty: number;
  heldValue: number;
  /** 0 means unknown. */
  price: number;
  /** This symbol's concentration ceiling, from risk.json. */
  maxWeight: number;
}

export interface OrderAssessment {
  estCost: number;
  /** Shown, but allowed through. Your own risk rules are advice, not a wall. */
  warnings: string[];
  /** Prevent the order outright. Structurally impossible or unaffordable. */
  blocks: string[];
}

/**
 * Money inside assessment messages.
 *
 * These strings are read at the moment a trade is decided, so "$19,744,302.55"
 * and "$19744302.55" are not equally good: the second takes a beat to size up,
 * and sizing it up wrong is the whole failure mode. Kept here rather than in
 * the CLI's formatter because core must not depend on a presentation layer.
 */
function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Check an order before it is sent.
 *
 * The blocks/warnings split matters. A block is something that cannot work or
 * cannot be undone: no price, no money, selling shares you do not own. A
 * warning is a policy you set for yourself and may knowingly override —
 * concentration is your call, and a tool that refuses your own judgment gets
 * worked around rather than heeded.
 */
export function assessOrder(req: OrderRequest, ctx: OrderContext): OrderAssessment {
  const qty = Number(req.qty) || 0;
  const limit = Number(req.limitPrice) || 0;
  const price = req.type === "limit" ? limit || ctx.price : ctx.price;
  const estCost = qty * price;
  const warnings: string[] = [];
  const blocks: string[] = [];

  if (!req.symbol.trim()) blocks.push("symbol is required");
  if (qty <= 0) blocks.push("quantity must be greater than 0");
  if (req.type === "limit" && limit <= 0) blocks.push("limit orders need a limit price");

  if (req.side === "buy") {
    if (price <= 0) {
      // Never buy blind. Without a price there is no way to know the cost, and
      // a market order for an unknown amount of money is not a decision.
      blocks.push("price unavailable — cannot place a buy without a known price");
    } else {
      if (estCost > ctx.buyingPower) {
        blocks.push(`est. cost ${money(estCost)} exceeds buying power ${money(ctx.buyingPower)}`);
      }
      if (ctx.equity > 0) {
        const postWeight = (ctx.heldValue + estCost) / ctx.equity;
        if (postWeight > ctx.maxWeight) {
          warnings.push(
            `would be ${(postWeight * 100).toFixed(0)}% of your book ` +
              `(your ceiling is ${(ctx.maxWeight * 100).toFixed(0)}%)`,
          );
        }
      }
    }
  } else {
    // Selling more than you hold opens a short. Alpaca would permit it; the
    // trader almost never means it.
    if (qty > ctx.heldQty + 1e-9) {
      blocks.push(`selling ${qty} but you hold ${ctx.heldQty} — this would open a short`);
    }
  }

  return { estCost, warnings, blocks };
}

// ── Placement ───────────────────────────────────────────────────────────────

/**
 * Send an order. ONE attempt.
 *
 * `postJson` has no retry parameter by construction, so this cannot silently
 * become a double-fill. If it fails, it fails visibly and a human decides what
 * to do — which is the correct owner of that decision.
 */
export async function placeOrder(req: OrderRequest): Promise<OrderResult> {
  // Demo mode has no account to send this to. Refuse loudly rather than
  // pretending to fill, which would teach the wrong thing about what happened.
  if (isDemoMode()) {
    return { ok: false, message: new DemoModeError("Placing an order").message };
  }
  const cfg = loadConfig();
  const payload: Record<string, string> = {
    symbol: req.symbol.toUpperCase(),
    side: req.side,
    type: req.type,
    time_in_force: "day",
    qty: req.qty,
  };
  if (req.type === "limit" && req.limitPrice) payload.limit_price = req.limitPrice;

  try {
    const data = await postJson<Record<string, unknown>>(
      `${cfg.tradeHost}/v2/orders`,
      payload,
      { headers: authHeaders(cfg), timeoutMs: 15_000 },
    );
    if (typeof data.id === "string") {
      return { ok: true, id: data.id, status: String(data.status ?? "") };
    }
    return { ok: false, message: String(data.message ?? "Alpaca returned no order id") };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ── History ─────────────────────────────────────────────────────────────────

export interface OrderRecord {
  id: string;
  symbol: string;
  side: string;
  qty: string;
  filledQty: string;
  type: string;
  status: string;
  limitPrice?: string;
  filledAvgPrice?: string;
  submittedAt: string;
}

export async function getOrders(limit = 50): Promise<OrderRecord[]> {
  if (isDemoMode()) return demoOrders().slice(0, limit);
  const cfg = loadConfig();
  const url = `${cfg.tradeHost}/v2/orders?status=all&limit=${limit}&direction=desc`;
  const arr = await getJson<unknown>(url, { headers: authHeaders(cfg) });
  if (!Array.isArray(arr)) return [];
  return arr.map((raw): OrderRecord => {
    const o = raw as Record<string, unknown>;
    return {
      id: String(o.id),
      symbol: String(o.symbol),
      side: String(o.side),
      qty: String(o.qty ?? ""),
      filledQty: String(o.filled_qty ?? "0"),
      type: String(o.type ?? o.order_type ?? ""),
      status: String(o.status ?? ""),
      limitPrice: o.limit_price ? String(o.limit_price) : undefined,
      filledAvgPrice: o.filled_avg_price ? String(o.filled_avg_price) : undefined,
      submittedAt: String(o.submitted_at ?? ""),
    };
  });
}

// ── Logging ─────────────────────────────────────────────────────────────────

/** One line per order, formatted for a human reading it six months later. */
export function formatOrderLogLine(
  req: OrderRequest,
  result: OrderResult,
  mode: Mode,
  at: string,
): string {
  const limit = req.type === "limit" && req.limitPrice ? ` @ $${req.limitPrice}` : "";
  const outcome = result.ok
    ? `accepted (${result.status}) id=${result.id}`
    : `FAILED: ${result.message}`;
  return (
    `${at}  [${mode}]  ${req.side.toUpperCase()} ${req.qty} ` +
    `${req.symbol.toUpperCase()} ${req.type}${limit}  -> ${outcome}\n`
  );
}

/**
 * Append to journal/orders.log.
 *
 * Failures are logged too. A rejected order is exactly the kind of thing you
 * want to find when reconstructing what happened on a bad morning.
 */
export function logOrder(
  req: OrderRequest,
  result: OrderResult,
  mode: Mode,
  at = new Date().toISOString().slice(0, 19).replace("T", " "),
): void {
  try {
    const file = ordersLogFile();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, formatOrderLogLine(req, result, mode, at));
  } catch {
    // Logging must never break the order flow. The order already happened;
    // failing here would misreport a placed order as a failed one.
  }
}
