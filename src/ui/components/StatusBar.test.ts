import { test } from "node:test";
import assert from "node:assert/strict";
import { fitHint } from "./StatusBar";

const HINT = "o order · A disarm · h history · g signals · c settings · w watchlist · t theme · q quit";

test("a hint that fits is returned unchanged", () => {
  assert.equal(fitHint(HINT, HINT.length), HINT);
  assert.equal(fitHint(HINT, 500), HINT);
});

// Ink clips an overflowing row mid-character, which fused two independent
// readings into "stream ●connectin1 pos". Dropping whole segments keeps every
// surviving token readable.
test("an overlong hint drops trailing segments rather than mid-word", () => {
  const out = fitHint(HINT, 40);
  assert.ok(out.length <= 40, `got ${out.length} chars: ${out}`);
  assert.ok(out.endsWith("…"), "truncation should be marked");
  // Whatever survives must be whole segments, never a severed word.
  for (const seg of out.replace(" …", "").split(" · ")) {
    assert.ok(HINT.includes(seg), `"${seg}" is not a whole segment of the hint`);
  }
});

test("the most important segment is kept, the least important dropped first", () => {
  // Segments are ordered most- to least-important, so the head survives.
  const out = fitHint(HINT, 30);
  assert.ok(out.startsWith("o order"), out);
  assert.ok(!out.includes("q quit"), out);
});

test("progressively less room yields progressively shorter hints", () => {
  const wide = fitHint(HINT, 80);
  const narrow = fitHint(HINT, 40);
  const tiny = fitHint(HINT, 20);
  assert.ok(wide.length >= narrow.length);
  assert.ok(narrow.length >= tiny.length);
});

test("a single segment too long for the space is hard-truncated", () => {
  const out = fitHint("averylongsinglesegmentwithnobreaks", 10);
  assert.equal(out.length, 10);
});

test("no room at all yields nothing rather than a stray ellipsis", () => {
  assert.equal(fitHint(HINT, 0), "");
  assert.equal(fitHint(HINT, -5), "");
});

test("an empty hint stays empty", () => {
  assert.equal(fitHint("", 40), "");
});
