import { test } from "node:test";
import assert from "node:assert/strict";
import { THEME_ORDER, THEMES } from "./theme";

const HEX = /^#[0-9a-f]{6}$/i;
const ROLES = ["positive", "negative", "warning", "accent", "info", "muted"] as const;

test("every theme is in the picker exactly once, and every picker entry exists", () => {
  assert.deepEqual([...THEME_ORDER].sort(), Object.keys(THEMES).sort());
  assert.equal(new Set(THEME_ORDER).size, THEME_ORDER.length);
  assert.equal(THEME_ORDER.at(-1), "Default", "Default stays last");
});

test("each theme's name matches its key, which config/ui.json stores", () => {
  for (const [key, theme] of Object.entries(THEMES)) assert.equal(theme.name, key);
});

test("every explicit theme is hex throughout, and the chart stops always are", () => {
  for (const theme of Object.values(THEMES)) {
    for (const stop of [...theme.graph.up, ...theme.graph.down]) assert.match(stop, HEX, `${theme.name} graph`);
    if (theme.name === "Default") continue;
    for (const role of ROLES) assert.match(theme[role], HEX, `${theme.name} ${role}`);
    assert.match(theme.text ?? "", HEX, `${theme.name} text`);
    assert.match(theme.border ?? "", HEX, `${theme.name} border`);
  }
});

// Gains, losses, warnings and the cursor carry meaning; two of them drawn in
// the same colour would make a theme quietly wrong.
test("no theme draws two meanings in the same colour", () => {
  for (const theme of Object.values(THEMES)) {
    const colours = [theme.positive, theme.negative, theme.warning, theme.accent].map((c) => c.toLowerCase());
    assert.equal(new Set(colours).size, colours.length, theme.name);
  }
});
