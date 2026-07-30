import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEnvFile, listPresets, loadPreset } from "./setup";
import { parseEnvFile } from "../../core/config";

const answers = {
  mode: "paper" as const,
  paperKeyId: "PK_TEST",
  paperSecret: "SECRET_TEST",
  liveKeyId: "",
  liveSecret: "",
};

test("the written .env round-trips through the parser", () => {
  const env = parseEnvFile(buildEnvFile(answers));
  assert.equal(env.ALPACA_PAPER_KEY_ID, "PK_TEST");
  assert.equal(env.ALPACA_PAPER_SECRET, "SECRET_TEST");
  assert.equal(env.ALPACA_MODE, "paper");
});

test("live keys are written empty when not provided, not omitted", () => {
  // Present-but-empty documents that the field exists, so a user switching to
  // live later finds the line rather than having to know its name.
  const text = buildEnvFile(answers);
  assert.match(text, /^ALPACA_LIVE_KEY_ID=$/m);
  assert.match(text, /^ALPACA_LIVE_SECRET=$/m);
});

// Re-running setup must not silently destroy a Telegram bot token or Claude
// token the user configured separately — those are not part of the core path,
// so the wizard never asks about them and could not restore them.
test("optional values already in .env are preserved on rewrite", () => {
  const existing = {
    TELEGRAM_BOT_TOKEN: "123:abc",
    TELEGRAM_CHAT_ID: "456",
    CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-xyz",
  };
  const env = parseEnvFile(buildEnvFile(answers, existing));
  assert.equal(env.TELEGRAM_BOT_TOKEN, "123:abc");
  assert.equal(env.TELEGRAM_CHAT_ID, "456");
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat-xyz");
});

test("absent optional values become empty rather than the string undefined", () => {
  const env = parseEnvFile(buildEnvFile(answers));
  assert.equal(env.TELEGRAM_BOT_TOKEN, "");
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "");
});

test("live mode is written through faithfully", () => {
  const env = parseEnvFile(
    buildEnvFile({
      mode: "live",
      paperKeyId: "PK",
      paperSecret: "PS",
      liveKeyId: "LK",
      liveSecret: "LS",
    }),
  );
  assert.equal(env.ALPACA_MODE, "live");
  assert.equal(env.ALPACA_LIVE_KEY_ID, "LK");
  // Paper keys survive alongside live, so `ALPACA_MODE=paper toreda …` still
  // works as a safe-testing override.
  assert.equal(env.ALPACA_PAPER_KEY_ID, "PK");
});

test("the file warns against committing it", () => {
  assert.match(buildEnvFile(answers), /never commit it/i);
});

// ── Presets ─────────────────────────────────────────────────────────────────

test("every preset offered by the wizard exists on disk", () => {
  for (const name of ["broad-market", "technology", "dividend-value"]) {
    assert.ok(loadPreset(name), `preset ${name} is missing`);
  }
});

test("an unknown preset returns null rather than throwing", () => {
  assert.equal(loadPreset("does-not-exist"), null);
});

test("presets are listed from disk", () => {
  const presets = listPresets();
  assert.ok(presets.includes("broad-market"));
  assert.ok(presets.length >= 3);
});

test("every preset has sectors and symbols", () => {
  for (const name of listPresets()) {
    const preset = loadPreset(name);
    assert.ok(preset, name);
    const sectors = Object.keys(preset.sectors);
    assert.ok(sectors.length > 0, `${name} has no sectors`);
    for (const sector of sectors) {
      assert.ok(preset.sectors[sector]!.length > 0, `${name}/${sector} is empty`);
    }
  }
});

test("preset symbols are uppercase and unique within a preset", () => {
  for (const name of listPresets()) {
    const symbols = Object.values(loadPreset(name)!.sectors).flat();
    assert.equal(new Set(symbols).size, symbols.length, `${name} has duplicate symbols`);
    for (const s of symbols) assert.equal(s, s.toUpperCase(), `${name}: ${s} is not uppercase`);
  }
});

// The default offered first must not teach the concentration mistake the
// building-a-watchlist doc warns about.
test("the default preset spans several sectors", () => {
  assert.ok(Object.keys(loadPreset("broad-market")!.sectors).length >= 6);
});

test("the concentrated preset says so in its own comment", () => {
  const preset = loadPreset("technology");
  assert.ok(preset?._comment?.join(" ").match(/concentrated|move together|one position/i));
});
