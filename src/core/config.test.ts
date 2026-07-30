import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnvFile, resolveMode, modeLabel, TRADE_HOSTS } from "./config";

test("parses plain KEY=VALUE pairs", () => {
  const env = parseEnvFile("ALPACA_MODE=paper\nALPACA_PAPER_KEY_ID=abc123");
  assert.equal(env.ALPACA_MODE, "paper");
  assert.equal(env.ALPACA_PAPER_KEY_ID, "abc123");
});

test("ignores comments and blank lines", () => {
  const env = parseEnvFile("# a comment\n\n  # indented\nKEY=value\n");
  assert.deepEqual(env, { KEY: "value" });
});

test("strips a leading export, as the source template used", () => {
  const env = parseEnvFile("export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-xyz");
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "sk-ant-oat-xyz");
});

test("strips matched surrounding quotes", () => {
  const env = parseEnvFile(`A="quoted"\nB='single'\nC=bare`);
  assert.equal(env.A, "quoted");
  assert.equal(env.B, "single");
  assert.equal(env.C, "bare");
});

test("keeps unmatched quotes, which are part of the value", () => {
  const env = parseEnvFile(`A="unbalanced`);
  assert.equal(env.A, '"unbalanced');
});

test("an empty value is empty, not missing", () => {
  const env = parseEnvFile("TELEGRAM_BOT_TOKEN=");
  assert.equal(env.TELEGRAM_BOT_TOKEN, "");
  assert.ok("TELEGRAM_BOT_TOKEN" in env);
});

test("values containing = survive intact", () => {
  const env = parseEnvFile("TOKEN=abc=def==");
  assert.equal(env.TOKEN, "abc=def==");
});

test("malformed lines are skipped rather than throwing", () => {
  const env = parseEnvFile("this is not a pair\nGOOD=yes");
  assert.deepEqual(env, { GOOD: "yes" });
});

// ── Mode resolution: the single most safety-relevant function here ──────────
// Anything that is not exactly "live" must be paper. A typo has to fail safe,
// because the failure direction is real money.

test("only an exact 'live' selects the live account", () => {
  assert.equal(resolveMode("live"), "live");
  assert.equal(resolveMode("LIVE"), "live");
  assert.equal(resolveMode("  live  "), "live");
});

test("anything else is paper", () => {
  for (const value of [undefined, "", "  ", "paper", "liv", "livee", "l1ve", "real", "true", "1"]) {
    assert.equal(resolveMode(value), "paper", `expected paper for ${JSON.stringify(value)}`);
  }
});

test("each mode has its own endpoint and they are not the same", () => {
  assert.equal(TRADE_HOSTS.paper, "https://paper-api.alpaca.markets");
  assert.equal(TRADE_HOSTS.live, "https://api.alpaca.markets");
  assert.notEqual(TRADE_HOSTS.paper, TRADE_HOSTS.live);
});

test("the live banner is unmissable", () => {
  assert.match(modeLabel("live"), /REAL MONEY/);
  assert.match(modeLabel("paper"), /fake money/);
});
