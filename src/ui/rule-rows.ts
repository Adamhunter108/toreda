// The rules panel's rows: each breach, and each position held past its stop by
// an exception, as one short line in plain words.
//
// The rules used to sit in a strip of full sentences, three at most. A fourth
// breach was hidden behind "…and 1 more", and a long one was cut off mid-way.
// A short row per rule fits them all, and the full sentence is still in the
// detail pane and the `l` rules view, where there is room for it.

import type { PositionAlert, StopException } from "../scanner/types";

export interface RuleRow {
  key: string;
  /** What the rule says: SELL or TRIM, or HELD when your exception is holding it. */
  tag: "SELL" | "TRIM" | "HELD";
  /** Red for a stop, because the rule says sell; gold for the rest. */
  tone: "negative" | "warning";
  symbol: string;
  /** The rule, in plain words. */
  rule: string;
  /** Where the position stands against it. */
  where: string;
  /** The line itself, and anything you decided about it. */
  line: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03-02" → "Mar 2". Anything that isn't a date passes through. */
export function shortDate(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  const month = m ? MONTHS[Number(m[1]) - 1] : undefined;
  return m && month ? `${month} ${Number(m[2])}` : iso;
}

const money = (n: number): string => `$${n.toFixed(2)}`;
const below = (pct: number): string => `${Math.abs(pct).toFixed(1)}% below`;

function stopRow(a: PositionAlert): RuleRow {
  const s = a.stop!;
  const where =
    s.from === "high"
      ? `${below(s.belowPct)} its ${money(s.anchor)} high` +
        (s.highDate ? ` (${shortDate(s.highDate)})` : "")
      : `${below(s.belowPct)} what you paid (${money(s.anchor)})`;
  // The stop's price leads, so a narrow terminal cuts the qualifier instead.
  let line = `stop ${money(s.price)} (${s.pct}%)`;
  if (s.exceptionUntil !== null) {
    line += s.exceptionUntil ? ` · your exception until ${shortDate(s.exceptionUntil)}` : " · your exception";
  } else if (s.lapsedUntil !== null) {
    line += /^\d{4}-\d{2}-\d{2}$/.test(s.lapsedUntil)
      ? ` · your exception ended ${shortDate(s.lapsedUntil)}`
      : " · your exception had no end date, so it doesn't apply";
  }
  return { key: a.symbol + a.rule, tag: "SELL", tone: "negative", symbol: a.symbol, rule: "stop-loss", where, line };
}

function sizeRow(a: PositionAlert): RuleRow {
  const s = a.size!;
  const over = s.overUsd >= 1 ? `about $${Math.round(s.overUsd).toLocaleString("en-US")}` : "under $1";
  return {
    key: a.symbol + a.rule,
    tag: "TRIM",
    tone: "warning",
    symbol: a.symbol,
    rule: "size limit",
    where: `${(s.weight * 100).toFixed(1)}% of your account`,
    line: `limit ${Math.round(s.ceiling * 100)}%${s.override ? " (your override)" : ""} · ${over} over`,
  };
}

function heldRow(h: StopException): RuleRow {
  return {
    key: h.symbol + " held",
    tag: "HELD",
    tone: "warning",
    symbol: h.symbol,
    rule: "exception",
    where: `${below(h.belowPct)} ${h.from === "high" ? "its high" : "what you paid"}`,
    line:
      `past its ${h.defaultPct}% stop · you're holding to ${h.stopPct}%` +
      (h.until ? ` until ${shortDate(h.until)}` : "") +
      (h.reason ? `: ${h.reason}` : ""),
  };
}

/** Breaches first, stops before sizes, then positions your exceptions are holding. */
export function ruleRows(alerts: PositionAlert[], held: StopException[]): RuleRow[] {
  const rows = alerts.map((a): RuleRow => {
    if (a.stop) return stopRow(a);
    if (a.size) return sizeRow(a);
    // An alert without its figures: say what it is, in its own words.
    return {
      key: a.symbol + a.rule,
      tag: a.action,
      tone: a.rule === "STOP LOSS" ? "negative" : "warning",
      symbol: a.symbol,
      rule: a.rule === "STOP LOSS" ? "stop-loss" : "size limit",
      where: a.detail.split("\n")[0] ?? "",
      line: "",
    };
  });
  return [...rows, ...held.map(heldRow)];
}

/** "3 past their stop · 1 over its size limit". */
export function ruleSummary(alerts: PositionAlert[], held: StopException[]): string {
  const stops = alerts.filter((a) => a.rule === "STOP LOSS").length;
  const sizes = alerts.length - stops;
  const parts: string[] = [];
  if (stops) parts.push(`${stops} past ${stops === 1 ? "its" : "their"} stop`);
  if (sizes) parts.push(`${sizes} over ${sizes === 1 ? "its" : "their"} size limit`);
  if (held.length) parts.push(`${held.length} held by your exception${held.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** Inner width at which the plain-words rule column fits beside the figures. */
export const RULE_COLUMN_MIN_WIDTH = 100;

/** Widest `where` shown; longer ones are cut so the line still lines up. */
export const WHERE_MAX = 44;

/** Column widths for a set of rows, so they line up. */
export function ruleColumns(rows: RuleRow[], innerWidth: number): { symbol: number; rule: number; where: number } {
  const longest = (f: (r: RuleRow) => string): number => Math.max(0, ...rows.map((r) => f(r).length));
  return {
    symbol: Math.max(4, longest((r) => r.symbol)),
    rule: innerWidth >= RULE_COLUMN_MIN_WIDTH ? longest((r) => r.rule) : 0,
    where: Math.min(WHERE_MAX, longest((r) => r.where)),
  };
}
