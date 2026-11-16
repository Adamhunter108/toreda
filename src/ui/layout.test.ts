import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isWide,
  POSITION_ROW_WIDTH,
  positionsPanelWidth,
  PANEL_CHROME,
  shouldShowSparkline,
  SPARK_WIDTH,
  ZOOM_SPARK_MAX,
  zoomedPanelRows,
  zoomedSparkWidth,
} from "./layout";

test("the two-column layout starts at 100 columns", () => {
  assert.equal(isWide(99), false);
  assert.equal(isWide(100), true);
});

test("the positions panel loses width to the right column when wide", () => {
  // Narrow: the panel spans the terminal, minus its own chrome.
  assert.equal(positionsPanelWidth(80), 76);
  // Wide: the right column and its margin come off first.
  assert.equal(positionsPanelWidth(130), 130 - 35 - 4);
});

// THE regression. At 110 columns the terminal IS wide and the two-column layout
// IS correct — and the sparkline still does not fit. Showing it there made Ink
// drop characters mid-number, rendering $3752.75 as $3752.7 and 11 shares as 1.
// Both look like valid figures, which is what makes this worse than a visibly
// broken layout.
test("the sparkline is hidden at widths where it would truncate the numbers", () => {
  assert.equal(shouldShowSparkline(110), false, "110 was the bug: wide, but not wide enough");
  assert.equal(shouldShowSparkline(100), false);
  assert.equal(shouldShowSparkline(80), false);
});

test("the sparkline appears once there is genuinely room", () => {
  assert.equal(shouldShowSparkline(130), true);
  assert.equal(shouldShowSparkline(200), true);
});

test("the threshold is exactly where the row stops fitting", () => {
  // Find the narrowest terminal that shows a sparkline, then confirm one column
  // narrower does not — the boundary is the whole point.
  let boundary = 0;
  for (let cols = 60; cols <= 220; cols++) {
    if (shouldShowSparkline(cols)) {
      boundary = cols;
      break;
    }
  }
  assert.ok(boundary > 0, "no width shows a sparkline");
  assert.equal(shouldShowSparkline(boundary - 1), false);
  assert.ok(
    positionsPanelWidth(boundary) >= POSITION_ROW_WIDTH + SPARK_WIDTH,
    "the boundary width must actually fit the full row",
  );
});

// The single rule, stated once: the sparkline shows exactly when the full row
// fits, at every width. The old `cols >= 100` test was a proxy for this, and got
// it wrong in BOTH directions — hiding the sparkline at 95 columns where it fits
// fine in the single-column layout, and showing it at 110 where it does not.
test("the sparkline shows if and only if the row fits, at every width", () => {
  for (let cols = 40; cols <= 250; cols++) {
    const fits = positionsPanelWidth(cols) >= POSITION_ROW_WIDTH + SPARK_WIDTH;
    assert.equal(
      shouldShowSparkline(cols),
      fits,
      `at ${cols} columns: panel is ${positionsPanelWidth(cols)}, needs ${POSITION_ROW_WIDTH + SPARK_WIDTH}`,
    );
  }
});

test("a narrow single-column terminal can still show the sparkline if it fits", () => {
  // Below the two-column threshold the panel spans the whole terminal, so there
  // is more room for the row, not less.
  assert.equal(shouldShowSparkline(95), true);
  assert.equal(shouldShowSparkline(70), false);
});

test("an absurdly narrow terminal does not produce a negative width", () => {
  assert.ok(positionsPanelWidth(10) <= 10);
  assert.equal(shouldShowSparkline(10), false);
});

// Zooming must not reintroduce the truncation bug: a wider sparkline is only
// worth having if every number in the row still renders in full.
test("the zoomed sparkline never pushes the row past the terminal", () => {
  for (let cols = 10; cols <= 300; cols++) {
    const w = zoomedSparkWidth(cols);
    if (w === 0) continue;
    assert.ok(
      PANEL_CHROME + POSITION_ROW_WIDTH + 2 + w <= cols,
      `at ${cols} columns a ${w}-wide sparkline overflows`,
    );
    assert.ok(w >= SPARK_WIDTH - 2, "never narrower than the grid's sparkline");
    assert.ok(w <= ZOOM_SPARK_MAX);
  }
});

test("zooming never hides a sparkline the grid would have shown", () => {
  for (let cols = 40; cols <= 250; cols++) {
    if (shouldShowSparkline(cols)) {
      assert.ok(zoomedSparkWidth(cols) > 0, `zoom lost the sparkline at ${cols} columns`);
    }
  }
});

test("a zoomed panel gives back a row for each banner, with a legible floor", () => {
  assert.equal(zoomedPanelRows(40, 0), 32);
  assert.equal(zoomedPanelRows(40, 2), 30);
  assert.equal(zoomedPanelRows(12, 2), 10);
});
