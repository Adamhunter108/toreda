import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type GridPlan,
  ALLOC_WIDTH,
  CHART_FLOOR,
  CHART_MIN,
  fitPositions,
  isWide,
  NARROW_CHART_ROWS,
  PANEL_CHROME,
  planGrid,
  POSITION_ROW_WIDTH,
  positionColumns,
  positionRowWidth,
  positionsHeight,
  positionsPanelWidth,
  rulesStripHeight,
  shouldShowSparkline,
  signalsHeight,
  SPARK_WIDTH,
  WEIGHT_WIDTH,
  ZOOM_SPARK_MAX,
  zoomedPanelRows,
  zoomedPositionColumns,
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

// The single rule, stated once and checked everywhere: whatever columns are
// chosen, the row fits the panel it is drawn in.
test("the positions row fits its panel at every terminal width", () => {
  for (let cols = 40; cols <= 300; cols++) {
    const panel = positionsPanelWidth(cols);
    const chosen = positionColumns(panel);
    if (!chosen.weight) continue; // base row alone: the panel is what it is
    assert.ok(positionRowWidth(chosen) <= panel, `at ${cols} columns the row overflows ${panel}`);
  }
});

test("optional columns are earned in order: weight, then trend, then allocation", () => {
  for (let w = 0; w <= 250; w++) {
    const c = positionColumns(w);
    if (c.spark > 0) assert.equal(c.weight, true, `trend without weight at ${w}`);
    if (c.alloc) assert.ok(c.spark > 0, `allocation without trend at ${w}`);
  }
});

test("each optional column appears as soon as it fits", () => {
  const base = POSITION_ROW_WIDTH + WEIGHT_WIDTH;
  assert.equal(positionColumns(base - 1).weight, false);
  assert.equal(positionColumns(base).weight, true);
  assert.equal(positionColumns(base + SPARK_WIDTH - 1).spark, 0);
  assert.ok(positionColumns(base + SPARK_WIDTH).spark > 0);
  assert.equal(positionColumns(base + SPARK_WIDTH + ALLOC_WIDTH - 1).alloc, false);
  assert.equal(positionColumns(base + SPARK_WIDTH + ALLOC_WIDTH).alloc, true);
  // An 80-column terminal has room for the weight.
  assert.equal(positionColumns(positionsPanelWidth(80)).weight, true);
});

