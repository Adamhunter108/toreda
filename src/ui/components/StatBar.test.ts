import { test } from "node:test";
import assert from "node:assert/strict";
import { fitStats, type Stat } from "./StatBar";

const stat = (key: string, label: string, value: string, short = value): Stat => ({
  key,
  label,
  value,
  short,
  amount: 1,
});

const demo = [
  stat("unrealized", "Unrealized", "+$3687.83 (+11.96%)", "+$3687.83"),
  stat("today", "Today", "-$509.54 (-1.30%)", "-$509.54"),
  stat("realized", "Realized", "+$1284.40"),
];

const width = (r: ReturnType<typeof fitStats>): number =>
  r.stats.reduce(
    (w, s) =>
      w + s.label.length + 1 + (r.short ? s.short : s.value).length + (r.notes && s.note ? 1 + s.note.length : 0),
    0,
  ) +
  r.gap * Math.max(0, r.stats.length - 1);

// A day with a deposit in it.
const deposited = [
  demo[0]!,
  { ...stat("today", "Today", "-$40.00 (-1.00%)", "-$40.00"), note: "excl. +$1,000 deposited" },
  demo[2]!,
];

test("the transfer note shows when there is room for it", () => {
  const r = fitStats(deposited, 120);
  assert.equal(r.notes, true);
  assert.equal(r.stats.length, 3);
  assert.ok(width(r) <= 120);
});

test("the transfer note is the first thing to go, before any figure", () => {
  const r = fitStats(deposited, 78);
  assert.equal(r.notes, false);
  assert.equal(r.stats.length, 3, "Realized kept over the note");
});

test("the line with a note always fits", () => {
  for (let available = 15; available <= 160; available++) {
    const r = fitStats(deposited, available);
    assert.ok(width(r) <= available, `${width(r)} > ${available}`);
  }
});

// The regression: at 80 columns this line was two characters too wide, and Ink
// deleted the spaces after "Unrealized" and "Today" to make it fit.
test("the demo figures fit an 80-column terminal intact", () => {
  const r = fitStats(demo, 78);
  assert.equal(r.stats.length, 3);
  assert.ok(width(r) <= 78);
});

test("the line always fits, however narrow", () => {
  for (let available = 10; available <= 120; available++) {
    const r = fitStats(demo, available);
    const w = width(r);
    // Below the width of Today alone nothing can fit; above it, everything shown must.
    if (available >= "Today -$509.54".length) assert.ok(w <= available, `${w} > ${available}`);
  }
});

test("Today is the last figure to go", () => {
  const r = fitStats(demo, 20);
  assert.deepEqual(
    r.stats.map((s) => s.key),
    ["today"],
  );
});

test("Realized is dropped before any percentage is", () => {
  // "Unrealized +$3687.83 (+11.96%)" (30) + gap 3 + "Today -$509.54 (-1.30%)" (23)
  const r = fitStats(demo, 56);
  assert.deepEqual(
    r.stats.map((s) => s.key),
    ["unrealized", "today"],
  );
  assert.equal(r.short, false);
});
