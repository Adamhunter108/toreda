// The reasoning journal: journal/YYYY-MM.md.
//
// Distinct from journal/orders.log, which records WHAT was sent. This records
// WHY — written at the moment of the decision, before the outcome is known, so a
// later review can tell a good decision from a lucky one. Same shape as
// templates/journal-month.md.
//
// Append-only. Nothing here ever rewrites an existing line: a corrected entry is
// a new entry noting the correction.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Mode } from "./config";
import { journalFileFor } from "./paths";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Local calendar date, YYYY-MM-DD — the day the trader experienced. */
export function localDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * The exact text to append for `entry` on `date`, given the file's current
 * contents (null when the file does not exist yet).
 *
 * Starts a new month file with its title, and a new day with its `## date`
 * heading — unless today's heading is already the last one, in which case the
 * entry joins it.
 */
export function journalAppendText(existing: string | null, date: Date, entry: string): string {
  const day = localDate(date);
  const body = entry.endsWith("\n") ? entry : entry + "\n";

  if (existing === null || existing.trim() === "") {
    return `# Trading journal — ${date.getFullYear()} ${MONTHS[date.getMonth()]}\n\n## ${day}\n\n${body}`;
  }

  const headings = existing.match(/^## .*$/gm) ?? [];
  const last = headings[headings.length - 1]?.slice(3).trim();
  const sep = existing.endsWith("\n") ? "" : "\n";
  return last === day ? sep + body : `${sep}\n## ${day}\n\n${body}`;
}

export type JournalWrite = { ok: true; file: string } | { ok: false; error: string };

/** Append an entry to this month's journal. Never throws. */
export function appendJournal(entry: string, date = new Date()): JournalWrite {
  const file = journalFileFor(date);
  try {
    mkdirSync(dirname(file), { recursive: true });
    const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
    appendFileSync(file, journalAppendText(existing, date, entry));
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Entry formats ───────────────────────────────────────────────────────────

const money = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface TradeEntry {
  side: "buy" | "sell";
  qty: string;
  symbol: string;
  type: "market" | "limit";
  limitPrice?: string;
  /** Last price at the moment of the decision. 0 when unknown. */
  price: number;
  mode: Mode;
  why: string;
  wrongIf: string;
}

/**
 * A trade, as written when it is placed.
 *
 * A market order's fill price is not known yet, so the price is marked as the
 * last price at decision time (`~`), not presented as the fill. A blank reason
 * is recorded as blank rather than omitted: "I had no reason written down" is
 * itself something a review should be able to see.
 */
export function formatTradeEntry(t: TradeEntry): string {
  const qty = Number(t.qty) || 0;
  const limit = t.type === "limit" ? Number(t.limitPrice) || 0 : 0;
  const at = limit ? money(limit) : t.price > 0 ? `~${money(t.price)}` : "market";
  const px = limit || t.price;
  const est = px > 0 ? `~$${Math.round(qty * px).toLocaleString("en-US")} · ` : "";
  const none = "_none recorded_";
  return [
    `- **${t.side.toUpperCase()} ${t.qty} ${t.symbol.toUpperCase()} @ ${at}** (${est}${t.type} · ${t.mode})`,
    `  - **Why:** ${t.why.trim() || none}`,
    `  - **Wrong if:** ${t.wrongIf.trim() || none}`,
  ].join("\n");
}

/** A change to config/risk.json — the "a rule changed" entry the template asks for. */
export function formatRulesEntry(changes: string[], why: string): string {
  return [
    "- **Risk rules changed** (dashboard)",
    ...changes.map((c) => `  - ${c}`),
    `  - **Why:** ${why.trim() || "_none recorded_"}`,
  ].join("\n");
}