test("a ~150-column terminal shows weight, trend and allocation together", () => {
  // The width of the screenshot where the separate Allocation panel was
  // wasting most of the screen.
  const c = positionColumns(positionsPanelWidth(150));
  assert.deepEqual([c.weight, c.spark > 0, c.alloc], [true, true, true]);
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
test("the zoomed row never pushes past the terminal", () => {
  for (let cols = 10; cols <= 300; cols++) {
    const c = zoomedPositionColumns(cols);
    if (!c.weight) continue;
    assert.ok(PANEL_CHROME + positionRowWidth(c) <= cols, `at ${cols} columns the zoomed row overflows`);
    if (c.spark) {
      assert.ok(c.spark >= SPARK_WIDTH - 2, "never narrower than the grid's sparkline");
      assert.ok(c.spark <= ZOOM_SPARK_MAX);
    }
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
  assert.equal(zoomedPanelRows(40, 0), 33);
  assert.equal(zoomedPanelRows(40, 2), 31);
  assert.equal(zoomedPanelRows(12, 2), 10);
});

// ── Row budgets ───────────────────────────────────────────────────────────

test("a windowed positions panel spends one extra line saying so", () => {
  assert.equal(positionsHeight(5, 5), 9);
  assert.equal(positionsHeight(5, 12), 10);
});

test("every position is shown whenever it fits, never fewer than one", () => {
  assert.equal(fitPositions(5, 100), 5);
  assert.equal(fitPositions(0, 100), 0);
  const r = fitPositions(40, 20);
  assert.ok(r >= 1 && r < 40 && positionsHeight(r, 40) <= 20);
  assert.equal(fitPositions(40, 3), 1);
});

/** Height of the wide grid's left column for a plan. */
const leftH = (plan: { posRows: number; chartRows: number }, nPos: number): number =>
  positionsHeight(plan.posRows, nPos) + plan.chartRows + 3;

// The regression from the screenshot: a ~150×31 terminal with one breach line
// showed ONE of five positions, because the chart and the allocation panel
// were sized first and positions got what was left.
test("positions are sized first: a 150×31 terminal shows the whole book", () => {
  const plan = planGrid({ wide: true, nPos: 5, nMovers: 25, nSignals: 3, contentH: 31 - 7 - 1 });
  assert.equal(plan.posRows, 5);
  assert.ok(plan.chartRows >= CHART_FLOOR);
});

test("the chart shrinks to its floor before any position scrolls", () => {
  const plan = planGrid({ wide: true, nPos: 30, nMovers: 25, nSignals: 3, contentH: 24 });
  assert.ok(plan.posRows < 30, "a 30-position book must scroll in 24 rows");
  assert.equal(plan.chartRows, CHART_FLOOR, "and only once the chart is at its floor");
  assert.ok(leftH(plan, 30) <= 24);
});

test("with room to spare the chart keeps its preferred height", () => {
  const plan = planGrid({ wide: true, nPos: 3, nMovers: 25, nSignals: 3, contentH: 40 });
  assert.ok(plan.chartRows >= CHART_MIN);
});

test("the wide grid fits the terminal however large the book", () => {
  for (const nPos of [0, 1, 5, 12, 30, 80]) {
    for (const contentH of [16, 24, 32, 50]) {
      for (const nSignals of [0, 3, 12]) {
        const plan = planGrid({ wide: true, nPos, nMovers: 25, nSignals, contentH });
        assert.ok(leftH(plan, nPos) <= contentH, `left ${leftH(plan, nPos)} > ${contentH} (${nPos})`);
        const right = plan.watchRows + 5 + signalsHeight(plan.signalRows, nSignals);
        assert.ok(right <= contentH, `right ${right} > ${contentH} (${nSignals} signals)`);
      }
    }
  }
});

// Both columns end on the same row, so the frame does not look ragged — and
// a focused right-hand panel no longer adds a wrapped title line to break it.
test("the wide columns balance whenever the content allows", () => {
  for (const nPos of [1, 5, 12]) {
    const plan = planGrid({ wide: true, nPos, nMovers: 25, nSignals: 3, contentH: 30 });
    const right = plan.watchRows + 5 + signalsHeight(plan.signalRows, 3);
    assert.equal(leftH(plan, nPos), right, `unbalanced with ${nPos} positions`);
  }
});

/** Height of the single-column stack for a plan. */
const narrowH = (plan: GridPlan, nPos: number, nSignals: number): number =>
  positionsHeight(plan.posRows, nPos) +
  plan.chartRows + 3 +
  (plan.watchRows ? plan.watchRows + 5 : 4) +
  signalsHeight(plan.signalRows, nSignals);

test("the narrow grid shrinks the chart before it hides a position", () => {
  const plan = planGrid({ wide: false, nPos: 5, nMovers: 25, nSignals: 0, contentH: 29 });
  assert.equal(plan.posRows, 5, "every position shown");
  assert.ok(plan.chartRows >= CHART_FLOOR);
  assert.ok(narrowH(plan, 5, 0) <= 29, `narrow total ${narrowH(plan, 5, 0)}`);
});

// The second regression: at 80×40 with a scan loaded and a breach line, the
// watchlist and signals kept their full size and positions dropped to ONE row.
test("the narrow grid shrinks watchlist and signals before it hides a position", () => {
  const plan = planGrid({ wide: false, nPos: 5, nMovers: 25, nSignals: 5, contentH: 40 - 7 - 2 });
  assert.equal(plan.posRows, 5, "every position shown");
  assert.ok(narrowH(plan, 5, 5) <= 31, `narrow total ${narrowH(plan, 5, 5)}`);
});

test("the narrow grid fits whenever its minimums do", () => {
  for (const nPos of [0, 1, 5, 12, 30]) {
    for (const nSignals of [0, 3, 12]) {
      for (const contentH of [24, 31, 40, 60]) {
        const plan = planGrid({ wide: false, nPos, nMovers: 25, nSignals, contentH });
        const h = narrowH(plan, nPos, nSignals);
        const floor = positionsHeight(1, nPos) + CHART_FLOOR + 3 + 8 + signalsHeight(2, nSignals);
        if (floor <= contentH) assert.ok(h <= contentH, `${h} > ${contentH} (${nPos}/${nSignals})`);
      }
    }
  }
});

test("the narrow grid keeps the full chart when the book fits beside it", () => {
  const plan = planGrid({ wide: false, nPos: 2, nMovers: 25, nSignals: 0, contentH: 40 });
  assert.equal(plan.chartRows, NARROW_CHART_ROWS);
});

test("the rules strip is one line when quiet, one per breach up to a cap", () => {
  assert.equal(rulesStripHeight(null), 1);
  assert.equal(rulesStripHeight(0), 1);
  assert.equal(rulesStripHeight(2), 2);
  assert.equal(rulesStripHeight(3), 3);
  assert.equal(rulesStripHeight(7), 4);
});
