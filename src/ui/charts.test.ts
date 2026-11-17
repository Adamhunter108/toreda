import { test } from "node:test";
import assert from "node:assert/strict";
import { brailleChart, sparkline } from "./charts";

/** Lit dot rows, per dot column, decoded back out of the braille characters. */
function litColumns(rows: string[]): number[][] {
  const width = rows[0]?.length ?? 0;
  const cols: number[][] = Array.from({ length: width * 2 }, () => []);
  // Bit for (column-in-cell, row-in-cell), matching charts.ts.
  const bits = [
    [0x01, 0x02, 0x04, 0x40],
    [0x08, 0x10, 0x20, 0x80],
  ];
  rows.forEach((line, cy) => {
    [...line].forEach((ch, cx) => {
      const code = ch === " " ? 0 : ch.charCodeAt(0) - 0x2800;
      for (let c = 0; c < 2; c++) {
        for (let r = 0; r < 4; r++) {
          if (code & bits[c]![r]!) cols[cx * 2 + c]!.push(cy * 4 + r);
        }
      }
    });
  });
  return cols;
}

test("a chart is exactly the requested size", () => {
  const rows = brailleChart([1, 3, 2, 5], 20, 4, true);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => [...r].length === 20));
});

// The regression: two points stretched across a wide chart used to render as
// two flat plateaus — half the chart at the low, half at the high — because
// each column took the NEAREST point. A line between two points is a ramp.
test("a sparse series is drawn as a ramp between points, not a staircase", () => {
  const heights = litColumns(brailleChart([100, 200], 40, 4, true)).map((c) => c.length);
  for (let i = 1; i < heights.length; i++) {
    assert.ok(heights[i]! >= heights[i - 1]!, `fill dropped at dot column ${i}`);
  }
  assert.ok(new Set(heights).size > 8, `only ${new Set(heights).size} distinct heights`);
});

test("a line chart has no vertical gaps on a steep move", () => {
  const cols = litColumns(brailleChart([0, 0, 10, 10], 10, 4));
  for (let x = 1; x < cols.length; x++) {
    const prev = cols[x - 1]!;
    const cur = cols[x]!;
    assert.ok(cur.length > 0, `column ${x} is empty`);
    const touches =
      Math.min(...cur) <= Math.max(...prev) + 1 && Math.max(...cur) >= Math.min(...prev) - 1;
    assert.ok(touches, `gap between dot columns ${x - 1} and ${x}`);
  }
});

test("the curve still passes through the first and last values", () => {
  const cols = litColumns(brailleChart([10, 20, 15, 30], 12, 3));
  const bottom = 3 * 4 - 1;
  assert.deepEqual(cols[0], [bottom], "first value is the minimum: bottom row");
  assert.ok(cols[cols.length - 1]!.includes(0), "last value is the maximum: top row");
});

test("a flat series draws a flat line rather than failing", () => {
  const rows = brailleChart([5, 5, 5], 10, 2);
  assert.equal(rows.length, 2);
});

test("a sparkline keeps only the most recent points that fit", () => {
  assert.equal(sparkline([1, 2, 3, 4, 5], 3).length, 3);
  assert.equal(sparkline([], 3), "");
});
