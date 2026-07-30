// The mode banner.
//
// Printed before anything that reads or touches an account, so "which account
// am I looking at" is never a question you have to go and answer. In live mode
// it is red and says REAL MONEY, because the cost of that being ambiguous is
// not symmetric with the cost of it being noisy.

import { loadConfig, type Mode } from "../core/config";
import { c, out } from "./format";

export function banner(mode: Mode): string {
  return mode === "live"
    ? c.red(c.bold("🚨 LIVE — REAL MONEY"))
    : c.yellow("📝 PAPER — fake money");
}

export function printBanner(mode?: Mode): Mode {
  const resolved = mode ?? loadConfig().mode;
  out(banner(resolved));
  return resolved;
}
