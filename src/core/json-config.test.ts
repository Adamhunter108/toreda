import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWatchlist } from "./watchlist";
import { loadScannerConfig, DEFAULT_SCANNER_CONFIG } from "./scanner-config";
import { loadUiConfig } from "./ui-config";
import { THEMES } from "./theme";

// A fresh clone has no config/*.json — only the shipped config/*.default.json.
// Everything must load from those without the user having run setup yet, or the
// first thing a new user sees is a crash.

test("the watchlist loads from the shipped default in a fresh clone", () => {
  const wl = loadWatchlist();
  assert.ok(wl.symbols.length > 0, "expected the default watchlist to have symbols");
  assert.ok(wl.sectors.length > 0, "expected the default watchlist to have sectors");
  // Every symbol must be reachable from a sector, or signals render unlabelled.
  for (const s of wl.symbols) {
    assert.ok(wl.sectorOf[s], `${s} has no sector`);
  }
});

test("the default watchlist spans several sectors, not one bet in many tickers", () => {
  assert.ok(
    loadWatchlist().sectors.length >= 4,
    "a starter watchlist concentrated in one sector teaches the wrong habit",
  );
});

test("watchlist symbols are unique and uppercase", () => {
  const symbols = loadWatchlist().symbols;
  assert.equal(new Set(symbols).size, symbols.length, "duplicate symbols");
  for (const s of symbols) assert.equal(s, s.toUpperCase());
});

test("scanner config loads from the shipped default", () => {
  const cfg = loadScannerConfig();
  assert.equal(cfg.minConfidence, DEFAULT_SCANNER_CONFIG.minConfidence);
  assert.equal(cfg.discovery.enabled, true);
  assert.deepEqual(cfg.sectorFocus, [], "a shipped sector focus would hide most signals");
});

test("scanner thresholds keep the signs their meaning requires", () => {
  const t = loadScannerConfig().thresholds;
  assert.ok(t.momentumPct > 0, "momentum is an upward move");
  assert.ok(t.valuePullbackPct < 0, "a pullback is a drawdown");
  assert.ok(t.socialBullShare > 0.5 && t.socialBullShare <= 1, "a lean needs a majority");
});

test("ui config loads and names a real theme", () => {
  const ui = loadUiConfig();
  assert.ok(ui.theme in THEMES, `${ui.theme} is not a defined theme`);
});
