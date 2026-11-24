import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutFooter, parseHints, statusBarHeight } from "./StatusBar";

const HINT =
  "↑↓ select · ⏎ detail · s sort · tab panel · space zoom · l rules · A arm · h history · " +
  "g signals · r scan · c settings · w watchlist · t theme · q quit";

test("each segment splits into its key and what it does", () => {
  assert.deepEqual(parseHints("↑↓ select · space/esc back · [/] line · A arm"), [
    { key: "↑↓", label: "select" },
    { key: "space/esc", label: "back" },
    { key: "[/]", label: "line" },
    { key: "A", label: "arm" },
  ]);
});

test("a segment that isn't a key stays a plain label", () => {
  assert.deepEqual(parseHints("scanner settings · esc back"), [
    { key: "", label: "scanner settings" },
    { key: "esc", label: "back" },
  ]);
  assert.deepEqual(parseHints("editing watchlist"), [{ key: "", label: "editing watchlist" }]);
});

test("when everything fits, status and keys share one line", () => {
  const layout = layoutFooter(40, parseHints("esc back · q quit"), 120);
  assert.equal(layout.inline, true);
  assert.equal(layout.rows.length, 1);
});

// A vertical screen is narrow: the legend used to lose most of its keys off
// the right. Now every key is shown, in as many rows as it takes.
test("on a narrow terminal every key wraps into a grid, none dropped", () => {
  const hints = parseHints(HINT);
  const layout = layoutFooter(40, hints, 80);
  assert.equal(layout.inline, false);
  assert.deepEqual(layout.rows.flat(), hints, "every key, in order");
  // The widest entry ("w watchlist", "c settings") sets the cell.
  assert.equal(layout.cell, "w watchlist".length + 2);
  for (const row of layout.rows) {
    const width = (row.length - 1) * layout.cell + (row.at(-1)!.key.length + 1 + row.at(-1)!.label.length);
    assert.ok(width <= 78, `row is ${width} wide`);
  }
});

test("wrapped rows are evened out rather than leaving a short last row", () => {
  const rows = layoutFooter(40, parseHints(HINT), 150).rows.map((r) => r.length);
  assert.deepEqual(rows, [7, 7]);
});

test("a narrower terminal takes more rows, never a cut key", () => {
  const hints = parseHints(HINT);
  const wide = layoutFooter(40, hints, 100).rows.length;
  const narrow = layoutFooter(40, hints, 60).rows.length;
  assert.ok(narrow > wide);
  assert.equal(layoutFooter(40, hints, 10).rows.length, hints.length, "one per row at worst");
});

test("the height counts the status line plus the legend's rows", () => {
  const at = new Date(2026, 2, 2, 9, 30);
  assert.equal(statusBarHeight("live", undefined, 3, at, "esc back · q quit", 120), 1);
  const rows = layoutFooter(0, parseHints(HINT), 80).rows.length;
  const height = statusBarHeight("live", undefined, 3, at, HINT, 80);
  assert.ok(height >= 2 && height <= rows + 1, `height ${height}`);
});

test("no keys at all is just the status line", () => {
  assert.equal(statusBarHeight("live", undefined, 0, null, "", 80), 1);
});
