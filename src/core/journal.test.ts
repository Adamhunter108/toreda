import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendJournal,
  formatRulesEntry,
  formatTradeEntry,
  journalAppendText,
  localDate,
} from "./journal";

const day = new Date(2026, 10, 16, 10, 30); // 16 Nov 2026, local

test("dates are the local calendar day, zero-padded", () => {
  assert.equal(localDate(new Date(2026, 0, 5)), "2026-01-05");
});

test("a new month file gets a title and a day heading", () => {
  const text = journalAppendText(null, day, "- entry");
  assert.equal(text, "# Trading journal — 2026 November\n\n## 2026-11-16\n\n- entry\n");
});

test("an entry on the same day joins that day's heading", () => {
  const existing = "# Trading journal — 2026 November\n\n## 2026-11-16\n\n- first\n";
  assert.equal(journalAppendText(existing, day, "- second"), "- second\n");
});

test("an entry on a new day starts a new heading", () => {
  const existing = "## 2026-11-15\n\n- yesterday\n";
  assert.equal(journalAppendText(existing, day, "- today"), "\n## 2026-11-16\n\n- today\n");
});

test("a file missing its trailing newline is not run together", () => {
  const existing = "## 2026-11-16\n\n- first";
  assert.equal(journalAppendText(existing, day, "- second"), "\n- second\n");
});

test("only the last heading counts — an old same-date heading is not reused", () => {
  // Someone hand-wrote a later day's heading; today's entry must not slot back
  // in above it, which would be rewriting the order of history.
  const existing = "## 2026-11-16\n\n- a\n\n## 2026-11-17\n\n- b\n";
  assert.ok(journalAppendText(existing, day, "- c").startsWith("\n## 2026-11-16"));
});

test("appending never rewrites what is already there", () => {
  const home = mkdtempSync(join(tmpdir(), "toreda-journal-"));
  const prev = process.env.TOREDA_HOME;
  process.env.TOREDA_HOME = home;
  try {
    const a = appendJournal("- one", day);
    const b = appendJournal("- two", day);
    assert.ok(a.ok && b.ok);
    const file = join(home, "journal", "2026-11.md");
    assert.equal(
      readFileSync(file, "utf8"),
      "# Trading journal — 2026 November\n\n## 2026-11-16\n\n- one\n- two\n",
    );
  } finally {
    if (prev === undefined) delete process.env.TOREDA_HOME;
    else process.env.TOREDA_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
});

test("a market order is marked as decision-time price, not presented as a fill", () => {
  const entry = formatTradeEntry({
    side: "buy",
    qty: "5",
    symbol: "nvda",
    type: "market",
    price: 196.82,
    mode: "paper",
    why: "breakout on volume",
    wrongIf: "closes back under $190",
  });
  assert.equal(
    entry,
    "- **BUY 5 NVDA @ ~$196.82** (~$984 · market · paper)\n" +
      "  - **Why:** breakout on volume\n" +
      "  - **Wrong if:** closes back under $190",
  );
});

test("a limit order shows its limit, and a blank reason is recorded as blank", () => {
  const entry = formatTradeEntry({
    side: "sell",
    qty: "10",
    symbol: "AMD",
    type: "limit",
    limitPrice: "430",
    price: 434.13,
    mode: "live",
    why: "",
    wrongIf: "  ",
  });
  assert.ok(entry.startsWith("- **SELL 10 AMD @ $430.00** (~$4,300 · limit · live)"));
  assert.ok(entry.includes("**Why:** _none recorded_"));
  assert.ok(entry.includes("**Wrong if:** _none recorded_"));
});

test("a rules change lists each change and its reason", () => {
  assert.equal(
    formatRulesEntry(["stop loss −7% → −10%"], "giving swing trades room"),
    "- **Risk rules changed** (dashboard)\n  - stop loss −7% → −10%\n  - **Why:** giving swing trades room",
  );
});
