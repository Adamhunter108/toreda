// Rendering a scan for a human.
//
// Print order is deliberate and not negotiable: rule breaches come FIRST,
// unconditionally. Managing what you already own outranks any opportunity to
// own more, and burying a stop-loss breach below eight buy ideas inverts that.

import { c, compactMoney, out, pctRaw } from "../cli/format";
import type {
  DiscoveryResult,
  OpportunitySignal,
  PositionAlert,
  ScanResult,
  StopException,
} from "./types";

function actionColor(action: string): (s: string) => string {
  const a = action.toLowerCase();
  if (a === "buy") return c.green;
  if (a === "sell" || a === "trim") return c.red;
  return c.yellow;
}

function confidenceColor(confidence: number): (s: string) => string {
  if (confidence >= 7) return c.green;
  if (confidence >= 4) return c.yellow;
  return c.red;
}

function confidenceBar(confidence: number): string {
  const n = Math.max(0, Math.min(10, Math.round(confidence)));
  return "▉".repeat(n) + "░".repeat(10 - n);
}

export function printPositionReview(alerts: PositionAlert[]): void {
  if (alerts.length === 0) return;
  out("", c.bold("⚖  Position review — rule breaches"), c.dim("─".repeat(64)));
  for (const alert of alerts) {
    const color = alert.rule === "STOP LOSS" ? c.red : c.yellow;
    out("", `${c.bold(alert.symbol)} — ${color(`${alert.rule}: ${alert.action}`)}`);
    for (const line of alert.detail.split("\n")) out(`  ${line}`);
  }
  out("", c.dim("  These are your own rules, not market predictions."));
}

/** Positions held past the default stop under a dated exception. */
export function printStopExceptions(held: StopException[]): void {
  if (held.length === 0) return;
  out("", c.bold("◆  Held past your stop — dated exceptions"), c.dim("─".repeat(64)));
  for (const h of held) {
    out(
      "",
      `${c.bold(h.symbol)} — ${c.yellow(`${h.plPct.toFixed(1)}% from entry, past the ${h.defaultPct}% stop`)}`,
      `  Exception to ${h.stopPct}%${h.until ? ` until ${h.until}` : ""} ` +
        `(decided ${h.decided || "undated"}): ${h.reason}`,
    );
  }
  out("", c.dim("  When an exception ends, the default stop and its SELL alert come back."));
}

export function printSignals(result: ScanResult): void {
  const shown = result.opportunities.filter((o) => o.confidence >= result.minConfidence);

  if (shown.length === 0) {
    out("", `No signals cleared confidence ${result.minConfidence}/10 this scan.`);
    return;
  }

  out(
    "",
    c.bold(`🎯 ${shown.length} signal${shown.length === 1 ? "" : "s"}`),
    c.dim("─".repeat(64)),
  );

  for (const o of shown) {
    printSignal(o);
  }

  out(
    "",
    c.dim(
      "Confidence is a heuristic ranking aid, not a probability. Nothing here is an order.",
    ),
  );
}

function printSignal(o: OpportunitySignal): void {
  const price = o.price ? ` @ $${o.price.toFixed(2)}` : "";
  const change = o.pctChange !== undefined ? ` (${pctRaw(o.pctChange, 1)})` : "";
  const held = o.position ? c.cyan(" [HELD]") : "";
  const type = o.opportunityType.replace(/_/g, " ").toUpperCase();

  out("", `${c.bold(o.symbol)}${price}${change}${held} — ${type}`);
  out(
    `  ${actionColor(o.action)(c.bold(o.action.toUpperCase()))}  ` +
      `${confidenceColor(o.confidence)(confidenceBar(o.confidence))} ${o.confidence}/10  ` +
      `${c.dim(o.timeframe.replace(/_/g, " "))}  ${c.dim(o.sector)}`,
  );
  out(`  ${o.reasoning}`);
  out(c.dim(`  score: ${o.scoreBreakdown.join(", ")}`));
  for (const catalyst of o.catalysts) out(c.dim(`    • ${catalyst}`));
}

export function printDiscovery(discovery: DiscoveryResult): void {
  out("", c.bold("🔭 Discovery — moving, not on your watchlist"), c.dim("─".repeat(64)));

  if (discovery.candidates.length === 0) {
    out("", `Nothing cleared the quality gates (${discovery.considered} candidates screened).`);
  } else {
    for (const cand of discovery.candidates) {
      out("", `${c.bold(cand.symbol)} @ $${cand.price.toFixed(2)} (${pctRaw(cand.pctChange, 1)}) — ${cand.name}`);
      out(
        c.dim(
          `  via ${cand.sources.join(", ")} | prev-day volume ${compactMoney(cand.dollarVolume)}`,
        ) +
          (cand.fractionable
            ? c.dim(" | fractionable")
            : c.yellow(` | whole shares only — min buy $${cand.price.toFixed(2)}`)),
      );
    }
  }

  // Say what was thrown away, so an over-aggressive filter is visible rather
  // than silently producing an empty, confident-looking list.
  const dropped = Object.entries(discovery.rejected).sort((a, b) => b[1] - a[1]);
  if (dropped.length > 0) {
    out("", c.dim(`  filtered out: ${dropped.map(([r, n]) => `${n} ${r}`).join(", ")}`));
  }
  if (discovery.notShown > 0) {
    out(c.dim(`  ${discovery.notShown} more passed the gates but aren't shown (display cap)`));
  }
  out(
    "",
    c.yellow("  These are UNVETTED — surfaced by screens, not analysed. Research before acting."),
  );
}

export function printScan(result: ScanResult): void {
  // Degradation is stated up front. A scan missing its news source looks
  // identical to a quiet news day unless it says so.
  if (result.degraded.length > 0) {
    out("", c.yellow("⚠ Partial scan — some sources were unavailable:"));
    for (const reason of result.degraded) out(c.dim(`    • ${reason}`));
  }

  printPositionReview(result.positionAlerts);
  printStopExceptions(result.stopExceptions ?? []);
  printSignals(result);

  // Discovery runs last so the curated universe stays the headline and unvetted
  // names never mix into it.
  if (result.discovery) printDiscovery(result.discovery);
  out("");
}
