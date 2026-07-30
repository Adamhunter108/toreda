import { test } from "node:test";
import assert from "node:assert/strict";
import { excludedByName, looksLikeDerivative, EXCLUDED_NAME_PATTERNS } from "./discovery";

// Discovery's job is reaching the few real businesses in screener output that
// is ~90% noise. These gates are what does it, and each is prone to a specific
// over-reach that would quietly discard names worth seeing.

test("warrants, units and rights are caught by ticker shape", () => {
  for (const s of ["ABCDW", "ABCDU", "ABCDR", "ABCDP"]) {
    assert.equal(looksLikeDerivative(s), true, `${s} should be caught`);
  }
});

test("ordinary tickers are not mistaken for derivatives", () => {
  for (const s of ["NVDA", "AAPL", "GOOGL", "F", "BRK"]) {
    assert.equal(looksLikeDerivative(s), false, `${s} should pass`);
  }
});

test("a five-letter ticker not ending in a class suffix passes", () => {
  assert.equal(looksLikeDerivative("GOOGL"), false);
});

test("leveraged and inverse products are excluded by name", () => {
  for (const name of [
    "Direxion Daily Semiconductor Bull 3X Shares",
    "ProShares UltraPro QQQ",
    "ProShares UltraShort S&P500",
    "Some Inverse Treasury Fund",
    "Leveraged Gold Miners ETF",
  ]) {
    assert.equal(excludedByName(name), true, `${name} should be excluded`);
  }
});

test("warrants and units are excluded by name too", () => {
  assert.equal(excludedByName("Acme Corp Warrant"), true);
  assert.equal(excludedByName("Acme Acquisition Corp Units"), true);
});

// The patterns are matched as substrings, so each has to be anchored enough not
// to swallow real companies. These are the specific near-misses.

test("'United' is not caught by the ' units' pattern", () => {
  assert.equal(excludedByName("United Airlines Holdings Inc"), false);
  assert.equal(excludedByName("UnitedHealth Group Incorporated"), false);
});

test("ADRs are not excluded — TSM and ASML are wanted", () => {
  assert.equal(excludedByName("Taiwan Semiconductor Manufacturing Company Ltd."), false);
  assert.equal(excludedByName("ASML Holding N.V. - New York Registry Shares"), false);
});

test("ordinary companies are not excluded", () => {
  for (const name of [
    "NVIDIA Corporation",
    "Apple Inc.",
    "Bank of America Corporation",
    "Caterpillar Inc.",
    "Coca-Cola Company",
  ]) {
    assert.equal(excludedByName(name), false, `${name} should pass`);
  }
});

// A company whose NAME BEGINS with bull/bear/ultra is a business, not a fund.
// "Ultra Clean Holdings" is a real, currently-listed semiconductor supplier and
// was being silently discarded by an unanchored 'ultra ' pattern — the exact
// failure mode discovery's rejection counts exist to make visible.
test("a company whose name begins with bull, bear or ultra is not excluded", () => {
  for (const name of [
    "Ultra Clean Holdings, Inc.",
    "Bear Stearns Companies",
    "Bull Horn Holdings Corp",
  ]) {
    assert.equal(excludedByName(name), false, `${name} should pass`);
  }
});

test("but leveraged funds carrying those words mid-name are still excluded", () => {
  for (const name of [
    "Direxion Daily Semiconductor Bear 3X Shares",
    "Direxion Daily Financial Bull 3X Shares",
    "ProShares Ultra S&P500",
  ]) {
    assert.equal(excludedByName(name), true, `${name} should be excluded`);
  }
});

test("name matching is case-insensitive", () => {
  assert.equal(excludedByName("DIREXION DAILY 3X BULL"), true);
  assert.equal(excludedByName("direxion daily 3x bull"), true);
});

test("every exclusion pattern is lowercase, since matching lowercases the name", () => {
  // A pattern with a capital letter would silently never match.
  for (const p of EXCLUDED_NAME_PATTERNS) {
    assert.equal(p, p.toLowerCase(), `pattern "${p}" must be lowercase`);
  }
});
