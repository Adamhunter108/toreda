import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, hasFlag, flagValue } from "./args";

test("splits the command from its positionals", () => {
  const a = parseArgs(["quote", "NVDA", "AMD"]);
  assert.equal(a.command, "quote");
  assert.deepEqual(a.positionals, ["NVDA", "AMD"]);
});

test("no arguments yields a null command", () => {
  const a = parseArgs([]);
  assert.equal(a.command, null);
  assert.deepEqual(a.positionals, []);
});

test("bare flags are boolean", () => {
  const a = parseArgs(["order", "NVDA", "buy", "5", "--confirm"]);
  assert.equal(a.flags.confirm, true);
  assert.deepEqual(a.positionals, ["NVDA", "buy", "5"]);
});

test("--flag=value form", () => {
  const a = parseArgs(["brief", "--out=report.txt"]);
  assert.equal(a.flags.out, "report.txt");
});

test("--flag value form only for declared value flags", () => {
  const a = parseArgs(["brief", "--out", "report.txt"], { valueFlags: ["out"] });
  assert.equal(a.flags.out, "report.txt");
  assert.deepEqual(a.positionals, []);
});

// The safety case this parser exists for: --confirm is not a value flag, so it
// must not swallow the token after it. If it did, `--confirm` would read as the
// string "NVDA" and a truthiness check would still transmit the order — while
// the symbol silently vanished from the positionals.
test("an undeclared flag never consumes the next token", () => {
  const a = parseArgs(["order", "--confirm", "NVDA", "buy", "5"]);
  assert.equal(a.flags.confirm, true);
  assert.deepEqual(a.positionals, ["NVDA", "buy", "5"]);
});

test("negative numbers are positionals, not flags", () => {
  const a = parseArgs(["config", "set", "stopLossPct", "-7"]);
  assert.deepEqual(a.positionals, ["set", "stopLossPct", "-7"]);
  assert.deepEqual(a.flags, {});
});

test("bundled short flags expand", () => {
  const a = parseArgs(["scan", "-vq"]);
  assert.equal(a.flags.v, true);
  assert.equal(a.flags.q, true);
});

test("everything after -- is positional", () => {
  const a = parseArgs(["scan", "--", "--not-a-flag"]);
  assert.deepEqual(a.positionals, ["--not-a-flag"]);
  assert.equal(a.flags["not-a-flag"], undefined);
});

test("a value flag at the end of argv stays boolean rather than consuming nothing", () => {
  const a = parseArgs(["brief", "--out"], { valueFlags: ["out"] });
  assert.equal(a.flags.out, true);
});

test("a value flag does not consume a following flag", () => {
  const a = parseArgs(["brief", "--out", "--telegram"], { valueFlags: ["out"] });
  assert.equal(a.flags.out, true);
  assert.equal(a.flags.telegram, true);
});

test("hasFlag accepts aliases", () => {
  const a = parseArgs(["scan", "-h"]);
  assert.equal(hasFlag(a, "help", "h"), true);
  assert.equal(hasFlag(a, "verbose"), false);
});

test("flagValue returns strings only, never a bare boolean", () => {
  const a = parseArgs(["brief", "--out=x.txt", "--telegram"]);
  assert.equal(flagValue(a, "out"), "x.txt");
  assert.equal(flagValue(a, "telegram"), undefined);
});
